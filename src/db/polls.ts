import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import { createNotifications, safely, tripPeople } from "./notifications";
import { itineraryItems, pollOptions, pollParticipants, pollVotes, polls, places, trips, userProfiles } from "./schema";
import { dedupeKeys, personName, type NotificationDraft } from "@/lib/notifications";
import {
  POLL_LIMITS,
  deadlineInstant,
  formatDeadline,
  pollPermissions,
  tallyVotes,
  type PollParentType,
  type PollStatus,
  type PollTally,
  type PollView,
} from "@/lib/polls";
import { ForbiddenError, type TripRole } from "@/lib/sharing";
import { cleanText } from "@/lib/notifications";

/**
 * "Ask the group" data layer. Like sharing.ts it is only reached from
 * src/lib/dal.ts, which has already verified the session and resolved the
 * caller's role on THIS trip (`ctx`). Writes run inside the trip-write
 * transaction, so a poll, its options, its participants and the "new
 * question" notifications appear together or not at all.
 */

export type PollCtx = { userId: string; ownerId: string; role: TripRole };

export type PollParentInput =
  | { type: "trip" }
  | { type: "day"; day: string }
  | { type: "activity"; item_id: string }
  | { type: "place"; place_id: string };

export type PollInput = {
  question: string;
  description: string | null;
  options: { label: string; place_id: string | null }[];
  any_option: boolean;
  /** The deadline as typed: wall-clock in the TRIP's zone. The server turns it into an instant. */
  closes: { date: string; time: string } | null;
  parent: PollParentInput;
  /** null = everyone on the trip now. The creator is always included. */
  participant_ids: string[] | null;
  replaces_poll_id: string | null;
};

export type PollWriteReason =
  | "not_found"
  | "bad_parent"
  | "option_place_not_in_trip"
  | "duplicate_options"
  | "deadline_past"
  | "participant_not_member"
  | "no_participants"
  | "too_many_open"
  | "has_votes"
  | "not_open"
  | "closed"
  | "canceled"
  | "not_participant"
  | "bad_option"
  | "has_result"
  | "already_chosen"
  | "revised_not_found";

export type PollResult<T = object> = ({ ok: true } & T) | { ok: false; reason: PollWriteReason };

const fail = (reason: PollWriteReason) => ({ ok: false, reason }) as const;
const isOrganizer = (ctx: PollCtx, createdBy: string) => ctx.role === "owner" || createdBy === ctx.userId;

/* ------------------------------ validation ------------------------------ */

type TripFacts = { time_zone: string; start_date: string; end_date: string; title: string };

async function lockTrip(db: Db, ctx: PollCtx, tripId: string): Promise<TripFacts | null> {
  const [trip] = await db
    .select({ time_zone: trips.time_zone, start_date: trips.start_date, end_date: trips.end_date, title: trips.title })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.owner_id, ctx.ownerId)))
    .for("update");
  return trip ?? null;
}

type Resolved = {
  parent: { type: PollParentType; day: string | null; item: string | null; place: string | null };
  options: { position: number; label: string; place_id: string | null }[];
  closes_at: string | null;
  participants: string[];
};

/** Everything that must hold before a poll is written; every linked resource must belong to THIS trip. */
async function resolveInput(db: Db, ctx: PollCtx, tripId: string, trip: TripFacts, input: PollInput): Promise<PollResult<{ resolved: Resolved }>> {
  // Parent.
  const parent: Resolved["parent"] = { type: input.parent.type, day: null, item: null, place: null };
  if (input.parent.type === "day") {
    if (input.parent.day < trip.start_date || input.parent.day > trip.end_date) return fail("bad_parent");
    parent.day = input.parent.day;
  } else if (input.parent.type === "activity") {
    const [row] = await db
      .select({ id: itineraryItems.id })
      .from(itineraryItems)
      .where(and(eq(itineraryItems.id, input.parent.item_id), eq(itineraryItems.trip_id, tripId), eq(itineraryItems.owner_id, ctx.ownerId)));
    if (!row) return fail("bad_parent");
    parent.item = row.id;
  } else if (input.parent.type === "place") {
    const [row] = await db
      .select({ id: places.id })
      .from(places)
      .where(and(eq(places.id, input.parent.place_id), eq(places.trip_id, tripId), eq(places.owner_id, ctx.ownerId)));
    if (!row) return fail("bad_parent");
    parent.place = row.id;
  }

  // Options: Explore records of this trip, or plain text.
  const placeIds = [...new Set(input.options.flatMap((o) => (o.place_id ? [o.place_id] : [])))];
  const found = placeIds.length
    ? await db
        .select({ id: places.id, name: places.name })
        .from(places)
        .where(and(inArray(places.id, placeIds), eq(places.trip_id, tripId), eq(places.owner_id, ctx.ownerId)))
    : [];
  if (found.length !== placeIds.length) return fail("option_place_not_in_trip");
  const nameOf = new Map(found.map((p) => [p.id, p.name]));
  const options = input.options.map((o, i) => ({
    position: i + 1,
    label: cleanText(o.place_id ? (nameOf.get(o.place_id) ?? o.label) : o.label, POLL_LIMITS.option),
    place_id: o.place_id,
  }));
  if (options.length < POLL_LIMITS.minOptions || options.length > POLL_LIMITS.maxOptions || options.some((o) => !o.label)) {
    return fail("duplicate_options");
  }
  const keys = options.map((o) => (o.place_id ? `p:${o.place_id}` : `t:${o.label.toLowerCase()}`));
  const labels = options.map((o) => o.label.toLowerCase());
  if (new Set(keys).size !== keys.length || new Set(labels).size !== labels.length) return fail("duplicate_options");

  // Deadline.
  let closes_at: string | null = null;
  if (input.closes) {
    closes_at = deadlineInstant(input.closes.date, input.closes.time, trip.time_zone);
    if (!closes_at) return fail("deadline_past");
    const [{ future }] = await db.select({ future: sql<boolean>`${closes_at}::timestamptz > now()` }).from(trips).limit(1);
    if (!future) return fail("deadline_past");
  }

  // Participants: people on the trip right now, nobody else. Asking someone never adds them.
  const people = new Set(await tripPeople(db, tripId));
  const requested = input.participant_ids ?? [...people];
  if (requested.some((id) => !people.has(id))) return fail("participant_not_member");
  const participants = [...new Set([ctx.userId, ...requested])];
  if (participants.length < 2) return fail("no_participants");

  return { ok: true, resolved: { parent, options, closes_at, participants } };
}

/** Tells the asked people (never the creator, never former members — the service re-checks). */
async function announceOpened(db: Db, ctx: PollCtx, trip: TripFacts, pollId: string, tripId: string, question: string, closesAt: string | null, creatorName: string, participants: string[]) {
  await safely(db, "poll_vote_needed", (tx) =>
    createNotifications(
      tx,
      participants
        .filter((id) => id !== ctx.userId)
        .map(
          (recipientId): NotificationDraft => ({
            type: "poll_vote_needed",
            recipientId,
            actorId: ctx.userId,
            tripId,
            pollId,
            dedupeKey: dedupeKeys.pollVoteNeeded(pollId),
            title: "Ask the group",
            body: `${personName(creatorName)} asked: “${cleanText(question, 140)}”${closesAt ? ` Vote by ${formatDeadline(closesAt, trip.time_zone)}.` : ""}`,
          }),
        ),
    ),
  );
}

/* -------------------------------- writes -------------------------------- */

export async function createPoll(db: Db, ctx: PollCtx, tripId: string, input: PollInput, creatorName: string): Promise<PollResult<{ id: string }>> {
  const trip = await lockTrip(db, ctx, tripId);
  if (!trip) return fail("not_found");
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(polls)
    .where(and(eq(polls.trip_id, tripId), eq(polls.status, "open"), sql`(${polls.closes_at} is null or ${polls.closes_at} > now())`));
  if (open >= POLL_LIMITS.maxOpen) return fail("too_many_open");

  const checked = await resolveInput(db, ctx, tripId, trip, input);
  if (!checked.ok) return checked;
  const { resolved } = checked;

  // "Create a revised poll": the original is canceled in the same transaction — only by its organizer, only if undecided.
  if (input.replaces_poll_id) {
    const [old] = await db
      .select()
      .from(polls)
      .where(and(eq(polls.id, input.replaces_poll_id), eq(polls.trip_id, tripId), eq(polls.owner_id, ctx.ownerId)))
      .for("update");
    if (!old) return fail("revised_not_found");
    if (!isOrganizer(ctx, old.created_by)) throw new ForbiddenError("Only the person who asked, or the trip owner, can replace this question.");
    if (old.result_option_id) return fail("has_result");
    if (old.status !== "canceled") {
      await db.update(polls).set({ status: "canceled", canceled_at: sql`now()` }).where(eq(polls.id, old.id));
    }
  }

  const [row] = await db
    .insert(polls)
    .values({
      trip_id: tripId,
      owner_id: ctx.ownerId,
      created_by: ctx.userId,
      question: input.question,
      description: input.description,
      parent_type: resolved.parent.type,
      parent_day: resolved.parent.day,
      parent_item_id: resolved.parent.item,
      parent_place_id: resolved.parent.place,
      closes_at: resolved.closes_at,
      any_option: input.any_option,
      replaces_poll_id: input.replaces_poll_id,
    })
    .returning({ id: polls.id });
  await db.insert(pollOptions).values(resolved.options.map((o) => ({ ...o, poll_id: row.id, trip_id: tripId })));
  await db.insert(pollParticipants).values(resolved.participants.map((user_id) => ({ poll_id: row.id, trip_id: tripId, user_id })));
  await announceOpened(db, ctx, trip, row.id, tripId, input.question, resolved.closes_at, creatorName, resolved.participants);
  return { ok: true, id: row.id };
}

async function lockPoll(db: Db, ctx: PollCtx, tripId: string, pollId: string, mode: "update" | "share") {
  const [row] = await db
    .select({ poll: polls, expired: sql<boolean>`coalesce(${polls.closes_at} <= now(), false)` })
    .from(polls)
    .where(and(eq(polls.id, pollId), eq(polls.trip_id, tripId), eq(polls.owner_id, ctx.ownerId)))
    .for(mode);
  return row ?? null;
}

/** Question, description, options, deadline — only while nobody has answered. After that: a revised poll. */
export async function updatePoll(db: Db, ctx: PollCtx, tripId: string, pollId: string, input: PollInput, creatorName: string): Promise<PollResult> {
  const trip = await lockTrip(db, ctx, tripId);
  if (!trip) return fail("not_found");
  const locked = await lockPoll(db, ctx, tripId, pollId, "update");
  if (!locked) return fail("not_found");
  const { poll } = locked;
  if (!isOrganizer(ctx, poll.created_by)) throw new ForbiddenError("Only the person who asked, or the trip owner, can change this question.");
  if (poll.status !== "open") return fail("not_open");
  if (poll.result_option_id) return fail("has_result");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pollVotes).where(eq(pollVotes.poll_id, pollId));
  if (n > 0) return fail("has_votes");

  // The attachment itself is fixed; only the content changes.
  const parent: PollParentInput =
    poll.parent_type === "day" && poll.parent_day
      ? { type: "day", day: poll.parent_day }
      : poll.parent_type === "activity" && poll.parent_item_id
        ? { type: "activity", item_id: poll.parent_item_id }
        : poll.parent_type === "place" && poll.parent_place_id
          ? { type: "place", place_id: poll.parent_place_id }
          : { type: "trip" };
  const checked = await resolveInput(db, ctx, tripId, trip, { ...input, parent });
  if (!checked.ok) return checked;
  const { resolved } = checked;

  await db
    .update(polls)
    .set({ question: input.question, description: input.description, closes_at: resolved.closes_at, any_option: input.any_option })
    .where(eq(polls.id, pollId));
  await db.delete(pollOptions).where(eq(pollOptions.poll_id, pollId));
  await db.insert(pollOptions).values(resolved.options.map((o) => ({ ...o, poll_id: pollId, trip_id: tripId })));
  await db.delete(pollParticipants).where(eq(pollParticipants.poll_id, pollId));
  await db.insert(pollParticipants).values(resolved.participants.map((user_id) => ({ poll_id: pollId, trip_id: tripId, user_id })));
  // People added by the edit hear about it; everyone already told is skipped by the dedupe key.
  await announceOpened(db, ctx, trip, pollId, tripId, input.question, resolved.closes_at, creatorName, resolved.participants);
  return { ok: true };
}

export type VoteResponse = { option_id: string } | { any: true };

/**
 * One response per person (primary key), changeable while the poll is open.
 * The deadline is checked against the database clock inside the transaction,
 * so it holds even when no background job has closed the poll.
 */
export async function castVote(db: Db, ctx: PollCtx, tripId: string, pollId: string, response: VoteResponse): Promise<PollResult> {
  const locked = await lockPoll(db, ctx, tripId, pollId, "share");
  if (!locked) return fail("not_found");
  const { poll, expired } = locked;
  if (poll.status === "canceled") return fail("canceled");
  if (poll.status !== "open" || expired) return fail("closed");
  const [asked] = await db
    .select({ u: pollParticipants.user_id })
    .from(pollParticipants)
    .where(and(eq(pollParticipants.poll_id, pollId), eq(pollParticipants.user_id, ctx.userId)));
  if (!asked) return fail("not_participant");
  let optionId: string | null = null;
  if ("any" in response) {
    if (!poll.any_option) return fail("bad_option");
  } else {
    const [opt] = await db
      .select({ id: pollOptions.id })
      .from(pollOptions)
      .where(and(eq(pollOptions.id, response.option_id), eq(pollOptions.poll_id, pollId)));
    if (!opt) return fail("bad_option");
    optionId = opt.id;
  }
  await db
    .insert(pollVotes)
    .values({ poll_id: pollId, trip_id: tripId, owner_id: ctx.ownerId, user_id: ctx.userId, option_id: optionId })
    .onConflictDoUpdate({ target: [pollVotes.poll_id, pollVotes.user_id], set: { option_id: optionId, updated_at: sql`now()` } });
  return { ok: true };
}

export async function closePoll(db: Db, ctx: PollCtx, tripId: string, pollId: string): Promise<PollResult> {
  const locked = await lockPoll(db, ctx, tripId, pollId, "update");
  if (!locked) return fail("not_found");
  if (!isOrganizer(ctx, locked.poll.created_by)) throw new ForbiddenError("Only the person who asked, or the trip owner, can close this question.");
  if (locked.poll.status !== "open") return fail("not_open");
  await db.update(polls).set({ status: "closed", closed_at: sql`now()`, closed_by: ctx.userId }).where(eq(polls.id, pollId));
  return { ok: true };
}

export async function cancelPoll(db: Db, ctx: PollCtx, tripId: string, pollId: string): Promise<PollResult> {
  const locked = await lockPoll(db, ctx, tripId, pollId, "update");
  if (!locked) return fail("not_found");
  if (!isOrganizer(ctx, locked.poll.created_by)) throw new ForbiddenError("Only the person who asked, or the trip owner, can cancel this question.");
  if (locked.poll.result_option_id) return fail("has_result");
  if (locked.poll.status === "canceled") return fail("canceled");
  await db.update(polls).set({ status: "canceled", canceled_at: sql`now()` }).where(eq(polls.id, pollId));
  return { ok: true };
}

/** Totals over people who are still on the trip. */
async function activeTally(db: Db, tripId: string, pollId: string): Promise<PollTally> {
  const options = await db.select({ id: pollOptions.id }).from(pollOptions).where(eq(pollOptions.poll_id, pollId));
  const people = new Set(await tripPeople(db, tripId));
  const [participants, votes] = await Promise.all([
    db.select({ u: pollParticipants.user_id }).from(pollParticipants).where(eq(pollParticipants.poll_id, pollId)),
    db.select({ u: pollVotes.user_id, option_id: pollVotes.option_id }).from(pollVotes).where(eq(pollVotes.poll_id, pollId)),
  ]);
  return tallyVotes(
    options.map((o) => o.id),
    votes.filter((v) => people.has(v.u)),
    participants.filter((p) => people.has(p.u)).length,
  );
}

/**
 * The organizer's explicit decision. It closes the poll, records the totals
 * as they stand (so later departures never rewrite them), and tells the
 * people who were asked. Nothing is added to the itinerary.
 */
export async function chooseResult(db: Db, ctx: PollCtx, tripId: string, pollId: string, optionId: string, chooserName: string): Promise<PollResult> {
  const locked = await lockPoll(db, ctx, tripId, pollId, "update");
  if (!locked) return fail("not_found");
  const { poll } = locked;
  if (!isOrganizer(ctx, poll.created_by)) throw new ForbiddenError("Only the person who asked, or the trip owner, can choose the final answer.");
  if (poll.status === "canceled") return fail("canceled");
  if (poll.result_option_id) return fail("already_chosen");
  const [option] = await db
    .select({ id: pollOptions.id, label: pollOptions.label })
    .from(pollOptions)
    .where(and(eq(pollOptions.id, optionId), eq(pollOptions.poll_id, pollId)));
  if (!option) return fail("bad_option");
  const tally = await activeTally(db, tripId, pollId);
  await db
    .update(polls)
    .set({
      status: "closed",
      closed_at: sql`coalesce(${polls.closed_at}, now())`,
      closed_by: sql`coalesce(${polls.closed_by}, ${ctx.userId})`,
      result_option_id: option.id,
      result_selected_by: ctx.userId,
      result_selected_at: sql`now()`,
      result_tally: { counts: tally.counts, any: tally.any, voted: tally.voted, eligible: tally.eligible },
    })
    .where(eq(polls.id, pollId));
  const asked = await db.select({ u: pollParticipants.user_id }).from(pollParticipants).where(eq(pollParticipants.poll_id, pollId));
  await safely(db, "poll_result", (tx) =>
    createNotifications(
      tx,
      asked
        .filter((p) => p.u !== ctx.userId)
        .map(
          (p): NotificationDraft => ({
            type: "poll_result",
            recipientId: p.u,
            actorId: ctx.userId,
            tripId,
            pollId,
            dedupeKey: dedupeKeys.pollResult(pollId),
            title: "The group has decided",
            body: `${personName(chooserName)} chose “${option.label}” for “${cleanText(poll.question, 120)}”.`,
          }),
        ),
    ),
  );
  return { ok: true };
}

/* --------------------------------- reads --------------------------------- */

/**
 * Every poll of the trip as the caller should see it. Totals and the "who
 * voted" list include current members only; a finalized poll shows the
 * totals it was decided with.
 */
export async function listPolls(db: Db, ctx: PollCtx, tripId: string): Promise<PollView[]> {
  const rows = await db
    .select({ poll: polls, expired: sql<boolean>`coalesce(${polls.closes_at} <= now(), false)` })
    .from(polls)
    .where(and(eq(polls.trip_id, tripId), eq(polls.owner_id, ctx.ownerId)))
    .orderBy(desc(polls.created_at), desc(polls.id))
    .limit(100);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.poll.id);
  const [options, participants, votes, people] = await Promise.all([
    db
      .select({ o: pollOptions, place: { id: places.id, name: places.name, kind: places.kind, category: places.category } })
      .from(pollOptions)
      .leftJoin(places, and(eq(places.id, pollOptions.place_id), eq(places.trip_id, pollOptions.trip_id)))
      .where(inArray(pollOptions.poll_id, ids))
      .orderBy(asc(pollOptions.position)),
    db.select().from(pollParticipants).where(inArray(pollParticipants.poll_id, ids)),
    db.select().from(pollVotes).where(inArray(pollVotes.poll_id, ids)),
    tripPeople(db, tripId),
  ]);
  const current = new Set(people);

  const itemIds = [...new Set(rows.flatMap((r) => (r.poll.parent_item_id ? [r.poll.parent_item_id] : [])))];
  const placeIds = [...new Set(rows.flatMap((r) => (r.poll.parent_place_id ? [r.poll.parent_place_id] : [])))];
  const resultPlaceIds = [
    ...new Set(
      options.flatMap(({ o }) => (rows.some((r) => r.poll.result_option_id === o.id) && o.place_id ? [o.place_id] : [])),
    ),
  ];
  const [items, parentPlaces, visits] = await Promise.all([
    itemIds.length
      ? db
          .select({ id: itineraryItems.id, title: itineraryItems.title, place_name: places.name, date: itineraryItems.local_date })
          .from(itineraryItems)
          .leftJoin(places, eq(places.id, itineraryItems.place_id))
          .where(and(inArray(itineraryItems.id, itemIds), eq(itineraryItems.trip_id, tripId)))
      : [],
    placeIds.length ? db.select({ id: places.id, name: places.name }).from(places).where(and(inArray(places.id, placeIds), eq(places.trip_id, tripId))) : [],
    resultPlaceIds.length
      ? db
          .select({ id: itineraryItems.id, place_id: itineraryItems.place_id, date: itineraryItems.local_date, status: itineraryItems.status })
          .from(itineraryItems)
          .where(
            and(
              inArray(itineraryItems.place_id, resultPlaceIds),
              eq(itineraryItems.trip_id, tripId),
              inArray(itineraryItems.status, ["planned", "completed"]),
            ),
          )
          .orderBy(asc(itineraryItems.local_date))
      : [],
  ]);

  const nameIds = [...new Set([ctx.ownerId, ...rows.flatMap((r) => [r.poll.created_by, r.poll.result_selected_by ?? ""]), ...participants.map((p) => p.user_id), ...votes.map((v) => v.user_id)])].filter(Boolean);
  const profiles = await db.select({ id: userProfiles.user_id, name: userProfiles.display_name }).from(userProfiles).where(inArray(userProfiles.user_id, nameIds));
  const names = new Map(profiles.map((p) => [p.id, p.name]));
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? (id === ctx.ownerId ? "The trip owner" : "A trip member")) : "Someone");
  const replacedBy = new Map(rows.filter((r) => r.poll.replaces_poll_id).map((r) => [r.poll.replaces_poll_id!, r.poll.id]));

  return rows.map(({ poll, expired }) => {
    const opts = options.filter((x) => x.o.poll_id === poll.id).map(({ o, place }) => ({
      id: o.id,
      position: o.position,
      label: o.label,
      place: place?.id ? { id: place.id, name: place.name, kind: place.kind, category: place.category } : null,
    }));
    const askedAll = participants.filter((p) => p.poll_id === poll.id);
    const asked = askedAll.filter((p) => current.has(p.user_id));
    const activeVotes = votes.filter((v) => v.poll_id === poll.id && current.has(v.user_id) && asked.some((a) => a.user_id === v.user_id));
    const live = tallyVotes(opts.map((o) => o.id), activeVotes, asked.length);
    const snapshot = poll.result_tally
      ? { ...poll.result_tally, leaders: (() => { const top = Math.max(0, ...Object.values(poll.result_tally.counts)); return top > 0 ? Object.keys(poll.result_tally.counts).filter((k) => poll.result_tally!.counts[k] === top) : []; })() }
      : null;
    const myVote = votes.find((v) => v.poll_id === poll.id && v.user_id === ctx.userId);
    const iAmAsked = asked.some((a) => a.user_id === ctx.userId);
    const item = poll.parent_item_id ? items.find((i) => i.id === poll.parent_item_id) : undefined;
    const parentPlace = poll.parent_place_id ? parentPlaces.find((p) => p.id === poll.parent_place_id) : undefined;
    const resultOption = poll.result_option_id ? opts.find((o) => o.id === poll.result_option_id) : undefined;
    const existing = resultOption?.place
      ? (visits.find((v) => v.place_id === resultOption.place!.id) ?? null)
      : null;
    return {
      id: poll.id,
      question: poll.question,
      description: poll.description,
      created_by: poll.created_by,
      creator_name: nameOf(poll.created_by),
      created_at: poll.created_at,
      parent: {
        type: poll.parent_type as PollParentType,
        day: poll.parent_day,
        item: item ? { id: item.id, title: item.title ?? item.place_name ?? "An activity", date: item.date } : null,
        place: parentPlace ?? null,
        missing: (poll.parent_type === "activity" && !item) || (poll.parent_type === "place" && !parentPlace),
      },
      status: poll.status as PollStatus,
      closes_at: poll.closes_at,
      expired,
      any_option: poll.any_option,
      options: opts,
      participants: asked.map((a) => ({ user_id: a.user_id, name: nameOf(a.user_id), voted: activeVotes.some((v) => v.user_id === a.user_id) })),
      votes: activeVotes.map((v) => ({ user_id: v.user_id, name: nameOf(v.user_id), option_id: v.option_id })),
      tally: live,
      hasVotes: votes.some((v) => v.poll_id === poll.id),
      me: { asked: iAmAsked, response: myVote ? { option_id: myVote.option_id } : null },
      result:
        poll.result_option_id && poll.result_selected_at
          ? {
              option_id: poll.result_option_id,
              selected_by: nameOf(poll.result_selected_by),
              selected_at: poll.result_selected_at,
              tally: snapshot ?? live,
              existing: existing ? { id: existing.id, date: existing.date, status: existing.status } : null,
            }
          : null,
      replaces: poll.replaces_poll_id,
      replacedBy: replacedBy.get(poll.id) ?? null,
      can: pollPermissions({
        role: ctx.role,
        userId: ctx.userId,
        createdBy: poll.created_by,
        status: poll.status as PollStatus,
        expired,
        asked: iAmAsked,
        hasVotes: votes.some((v) => v.poll_id === poll.id),
        hasResult: Boolean(poll.result_option_id),
      }),
    } satisfies PollView;
  });
}
