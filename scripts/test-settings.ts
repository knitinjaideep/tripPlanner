/**
 * Personal Settings against a migrated, disposable database: defaults,
 * partial updates, isolation between users, persistence, lenient reads of
 * unknown stored values, strict validation of writes, the notification
 * delivery gate (including "history is kept"), the Atlas-only display name,
 * and the reminder switch interaction.
 *
 *   TEST_DATABASE_URL=postgres://… npm run test:settings
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db";
import * as n from "../src/db/notifications";
import * as q from "../src/db/queries";
import * as sh from "../src/db/sharing";
import * as st from "../src/db/settings";
import { notifications, reminderPrefs, trips, userProfiles, userSettings } from "../src/db/schema";
import { dedupeKeys, type NotificationDraft } from "../src/lib/notifications";
import {
  BACKGROUND_IDS,
  defaultAppearance,
  effectiveAppearance,
  parseAppearance,
  parseDisplayPreferences,
  parseNotificationSettings,
  parseTravelPreferences,
  type BackgroundId,
} from "../src/lib/settings";
import {
  appearanceSettingsSchema,
  displayNameSchema,
  displaySettingsSchema,
  notificationSettingsSchema,
  travelSettingsSchema,
} from "../src/lib/validation";
import type { TripInput } from "../src/lib/types";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL to a migrated, disposable database.");
  process.exit(1);
}
const { db, pool } = createDb(url);
const id = () => `test-${randomUUID()}`;
const [ALICE, BOB, OWNER, EDITOR] = [id(), id(), id(), id()];
const ALL: BackgroundId[] = [...BACKGROUND_IDS];
let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const read = (user: string, available: BackgroundId[] = ALL) => st.readSettings(db, user, available);
const put = (user: string, section: Parameters<typeof st.saveSection>[2], patch: Record<string, unknown>) => st.saveSection(db, user, section, patch);
/** Appearance saves name the version they are based on; this saves on top of whatever is stored now. */
const putA = async (user: string, patch: Record<string, unknown>) => {
  const { version } = await st.readAppearance(db, user, ALL);
  const r = await st.saveAppearance(db, user, patch, version, ALL);
  assert.ok(r.ok, "appearance save should succeed on the current version");
  return r;
};

const trip: TripInput = { title: "Settings trip", destination: "Aruba", start_date: "2026-10-14", end_date: "2026-10-19", time_zone: "America/Aruba", travelers: ["A"], cover_image: "beach", notes: null };

async function main() {
  console.log("Authorization shape");
  await check("no settings action or DAL function accepts a user id: who is saving always comes from the verified session", () => {
    const actions = readFileSync("src/app/actions/settings.ts", "utf8");
    assert.ok(!/user_?id|owner_?id|recipient/i.test(actions.replace(/\/\*[\s\S]*?\*\//g, "")), "an action takes only the values to save");
    const dal = readFileSync("src/lib/dal.ts", "utf8");
    for (const fn of ["getSettingsForUser", "saveSettingsSectionForUser", "saveDisplayNameForUser", "getDisplayPrefsForUser"]) {
      const sig = new RegExp(`${fn}\\s*(?:=\\s*cache\\()?(?:async )?\\(([^)]*)\\)`).exec(dal)?.[1] ?? "";
      assert.ok(!/user|owner/i.test(sig), `${fn} takes no user id`);
    }
  });

  console.log("Defaults");
  await check("a person with no row gets Explorer’s Map (when available), Subtle, Comfortable, mascot shown", async () => {
    const s = await read(ALICE);
    assert.deepEqual(s.appearance, { background: "explorers-map", intensity: "subtle", density: "comfortable", mascot: "show" });
    assert.equal(s.appearanceSaved, false);
  });
  await check("…and Plain Ivory when the Explorer’s Map picture is missing", async () => {
    const s = await read(ALICE, ["plain-ivory", "forest-mist"]);
    assert.equal(s.appearance.background, "plain-ivory");
    assert.deepEqual(defaultAppearance([]).background, "plain-ivory");
  });
  await check("other sections default safely: all notifications on, no travel choices, 12-hour / miles / USD, no local name", async () => {
    const s = await read(ALICE);
    assert.ok(Object.values(s.notifications).every(Boolean));
    assert.deepEqual(s.travel, { diet: null, diet_note: "", interests: [], pace: null, transport: [] });
    assert.deepEqual(s.display, { clock: "12h", distance: "mi", currency: "USD" });
    assert.equal(s.displayNameOverride, null);
  });
  await check("a saved background whose picture is missing is displayed as Plain Ivory (effective only)", () => {
    const saved = parseAppearance({ background: "golden-hour" }, ALL);
    assert.equal(effectiveAppearance(saved, ALL).background, "golden-hour");
    assert.equal(effectiveAppearance(saved, ["plain-ivory"]).background, "plain-ivory");
    assert.equal(saved.background, "golden-hour", "the stored choice is not rewritten");
  });

  console.log("Saving and partial updates");
  await check("saving one field keeps the rest of the section, and other sections untouched", async () => {
    await putA(ALICE, { background: "forest-mist" });
    await putA(ALICE, { density: "compact" });
    await put(ALICE, "display", { clock: "24h" });
    await put(ALICE, "travel", { pace: "relaxed" });
    const s = await read(ALICE);
    assert.deepEqual(s.appearance, { background: "forest-mist", intensity: "subtle", density: "compact", mascot: "show" });
    assert.equal(s.appearanceSaved, true);
    assert.deepEqual(s.display, { clock: "24h", distance: "mi", currency: "USD" });
    assert.equal(s.travel.pace, "relaxed");
    assert.ok(Object.values(s.notifications).every(Boolean), "notifications never written, still defaults");
  });
  await check("a section save returns what was stored", async () => {
    const stored = await put(ALICE, "display", { distance: "km" });
    assert.deepEqual(stored, { clock: "24h", distance: "km" });
  });
  await check("arrays and null are replaced as sent (clearing a choice sticks)", async () => {
    await put(ALICE, "travel", { interests: ["beaches", "food"], transport: ["walking"], diet: "vegetarian", diet_note: "no mushrooms" });
    await put(ALICE, "travel", { interests: ["food"], diet: null });
    const t = (await read(ALICE)).travel;
    assert.deepEqual(t, { diet: null, diet_note: "no mushrooms", interests: ["food"], pace: "relaxed", transport: ["walking"] });
  });
  await check("concurrent appearance saves from the same version: exactly one wins, the rest are told it is stale (nothing lost silently)", async () => {
    const { version } = await st.readAppearance(db, BOB, ALL);
    const results = await Promise.all([
      st.saveAppearance(db, BOB, { background: "alpine-dawn" }, version, ALL),
      st.saveAppearance(db, BOB, { intensity: "standard" }, version, ALL),
      st.saveAppearance(db, BOB, { mascot: "hide" }, version, ALL),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    const after = await st.readAppearance(db, BOB, ALL);
    assert.equal(after.version, version + 1, "one save, one version bump");
    // The remaining changes are re-sent on the new version, as the client does after reviewing.
    await putA(BOB, { background: "alpine-dawn", intensity: "standard", mascot: "hide" });
    assert.deepEqual((await read(BOB)).appearance, { background: "alpine-dawn", intensity: "standard", density: "comfortable", mascot: "hide" });
  });
  await check("a stale save (another device saved since) is refused and the newer choice is kept", async () => {
    const u = id();
    const first = await putA(u, { background: "forest-mist" });
    const staleVersion = first.version; // device A read this
    await putA(u, { background: "golden-hour" }); // device B saved after
    const late = await st.saveAppearance(db, u, { background: "island-breeze" }, staleVersion, ALL);
    assert.equal(late.ok, false);
    assert.equal((await read(u)).appearance.background, "golden-hour");
    assert.equal((await read(u)).appearanceVersion, 2);
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${u}`);
  });
  await check("first save needs version 0; a wrong base on a brand-new account is a conflict, not an insert", async () => {
    const u = id();
    assert.equal((await st.saveAppearance(db, u, { background: "riverstone" }, 3, ALL)).ok, false);
    assert.equal((await read(u)).appearanceSaved, false);
    const ok = await st.saveAppearance(db, u, { background: "riverstone" }, 0, ALL);
    assert.ok(ok.ok && ok.version === 1 && ok.appearance.background === "riverstone");
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${u}`);
  });
  await check("saving appearance preserves notifications, travel, display and the local name", async () => {
    const u = id();
    await put(u, "notifications", { polls: false });
    await put(u, "travel", { pace: "busy", interests: ["food"] });
    await put(u, "display", { clock: "24h", currency: "EUR" });
    await st.saveDisplayName(db, u, "Nini", "Google Name");
    const before = await read(u);
    await putA(u, { background: "meadow-haze", density: "compact" });
    const after = await read(u);
    assert.deepEqual(after.notifications, before.notifications);
    assert.deepEqual(after.travel, before.travel);
    assert.deepEqual(after.display, before.display);
    assert.equal(after.displayNameOverride, "Nini");
    assert.equal(after.appearance.background, "meadow-haze");
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${u}`);
  });
  await check("a save only writes the fields sent (others keep their stored value) and never takes a user id", async () => {
    const u = id();
    await putA(u, { background: "desert-silk", intensity: "standard" });
    await putA(u, { mascot: "hide" });
    assert.deepEqual((await read(u)).appearance, { background: "desert-silk", intensity: "standard", density: "comfortable", mascot: "hide" });
    assert.equal(st.saveAppearance.length, 5, "(db, userId, patch, expectedVersion, available): the user comes from the DAL's verified session");
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${u}`);
  });
  await check("a legacy underscore id stored by the first migration is read as the current hyphenated id", async () => {
    const u = id();
    await db.insert(userSettings).values({ user_id: u, appearance: { background: "forest_mist" } });
    assert.equal((await read(u)).appearance.background, "forest-mist");
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${u}`);
  });

  console.log("Isolation and persistence");
  await check("one person’s settings never appear in or change another’s", async () => {
    const alice = await read(ALICE);
    const bob = await read(BOB);
    assert.equal(alice.appearance.background, "forest-mist");
    assert.equal(bob.appearance.background, "alpine-dawn");
    assert.equal(bob.display.clock, "12h");
    assert.equal(bob.travel.pace, null);
    assert.equal(await st.displayNameOverride(db, BOB), null);
  });
  await check("settings persist across connections (sessions / devices)", async () => {
    const other = createDb(url!);
    try {
      const s = await st.readSettings(other.db, ALICE, ALL);
      assert.equal(s.appearance.background, "forest-mist");
      assert.equal(s.display.distance, "km");
    } finally {
      await other.pool.end();
    }
  });

  console.log("Existing and unknown stored values");
  await check("unknown / wrong-typed stored values fall back per field without losing the good ones", async () => {
    const odd = id();
    await db.insert(userSettings).values({
      user_id: odd,
      appearance: { background: "volcano", intensity: "loud", density: "compact", mascot: 7 },
      notifications: { polls: false, invitations: "no", something_new: true },
      travel: { diet: "carnivore", interests: ["food", "skydiving", 5], pace: "busy", transport: "car", diet_note: "x".repeat(500) },
      display: { clock: "25h", distance: "km", currency: "ZZZ" },
    });
    const s = await read(odd);
    assert.deepEqual(s.appearance, { background: "explorers-map", intensity: "subtle", density: "compact", mascot: "show" });
    assert.equal(s.notifications.polls, false);
    assert.equal(s.notifications.invitations, true);
    assert.deepEqual(s.travel.interests, ["food"]);
    assert.equal(s.travel.diet, null);
    assert.equal(s.travel.pace, "busy");
    assert.deepEqual(s.travel.transport, []);
    assert.equal(s.travel.diet_note.length, 140);
    assert.deepEqual(s.display, { clock: "12h", distance: "km", currency: "USD" });
    assert.deepEqual(parseAppearance(null, ALL), defaultAppearance(ALL));
    assert.deepEqual(parseAppearance("garbage", ALL), defaultAppearance(ALL));
    assert.deepEqual(parseNotificationSettings([1, 2]), parseNotificationSettings({}));
    assert.deepEqual(parseTravelPreferences(undefined), parseTravelPreferences({}));
    assert.deepEqual(parseDisplayPreferences(42), parseDisplayPreferences({}));
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${odd}`);
  });
  await check("the database refuses a non-object section", async () => {
    await assert.rejects(() => db.execute(sql`insert into user_settings (user_id, appearance) values (${id()}, '[1]'::jsonb)`));
  });
  await check("a section save does not touch a legacy reminder_prefs row, except lifting “off” when a reminder type is switched on", async () => {
    const u = id();
    await db.insert(reminderPrefs).values({ user_id: u, enabled: false, in_app: true, email: false, quiet_enabled: true, quiet_start: "21:00", quiet_end: "06:30", quiet_zone: "America/Aruba" });
    await put(u, "notifications", { polls: false });
    assert.equal((await read(u)).remindersPausedElsewhere, true);
    await put(u, "notifications", { booking_reminders: true });
    const s = await read(u);
    assert.equal(s.remindersPausedElsewhere, false);
    const [row] = await db.select().from(reminderPrefs).where(sql`${reminderPrefs.user_id} = ${u}`);
    assert.equal(row.enabled, true);
    assert.equal(row.quiet_enabled, true);
    assert.equal(row.quiet_start, "21:00:00");
    assert.equal(row.quiet_zone, "America/Aruba");
    assert.equal(s.notifications.polls, false);
    await db.delete(reminderPrefs).where(sql`${reminderPrefs.user_id} = ${u}`);
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${u}`);
  });

  console.log("Validation of writes");
  await check("appearance: only known backgrounds and options; unknown keys and empty patches are refused", () => {
    assert.ok(appearanceSettingsSchema.safeParse({ background: "golden-hour" }).success);
    assert.ok(!appearanceSettingsSchema.safeParse({ background: "../../etc/passwd" }).success);
    assert.ok(!appearanceSettingsSchema.safeParse({ intensity: "loud" }).success);
    assert.ok(!appearanceSettingsSchema.safeParse({}).success);
    assert.ok(!appearanceSettingsSchema.safeParse({ background: "golden-hour", user_id: "someone-else" }).success);
  });
  await check("notifications: only the six known switches, booleans only", () => {
    assert.ok(notificationSettingsSchema.safeParse({ polls: false }).success);
    assert.ok(!notificationSettingsSchema.safeParse({ polls: "false" }).success);
    assert.ok(!notificationSettingsSchema.safeParse({ email: true }).success, "there is no email channel to configure");
    assert.ok(!notificationSettingsSchema.safeParse({}).success);
  });
  await check("travel: known choices, de-duplicated lists, a short cleaned note", () => {
    const ok = travelSettingsSchema.safeParse({ interests: ["food", "food", "beaches"], diet_note: "  no\u0000 nuts  " });
    assert.ok(ok.success);
    assert.deepEqual(ok.data.interests, ["food", "beaches"]);
    assert.equal(ok.data.diet_note, "no  nuts");
    assert.ok(!travelSettingsSchema.safeParse({ diet_note: "x".repeat(141) }).success);
    assert.ok(!travelSettingsSchema.safeParse({ diet: "carnivore" }).success);
    assert.ok(!travelSettingsSchema.safeParse({ pace: "frantic" }).success);
    assert.ok(!travelSettingsSchema.safeParse({ transport: ["teleport"] }).success);
  });
  await check("display: 12h/24h, mi/km, known currencies", () => {
    assert.ok(displaySettingsSchema.safeParse({ clock: "24h", distance: "km", currency: "EUR" }).success);
    assert.ok(!displaySettingsSchema.safeParse({ clock: "military" }).success);
    assert.ok(!displaySettingsSchema.safeParse({ currency: "BTC" }).success);
  });
  await check("display name: trimmed, control and bidi characters removed, blank = Google name, ≤ 80", () => {
    assert.equal(displayNameSchema.parse("  Pavani   K ‮"), "Pavani K");
    assert.equal(displayNameSchema.parse("   "), null);
    assert.ok(!displayNameSchema.safeParse("x".repeat(81)).success);
  });

  console.log("Display name (Atlas only)");
  await check("saving a local name updates co-member-visible names, survives the next sign-in sync, and clearing returns the Google name", async () => {
    const u = id();
    await sh.upsertProfile(db, { id: u, name: "Google Name", email: "g@example.com" });
    const names = async () => (await db.select({ n: userProfiles.display_name }).from(userProfiles).where(sql`${userProfiles.user_id} = ${u}`))[0].n;
    assert.equal(await names(), "Google Name");
    assert.equal(await st.saveDisplayName(db, u, "Nitin K", "Google Name"), "Nitin K");
    assert.equal(await names(), "Nitin K");
    await sh.upsertProfile(db, { id: u, name: "Google Name", email: "g@example.com" });
    assert.equal(await names(), "Nitin K", "the session name does not overwrite the local name");
    assert.equal(await st.displayNameOverride(db, u), "Nitin K");
    assert.equal(await st.saveDisplayName(db, u, null, "Google Name"), null);
    assert.equal(await names(), "Google Name");
    await sh.upsertProfile(db, { id: u, name: "Renamed At Google", email: "g@example.com" });
    assert.equal(await names(), "Renamed At Google");
    await db.delete(userProfiles).where(sql`${userProfiles.user_id} = ${u}`);
    await db.delete(userSettings).where(sql`${userSettings.user_id} = ${u}`);
  });

  console.log("Notification delivery gate");
  const created = await q.createTrip(db, OWNER, trip);
  const T = created.id;
  const made = await sh.createInvitation(db, { ownerId: OWNER, tripId: T, invitedBy: OWNER, inviterName: "Olive", email: null, role: "editor" });
  assert.ok(made.ok);
  assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(made.token), userId: EDITOR, verifiedEmail: null, emailUnverified: false })).status, "ok");
  const inbox = (u: string, type?: string) => db.select().from(notifications).where(sql`${notifications.recipient_id} = ${u} ${type ? sql`and ${notifications.type} = ${type}` : sql``}`);
  const draft = (type: "poll_result" | "evening_preview" | "reminder", to: string, key: string, subject: "booking" | "task" = "booking"): NotificationDraft => {
    const base = { recipientId: to, actorId: null, tripId: T, dedupeKey: key, title: "Hello", body: "World" };
    if (type === "poll_result") return { ...base, type, pollId: randomUUID() };
    if (type === "evening_preview") return { ...base, type, date: "2026-10-15" };
    return { ...base, type, reminderId: randomUUID(), occurrence: 1, subject, subjectId: randomUUID() };
  };

  await check("every type is delivered while its switch is on (the default)", async () => {
    assert.equal(await n.createNotifications(db, [draft("poll_result", OWNER, "g1"), draft("evening_preview", OWNER, "g2"), draft("reminder", OWNER, "g3", "booking"), draft("reminder", OWNER, "g4", "task")]), 4);
  });
  await check("turning a type off stops new notifications of that type only, and keeps the history", async () => {
    await put(OWNER, "notifications", { polls: false, task_reminders: false });
    const before = (await inbox(OWNER)).length;
    assert.equal(await n.createNotifications(db, [draft("poll_result", OWNER, "g5")]), 0);
    assert.equal(await n.createNotifications(db, [draft("reminder", OWNER, "g6", "task")]), 0);
    assert.equal(await n.createNotifications(db, [draft("reminder", OWNER, "g7", "booking")]), 1, "booking reminders are a separate switch");
    assert.equal(await n.createNotifications(db, [draft("evening_preview", OWNER, "g8")]), 1);
    assert.equal((await inbox(OWNER)).length, before + 2);
    assert.equal((await inbox(OWNER, "poll_result")).length, 1, "the old poll notification is still in the inbox");
  });
  await check("the gate is per recipient: someone else with the type on still receives it", async () => {
    assert.equal(await n.createNotifications(db, [draft("poll_result", OWNER, "g9"), draft("poll_result", EDITOR, "g9")]), 1);
    assert.equal((await inbox(EDITOR, "poll_result")).length, 1);
  });
  await check("turning it back on resumes delivery; the earlier suppressed event is not replayed", async () => {
    await put(OWNER, "notifications", { polls: true });
    assert.equal(await n.createNotifications(db, [draft("poll_result", OWNER, "g10")]), 1);
    assert.equal((await inbox(OWNER, "poll_result")).length, 2);
  });
  await check("invitation and shared-plan switches gate the real events", async () => {
    const accepted = async () => (await inbox(OWNER, "invitation_accepted")).length;
    const base = await accepted(); // the editor who joined earlier, before any opt-out
    await put(OWNER, "notifications", { invitations: false, shared_changes: false });
    const mk = await sh.createInvitation(db, { ownerId: OWNER, tripId: T, invitedBy: OWNER, inviterName: "Olive", email: null, role: "viewer" });
    assert.ok(mk.ok);
    const joiner = id();
    assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(mk.token), userId: joiner, verifiedEmail: null, emailUnverified: false })).status, "ok");
    assert.equal(await accepted(), base, "owner opted out of invitation notices");
    await put(OWNER, "notifications", { invitations: true });
    const mk2 = await sh.createInvitation(db, { ownerId: OWNER, tripId: T, invitedBy: OWNER, inviterName: "Olive", email: null, role: "viewer" });
    assert.ok(mk2.ok);
    assert.equal((await sh.acceptInvitation(db, { tokenHash: sh.hashInviteToken(mk2.token), userId: id(), verifiedEmail: null, emailUnverified: false })).status, "ok");
    assert.equal(await accepted(), base + 1);
    assert.equal(await n.createNotifications(db, [{ type: "itinerary_changed", recipientId: OWNER, actorId: EDITOR, tripId: T, itemId: randomUUID(), date: "2026-10-15", dedupeKey: dedupeKeys.itineraryAdded(randomUUID()), title: "Added", body: "Dinner" }]), 0, "shared changes are off");
    await put(OWNER, "notifications", { shared_changes: true });
    assert.equal(await n.createNotifications(db, [{ type: "itinerary_changed", recipientId: OWNER, actorId: EDITOR, tripId: T, itemId: randomUUID(), date: "2026-10-15", dedupeKey: dedupeKeys.itineraryAdded(randomUUID()), title: "Added", body: "Dinner" }]), 1);
  });

  await db.delete(notifications).where(sql`${notifications.trip_id} = ${T}`);
  await db.execute(sql`delete from trips where id = ${T}`);
  await db.delete(userSettings).where(sql`${userSettings.user_id} in (${ALICE}, ${BOB}, ${OWNER}, ${EDITOR})`);
  await db.delete(userProfiles).where(sql`${userProfiles.user_id} like 'test-%'`);
  await db.delete(userSettings).where(sql`${userSettings.user_id} like 'test-%'`);
  void trips;
  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
