/**
 * Shared trips: invitations, membership, roles, attribution, change detection
 * and edit conflicts — against a migrated, disposable database.
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:sharing
 *
 * Runs the real sharing queries and the real write gate (`runTripWrite`, the
 * function every DAL mutation goes through) as several different users. Email
 * uses a mock transport: nothing is ever sent. Test records are removed at the
 * end. Google sign-in and session cookies are not exercised here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db";
import * as q from "../src/db/queries";
import * as sh from "../src/db/sharing";
import { tripInvitations, trips } from "../src/db/schema";
import { decideInvitePage } from "../src/lib/invite-page";
import {
  buildInviteMessage,
  getAppOrigin,
  getEmailConfig,
  sendInviteEmail,
  type EmailConfig,
  type InviteEmail,
} from "../src/lib/email/invitation-email";
import {
  ForbiddenError,
  INVITE_CREATE_LIMIT_PER_HOUR,
  TOKEN_PATTERN,
  can,
  invitePath,
  maskEmail,
  normalizeEmail,
  parseEmail,
} from "../src/lib/sharing";
import type { ItineraryItemInput, PlaceInput, ReservationInput, TripInput } from "../src/lib/types";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to a migrated, disposable database.");
  process.exit(1);
}

const { db, pool } = createDb(url);
const id = () => `test-${randomUUID()}`;
const [OWNER, EDITOR, VIEWER, STRANGER, GUEST] = [id(), id(), id(), id(), id()];
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
const place = (name: string): PlaceInput => ({
  name,
  kind: "food",
  category: "restaurant",
  priority: "maybe",
  address: null,
  maps_url: null,
  website_url: null,
  planning_notes: null,
});
const visit = (title: string): ItineraryItemInput => ({
  place_id: null,
  reservation_id: null,
  title,
  category: "activity",
  local_date: "2026-10-15",
  local_start_time: null,
  local_end_date: null,
  local_end_time: null,
  timezone: null,
  planning_notes: null,
});
const booking: ReservationInput = {
  kind: "activity",
  status: "confirmed",
  title: "Catamaran",
  provider: null,
  confirmation_code: "ABC123",
  start_date: "2026-10-16",
  start_time: "10:00",
  start_time_zone: "America/Aruba",
  end_date: "2026-10-16",
  end_time: "13:00",
  end_time_zone: "America/Aruba",
  origin: null,
  destination: null,
  location: null,
  booking_url: null,
  notes: null,
  details: {},
};

/** The same gate every DAL mutation uses, as a given user. */
const write = <T>(user: string, tripId: string, fn: (d: typeof db, c: sh.TripContext) => Promise<T>, cap: "contribute" | "manage_trip" | "manage_members" = "contribute") =>
  sh.runTripWrite(db, user, tripId, cap, "NO_ACCESS" as const, fn);

const forbidden = async (p: Promise<unknown>) => {
  await assert.rejects(p, (e) => e instanceof ForbiddenError);
};

async function join(tripId: string, userId: string, role: "editor" | "viewer", email: string | null = null) {
  const made = await sh.createInvitation(db, { ownerId: OWNER, tripId, invitedBy: OWNER, inviterName: "Olive", email, role });
  assert.ok(made.ok);
  const accepted = await sh.acceptInvitation(db, {
    tokenHash: sh.hashInviteToken(made.token),
    userId,
    verifiedEmail: email,
    emailUnverified: false,
  });
  assert.equal(accepted.status, "ok");
}

async function main() {
  const createdTrips: string[] = [];
  const mkTrip = async (title: string) => {
    const { id: tripId } = await q.createTrip(db, OWNER, tripInput(title));
    createdTrips.push(tripId);
    return tripId;
  };

  // A trip that exists before any sharing: the owner keeps access.
  const t = await mkTrip("Aruba");
  const other = await mkTrip("Another trip");
  await q.createReservation(db, OWNER, t, booking);

  console.log("Roles and helpers");
  await check("capabilities by role", () => {
    assert.ok(can("owner", "manage_members") && can("owner", "manage_trip") && can("owner", "contribute"));
    assert.ok(can("editor", "contribute") && can("editor", "read"));
    assert.ok(!can("editor", "manage_members") && !can("editor", "manage_trip"));
    assert.ok(can("viewer", "read") && !can("viewer", "contribute"));
    // Voting in a poll is the one explicit exception: a viewer may participate, and still cannot change anything else.
    assert.ok(can("viewer", "participate") && can("editor", "participate") && can("owner", "participate"));
    assert.ok(!can("viewer", "contribute") && !can("viewer", "manage_trip") && !can("viewer", "manage_members"));
    assert.ok(!can(null, "read") && !can(null, "participate"));
  });
  await check("emails are trimmed and lower-cased, with no Gmail dot or plus equivalence", () => {
    assert.equal(normalizeEmail("  Maya@Example.COM \n"), "maya@example.com");
    assert.equal(parseEmail("  Maya@Example.COM "), "maya@example.com");
    assert.notEqual(parseEmail("maya.k@gmail.com"), parseEmail("mayak@gmail.com"));
    assert.notEqual(parseEmail("maya+x@gmail.com"), parseEmail("maya@gmail.com"));
    for (const bad of ["", "no-at", "a@b", "a b@c.com", "a@b.c", "a@@b.com", "<x>@b.com", "a@b..com"]) assert.equal(parseEmail(bad), null, bad);
    assert.equal(maskEmail("maya@example.com"), "m•••@e•••.com");
  });
  await check("the owner of a pre-existing trip keeps full access; strangers have none", async () => {
    assert.deepEqual(await sh.resolveTripAccess(db, OWNER, t), { ownerId: OWNER, role: "owner" });
    assert.equal(await sh.resolveTripAccess(db, STRANGER, t), null);
    assert.equal(await sh.resolveTripAccess(db, OWNER, randomUUID()), null);
  });

  console.log("Invitations");
  let emailInvite!: Extract<Awaited<ReturnType<typeof sh.createInvitation>>, { ok: true }>;
  await check("owner creates an email invitation: random token, only its hash is stored", async () => {
    const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: t, invitedBy: OWNER, inviterName: "Olive", email: "wife@example.com", role: "editor" });
    assert.ok(made.ok);
    emailInvite = made;
    assert.match(made.token, TOKEN_PATTERN);
    const [row] = await db.select().from(tripInvitations).where(sql`${tripInvitations.id} = ${made.id}`);
    assert.equal(row.token_hash, sh.hashInviteToken(made.token));
    assert.ok(!JSON.stringify(row).includes(made.token), "the raw token is nowhere in the row");
    assert.equal(row.email, "wife@example.com");
    assert.equal(row.role, "editor");
    assert.equal(row.delivery_status, "not_sent");
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7.01, `expires in ~7 days (${days})`);
    const second = await sh.createInvitation(db, { ownerId: OWNER, tripId: t, invitedBy: OWNER, inviterName: "Olive", email: null, role: "editor" });
    assert.ok(second.ok && second.token !== made.token);
  });
  await check("another owner cannot create invitations for this trip, and an editor fails the manage gate", async () => {
    const tp0 = await mkTrip("Gate");
    await join(tp0, EDITOR, "editor");
    const made = await sh.createInvitation(db, { ownerId: STRANGER, tripId: t, invitedBy: STRANGER, inviterName: "x", email: null, role: "editor" });
    assert.deepEqual(made, { ok: false, reason: "not_found" });
    await forbidden(write(EDITOR, tp0, async () => 1, "manage_members"));
  });
  await check("a duplicate open invitation to the same address is refused (use Send again)", async () => {
    const again = await sh.createInvitation(db, { ownerId: OWNER, tripId: t, invitedBy: OWNER, inviterName: "Olive", email: "wife@example.com", role: "viewer" });
    assert.deepEqual(again, { ok: false, reason: "already_invited", invitationId: emailInvite.id });
  });

  await check("the preview is minimal and previewing or signing in never accepts", async () => {
    const preview = await sh.previewInvitation(db, sh.hashInviteToken(emailInvite.token));
    assert.ok(preview);
    const page = decideInvitePage(preview, { id: GUEST, email: "wife@example.com", emailVerified: true }, false);
    assert.equal(page.kind, "ready");
    assert.deepEqual(Object.keys(page).sort(), ["inviter", "kind", "role", "trip"]);
    assert.deepEqual(Object.keys((page as { trip: object }).trip).sort(), ["end_date", "start_date", "title"]);
    assert.equal(JSON.stringify(page).includes("wife@example.com"), false, "no invited email");
    assert.equal(JSON.stringify(page).includes("ABC123"), false, "no booking details");
    assert.equal(await sh.resolveTripAccess(db, GUEST, t), null, "still not a member");
    assert.equal((await sh.listMembers(db, OWNER, t)).length, 0);
  });
  await check("wrong signed-in account cannot accept an email-bound invitation; hint is masked", async () => {
    const res = await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(emailInvite.token), userId: STRANGER, verifiedEmail: "someone@else.com", emailUnverified: false });
    assert.deepEqual(res, { status: "wrong_account", hint: "w•••@e•••.com" });
    assert.equal(await sh.resolveTripAccess(db, STRANGER, t), null);
    const preview = (await sh.previewInvitation(db, sh.hashInviteToken(emailInvite.token)))!;
    const page = decideInvitePage(preview, { id: STRANGER, email: "someone@else.com", emailVerified: true }, false);
    assert.equal(page.kind, "wrong_account");
    assert.equal(JSON.stringify(page).includes("wife@example.com"), false);
  });
  await check("an unverified email, or a Gmail-style variant, does not match", async () => {
    const tokenHash = sh.hashInviteToken(emailInvite.token);
    assert.equal((await sh.acceptInvitation(db, { tokenHash, userId: GUEST, verifiedEmail: null, emailUnverified: true })).status, "unverified_email");
    assert.equal((await sh.acceptInvitation(db, { tokenHash, userId: GUEST, verifiedEmail: "w.ife@example.com", emailUnverified: false })).status, "wrong_account");
    const preview = (await sh.previewInvitation(db, tokenHash))!;
    assert.equal(decideInvitePage(preview, { id: GUEST, email: "wife@example.com", emailVerified: false }, false).kind, "unverified_email");
  });
  await check("the invited person accepts explicitly: membership with exactly the offered role", async () => {
    const res = await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(emailInvite.token), userId: GUEST, verifiedEmail: normalizeEmail(" Wife@Example.com "), emailUnverified: false });
    assert.deepEqual(res, { status: "ok", tripId: t, role: "editor" });
    assert.deepEqual(await sh.resolveTripAccess(db, GUEST, t), { ownerId: OWNER, role: "editor" });
    const members = await sh.listMembers(db, OWNER, t);
    assert.equal(members.length, 1);
    assert.equal(members[0].role, "editor");
  });
  await check("accepting again: already accepted by you; someone else: used; already a member is not consumed", async () => {
    const tokenHash = sh.hashInviteToken(emailInvite.token);
    assert.deepEqual(await sh.acceptInvitation(db, { tokenHash, userId: GUEST, verifiedEmail: "wife@example.com", emailUnverified: false }), { status: "accepted_by_you", tripId: t });
    assert.equal((await sh.acceptInvitation(db, { tokenHash, userId: STRANGER, verifiedEmail: "wife@example.com", emailUnverified: false })).status, "accepted_by_other");
    const link = await sh.createInvitation(db, { ownerId: OWNER, tripId: t, invitedBy: OWNER, inviterName: "Olive", email: null, role: "viewer" });
    assert.ok(link.ok);
    const res = await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(link.token), userId: GUEST, verifiedEmail: null, emailUnverified: false });
    assert.deepEqual(res, { status: "already_member", tripId: t });
    assert.equal((await sh.listOpenInvitations(db, OWNER, t)).some((i) => i.id === link.id), true, "left open — not consumed");
    assert.equal((await sh.resolveTripAccess(db, GUEST, t))?.role, "editor", "role not downgraded by a second invitation");
    assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(link.token), userId: OWNER, verifiedEmail: null, emailUnverified: false })).status, "owner");
    await sh.revokeInvitation(db, OWNER, t, link.id);
  });

  await check("a copied link needs a signed-in user, is single-use, and cannot be shared onward", async () => {
    const link = await sh.createInvitation(db, { ownerId: OWNER, tripId: t, invitedBy: OWNER, inviterName: "Olive", email: null, role: "viewer" });
    assert.ok(link.ok);
    const hash = sh.hashInviteToken(link.token);
    const preview = (await sh.previewInvitation(db, hash))!;
    assert.equal(preview.email_bound, false);
    assert.equal(preview.email_hint, null);
    // Signed out → the page decision never runs (the DAL returns "signed_out"); there is no accept path without a user id.
    assert.equal((await sh.acceptInvitation(db, { tokenHash: hash, userId: VIEWER, verifiedEmail: null, emailUnverified: false })).status, "ok");
    assert.equal((await sh.acceptInvitation(db, { tokenHash: hash, userId: STRANGER, verifiedEmail: null, emailUnverified: false })).status, "accepted_by_other");
    assert.equal((await sh.resolveTripAccess(db, VIEWER, t))?.role, "viewer");
    assert.equal(await sh.resolveTripAccess(db, STRANGER, t), null);
  });

  await check("expired, revoked and unknown tokens fail", async () => {
    const mk = async (email: string | null = null) => {
      const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: other, invitedBy: OWNER, inviterName: "Olive", email, role: "editor" });
      assert.ok(made.ok);
      return made;
    };
    const accept = (token: string, user = STRANGER) => sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(token), userId: user, verifiedEmail: null, emailUnverified: false });
    const expired = await mk();
    await db.execute(sql`update trip_invitations set expires_at = now() - interval '1 minute' where id = ${expired.id}`);
    assert.equal((await accept(expired.token)).status, "expired");
    assert.equal((await sh.previewInvitation(db, sh.hashInviteToken(expired.token)))!.state, "expired");
    const revoked = await mk();
    assert.equal(await sh.revokeInvitation(db, OWNER, other, revoked.id), true);
    assert.equal((await accept(revoked.token)).status, "revoked");
    assert.equal(await sh.revokeInvitation(db, OWNER, other, revoked.id), false, "already revoked");
    assert.equal((await accept(sh.newInviteToken())).status, "invalid");
    assert.equal(await sh.resolveTripAccess(db, STRANGER, other), null);
    // Another owner cannot revoke it.
    const mine = await mk();
    assert.equal(await sh.revokeInvitation(db, STRANGER, other, mine.id), false);
    await sh.revokeInvitation(db, OWNER, other, mine.id);
    // An expired invitation can be replaced and then works.
    const replaced = await sh.rotateInvitation(db, { ownerId: OWNER, tripId: other, invitationId: expired.id, forEmail: false });
    assert.ok(replaced.ok);
    assert.equal((await accept(replaced.token, EDITOR)).status, "ok");
    await sh.removeMember(db, OWNER, other, EDITOR);
  });
  await check("a deleted trip takes its invitations with it", async () => {
    const gone = await mkTrip("Deleted");
    const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: gone, invitedBy: OWNER, inviterName: "O", email: null, role: "editor" });
    assert.ok(made.ok);
    assert.equal(await q.deleteTrip(db, OWNER, gone), true);
    const res = await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(made.token), userId: STRANGER, verifiedEmail: null, emailUnverified: false });
    assert.equal(res.status, "invalid");
  });

  await check("simultaneous acceptance: one membership, one success", async () => {
    const t2 = await mkTrip("Race");
    const link = await sh.createInvitation(db, { ownerId: OWNER, tripId: t2, invitedBy: OWNER, inviterName: "O", email: null, role: "editor" });
    assert.ok(link.ok);
    const hash = sh.hashInviteToken(link.token);
    const sameUser = await Promise.all(
      Array.from({ length: 6 }, () => sh.acceptInvitation(db, { tokenHash: hash, userId: GUEST, verifiedEmail: null, emailUnverified: false })),
    );
    assert.equal(sameUser.filter((r) => r.status === "ok").length, 1);
    assert.ok(sameUser.every((r) => r.status === "ok" || r.status === "accepted_by_you"));
    assert.equal((await sh.listMembers(db, OWNER, t2)).length, 1);

    const link2 = await sh.createInvitation(db, { ownerId: OWNER, tripId: t2, invitedBy: OWNER, inviterName: "O", email: null, role: "viewer" });
    assert.ok(link2.ok);
    const hash2 = sh.hashInviteToken(link2.token);
    const two = await Promise.all(
      [STRANGER, EDITOR].map((userId) => sh.acceptInvitation(db, { tokenHash: hash2, userId, verifiedEmail: null, emailUnverified: false })),
    );
    assert.deepEqual(two.map((r) => r.status).sort(), ["accepted_by_other", "ok"]);
    assert.equal((await sh.listMembers(db, OWNER, t2)).length, 2, "exactly one new member");
    const dup = await db.execute(sql`select count(*)::int as n from trip_members where trip_id = ${t2} group by user_id having count(*) > 1`);
    assert.equal(dup.rows.length, 0);
  });

  await check("resending replaces the token: the old link stops working, the new one works once", async () => {
    const t3 = await mkTrip("Resend");
    const first = await sh.createInvitation(db, { ownerId: OWNER, tripId: t3, invitedBy: OWNER, inviterName: "O", email: "r@example.com", role: "editor" });
    assert.ok(first.ok);
    await db.execute(sql`update trip_invitations set last_sent_at = now() where id = ${first.id}`);
    assert.deepEqual(await sh.rotateInvitation(db, { ownerId: OWNER, tripId: t3, invitationId: first.id, forEmail: true }), { ok: false, reason: "cooldown" });
    await db.execute(sql`update trip_invitations set last_sent_at = now() - interval '2 minutes' where id = ${first.id}`);
    const second = await sh.rotateInvitation(db, { ownerId: OWNER, tripId: t3, invitationId: first.id, forEmail: true });
    assert.ok(second.ok && second.token !== first.token);
    const accept = (token: string) => sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(token), userId: GUEST, verifiedEmail: "r@example.com", emailUnverified: false });
    assert.equal((await accept(first.token)).status, "invalid", "old token is dead");
    assert.equal((await accept(second.token)).status, "ok");
    // Not the owner's invitation → not found.
    assert.deepEqual(await sh.rotateInvitation(db, { ownerId: STRANGER, tripId: t3, invitationId: first.id, forEmail: false }), { ok: false, reason: "not_found" });
  });
  await check("delivery is recorded only for the token that was sent", async () => {
    const t4 = await mkTrip("Delivery");
    const inv = await sh.createInvitation(db, { ownerId: OWNER, tripId: t4, invitedBy: OWNER, inviterName: "O", email: "d@example.com", role: "editor" });
    assert.ok(inv.ok);
    await sh.recordDelivery(db, { ownerId: OWNER, tripId: t4, invitationId: inv.id, token: sh.newInviteToken(), status: "sent" });
    assert.equal((await sh.listOpenInvitations(db, OWNER, t4))[0].delivery_status, "not_sent", "wrong token → not recorded");
    await sh.recordDelivery(db, { ownerId: OWNER, tripId: t4, invitationId: inv.id, token: inv.token, status: "failed" });
    const [row] = await sh.listOpenInvitations(db, OWNER, t4);
    assert.deepEqual([row.delivery_status, row.last_sent_at, row.send_count], ["failed", null, 1]);
  });
  await check("invitations are rate limited per trip per hour, and members / owner emails are refused", async () => {
    const t5 = await mkTrip("Limits");
    await sh.upsertProfile(db, { id: OWNER, name: "Olive", email: "olive@example.com" });
    assert.deepEqual(await sh.createInvitation(db, { ownerId: OWNER, tripId: t5, invitedBy: OWNER, inviterName: "O", email: "olive@example.com", role: "editor" }), { ok: false, reason: "is_owner" });
    await sh.upsertProfile(db, { id: GUEST, name: "Wife", email: "wife@example.com" });
    await join(t5, GUEST, "editor");
    assert.deepEqual(await sh.createInvitation(db, { ownerId: OWNER, tripId: t5, invitedBy: OWNER, inviterName: "O", email: "WIFE@example.com", role: "editor" }), { ok: false, reason: "already_member" });
    for (let i = 0; i < INVITE_CREATE_LIMIT_PER_HOUR - 1; i++) {
      assert.ok((await sh.createInvitation(db, { ownerId: OWNER, tripId: t5, invitedBy: OWNER, inviterName: "O", email: null, role: "viewer" })).ok);
    }
    assert.deepEqual(await sh.createInvitation(db, { ownerId: OWNER, tripId: t5, invitedBy: OWNER, inviterName: "O", email: null, role: "viewer" }), { ok: false, reason: "rate_limited" });
  });

  console.log("Email delivery (mock transport — nothing is sent)");
  const config: EmailConfig = { origin: "https://atlas.example.com", apiKey: "key_test", from: "Atlas <invites@example.com>", devInbox: null };
  const mail: InviteEmail = {
    to: "wife@example.com",
    inviterName: 'Olive <script>alert(1)</script>\r\nBcc: evil@x.com',
    tripTitle: 'Aruba "2026" & <b>fun</b>',
    role: "editor",
    expiresAt: "2026-10-14T12:00:00Z",
    invitePath: invitePath("T".repeat(43)),
  };
  await check("not configured: nothing is sent and it is reported as not configured", async () => {
    let called = 0;
    const result = await sendInviteEmail(mail, { config: null, transport: async () => (called++, { accepted: true }) });
    assert.deepEqual(result, { status: "not_configured" });
    assert.equal(called, 0);
    assert.equal(getEmailConfig({} as NodeJS.ProcessEnv), null);
    assert.equal(getEmailConfig({ APP_ORIGIN: "https://a.example", RESEND_API_KEY: "k" } as unknown as NodeJS.ProcessEnv), null, "needs a sender too");
  });
  await check("sent only when the provider accepts; rejection and network errors are failures", async () => {
    assert.deepEqual(await sendInviteEmail(mail, { config, transport: async () => ({ accepted: true }) }), { status: "sent" });
    assert.deepEqual(await sendInviteEmail(mail, { config, transport: async () => ({ accepted: false }) }), { status: "failed" });
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await sendInviteEmail(mail, { config, transport: async () => { throw new Error("boom https://atlas.example.com/invite/secret"); } }), { status: "failed" });
    } finally {
      console.error = quiet;
    }
  });
  await check("the message uses the configured origin, escapes user text, and carries no private details", async () => {
    const seen: { to: string; html: string; text: string; subject: string }[] = [];
    await sendInviteEmail(mail, { config: { ...config, devInbox: "dev@example.com" }, transport: async (m) => (seen.push(m), { accepted: true }) });
    assert.equal(seen[0].to, "dev@example.com", "development inbox overrides the recipient");
    const m = buildInviteMessage(mail, config.origin);
    assert.equal(m.url, `https://atlas.example.com/invite/${"T".repeat(43)}`);
    assert.ok(m.html.includes(`href="${m.url}"`));
    assert.ok(!m.html.includes("<script>") && !m.html.includes("<b>fun</b>"), "HTML escaped");
    assert.ok(m.html.includes("&lt;script&gt;"));
    assert.ok(!/[\r\n]/.test(m.subject), "no header injection");
    assert.ok(m.html.includes("Can view the trip and contribute to the plan."));
    assert.ok(/Aruba/.test(m.text) && !/ABC123|confirmation|address/i.test(m.text + m.html));
    assert.equal(getAppOrigin({ APP_ORIGIN: "http://evil.example" } as unknown as NodeJS.ProcessEnv), null, "http only on localhost");
    assert.equal(getAppOrigin({ APP_ORIGIN: "http://localhost:3000" } as unknown as NodeJS.ProcessEnv), "http://localhost:3000");
    assert.equal(getAppOrigin({ APP_ORIGIN: "https://user:pw@a.example" } as unknown as NodeJS.ProcessEnv), null);
  });

  console.log("Permissions on a shared trip");
  const tp = await mkTrip("Shared");
  const eagle = await q.createPlace(db, OWNER, tp, place("Eagle Beach"));
  assert.ok(eagle.ok);
  await sh.upsertProfile(db, { id: OWNER, name: "Olive", email: "olive@example.com" });
  await sh.upsertProfile(db, { id: EDITOR, name: "Eddie", email: "eddie@example.com" });
  await sh.upsertProfile(db, { id: VIEWER, name: "Vera", email: "vera@example.com" });
  await join(tp, EDITOR, "editor");
  await join(tp, VIEWER, "viewer");
  const cat = await q.createPackingCategory(db, OWNER, tp, { name: "Beach" });
  assert.ok(cat.ok);

  await check("an editor contributes everywhere: itinerary, Explore, bookings, packing, memories, documents", async () => {
    const asEditor = <T>(fn: (d: typeof db, c: sh.TripContext) => Promise<T>) => write(EDITOR, tp, fn);
    const v = await asEditor((d, c) => q.createItineraryItem(d, c.ownerId, tp, visit("Snorkel")));
    const p = await asEditor((d, c) => q.createPlace(d, c.ownerId, tp, place("Zeerovers")));
    const b = await asEditor((d, c) => q.createReservation(d, c.ownerId, tp, booking));
    const pk = await asEditor((d, c) => q.createPackingItem(d, c.ownerId, tp, { category_id: cat.id, label: "Hat", quantity: 1, traveler_name: null, notes: null }));
    const mem = await asEditor((d, c) => q.saveTripMemory(d, c.ownerId, tp, { summary: "Great" }));
    const doc = await asEditor((d, c) => q.createDocument(d, c.ownerId, tp, { reservation_id: null, label: "Tickets", url: "https://example.com/t" }));
    assert.ok(v !== "NO_ACCESS" && v.ok && p !== "NO_ACCESS" && p.ok && b !== "NO_ACCESS" && b && pk !== "NO_ACCESS" && pk.ok && mem === true && doc !== "NO_ACCESS" && doc.ok);
    // The owner sees all of it as the same trip's content (rows carry the owner's id, so FKs hold).
    assert.equal((await q.listItinerary(db, OWNER, tp))!.some((e) => e.title === "Snorkel"), true);
    assert.equal((await q.listPlaces(db, OWNER, tp))!.some((x) => x.name === "Zeerovers"), true);
    const detail = await q.getTripWithDetails(db, OWNER, tp);
    assert.equal(detail!.reservations.length, 1);
    assert.equal(detail!.documents.length, 1);
    await asEditor((d, c) => q.deleteItineraryItem(d, c.ownerId, tp, v.ok ? v.id : ""));
    await asEditor((d, c) => q.deletePlace(d, c.ownerId, tp, p.ok ? p.id : "", "block"));
  });
  await check("a viewer cannot change anything — every mutation is refused at the gate", async () => {
    const asViewer = <T>(fn: (d: typeof db, c: sh.TripContext) => Promise<T>) => write(VIEWER, tp, fn);
    let ran = 0;
    const ops: ((d: typeof db, c: sh.TripContext) => Promise<unknown>)[] = [
      (d, c) => q.createItineraryItem(d, c.ownerId, tp, visit("Nope")),
      (d, c) => q.createPlace(d, c.ownerId, tp, place("Nope")),
      (d, c) => q.createReservation(d, c.ownerId, tp, booking),
      (d, c) => q.createPackingItem(d, c.ownerId, tp, { category_id: cat.id, label: "Nope", quantity: 1, traveler_name: null, notes: null }),
      (d, c) => q.saveTripMemory(d, c.ownerId, tp, { summary: "Nope" }),
      (d, c) => q.createDocument(d, c.ownerId, tp, { reservation_id: null, label: "Nope", url: "https://example.com" }),
      (d, c) => q.updatePlace(d, c.ownerId, tp, eagle.id, place("Hijacked")),
      (d, c) => q.deletePlace(d, c.ownerId, tp, eagle.id, "detach"),
      (d, c) => q.updateTrip(d, c.ownerId, tp, tripInput("Hijacked")),
    ];
    for (const op of ops) {
      await forbidden(asViewer(async (d, c) => { ran++; return op(d, c); }));
    }
    assert.equal(ran, 0, "the operation body never ran");
    assert.equal((await q.listPlaces(db, OWNER, tp))!.find((x) => x.id === eagle.id)!.name, "Eagle Beach");
    assert.equal((await q.getTripWithDetails(db, OWNER, tp))!.title, "Shared");
  });
  await check("an editor cannot manage the trip, invitations or members — including promoting themselves", async () => {
    await forbidden(write(EDITOR, tp, async () => 1, "manage_trip"));
    await forbidden(write(EDITOR, tp, async () => 1, "manage_members"));
    await forbidden(write(VIEWER, tp, async () => 1, "manage_members"));
    assert.equal((await sh.resolveTripAccess(db, EDITOR, tp))?.role, "editor");
    // Only the owner passes the owner-only gate.
    assert.equal(await write(OWNER, tp, async () => "ok", "manage_members"), "ok");
  });
  await check("non-members get the same 'no access' as a missing trip, on every write path", async () => {
    assert.equal(await write(STRANGER, tp, async () => "ran"), "NO_ACCESS");
    assert.equal(await write(STRANGER, randomUUID(), async () => "ran"), "NO_ACCESS");
    assert.equal(await write(STRANGER, tp, async () => "ran", "manage_members"), "NO_ACCESS");
  });
  await check("membership is per trip: access to one trip never reaches the owner's others", async () => {
    assert.equal(await sh.resolveTripAccess(db, EDITOR, other), null);
    assert.equal(await write(EDITOR, other, async () => "ran"), "NO_ACCESS");
    // A nested id from another trip is refused by the owner-scoped query even with a valid role on this one.
    const foreign = await q.createPlace(db, OWNER, other, place("Elsewhere"));
    assert.ok(foreign.ok);
    const r = await write(EDITOR, tp, (d, c) => q.updatePlace(d, c.ownerId, tp, foreign.id, place("Hijacked")));
    assert.equal(r, false);
    assert.equal((await q.listPlaces(db, OWNER, other))!.find((x) => x.id === foreign.id)!.name, "Elsewhere");
  });
  await check("trip lists: shared trips appear for members, labelled by role, never for others", async () => {
    const mine = await sh.listAccessibleTrips(db, EDITOR);
    const s = mine.find((x) => x.id === tp);
    assert.ok(s);
    assert.deepEqual([s.role, s.owner_name], ["editor", "Olive"]);
    assert.equal(mine.some((x) => x.id === other), false);
    assert.equal((await sh.listAccessibleTrips(db, id())).length, 0);
    assert.equal((await sh.listAccessibleTrips(db, OWNER)).find((x) => x.id === tp)!.role, "owner");
  });
  await check("Explore hearts and 'Your notes' stay private to each member", async () => {
    assert.equal(await q.setPlaceFavorite(db, OWNER, tp, eagle.id, true, OWNER), true);
    assert.equal(await q.updatePlaceNotes(db, OWNER, tp, eagle.id, "Owner secret", OWNER), true);
    const asOwner = (await q.listPlaces(db, OWNER, tp, OWNER))!.find((x) => x.id === eagle.id)!;
    const asEditor = (await q.listPlaces(db, OWNER, tp, EDITOR))!.find((x) => x.id === eagle.id)!;
    const asViewer = (await q.listPlaces(db, OWNER, tp, VIEWER))!.find((x) => x.id === eagle.id)!;
    assert.deepEqual([asOwner.is_favorite, asOwner.my_notes], [true, "Owner secret"]);
    assert.deepEqual([asEditor.is_favorite, asEditor.my_notes], [false, null]);
    assert.deepEqual([asViewer.is_favorite, asViewer.my_notes], [false, null]);
    await q.updatePlaceNotes(db, OWNER, tp, eagle.id, "Eddie's note", EDITOR);
    assert.equal((await q.listPlaces(db, OWNER, tp, OWNER))!.find((x) => x.id === eagle.id)!.my_notes, "Owner secret");
    assert.equal((await q.listPlaces(db, OWNER, tp, EDITOR))!.find((x) => x.id === eagle.id)!.my_notes, "Eddie's note");
    assert.equal(await q.setPlaceFavorite(db, OWNER, other, eagle.id, true, EDITOR), false, "place must be in the trip");
  });

  console.log("Attribution, change detection and conflicts");
  await check("rows record who added and last changed them, set by the server — not the browser", async () => {
    const made = await write(EDITOR, tp, (d, c) => q.createItineraryItem(d, c.ownerId, tp, visit("Sunset sail")));
    assert.ok(made !== "NO_ACCESS" && made.ok);
    const row = async () => (await q.listItinerary(db, OWNER, tp))!.find((e) => e.id === (made as { id: string }).id)!;
    assert.deepEqual([(await row()).created_by, (await row()).updated_by], [EDITOR, EDITOR]);
    await write(OWNER, tp, (d, c) => q.updateItineraryItem(d, c.ownerId, tp, made.id, visit("Sunset sail!")));
    const after = await row();
    assert.deepEqual([after.created_by, after.updated_by], [EDITOR, OWNER], "creator kept, last editor updated");
    const names = await sh.profileNames(db, [EDITOR, OWNER, "unknown"]);
    assert.deepEqual(names, { [EDITOR]: "Eddie", [OWNER]: "Olive" });
  });
  await check("a change by one member changes the trip's version, which another session polls", async () => {
    const v1 = await sh.tripVersion(db, OWNER, tp);
    assert.equal(await sh.tripVersion(db, OWNER, tp), v1, "stable when nothing changed");
    const made = await write(EDITOR, tp, (d, c) => q.createPackingItem(d, c.ownerId, tp, { category_id: cat.id, label: "Snorkel", quantity: 1, traveler_name: null, notes: null }));
    assert.ok(made !== "NO_ACCESS" && made.ok);
    const v2 = await sh.tripVersion(db, OWNER, tp);
    assert.notEqual(v2, v1);
    await write(OWNER, tp, (d, c) => q.setPackingItemPacked(d, c.ownerId, tp, made.id, true));
    const v3 = await sh.tripVersion(db, OWNER, tp);
    assert.notEqual(v3, v2);
    await write(OWNER, tp, (d, c) => q.deletePackingItem(d, c.ownerId, tp, made.id));
    assert.notEqual(await sh.tripVersion(db, OWNER, tp), v3, "deletions count too");
    assert.equal((await sh.tripVersion(db, OWNER, other)) === v1, false, "versions are per trip");
  });
  await check("a stale edit gets a conflict instead of overwriting (itinerary, place, booking, packing)", async () => {
    const stamp = async (table: string, rowId: string) =>
      (await db.execute<{ u: string }>(sql`select updated_at::text as u from ${sql.raw(table)} where id = ${rowId}`)).rows[0].u;

    // itinerary
    const it = await write(OWNER, tp, (d, c) => q.createItineraryItem(d, c.ownerId, tp, visit("Brunch")));
    assert.ok(it !== "NO_ACCESS" && it.ok);
    const loaded = await stamp("itinerary_items", it.id);
    await write(EDITOR, tp, (d, c) => q.updateItineraryItem(d, c.ownerId, tp, it.id, visit("Brunch at 11")));
    const stale = await write(OWNER, tp, (d, c) => q.updateItineraryItem(d, c.ownerId, tp, it.id, visit("My version"), { expectedUpdatedAt: loaded }));
    assert.deepEqual(stale, { ok: false, reason: "conflict" });
    assert.equal((await q.listItinerary(db, OWNER, tp))!.find((e) => e.id === it.id)!.title, "Brunch at 11");
    const fresh = await stamp("itinerary_items", it.id);
    const saved = await write(OWNER, tp, (d, c) => q.updateItineraryItem(d, c.ownerId, tp, it.id, visit("My version"), { expectedUpdatedAt: fresh }));
    assert.ok(saved !== "NO_ACCESS" && saved.ok, "deliberately saving over the newer version with its token works");

    // place
    const pl = await q.createPlace(db, OWNER, tp, place("Spot"));
    assert.ok(pl.ok);
    const plLoaded = await stamp("places", pl.id);
    await q.updatePlace(db, OWNER, tp, pl.id, place("Spot 2"));
    assert.equal(await q.updatePlace(db, OWNER, tp, pl.id, place("Mine"), plLoaded), "conflict");
    assert.equal(await q.updatePlace(db, OWNER, tp, pl.id, place("Mine"), await stamp("places", pl.id)), true);
    assert.equal(await q.updatePlace(db, OWNER, tp, randomUUID(), place("x"), plLoaded), false, "missing is not a conflict");

    // booking
    const bk = await q.createReservation(db, OWNER, tp, booking);
    assert.ok(bk);
    const bkLoaded = await stamp("reservations", bk.id);
    await q.updateReservation(db, OWNER, tp, bk.id, { ...booking, title: "Catamaran 2" });
    assert.deepEqual(await q.updateReservation(db, OWNER, tp, bk.id, { ...booking, title: "Mine" }, bkLoaded), { ok: false, reason: "conflict" });
    assert.deepEqual(await q.updateReservation(db, OWNER, tp, bk.id, { ...booking, title: "Mine" }, await stamp("reservations", bk.id)), { ok: true });

    // packing
    const pi = await q.createPackingItem(db, OWNER, tp, { category_id: cat.id, label: "Fins", quantity: 1, traveler_name: null, notes: null });
    assert.ok(pi.ok);
    const piLoaded = await stamp("packing_items", pi.id);
    await q.setPackingItemPacked(db, OWNER, tp, pi.id, true);
    assert.deepEqual(await q.updatePackingItem(db, OWNER, tp, pi.id, { category_id: cat.id, label: "Fins x2", quantity: 2, traveler_name: null, notes: null }, piLoaded), { ok: false, reason: "conflict" });
  });
  await check("two editors saving from the same version: exactly one wins, the other is told", async () => {
    const it = await q.createItineraryItem(db, OWNER, tp, visit("Contested"));
    assert.ok(it.ok);
    const token = (await db.execute<{ u: string }>(sql`select updated_at::text as u from itinerary_items where id = ${it.id}`)).rows[0].u;
    const results = await Promise.all(
      ["A", "B", "C"].map((n) => write(EDITOR, tp, (d, c) => q.updateItineraryItem(d, c.ownerId, tp, it.id, visit(`Contested ${n}`), { expectedUpdatedAt: token }))),
    );
    assert.equal(results.filter((r) => r !== "NO_ACCESS" && r.ok).length, 1);
    assert.equal(results.filter((r) => r !== "NO_ACCESS" && !r.ok && r.reason === "conflict").length, 2);
  });

  console.log("Role changes, removal and leaving");
  await check("changing a role takes effect on the next request", async () => {
    assert.deepEqual(await sh.updateMemberRole(db, OWNER, tp, EDITOR, "viewer"), { ok: true });
    await forbidden(write(EDITOR, tp, (d, c) => q.createPlace(d, c.ownerId, tp, place("Now blocked"))));
    assert.deepEqual(await sh.updateMemberRole(db, OWNER, tp, EDITOR, "editor"), { ok: true });
    assert.ok((await write(EDITOR, tp, (d, c) => q.createPlace(d, c.ownerId, tp, place("Allowed again")))) !== "NO_ACCESS");
    assert.deepEqual(await sh.updateMemberRole(db, OWNER, tp, OWNER, "viewer"), { ok: false, reason: "owner" });
    assert.deepEqual(await sh.updateMemberRole(db, STRANGER, tp, EDITOR, "viewer"), { ok: false, reason: "not_found" }, "only that trip's owner can");
  });
  await check("a removed member loses access at once; what they added stays; their private notes go", async () => {
    const added = (await q.listPlaces(db, OWNER, tp))!.find((x) => x.name === "Allowed again")!;
    assert.equal(added.created_by, EDITOR);
    assert.deepEqual(await sh.removeMember(db, OWNER, tp, EDITOR), { ok: true });
    assert.equal(await sh.resolveTripAccess(db, EDITOR, tp), null);
    assert.equal(await write(EDITOR, tp, (d, c) => q.createPlace(d, c.ownerId, tp, place("After removal"))), "NO_ACCESS");
    assert.equal((await sh.listAccessibleTrips(db, EDITOR)).some((x) => x.id === tp), false);
    assert.ok((await q.listPlaces(db, OWNER, tp))!.some((x) => x.id === added.id), "contribution preserved");
    assert.equal((await q.listItinerary(db, OWNER, tp))!.some((e) => e.created_by === EDITOR), true);
    const left = await db.execute(sql`select 1 from place_member_state where trip_id = ${tp} and user_id = ${EDITOR}`);
    assert.equal(left.rows.length, 0);
    assert.deepEqual(await sh.removeMember(db, OWNER, tp, EDITOR), { ok: false, reason: "not_found" });
    // The old invitation cannot be replayed: it was single-use.
    assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(emailInvite.token), userId: EDITOR, verifiedEmail: "wife@example.com", emailUnverified: false })).status, "accepted_by_other");
  });
  await check("the owner cannot be removed or leave; a member can leave", async () => {
    assert.deepEqual(await sh.removeMember(db, OWNER, tp, OWNER), { ok: false, reason: "owner" });
    assert.equal(await sh.leaveTrip(db, OWNER, tp), false);
    assert.equal(await sh.resolveTripAccess(db, OWNER, tp).then((a) => a?.role), "owner");
    assert.equal(await sh.leaveTrip(db, VIEWER, tp), true);
    assert.equal(await sh.resolveTripAccess(db, VIEWER, tp), null);
    assert.equal(await sh.leaveTrip(db, VIEWER, tp), false);
  });
  await check("the database itself refuses an owner membership row and cross-owner membership", async () => {
    await assert.rejects(db.execute(sql`insert into trip_members (trip_id, owner_id, user_id, role, invited_by) values (${tp}, ${OWNER}, ${OWNER}, 'editor', ${OWNER})`));
    await assert.rejects(db.execute(sql`insert into trip_members (trip_id, owner_id, user_id, role, invited_by) values (${tp}, ${STRANGER}, ${GUEST}, 'editor', ${STRANGER})`));
    await assert.rejects(db.execute(sql`insert into trip_members (trip_id, owner_id, user_id, role, invited_by) values (${tp}, ${OWNER}, ${GUEST}, 'owner', ${OWNER})`));
  });
  await check("deleting a trip removes its members and invitations", async () => {
    const t6 = await mkTrip("Cascade");
    await join(t6, GUEST, "editor");
    assert.equal(await q.deleteTrip(db, OWNER, t6), true);
    const rows = await db.execute(sql`select 1 from trip_members where trip_id = ${t6} union all select 1 from trip_invitations where trip_id = ${t6}`);
    assert.equal(rows.rows.length, 0);
  });

  // cleanup
  await db.delete(trips).where(sql`${trips.id} in (${sql.join(createdTrips.map((x) => sql`${x}`), sql`, `)})`);
  await db.execute(sql`delete from user_profiles where user_id in (${OWNER}, ${EDITOR}, ${VIEWER}, ${GUEST}, ${STRANGER})`);
  console.log(`\n${passed} checks passed; test records removed.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
