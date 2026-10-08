/**
 * Notification inbox against a migrated, disposable database:
 * user isolation, personal read state, deduplication, recipients, access
 * removal, rollback, invitations (never auto-accepted), destination safety.
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:notifications
 *
 * Runs the real service functions and the real write gate (`runTripWrite`)
 * as several users. Test records are removed at the end. Sign-in, cookies and
 * the browser are not exercised here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db";
import * as n from "../src/db/notifications";
import * as q from "../src/db/queries";
import * as sh from "../src/db/sharing";
import { notifications, trips } from "../src/db/schema";
import { ForbiddenError } from "../src/lib/sharing";
import { dedupeKeys, type NotificationDraft } from "../src/lib/notifications";
import type { ItineraryItemInput, PlaceInput, ReservationInput, TripInput } from "../src/lib/types";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to a migrated, disposable database.");
  process.exit(1);
}

const { db, pool } = createDb(url);
const id = () => `test-${randomUUID()}`;
const [OWNER, EDITOR, VIEWER, STRANGER, INVITEE, NEWCOMER, OTHER] = [id(), id(), id(), id(), id(), id(), id()];
const EMAILS = { invitee: `invitee-${randomUUID()}@example.com`, newcomer: `new-${randomUUID()}@example.com` };
let passed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const viewer = (userId: string, verifiedEmail: string | null = null): n.Viewer => ({ id: userId, verifiedEmail });
const list = (userId: string, opts: Parameters<typeof n.listNotifications>[2] = {}, email: string | null = null) =>
  n.listNotifications(db, viewer(userId, email), opts);
const plan = async (userId: string) => (await list(userId)).items.filter((i) => i.type === "itinerary_changed");
const rowsFor = (userId: string) => db.select().from(notifications).where(sql`${notifications.recipient_id} = ${userId}`);

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
const visit = (title: string, over: Partial<ItineraryItemInput> = {}): ItineraryItemInput => ({
  place_id: null,
  reservation_id: null,
  title,
  category: "activity",
  local_date: "2026-10-15",
  local_start_time: "18:00",
  local_end_date: null,
  local_end_time: null,
  timezone: null,
  planning_notes: null,
  ...over,
});
const place = (name: string, address: string | null = null): PlaceInput => ({
  name,
  kind: "food",
  category: "restaurant",
  priority: "maybe",
  address,
  maps_url: null,
  website_url: null,
  planning_notes: null,
});
const booking: ReservationInput = {
  kind: "activity",
  status: "confirmed",
  title: "Catamaran",
  provider: null,
  confirmation_code: "SECRET-REF-9",
  start_date: "2026-10-16",
  start_time: "10:00",
  start_time_zone: "America/Aruba",
  end_date: "2026-10-16",
  end_time: "13:00",
  end_time_zone: "America/Aruba",
  origin: null,
  destination: null,
  location: "12 Private Lane",
  booking_url: null,
  notes: null,
  details: {},
};

/** The DAL's write path for itinerary changes, as a given user (same gate, same announcement). */
async function itinerary<R>(
  user: string,
  tripId: string,
  name: string,
  kind: "added" | "removed" | "changed",
  itemId: string | null,
  write: (d: typeof db, ownerId: string) => Promise<R>,
  outcome: (r: R) => { ok: boolean; id?: string },
) {
  return sh.runTripWrite(db, user, tripId, "contribute", "NO_ACCESS" as const, (d, ctx) =>
    n.withItineraryAnnouncement(d, { ownerId: ctx.ownerId, tripId, actorId: user, actorName: name, kind, itemId }, () => write(d, ctx.ownerId), outcome),
  );
}
type W = Awaited<ReturnType<typeof q.createItineraryItem>>;
const okW = (r: W) => ({ ok: r.ok, id: r.ok ? r.id : undefined });

async function addVisit(user: string, tripId: string, name: string, input: ItineraryItemInput, requestId?: string) {
  const r = await itinerary(user, tripId, name, "added", null, (d, o) => q.createItineraryItem(d, o, tripId, input, { requestId }), okW);
  assert.ok(r !== "NO_ACCESS" && r.ok);
  return r.id;
}
const editVisit = (user: string, tripId: string, name: string, itemId: string, input: ItineraryItemInput, expectedUpdatedAt?: string) =>
  itinerary(user, tripId, name, "changed", itemId, (d, o) => q.updateItineraryItem(d, o, tripId, itemId, input, { expectedUpdatedAt }), (r) => ({ ok: r.ok }));

async function join(tripId: string, userId: string, role: "editor" | "viewer", email: string | null = null) {
  const made = await sh.createInvitation(db, { ownerId: OWNER, tripId, invitedBy: OWNER, inviterName: "Olive", email, role });
  assert.ok(made.ok);
  const accepted = await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(made.token), userId, verifiedEmail: email, emailUnverified: false });
  assert.equal(accepted.status, "ok");
}

async function main() {
  const createdTrips: string[] = [];
  const mkTrip = async (title: string) => {
    const { id: tripId } = await q.createTrip(db, OWNER, tripInput(title));
    createdTrips.push(tripId);
    return tripId;
  };
  const trip = await mkTrip("Aruba");
  await join(trip, EDITOR, "editor", `editor-${randomUUID()}@example.com`);
  await join(trip, VIEWER, "viewer", `viewer-${randomUUID()}@example.com`);
  await sh.upsertProfile(db, { id: INVITEE, name: "Ines Invitee", email: EMAILS.invitee });
  await sh.upsertProfile(db, { id: OWNER, name: "Olive Owner", email: `owner-${randomUUID()}@example.com` });

  console.log("Itinerary changes → recipients");
  let dinner = "";
  await check("an added activity reaches every other member, never the actor or strangers", async () => {
    dinner = await addVisit(EDITOR, trip, "Eddie", visit("Dinner"));
    const owner = await plan(OWNER);
    assert.equal(owner.length, 1);
    assert.equal((await plan(VIEWER)).length, 1);
    assert.equal(owner[0].title, "Activity added");
    assert.equal(owner[0].body, "Eddie added Dinner for Thu, Oct 15 at 6:00 PM.");
    assert.equal(owner[0].href, `/trips/${trip}/itinerary?day=2026-10-15`);
    assert.equal((await list(EDITOR)).items.length, 0, "the actor is not notified of their own change");
    assert.equal((await list(STRANGER)).items.length, 0);
  });
  await check("a reschedule says what moved, in plain words", async () => {
    const r = await editVisit(EDITOR, trip, "Eddie", dinner, visit("Dinner", { local_start_time: "18:30" }));
    assert.ok(r !== "NO_ACCESS" && r.ok);
    const items = await plan(OWNER);
    assert.equal(items.length, 2);
    assert.equal(items[0].body, "Dinner moved from 6:00 PM to 6:30 PM. — Eddie");
  });
  await check("notes, renames and other edits stay quiet", async () => {
    const before = (await rowsFor(OWNER)).length;
    await editVisit(EDITOR, trip, "Eddie", dinner, visit("Dinner", { local_start_time: "18:30", planning_notes: "Window table please" }));
    await editVisit(EDITOR, trip, "Eddie", dinner, visit("Family dinner", { local_start_time: "18:30", planning_notes: "Window table please" }));
    await editVisit(EDITOR, trip, "Eddie", dinner, visit("Family dinner", { local_start_time: "18:30", planning_notes: "x", category: "food" }));
    assert.equal((await rowsFor(OWNER)).length, before);
  });
  await check("a location change names places only — never an address", async () => {
    const a = await q.createPlace(db, OWNER, trip, place("Zeerovers", "1 Secret Street 5"), undefined);
    const b = await q.createPlace(db, OWNER, trip, place("Wilhelmina's", "2 Hidden Road 9"), undefined);
    assert.ok(a.ok && b.ok);
    const withA = await addVisit(OWNER, trip, "Olive", visit("Lunch", { place_id: a.id, local_start_time: "12:00" }));
    await editVisit(OWNER, trip, "Olive", withA, visit("Lunch", { place_id: b.id, local_start_time: "12:00" }));
    const mine = (await list(EDITOR)).items;
    assert.equal(mine[0].body, "Lunch location changed from Zeerovers to Wilhelmina's. — Olive");
    assert.ok(!JSON.stringify(await rowsFor(EDITOR)).match(/Secret Street|Hidden Road/));
  });
  await check("removal is announced, with the day it was on", async () => {
    const d = await sh.runTripWrite(db, EDITOR, trip, "contribute", "NO_ACCESS" as const, (dd, ctx) =>
      n.withItineraryAnnouncement(dd, { ownerId: ctx.ownerId, tripId: trip, actorId: EDITOR, actorName: "Eddie", kind: "removed", itemId: dinner }, () => q.deleteItineraryItem(dd, ctx.ownerId, trip, dinner), (ok) => ({ ok })),
    );
    assert.equal(d, true);
    assert.equal((await list(VIEWER)).items[0].body, "Eddie removed Family dinner (Thu, Oct 15 at 6:30 PM).");
  });
  await check("times are shown in the trip's zone even when the entry is in another", async () => {
    const paris = await addVisit(OWNER, trip, "Olive", visit("Late snack", { local_date: "2026-10-16", local_start_time: "02:00", timezone: "Europe/Paris" }));
    assert.ok(paris);
    assert.equal((await list(EDITOR)).items[0].body, "Olive added Late snack for Thu, Oct 15 at 8:00 PM.");
    assert.equal((await list(EDITOR)).items[0].href, `/trips/${trip}/itinerary?day=2026-10-15`);
  });
  await check("bookings and booking-backed rows are never announced; confirmation codes never leak", async () => {
    const before = (await rowsFor(VIEWER)).length;
    const res = await q.createReservation(db, OWNER, trip, booking);
    assert.ok(res);
    const link = await q.ensureReservationVisit(db, OWNER, trip, (res as { id: string }).id);
    assert.ok(link.ok);
    await editVisit(OWNER, trip, "Olive", (link as { id: string }).id, { ...visit("x"), title: null, reservation_id: (res as { id: string }).id, local_date: null, local_start_time: null, timezone: null, planning_notes: "bring sunscreen" });
    assert.equal((await rowsFor(VIEWER)).length, before);
    assert.ok(!JSON.stringify(await rowsFor(VIEWER)).match(/SECRET-REF-9|Private Lane/));
  });
  await check("a viewer cannot change the plan, and nothing is announced", async () => {
    const before = (await rowsFor(OWNER)).length;
    await assert.rejects(addVisit(VIEWER, trip, "Vic", visit("Sneaky")), (e) => e instanceof ForbiddenError);
    assert.equal((await rowsFor(OWNER)).length, before);
  });
  await check("a failed change (stale edit) produces no notification", async () => {
    const id1 = await addVisit(OWNER, trip, "Olive", visit("Snorkel", { local_start_time: "09:00" }));
    const before = (await rowsFor(EDITOR)).length;
    const r = await editVisit(OWNER, trip, "Olive", id1, visit("Snorkel", { local_start_time: "11:00" }), "2001-01-01T00:00:00Z");
    assert.ok(r !== "NO_ACCESS" && !r.ok && r.reason === "conflict");
    assert.equal((await rowsFor(EDITOR)).length, before);
    const missing = await editVisit(OWNER, trip, "Olive", randomUUID(), visit("Ghost"));
    assert.ok(missing !== "NO_ACCESS" && !missing.ok);
    assert.equal((await rowsFor(EDITOR)).length, before);
  });
  await check("a rolled-back transaction leaves neither the change nor the notification", async () => {
    const before = (await rowsFor(OWNER)).length;
    const items = (await q.listItinerary(db, OWNER, trip))!.length;
    await assert.rejects(
      sh.runTripWrite(db, EDITOR, trip, "contribute", "NO_ACCESS" as const, async (d, ctx) => {
        await n.withItineraryAnnouncement(d, { ownerId: ctx.ownerId, tripId: trip, actorId: EDITOR, actorName: "Eddie", kind: "added", itemId: null }, () => q.createItineraryItem(d, ctx.ownerId, trip, visit("Doomed"), {}), okW);
        throw new Error("later step failed");
      }),
      /later step failed/,
    );
    assert.equal((await rowsFor(OWNER)).length, before);
    assert.equal((await q.listItinerary(db, OWNER, trip))!.length, items);
  });
  await check("a notification bug cannot undo or block the edit", async () => {
    const created = await sh.runTripWrite(db, OWNER, trip, "contribute", "NO_ACCESS" as const, async (d, ctx) => {
      const r = await q.createItineraryItem(d, ctx.ownerId, trip, visit("Resilient"), {});
      // The database refuses this row; the savepoint rolls back, the error is logged, and the transaction stays usable.
      await n.safely(d, "test", (tx) => (tx as typeof d).execute(sql`insert into notifications (recipient_id, type, title, body, dedupe_key) values ('x', 'Bad Type', 't', 'b', 'k')`));
      return q.listItinerary(d, ctx.ownerId, trip).then((rows) => ({ r, rows }));
    });
    assert.ok(created !== "NO_ACCESS" && created.r.ok);
    assert.ok(created.rows!.some((i) => i.title === "Resilient"));
  });
  await check("a hostile activity title cannot smuggle a link or token into the inbox", async () => {
    const token = "Zk3dQ9vXr1Lw8TnB2yHc5uJpA7sEo4MfGqRiVxC0bNd";
    await addVisit(OWNER, trip, "Olive", visit(`Beach https://evil.example/${token}`));
    const body = (await list(VIEWER)).items[0].body;
    assert.ok(!body.includes(token) && !body.includes("evil.example"), body);
  });

  console.log("Deduplication");
  await check("the same event twice creates one notification per recipient", async () => {
    const reqId = randomUUID();
    const first = await addVisit(EDITOR, trip, "Eddie", visit("Sunset sail", { local_start_time: "17:00" }), reqId);
    const before = (await rowsFor(OWNER)).length;
    const again = await addVisit(EDITOR, trip, "Eddie", visit("Sunset sail", { local_start_time: "17:00" }), reqId);
    assert.equal(first, again);
    assert.equal((await rowsFor(OWNER)).length, before);
  });
  await check("createNotifications is idempotent on (recipient, dedupe key), including concurrently", async () => {
    const draft = (recipientId: string): NotificationDraft => ({ type: "itinerary_changed", recipientId, actorId: STRANGER, tripId: trip, itemId: randomUUID(), date: null, dedupeKey: "same-event", title: "Hello", body: "World" });
    const results = await Promise.all([n.createNotifications(db, [draft(VIEWER)]), n.createNotifications(db, [draft(VIEWER)]), n.createNotifications(db, [draft(VIEWER)])]);
    assert.equal(results.reduce((a, b) => a + b, 0), 1);
    assert.equal((await rowsFor(VIEWER)).filter((r) => r.dedupe_key === "same-event").length, 1);
    // …but the same key for a different person is theirs alone.
    assert.equal(await n.createNotifications(db, [draft(EDITOR)]), 1);
  });

  console.log("Who may receive one");
  await check("people who are not on the trip, and not-yet-enabled types, are refused", async () => {
    const base = { actorId: OWNER, tripId: trip, itemId: randomUUID(), date: null, title: "t", body: "b" } as const;
    assert.equal(await n.createNotifications(db, [{ ...base, type: "itinerary_changed", recipientId: STRANGER, dedupeKey: "a" }]), 0);
    assert.equal(await n.createNotifications(db, [{ ...base, type: "itinerary_changed", recipientId: OWNER, dedupeKey: "b" }]), 0, "never to the actor");
    assert.equal((await rowsFor(STRANGER)).length, 0);
    // A type that is not in the registry (or not enabled) can never be written.
    await assert.rejects(n.createNotifications(db, [{ type: "weather_alert" as never, recipientId: VIEWER, actorId: null, tripId: trip, dedupeKey: "p", title: "t", body: "b" } as never]), /not enabled/);
  });
  await check("the database rejects a malformed type and a self-notification", async () => {
    await assert.rejects(db.execute(sql`insert into notifications (recipient_id, type, title, body, dedupe_key) values (${VIEWER}, 'Bad Type', 't', 'b', 'k1')`));
    await assert.rejects(db.execute(sql`insert into notifications (recipient_id, actor_id, type, title, body, dedupe_key) values (${VIEWER}, ${VIEWER}, 'reminder', 't', 'b', 'k2')`));
    await assert.rejects(db.execute(sql`insert into notifications (recipient_id, trip_id, type, title, body, dedupe_key) values (${VIEWER}, ${trip}, 'reminder', 't', 'b', 'k3')`), "a trip needs its owner");
  });

  console.log("Personal read state and isolation");
  await check("reading is personal: one member's read never marks another's", async () => {
    const mine = (await list(OWNER)).items;
    const target = mine.find((i) => !i.read_at)!;
    assert.equal(await n.markRead(db, viewer(OWNER), target.id), true);
    assert.ok((await list(OWNER)).items.find((i) => i.id === target.id)!.read_at, "persisted for a fresh read");
    const ownerRow = (await rowsFor(OWNER)).find((r) => r.id === target.id)!;
    const viewerRow = (await rowsFor(VIEWER)).find((r) => r.dedupe_key === ownerRow.dedupe_key)!;
    assert.equal(viewerRow.read_at, null);
  });
  await check("a notification id from someone else's inbox changes nothing and reveals nothing", async () => {
    const theirs = (await list(VIEWER)).items[0];
    assert.equal(await n.markRead(db, viewer(STRANGER), theirs.id), false);
    assert.equal(await n.markRead(db, viewer(OWNER), theirs.id), false, "even another member of the same trip");
    assert.equal(await n.getNotification(db, viewer(STRANGER), theirs.id), null);
    assert.equal(await n.archiveNotification(db, viewer(STRANGER), theirs.id), false);
    assert.equal((await list(VIEWER)).items.find((i) => i.id === theirs.id)!.read_at, null);
    assert.equal(await n.markAllRead(db, viewer(STRANGER)), 0);
    assert.equal((await n.countUnread(db, viewer(STRANGER))).unread, 0);
    assert.equal(await n.markRead(db, viewer(OWNER), "not-a-uuid"), false);
  });
  await check("opening the inbox never marks anything read; the count survives fresh reads", async () => {
    const a = await n.countUnread(db, viewer(VIEWER));
    await list(VIEWER);
    await list(VIEWER, { filter: "unread" });
    const b = await n.countUnread(db, viewer(VIEWER));
    assert.equal(a.unread, b.unread);
    assert.ok(b.unread > 0);
  });
  await check("mark all read only covers what was seen; newer arrivals stay unread", async () => {
    const seen = (await list(VIEWER)).items;
    const newest = seen[0].created_at;
    await new Promise((r) => setTimeout(r, 20));
    await addVisit(OWNER, trip, "Olive", visit("Arrived after viewing", { local_start_time: "21:00" }));
    const marked = await n.markAllRead(db, viewer(VIEWER), newest);
    assert.ok(marked > 0);
    const after = await list(VIEWER, { filter: "unread" });
    assert.equal(after.items.length, 1);
    assert.match(after.items[0].body, /Arrived after viewing/);
    assert.equal(after.unread, 1);
    assert.equal(await n.markAllRead(db, viewer(VIEWER), "garbage"), 0);
    assert.equal(await n.markAllRead(db, viewer(VIEWER)), 1);
    assert.equal((await n.countUnread(db, viewer(VIEWER))).unread, 0);
  });
  await check("archived notifications leave the list and the count", async () => {
    const [first] = (await list(OWNER)).items;
    const unreadBefore = (await n.countUnread(db, viewer(OWNER))).unread;
    assert.equal(await n.archiveNotification(db, viewer(OWNER), first.id), true);
    assert.ok(!(await list(OWNER)).items.some((i) => i.id === first.id));
    assert.ok((await n.countUnread(db, viewer(OWNER))).unread <= unreadBefore);
  });

  console.log("Pagination");
  await check("pages are stable, complete and duplicate-free; bad cursors fall back to the first page", async () => {
    const T = await mkTrip("Lots");
    await join(T, OTHER, "viewer");
    const drafts = Array.from({ length: 45 }, (_, i): NotificationDraft => ({ type: "itinerary_changed", recipientId: OTHER, actorId: OWNER, tripId: T, itemId: randomUUID(), date: "2026-10-15", dedupeKey: `bulk-${i}`, title: `Item ${i}`, body: `Body ${i}` }));
    assert.equal(await n.createNotifications(db, drafts), 45);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof list>> = await list(OTHER, { cursor, limit: 20 });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    assert.equal(pages, 3);
    assert.equal(seen.length, 45);
    assert.equal(new Set(seen).size, 45);
    const first = await list(OTHER, { limit: 20 });
    assert.deepEqual((await list(OTHER, { cursor: "garbage", limit: 20 })).items.map((i) => i.id), first.items.map((i) => i.id));
    assert.equal(first.unread, 45);
    const unreadOnly = await list(OTHER, { filter: "unread", limit: 50 });
    assert.equal(unreadOnly.items.length, 45);
  });

  console.log("Access removal");
  await check("a removed member loses every notification about the trip", async () => {
    const T = await mkTrip("Leaves");
    await join(T, OTHER, "editor");
    await addVisit(OWNER, T, "Olive", visit("Hike"));
    assert.equal((await list(OTHER)).items.filter((i) => i.trip?.id === T).length, 1);
    assert.deepEqual(await sh.removeMember(db, OWNER, T, OTHER), { ok: true });
    assert.equal((await rowsFor(OTHER)).filter((r) => r.trip_id === T).length, 0);
    assert.equal((await list(OTHER)).items.filter((i) => i.trip?.id === T).length, 0);
    // And a former member cannot be notified any more.
    const draft: NotificationDraft = { type: "itinerary_changed", recipientId: OTHER, actorId: OWNER, tripId: T, itemId: randomUUID(), date: null, dedupeKey: "after-removal", title: "t", body: "b" };
    assert.equal(await n.createNotifications(db, [draft]), 0);
  });
  await check("even if rows survive (access lost out-of-band), they are shown as unavailable with nothing private", async () => {
    const T = await mkTrip("Hidden plans");
    await join(T, OTHER, "editor");
    await addVisit(OWNER, T, "Olive", visit("Secret surprise party"));
    const before = await list(OTHER);
    const live = before.items.find((i) => i.trip?.id === T)!;
    assert.equal(live.available, true);
    assert.equal(before.unread >= 1, true);
    const unreadBefore = before.unread;
    await db.execute(sql`delete from trip_members where trip_id = ${T} and user_id = ${OTHER}`); // bypass the purge on purpose
    const after = await list(OTHER);
    const gone = after.items.find((i) => i.id === live.id)!;
    assert.equal(gone.available, false);
    assert.equal(gone.href, null);
    assert.equal(gone.trip, null);
    assert.ok(!JSON.stringify(gone).match(/Secret|surprise|Hidden plans/), JSON.stringify(gone));
    assert.equal(after.unread, unreadBefore - 1, "it no longer counts as unread");
    assert.equal((await list(OTHER, { filter: "unread", limit: 50 })).items.some((i) => i.id === live.id), false);
    const opened = await n.getNotification(db, viewer(OTHER), live.id);
    assert.equal(opened!.available, false);
    assert.equal(opened!.href, null);
  });
  await check("deleting the trip removes its notifications", async () => {
    const T = await mkTrip("Doomed trip");
    await join(T, OTHER, "editor");
    await addVisit(OWNER, T, "Olive", visit("Gone soon"));
    assert.ok((await rowsFor(OTHER)).some((r) => r.trip_id === T));
    assert.equal(await q.deleteTrip(db, OWNER, T), true);
    assert.ok(!(await rowsFor(OTHER)).some((r) => r.trip_id === T));
  });

  console.log("Invitations");
  const invTrip = await mkTrip("Invites");
  let invite!: Extract<Awaited<ReturnType<typeof sh.createInvitation>>, { ok: true }>;
  await check("inviting an existing account notifies that person — with no token anywhere", async () => {
    const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive Owner", email: EMAILS.invitee, role: "editor" });
    assert.ok(made.ok);
    invite = made;
    await n.announceInvitationCreated(db, { ownerId: OWNER, tripId: invTrip, inviterId: OWNER, inviterName: "Olive Owner", invitationId: made.id, email: EMAILS.invitee, role: "editor" });
    const page = await list(INVITEE, {}, EMAILS.invitee);
    assert.equal(page.items.length, 1);
    const item = page.items[0];
    assert.equal(item.type, "invitation_received");
    assert.equal(item.body, "Olive Owner invited you to “Invites” as an editor.");
    assert.equal(item.href, `/invitations/${made.id}`);
    assert.ok(!JSON.stringify(await rowsFor(INVITEE)).includes(made.token));
    assert.ok(!JSON.stringify(page).includes(made.token));
    assert.ok(!JSON.stringify(page).includes(sh.hashInviteToken(made.token)));
    assert.equal(await sh.resolveTripAccess(db, INVITEE, invTrip), null, "creating a notification does not join anyone");
    assert.equal((await rowsFor(OWNER)).filter((r) => r.type === "invitation_received").length, 0);
  });
  await check("sending the same invitation event again does not duplicate", async () => {
    await n.announceInvitationCreated(db, { ownerId: OWNER, tripId: invTrip, inviterId: OWNER, inviterName: "Olive Owner", invitationId: invite.id, email: EMAILS.invitee, role: "editor" });
    assert.equal((await rowsFor(INVITEE)).length, 1);
  });
  await check("the invitation is only visible to the verified address; an unverified account sees nothing of it", async () => {
    const page = await list(INVITEE, {}, null);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].available, false);
    assert.ok(!JSON.stringify(page).match(/Invites|Olive/));
    assert.equal(page.unread, 0);
    const wrong = await list(INVITEE, {}, "someone-else@example.com");
    assert.equal(wrong.items[0].available, false);
  });
  await check("a person who signs up later is reconciled after verified sign-in — and never auto-joined", async () => {
    const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive Owner", email: EMAILS.newcomer, role: "viewer" });
    assert.ok(made.ok);
    await n.announceInvitationCreated(db, { ownerId: OWNER, tripId: invTrip, inviterId: OWNER, inviterName: "Olive Owner", invitationId: made.id, email: EMAILS.newcomer, role: "viewer" });
    assert.equal((await rowsFor(NEWCOMER)).length, 0, "no account yet, so nobody to notify at creation");
    assert.equal(await n.reconcileInvitationNotifications(db, viewer(NEWCOMER, null)), 0, "an unverified email never matches");
    assert.equal(await n.reconcileInvitationNotifications(db, viewer(NEWCOMER, "other@example.com")), 0);
    assert.equal(await n.reconcileInvitationNotifications(db, viewer(NEWCOMER, EMAILS.newcomer)), 1);
    assert.equal(await n.reconcileInvitationNotifications(db, viewer(NEWCOMER, EMAILS.newcomer)), 0, "idempotent");
    const page = await list(NEWCOMER, {}, EMAILS.newcomer);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].available, true);
    assert.equal(page.unread, 1);
    assert.equal(await sh.resolveTripAccess(db, NEWCOMER, invTrip), null, "reconciling never accepts");
    assert.ok(!JSON.stringify(page).includes(made.token));
  });
  await check("reconcile skips closed, expired and link-only invitations", async () => {
    const mail = `closed-${randomUUID()}@example.com`;
    const a = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive", email: mail, role: "viewer" });
    assert.ok(a.ok);
    assert.equal(await sh.revokeInvitation(db, OWNER, invTrip, a.id), true);
    const b = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive", email: `exp-${randomUUID()}@example.com`, role: "viewer" });
    assert.ok(b.ok);
    await db.execute(sql`update trip_invitations set expires_at = now() - interval '1 minute' where id = ${b.id}`);
    assert.equal(await n.reconcileInvitationNotifications(db, viewer(id(), mail)), 0);
    assert.equal(await n.reconcileInvitationNotifications(db, viewer(id(), (await db.execute(sql`select email from trip_invitations where id = ${b.id}`)).rows[0].email as string)), 0);
    const link = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive", email: null, role: "viewer" });
    assert.ok(link.ok);
    assert.equal((await db.execute(sql`select 1 from notifications where resource_id = ${link.id}`)).rows.length, 0);
  });
  await check("a revoked invitation turns into an unavailable notification and stops counting", async () => {
    const mail = `rev-${randomUUID()}@example.com`;
    const who = id();
    const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive", email: mail, role: "viewer" });
    assert.ok(made.ok);
    assert.equal(await n.reconcileInvitationNotifications(db, viewer(who, mail)), 1);
    assert.equal((await n.countUnread(db, viewer(who, mail))).unread, 1);
    await sh.revokeInvitation(db, OWNER, invTrip, made.id);
    const page = await list(who, {}, mail);
    assert.equal(page.items[0].available, false);
    assert.equal(page.items[0].href, null);
    assert.ok(!JSON.stringify(page).match(/Invites|Olive/));
    assert.equal(page.unread, 0);
  });
  await check("accepting by the signed-in page is explicit, email-bound, and notifies the owner once", async () => {
    // Link invitations cannot be accepted by id (an id is not a secret).
    const link = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive", email: null, role: "viewer" });
    assert.ok(link.ok);
    assert.equal((await sh.acceptInvitation(db, { invitationId: link.id, userId: STRANGER, verifiedEmail: "x@example.com", emailUnverified: false })).status, "invalid");

    // Wrong or unverified addresses cannot accept by id.
    const body = { invitationId: invite.id, userId: INVITEE, userName: "Ines Invitee" };
    assert.equal((await sh.acceptInvitation(db, { ...body, verifiedEmail: "other@example.com", emailUnverified: false })).status, "wrong_account");
    assert.equal((await sh.acceptInvitation(db, { ...body, verifiedEmail: null, emailUnverified: true })).status, "unverified_email");
    assert.equal((await sh.acceptInvitation(db, { ...body, userId: STRANGER, verifiedEmail: "other@example.com", emailUnverified: false })).status, "wrong_account");
    assert.equal(await sh.resolveTripAccess(db, INVITEE, invTrip), null);
    assert.equal((await rowsFor(OWNER)).filter((r) => r.type === "invitation_accepted" && r.trip_id === invTrip).length, 0, "failed attempts notify nobody");

    // The invited person accepts.
    const ok = await sh.acceptInvitation(db, { ...body, verifiedEmail: EMAILS.invitee, emailUnverified: false });
    assert.equal(ok.status, "ok");
    assert.equal((await sh.resolveTripAccess(db, INVITEE, invTrip))?.role, "editor");
    const accepted = (await rowsFor(OWNER)).filter((r) => r.type === "invitation_accepted" && r.trip_id === invTrip);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].body, "Ines Invitee joined “Invites” as an editor.");

    // Doing it again (or concurrently) changes nothing.
    const again = await Promise.all([1, 2].map(() => sh.acceptInvitation(db, { ...body, verifiedEmail: EMAILS.invitee, emailUnverified: false })));
    assert.ok(again.every((r) => r.status === "accepted_by_you"));
    assert.equal((await rowsFor(OWNER)).filter((r) => r.type === "invitation_accepted" && r.trip_id === invTrip).length, 1);

    // The invitee's own notification now simply leads to the trip.
    const mine = (await list(INVITEE, {}, EMAILS.invitee)).items.find((i) => i.type === "invitation_received")!;
    assert.equal(mine.available, true);
    assert.equal(mine.href, `/trips/${invTrip}`);
  });
  await check("accepting through the link still notifies the owner, and the owner's item opens the trip", async () => {
    const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: invTrip, invitedBy: OWNER, inviterName: "Olive", email: null, role: "viewer" });
    assert.ok(made.ok);
    const r = await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(made.token), userId: OTHER, userName: "Olaf", verifiedEmail: null, emailUnverified: false });
    assert.equal(r.status, "ok");
    const item = (await list(OWNER)).items.find((i) => i.body.startsWith("Olaf joined"))!;
    assert.ok(item);
    assert.equal(item.href, `/trips/${invTrip}`);
    assert.ok(!JSON.stringify(item).includes(made.token));
  });
  await check("the previews used by the inbox page never reveal token hashes", async () => {
    const preview = await sh.previewInvitationById(db, invite.id);
    assert.ok(preview);
    assert.ok(!JSON.stringify(preview).includes(sh.hashInviteToken(invite.token)));
  });

  console.log("Destinations are derived, never stored");
  await check("tampered metadata cannot produce an unsafe destination", async () => {
    const T = await mkTrip("Tamper");
    await join(T, OTHER, "viewer");
    await addVisit(OWNER, T, "Olive", visit("Brunch"));
    const [row] = (await rowsFor(OTHER)).filter((r) => r.trip_id === T);
    for (const bad of ["//evil.example", "https://evil.example", "2026-10-15&next=//evil.example", "../../login"]) {
      await db.execute(sql`update notifications set metadata = ${JSON.stringify({ date: bad })}::jsonb where id = ${row.id}`);
      const item = (await list(OTHER)).items.find((i) => i.id === row.id)!;
      assert.equal(item.href, `/trips/${T}/itinerary`, bad);
    }
    await db.execute(sql`update notifications set metadata = ${JSON.stringify({ date: "2026-10-15", url: "https://evil.example" })}::jsonb where id = ${row.id}`);
    assert.equal((await list(OTHER)).items.find((i) => i.id === row.id)!.href, `/trips/${T}/itinerary?day=2026-10-15`);
    const columns = (await db.execute(sql`select column_name from information_schema.columns where table_name = 'notifications'`)).rows.map((r) => String(r.column_name));
    assert.ok(columns.length > 5 && !columns.some((c) => /url|href|path|link/.test(c)), `no URL column: ${columns.join(", ")}`);
  });
  await check("dedupe keys are stable and namespaced", () => {
    assert.equal(dedupeKeys.invitationReceived("x"), "invitation_received:x");
    assert.notEqual(dedupeKeys.itineraryAdded("x"), dedupeKeys.itineraryChanged("x", "v"));
  });

  // cleanup
  await db.delete(trips).where(sql`${trips.id} in (${sql.join(createdTrips.map((x) => sql`${x}`), sql`, `)})`);
  const users = [OWNER, EDITOR, VIEWER, STRANGER, INVITEE, NEWCOMER, OTHER];
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
