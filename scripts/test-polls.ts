/**
 * "Ask the group" polls against a migrated, disposable database: membership
 * and role enforcement, one response per person under concurrency, deadlines,
 * vote changes, abstention and ties, departed members, cross-trip rejection,
 * no automatic scheduling, duplicate-safe result application, notifications.
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:polls
 *
 * Uses the real data layer and the real write gate (`runTripWrite`) as
 * several users. Test records are removed at the end.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db";
import * as n from "../src/db/notifications";
import * as pollDb from "../src/db/polls";
import * as q from "../src/db/queries";
import * as sh from "../src/db/sharing";
import { notifications, trips } from "../src/db/schema";
import { ForbiddenError, can, type Capability } from "../src/lib/sharing";
import { deadlineInstant, formatDeadline, pollPermissions, standing, tallyVotes, decisionSummary } from "../src/lib/polls";
import type { ItineraryItemInput, PlaceInput, TripInput } from "../src/lib/types";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to a migrated, disposable database.");
  process.exit(1);
}
const { db, pool } = createDb(url);
const id = () => `test-${randomUUID()}`;
const [OWNER, EDITOR, EDITOR2, VIEWER, STRANGER, OTHER_OWNER] = [id(), id(), id(), id(), id(), id()];
let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const tripInput = (title: string): TripInput => ({
  title,
  destination: "Aruba",
  start_date: "2026-10-14",
  end_date: "2026-10-19",
  time_zone: "America/Aruba",
  travelers: ["A", "B"],
  cover_image: "beach",
  notes: null,
});
const place = (name: string): PlaceInput => ({ name, kind: "food", category: "restaurant", priority: "maybe", address: null, maps_url: null, website_url: null, planning_notes: null });
const visit = (title: string | null, over: Partial<ItineraryItemInput> = {}): ItineraryItemInput => ({
  place_id: null, reservation_id: null, title, category: "activity", local_date: "2026-10-15", local_start_time: "18:00",
  local_end_date: null, local_end_time: null, timezone: null, planning_notes: null, ...over,
});

const as = <T>(user: string, tripId: string, cap: Capability, fn: (d: typeof db, c: sh.TripContext) => Promise<T>) =>
  sh.runTripWrite(db, user, tripId, cap, "NO_ACCESS" as const, fn);
const forbidden = (p: Promise<unknown>) => assert.rejects(p, (e) => e instanceof ForbiddenError);

async function join(tripId: string, ownerId: string, userId: string, role: "editor" | "viewer") {
  const made = await sh.createInvitation(db, { ownerId, tripId, invitedBy: ownerId, inviterName: "Olive", email: null, role });
  assert.ok(made.ok);
  assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(made.token), userId, verifiedEmail: null, emailUnverified: false })).status, "ok");
}

type Input = Partial<pollDb.PollInput>;
const input = (over: Input = {}): pollDb.PollInput => ({
  question: "Where should we eat?",
  description: null,
  options: [{ label: "Friday", place_id: null }, { label: "Saturday", place_id: null }],
  any_option: true,
  closes: null,
  parent: { type: "trip" },
  participant_ids: null,
  replaces_poll_id: null,
  ...over,
});

async function main() {
  const createdTrips: string[] = [];
  const mkTrip = async (owner: string, title: string) => {
    const { id: tripId } = await q.createTrip(db, owner, tripInput(title));
    createdTrips.push(tripId);
    return tripId;
  };
  const T = await mkTrip(OWNER, "Aruba");
  await join(T, OWNER, EDITOR, "editor");
  await join(T, OWNER, EDITOR2, "editor");
  await join(T, OWNER, VIEWER, "viewer");
  const OTHER = await mkTrip(OTHER_OWNER, "Someone else's trip");
  const foreignPlace = await q.createPlace(db, OTHER_OWNER, OTHER, place("Foreign Cafe"), undefined);
  assert.ok(foreignPlace.ok);
  const foreignItem = await q.createItineraryItem(db, OTHER_OWNER, OTHER, visit("Foreign dinner"), {});
  assert.ok(foreignItem.ok);
  const sibling = await mkTrip(OWNER, "Same owner, other trip");
  const siblingPlace = await q.createPlace(db, OWNER, sibling, place("Sibling Cafe"), undefined);
  assert.ok(siblingPlace.ok);
  const pA = await q.createPlace(db, OWNER, T, place("Zeerovers"), undefined);
  const pB = await q.createPlace(db, OWNER, T, place("Wilhelmina's"), undefined);
  assert.ok(pA.ok && pB.ok);
  for (const u of [OWNER, EDITOR, EDITOR2, VIEWER]) await sh.upsertProfile(db, { id: u, name: `Name ${u.slice(5, 9)}`, email: null });

  const create = (user: string, over: Input = {}, tripId = T) =>
    as(user, tripId, "contribute", (d, c) => pollDb.createPoll(d, c, tripId, input(over), "Eddie"));
  const vote = (user: string, pollId: string, response: pollDb.VoteResponse, tripId = T) =>
    as(user, tripId, "participate", (d, c) => pollDb.castVote(d, c, tripId, pollId, response));
  const view = async (user: string, pollId: string, tripId = T) => {
    const r = await as(user, tripId, "read", (d, c) => pollDb.listPolls(d, c, tripId));
    assert.ok(r !== "NO_ACCESS");
    return r.find((p) => p.id === pollId)!;
  };
  const make = async (user: string, over: Input = {}) => {
    const r = await create(user, over);
    assert.ok(r !== "NO_ACCESS" && r.ok, JSON.stringify(r));
    return r.id;
  };

  console.log("Permissions and membership");
  await check("owners and editors can ask; viewers and strangers cannot", async () => {
    assert.ok((await create(OWNER)) !== "NO_ACCESS");
    assert.ok((await create(EDITOR)) !== "NO_ACCESS");
    await forbidden(create(VIEWER));
    assert.equal(await create(STRANGER), "NO_ACCESS");
  });
  let poll = "";
  await check("a viewer can vote, a stranger cannot, and a vote changes nothing else on the trip", async () => {
    poll = await make(EDITOR, { question: "Which day for the spa?" });
    const items = (await q.listItinerary(db, OWNER, T))!.length;
    const r = await vote(VIEWER, poll, { option_id: (await view(VIEWER, poll)).options[0].id });
    assert.ok(r !== "NO_ACCESS" && r.ok);
    assert.equal(await vote(STRANGER, poll, { any: true }), "NO_ACCESS");
    assert.equal((await q.listItinerary(db, OWNER, T))!.length, items);
    const v = await view(VIEWER, poll);
    assert.equal(v.can.vote, true);
    assert.equal(v.me.response?.option_id, v.options[0].id);
  });
  await check("the viewer exception is narrow: no itinerary, place, packing or trip changes", async () => {
    await forbidden(as(VIEWER, T, "contribute", (d, c) => q.createItineraryItem(d, c.ownerId, T, visit("Sneaky"), {})));
    await forbidden(as(VIEWER, T, "contribute", (d, c) => q.createPlace(d, c.ownerId, T, place("Sneaky"), undefined)));
    await forbidden(as(VIEWER, T, "manage_trip", async () => 1));
    assert.ok(can("viewer", "participate") && !can("viewer", "contribute"));
  });
  await check("only the asker or the owner can close, cancel or decide; others — even editors — cannot", async () => {
    const p = await make(EDITOR);
    await forbidden(as(EDITOR2, T, "participate", (d, c) => pollDb.closePoll(d, c, T, p)));
    await forbidden(as(VIEWER, T, "participate", (d, c) => pollDb.cancelPoll(d, c, T, p)));
    const opt = (await view(OWNER, p)).options[0].id;
    await forbidden(as(EDITOR2, T, "participate", (d, c) => pollDb.chooseResult(d, c, T, p, opt, "x")));
    assert.ok((await as(OWNER, T, "participate", (d, c) => pollDb.closePoll(d, c, T, p))) !== "NO_ACCESS");
    assert.equal((await view(OWNER, p)).status, "closed");
    const p2 = await make(EDITOR);
    const r = await as(EDITOR, T, "participate", (d, c) => pollDb.cancelPoll(d, c, T, p2));
    assert.ok(r !== "NO_ACCESS" && r.ok);
  });
  await check("the permission function mirrors the rules (apply = editors; viewers never)", () => {
    const base = { userId: "u", createdBy: "c", status: "closed" as const, expired: false, asked: true, hasVotes: true, hasResult: true };
    assert.equal(pollPermissions({ ...base, role: "editor" }).apply, true);
    assert.equal(pollPermissions({ ...base, role: "viewer" }).apply, false);
    assert.equal(pollPermissions({ ...base, role: "viewer", status: "open" }).vote, true);
    assert.equal(pollPermissions({ ...base, role: "viewer", status: "open", asked: false }).vote, false);
    assert.equal(pollPermissions({ ...base, role: null, status: "open" }).vote, false);
    assert.equal(pollPermissions({ ...base, role: "owner", status: "open", hasResult: false, hasVotes: true }).edit, false);
    assert.equal(pollPermissions({ ...base, role: "owner", status: "open", hasResult: false, hasVotes: false }).edit, true);
  });

  console.log("Linked resources stay inside the trip");
  await check("cross-trip places and activities are refused (other owner, and the same owner's other trip)", async () => {
    for (const bad of [foreignPlace.id, siblingPlace.id]) {
      const r = await create(OWNER, { options: [{ label: "x", place_id: bad }, { label: "Saturday", place_id: null }] });
      assert.ok(r !== "NO_ACCESS" && !r.ok && r.reason === "option_place_not_in_trip");
    }
    for (const parent of [{ type: "place", place_id: foreignPlace.id }, { type: "place", place_id: siblingPlace.id }, { type: "activity", item_id: foreignItem.id }, { type: "day", day: "2027-01-01" }] as const) {
      const r = await create(OWNER, { parent });
      assert.ok(r !== "NO_ACCESS" && !r.ok && r.reason === "bad_parent", JSON.stringify(parent));
    }
  });
  await check("the database itself refuses a cross-trip link", async () => {
    const p = await make(OWNER);
    await assert.rejects(db.execute(sql`update polls set parent_type = 'place', parent_place_id = ${foreignPlace.id} where id = ${p}`));
    await assert.rejects(db.execute(sql`insert into poll_options (poll_id, trip_id, position, label, place_id) values (${p}, ${T}, 3, 'x', ${foreignPlace.id})`));
    await assert.rejects(db.execute(sql`insert into poll_votes (poll_id, trip_id, owner_id, user_id, option_id) values (${p}, ${OTHER}, ${OTHER_OWNER}, ${STRANGER}, null)`));
  });
  await check("option, option-count, duplicate, deadline and participant rules", async () => {
    const reasons = async (over: Input) => {
      const r = await create(OWNER, over);
      return r !== "NO_ACCESS" && !r.ok ? r.reason : "ok";
    };
    assert.equal(await reasons({ options: [{ label: "Only one", place_id: null }] }), "duplicate_options");
    assert.equal(await reasons({ options: [1, 2, 3, 4].map((i) => ({ label: `o${i}`, place_id: null })) }), "duplicate_options");
    assert.equal(await reasons({ options: [{ label: "Friday", place_id: null }, { label: "friday", place_id: null }] }), "duplicate_options");
    assert.equal(await reasons({ options: [{ label: "", place_id: pA.id }, { label: "", place_id: pA.id }] }), "duplicate_options");
    assert.equal(await reasons({ closes: { date: "2020-01-01", time: "10:00" } }), "deadline_past");
    assert.equal(await reasons({ participant_ids: [STRANGER] }), "participant_not_member");
    assert.equal(await reasons({ participant_ids: [OTHER_OWNER] }), "participant_not_member");
  });

  console.log("Creating a poll");
  let spa = "";
  await check("an Explore option is stored by reference; text options are plain; no one is invited or added", async () => {
    const membersBefore = (await sh.listMembers(db, OWNER, T)).length;
    const invitesBefore = (await sh.listOpenInvitations(db, OWNER, T)).length;
    spa = await make(EDITOR, { question: "Which restaurant?", options: [{ label: "", place_id: pA.id }, { label: "", place_id: pB.id }, { label: "Cook at home", place_id: null }], parent: { type: "day", day: "2026-10-16" }, description: "Last night" });
    const v = await view(OWNER, spa);
    assert.deepEqual(v.options.map((o) => o.label), ["Zeerovers", "Wilhelmina's", "Cook at home"]);
    assert.equal(v.options[0].place?.id, pA.id);
    assert.equal(v.options[2].place, null);
    assert.equal(v.parent.day, "2026-10-16");
    assert.equal(v.any_option, true);
    assert.equal((await sh.listMembers(db, OWNER, T)).length, membersBefore);
    assert.equal((await sh.listOpenInvitations(db, OWNER, T)).length, invitesBefore);
    assert.equal(v.participants.length, 4);
  });
  await check("the deadline is entered in the trip's zone and stored as that real moment", () => {
    assert.equal(deadlineInstant("2026-10-16", "17:00", "America/Aruba"), "2026-10-16T21:00:00.000Z");
    assert.equal(formatDeadline("2026-10-16T21:00:00.000Z", "America/Aruba"), "Fri, Oct 16 at 5:00 PM AST");
    assert.equal(deadlineInstant("2026-13-40", "25:00", "America/Aruba"), null);
  });
  await check("a chosen subset of members is asked; the creator is always included", async () => {
    const p = await make(OWNER, { participant_ids: [VIEWER] });
    const v = await view(OWNER, p);
    assert.deepEqual(v.participants.map((x) => x.user_id).sort(), [OWNER, VIEWER].sort());
    const r = await vote(EDITOR, p, { any: true });
    assert.ok(r !== "NO_ACCESS" && !r.ok && r.reason === "not_participant", "being on the trip is not enough — they were not asked");
    assert.equal((await view(EDITOR, p)).can.vote, false);
  });

  console.log("Notifications");
  const plan = async (user: string, type: string) => (await db.select().from(notifications).where(sql`${notifications.recipient_id} = ${user} and ${notifications.type} = ${type}`));
  await check("opening a poll notifies the asked members, not the creator or strangers — once", async () => {
    const forSpa = (user: string) => db.select().from(notifications).where(sql`${notifications.recipient_id} = ${user} and ${notifications.resource_id} = ${spa} and ${notifications.type} = 'poll_vote_needed'`);
    assert.equal((await forSpa(EDITOR)).length, 0, "creator");
    for (const u of [OWNER, EDITOR2, VIEWER]) assert.equal((await forSpa(u)).length, 1, u);
    assert.equal((await forSpa(STRANGER)).length, 0);
    const [row] = await forSpa(VIEWER);
    assert.equal(row.title, "Ask the group");
    assert.match(row.body, /asked: “Which restaurant\?”/);
    const item = (await n.listNotifications(db, { id: VIEWER, verifiedEmail: null })).items.find((i) => i.id === row.id)!;
    assert.equal(item.href, `/trips/${T}/polls?poll=${spa}`);
  });
  await check("voting notifies nobody", async () => {
    const before = (await db.select().from(notifications)).length;
    await vote(VIEWER, spa, { option_id: (await view(VIEWER, spa)).options[0].id });
    await vote(OWNER, spa, { any: true });
    assert.equal((await db.select().from(notifications)).length, before);
  });

  console.log("Voting");
  await check("one response per person, even under concurrent requests", async () => {
    const p = await make(OWNER);
    const opts = (await view(OWNER, p)).options;
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => vote(VIEWER, p, i % 3 === 2 ? { any: true } : { option_id: opts[i % 2].id })));
    assert.ok(results.every((r) => r !== "NO_ACCESS" && r.ok));
    const rows = (await db.execute(sql`select * from poll_votes where poll_id = ${p} and user_id = ${VIEWER}`)).rows;
    assert.equal(rows.length, 1);
    await Promise.all([EDITOR, EDITOR2, OWNER].map((u) => vote(u, p, { option_id: opts[0].id })));
    assert.equal((await db.execute(sql`select 1 from poll_votes where poll_id = ${p}`)).rows.length, 4);
  });
  await check("a vote can be changed while the poll is open; totals follow", async () => {
    const p = await make(OWNER);
    const [a, b] = (await view(OWNER, p)).options;
    await vote(VIEWER, p, { option_id: a.id });
    assert.equal((await view(OWNER, p)).tally.counts[a.id], 1);
    await vote(VIEWER, p, { option_id: b.id });
    const v = await view(OWNER, p);
    assert.equal(v.tally.counts[a.id], 0);
    assert.equal(v.tally.counts[b.id], 1);
    assert.equal(v.votes.length, 1);
    assert.equal(v.votes[0].option_id, b.id);
    assert.ok(v.votes[0].name, "who voted is visible to the group");
  });
  await check("'Any works for me' is an abstention, not a vote for every option", async () => {
    const p = await make(OWNER);
    const v0 = await view(OWNER, p);
    await vote(VIEWER, p, { any: true });
    const v = await view(OWNER, p);
    assert.equal(v.tally.any, 1);
    assert.equal(v.tally.voted, 1);
    assert.ok(v.options.every((o) => v.tally.counts[o.id] === 0));
    assert.deepEqual(v.tally.leaders, []);
    assert.equal(standing(v.tally), "none");
    assert.equal(v.options.length, v0.options.length, "it is not an option");
    const off = await make(OWNER, { any_option: false });
    const r = await vote(VIEWER, off, { any: true });
    assert.ok(r !== "NO_ACCESS" && !r.ok && r.reason === "bad_option");
    const bad = await vote(VIEWER, p, { option_id: randomUUID() });
    assert.ok(bad !== "NO_ACCESS" && !bad.ok && bad.reason === "bad_option");
  });
  await check("ties stay ties; a leader is not a decision", async () => {
    const p = await make(OWNER);
    const [a, b] = (await view(OWNER, p)).options;
    await vote(VIEWER, p, { option_id: a.id });
    await vote(EDITOR, p, { option_id: b.id });
    const v = await view(OWNER, p);
    assert.deepEqual([...v.tally.leaders].sort(), [a.id, b.id].sort());
    assert.equal(standing(v.tally), "tied");
    assert.equal(v.status, "open");
    assert.equal(v.result, null);
    await vote(EDITOR2, p, { option_id: a.id });
    const v2 = await view(OWNER, p);
    assert.equal(standing(v2.tally), "leading");
    assert.equal(v2.result, null, "a leader is not a confirmed decision");
    assert.equal((await db.execute(sql`select result_option_id from polls where id = ${p}`)).rows[0].result_option_id, null);
    assert.deepEqual(tallyVotes(["a", "b"], [{ option_id: "a" }, { option_id: null }], 3).leaders, ["a"]);
  });

  console.log("Deadlines");
  await check("votes are refused after the deadline even though nothing closed the poll", async () => {
    const p = await make(OWNER, { closes: { date: "2026-12-30", time: "17:00" } });
    const opt = (await view(OWNER, p)).options[0].id;
    assert.ok((await vote(VIEWER, p, { option_id: opt })) !== "NO_ACCESS");
    await db.execute(sql`update polls set closes_at = now() - interval '1 second' where id = ${p}`); // time passes; no job runs
    assert.equal((await db.execute(sql`select status from polls where id = ${p}`)).rows[0].status, "open");
    const late = await vote(VIEWER, p, { option_id: opt });
    assert.ok(late !== "NO_ACCESS" && !late.ok && late.reason === "closed");
    const v = await view(VIEWER, p);
    assert.equal(v.expired, true);
    assert.equal(v.can.vote, false);
    assert.equal(v.me.response?.option_id, opt, "their earlier answer is kept");
    // The organizer can still decide after the deadline.
    const r = await as(OWNER, T, "participate", (d, c) => pollDb.chooseResult(d, c, T, p, opt, "Olive"));
    assert.ok(r !== "NO_ACCESS" && r.ok);
  });
  await check("a manually closed or canceled poll takes no votes; no deadline means it stays open", async () => {
    const open = await make(OWNER);
    assert.equal((await view(OWNER, open)).expired, false);
    const opt = (await view(OWNER, open)).options[0].id;
    await as(OWNER, T, "participate", (d, c) => pollDb.closePoll(d, c, T, open));
    const r = await vote(VIEWER, open, { option_id: opt });
    assert.ok(r !== "NO_ACCESS" && !r.ok && r.reason === "closed");
    const c = await make(OWNER);
    await as(OWNER, T, "participate", (d, cc) => pollDb.cancelPoll(d, cc, T, c));
    const r2 = await vote(VIEWER, c, { any: true });
    assert.ok(r2 !== "NO_ACCESS" && !r2.ok && r2.reason === "canceled");
  });

  console.log("The organizer's decision");
  let decided = "";
  await check("choosing a result is explicit, may differ from the leader, closes the poll and notifies — adding nothing to the itinerary", async () => {
    decided = await make(EDITOR, { question: "Which outing?", options: [{ label: "", place_id: pA.id }, { label: "Beach day", place_id: null }] });
    const [a, b] = (await view(OWNER, decided)).options;
    await vote(VIEWER, decided, { option_id: b.id });
    await vote(EDITOR2, decided, { option_id: b.id });
    await vote(OWNER, decided, { option_id: a.id });
    const itemsBefore = (await q.listItinerary(db, OWNER, T))!.length;
    const visitsBefore = (await db.execute(sql`select count(*)::int as n from itinerary_items where trip_id = ${T}`)).rows[0].n;
    const r = await as(EDITOR, T, "participate", (d, c) => pollDb.chooseResult(d, c, T, decided, a.id, "Eddie"));
    assert.ok(r !== "NO_ACCESS" && r.ok);
    const v = await view(OWNER, decided);
    assert.equal(v.status, "closed");
    assert.equal(v.result?.option_id, a.id, "the organizer's choice, not the leader");
    assert.deepEqual(v.tally.leaders, [b.id]);
    assert.equal((await q.listItinerary(db, OWNER, T))!.length, itemsBefore);
    assert.equal((await db.execute(sql`select count(*)::int as n from itinerary_items where trip_id = ${T}`)).rows[0].n, visitsBefore);
    for (const u of [OWNER, EDITOR2, VIEWER]) {
      const got = (await plan(u, "poll_result")).filter((x) => x.resource_id === decided);
      assert.equal(got.length, 1, u);
      assert.match(got[0].body, /Eddie chose “Zeerovers”/);
    }
    assert.equal((await plan(EDITOR, "poll_result")).filter((x) => x.resource_id === decided).length, 0);
    assert.equal((await plan(STRANGER, "poll_result")).length, 0);
    const again = await as(EDITOR, T, "participate", (d, c) => pollDb.chooseResult(d, c, T, decided, b.id, "Eddie"));
    assert.ok(again !== "NO_ACCESS" && !again.ok && again.reason === "already_chosen");
    assert.equal((await plan(OWNER, "poll_result")).filter((x) => x.resource_id === decided).length, 1, "no duplicate");
    const cancel = await as(OWNER, T, "participate", (d, c) => pollDb.cancelPoll(d, c, T, decided));
    assert.ok(cancel !== "NO_ACCESS" && !cancel.ok && cancel.reason === "has_result");
    assert.equal(decisionSummary(v), "The group chose “Zeerovers” for “Which outing?”.");
  });
  await check("a result for an Explore option links to what is already planned instead of duplicating it", async () => {
    assert.equal((await view(OWNER, decided)).result?.existing, null);
    const first = await as(EDITOR, T, "contribute", (d, c) => q.createItineraryItem(d, c.ownerId, T, visit(null, { place_id: pA.id }), { unlessPlaceScheduled: true }));
    assert.ok(first !== "NO_ACCESS" && first.ok);
    const v = await view(VIEWER, decided);
    assert.equal(v.result?.existing?.id, first.id);
    const second = await as(EDITOR, T, "contribute", (d, c) => q.createItineraryItem(d, c.ownerId, T, visit(null, { place_id: pA.id }), { unlessPlaceScheduled: true }));
    assert.ok(second !== "NO_ACCESS" && !second.ok && second.reason === "place_already_scheduled");
    assert.equal(v.can.apply, false, "a viewer cannot apply it");
    assert.equal((await view(EDITOR2, decided)).can.apply, true);
    assert.equal((await q.listItinerary(db, OWNER, T))!.filter((i) => i.place_id === pA.id).length, 1);
  });

  console.log("Edits and revised polls");
  await check("content can change only before anyone has answered; then a revised poll cancels the original", async () => {
    const p = await make(EDITOR);
    const edit = (over: Input) => as(EDITOR, T, "participate", (d, c) => pollDb.updatePoll(d, c, T, p, input(over), "Eddie"));
    assert.ok((await edit({ question: "Reworded question?" })) !== "NO_ACCESS");
    assert.equal((await view(OWNER, p)).question, "Reworded question?");
    await vote(VIEWER, p, { any: true });
    const blocked = await edit({ question: "Changed again?" });
    assert.ok(blocked !== "NO_ACCESS" && !blocked.ok && blocked.reason === "has_votes");
    assert.equal((await view(OWNER, p)).question, "Reworded question?");
    assert.equal((await view(OWNER, p)).can.edit, false);
    await forbidden(create(EDITOR2, { replaces_poll_id: p }));
    const revised = await create(EDITOR, { replaces_poll_id: p, question: "Revised question?" });
    assert.ok(revised !== "NO_ACCESS" && revised.ok);
    const old = await view(OWNER, p);
    assert.equal(old.status, "canceled");
    assert.equal(old.replacedBy, revised.id);
    assert.equal((await view(OWNER, revised.id)).status, "open");
    assert.equal((await view(OWNER, revised.id)).replaces, p);
    assert.equal((await view(OWNER, revised.id)).hasVotes, false);
    const r = await create(OWNER, { replaces_poll_id: decided });
    assert.ok(r !== "NO_ACCESS" && !r.ok && r.reason === "has_result", "a decided poll is never replaced");
  });

  console.log("People who leave");
  await check("a departed member cannot take part, is not counted, and is not notified", async () => {
    const p = await make(OWNER, { question: "Dinner before they leave?" });
    const [a, b] = (await view(OWNER, p)).options;
    await vote(VIEWER, p, { option_id: a.id });
    await vote(EDITOR2, p, { option_id: b.id });
    await vote(OWNER, p, { option_id: b.id });
    assert.equal((await view(OWNER, p)).tally.counts[a.id], 1);
    assert.deepEqual(await sh.removeMember(db, OWNER, T, VIEWER), { ok: true });
    assert.equal(await vote(VIEWER, p, { option_id: b.id }), "NO_ACCESS");
    assert.equal((await db.execute(sql`select 1 from poll_votes where poll_id = ${p} and user_id = ${VIEWER}`)).rows.length, 1, "history is kept");
    const v = await view(OWNER, p);
    assert.equal(v.tally.counts[a.id], 0, "excluded from active totals");
    assert.ok(!v.votes.some((x) => x.user_id === VIEWER));
    assert.ok(!v.participants.some((x) => x.user_id === VIEWER));
    assert.equal(v.tally.eligible, 3);
    const later = await make(OWNER, { question: "After they left" });
    assert.equal((await db.select().from(notifications).where(sql`${notifications.recipient_id} = ${VIEWER} and ${notifications.resource_id} = ${later}`)).length, 0);
    const choose = await as(OWNER, T, "participate", (d, c) => pollDb.chooseResult(d, c, T, later, "00000000-0000-4000-8000-000000000000", "x"));
    assert.ok(choose !== "NO_ACCESS" && !choose.ok);
  });
  await check("a finalized result is not rewritten when someone leaves afterwards", async () => {
    await join(T, OWNER, VIEWER, "viewer");
    const p = await make(OWNER, { question: "Frozen decision?" });
    const [a, b] = (await view(OWNER, p)).options;
    await vote(VIEWER, p, { option_id: a.id });
    await vote(EDITOR, p, { option_id: a.id });
    await vote(EDITOR2, p, { option_id: b.id });
    assert.ok((await as(OWNER, T, "participate", (d, c) => pollDb.chooseResult(d, c, T, p, a.id, "Olive"))) !== "NO_ACCESS");
    const before = await view(OWNER, p);
    assert.equal(before.result?.tally.counts[a.id], 2);
    await sh.removeMember(db, OWNER, T, VIEWER);
    await sh.removeMember(db, OWNER, T, EDITOR);
    const after = await view(OWNER, p);
    assert.equal(after.result?.option_id, a.id);
    assert.deepEqual(after.result?.tally, before.result?.tally, "decided with these totals");
    assert.equal(after.tally.counts[a.id], 0, "the live totals no longer count them");
    await join(T, OWNER, EDITOR, "editor");
    await join(T, OWNER, VIEWER, "viewer");
  });

  console.log("Linked records that disappear");
  await check("deleting a linked place or activity keeps the poll and its wording", async () => {
    const doomedPlace = await q.createPlace(db, OWNER, T, place("Doomed Diner"), undefined);
    const doomedItem = await q.createItineraryItem(db, OWNER, T, visit("Doomed dinner"), {});
    assert.ok(doomedPlace.ok && doomedItem.ok);
    const p = await make(OWNER, { question: "About a doomed thing", options: [{ label: "", place_id: doomedPlace.id }, { label: "Stay in", place_id: null }], parent: { type: "activity", item_id: doomedItem.id } });
    assert.equal((await view(OWNER, p)).parent.item?.title, "Doomed dinner");
    assert.equal(await q.deleteItineraryItem(db, OWNER, T, doomedItem.id), true);
    const del = await q.deletePlace(db, OWNER, T, doomedPlace.id, "detach");
    assert.ok(del);
    const v = await view(OWNER, p);
    assert.equal(v.options[0].label, "Doomed Diner");
    assert.equal(v.options[0].place, null);
    assert.equal(v.parent.item, null);
    assert.equal(v.parent.missing, true);
  });
  await check("deleting the trip removes its polls", async () => {
    const t2 = await mkTrip(OWNER, "Short-lived");
    await join(t2, OWNER, EDITOR, "editor");
    const r = await create(OWNER, {}, t2);
    assert.ok(r !== "NO_ACCESS" && r.ok);
    assert.equal(await q.deleteTrip(db, OWNER, t2), true);
    assert.equal((await db.execute(sql`select 1 from polls where trip_id = ${t2} union all select 1 from poll_options where trip_id = ${t2}`)).rows.length, 0);
  });

  // cleanup
  await db.delete(trips).where(sql`${trips.id} in (${sql.join(createdTrips.map((x) => sql`${x}`), sql`, `)})`);
  const users = [OWNER, EDITOR, EDITOR2, VIEWER, STRANGER, OTHER_OWNER];
  await db.execute(sql`delete from notifications where recipient_id in (${sql.join(users.map((u) => sql`${u}`), sql`, `)})`);
  await db.execute(sql`delete from user_profiles where user_id in (${sql.join(users.map((u) => sql`${u}`), sql`, `)})`);
  console.log(`\n${passed} checks passed; test records removed.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
