import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import { eveningPreviewPrefs, reminderPrefs, trips, userProfiles, userSettings } from "./schema";
import {
  defaultNotificationSettings,
  parseAppearance,
  parseDisplayPreferences,
  parseNotificationSettings,
  parseTravelPreferences,
  type Appearance,
  type BackgroundId,
  type EveningPreviewSchedule,
  type NotificationGroup,
  type NotificationSettings,
  type SettingsSection,
  type SettingsSnapshot,
} from "@/lib/settings";

/**
 * Personal Settings storage. Every function takes the VERIFIED user id from
 * the DAL and constrains its query by it — there is no way to name another
 * user's row. Reached only from src/lib/dal.ts (and the notification service
 * for the delivery gate).
 */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

const SECTION_COLUMNS = { notifications: "notifications", travel: "travel", display: "display" } as const satisfies Record<SettingsSection, string>;

async function getRow(db: Executor, userId: string) {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.user_id, userId));
  return row ?? null;
}

/** Everything Settings shows, parsed leniently: missing or unknown stored values become defaults. */
export async function readSettings(db: Executor, userId: string, available: readonly BackgroundId[]): Promise<SettingsSnapshot> {
  const [row, reminder] = await Promise.all([
    getRow(db, userId),
    db.select({ enabled: reminderPrefs.enabled }).from(reminderPrefs).where(eq(reminderPrefs.user_id, userId)),
  ]);
  return {
    appearance: parseAppearance(row?.appearance, available),
    appearanceSaved: Boolean(row?.appearance && Object.keys(row.appearance).length > 0),
    appearanceVersion: row?.appearance_version ?? 0,
    notifications: parseNotificationSettings(row?.notifications),
    remindersPausedElsewhere: reminder[0]?.enabled === false,
    travel: parseTravelPreferences(row?.travel),
    display: parseDisplayPreferences(row?.display),
    displayNameOverride: row?.display_name ?? null,
  };
}

/**
 * Merges `patch` into ONE section (jsonb `||`, atomic in the statement), so
 * other fields of the section and every other section are untouched, and
 * returns the section as stored. Reminder switches that are turned on also
 * lift the person's own "reminders off" master switch, so the toggle they just
 * flipped actually takes effect (their quiet hours and channels stay as they were).
 */
export async function saveSection(
  db: Db,
  userId: string,
  section: SettingsSection,
  patch: Record<string, unknown>,
  /** Runs in the same transaction after a reminder switch changed, so the person's scheduled reminders cancel / revive with it. */
  onReminderSwitchChanged?: (tx: Tx, userId: string) => Promise<void>,
): Promise<Record<string, unknown>> {
  const column = sql.identifier(SECTION_COLUMNS[section]);
  return db.transaction(async (tx) => {
    const result = await tx.execute<{ value: Record<string, unknown> }>(sql`
      insert into user_settings (user_id, ${column}) values (${userId}, ${JSON.stringify(patch)}::jsonb)
      on conflict (user_id) do update
        set ${column} = coalesce(user_settings.${column}, '{}'::jsonb) || excluded.${column}, updated_at = now()
      returning ${column} as value`);
    if (section === "notifications" && (patch.booking_reminders === true || patch.task_reminders === true)) {
      await tx.update(reminderPrefs).set({ enabled: true, updated_at: sql`now()` }).where(sql`${reminderPrefs.user_id} = ${userId} and not ${reminderPrefs.enabled}`);
    }
    if (section === "notifications" && onReminderSwitchChanged && ("booking_reminders" in patch || "task_reminders" in patch)) await onReminderSwitchChanged(tx, userId);
    return result.rows[0].value;
  });
}

/**
 * Saves appearance fields only, and only if the stored version is still the one
 * the caller started from (`expectedVersion`; 0 = never saved). One statement,
 * so two devices saving at once cannot both win: the loser gets `conflict` and
 * the caller re-reads. Other sections and columns are untouched (jsonb `||`).
 */
export async function saveAppearance(
  db: Db,
  userId: string,
  patch: Record<string, unknown>,
  expectedVersion: number,
  available: readonly BackgroundId[],
): Promise<{ ok: true; appearance: Appearance; version: number } | { ok: false }> {
  type Row = { appearance: unknown; appearance_version: number };
  const done = (row: Row | undefined) => (row ? { ok: true as const, appearance: parseAppearance(row.appearance, available), version: row.appearance_version } : null);
  // The version check lives in the UPDATE's WHERE, so two devices saving from the same version cannot both win.
  const updated = await db.execute<Row>(sql`
    update user_settings
      set appearance = coalesce(appearance, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
          appearance_version = appearance_version + 1,
          updated_at = now()
      where user_id = ${userId} and appearance_version = ${expectedVersion}::int
      returning appearance, appearance_version`);
  const hit = done(updated.rows[0]);
  if (hit) return hit;
  // No row yet: only a first save (version 0) may create it, and a concurrent creator makes this a conflict.
  if (expectedVersion === 0) {
    const inserted = await db.execute<Row>(sql`
      insert into user_settings (user_id, appearance, appearance_version)
      values (${userId}, ${JSON.stringify(patch)}::jsonb, 1)
      on conflict (user_id) do nothing
      returning appearance, appearance_version`);
    const created = done(inserted.rows[0]);
    if (created) return created;
  }
  return { ok: false };
}

/** Just the appearance (for focus refresh), read for the verified user. */
export async function readAppearance(db: Executor, userId: string, available: readonly BackgroundId[]) {
  const row = await getRow(db, userId);
  return { appearance: parseAppearance(row?.appearance, available), version: row?.appearance_version ?? 0 };
}

/**
 * Sets (or, with null, clears) the Atlas-only display name, and brings the
 * copy co-members see (`user_profiles`) in line right away. Never touches the
 * Google account.
 */
export async function saveDisplayName(db: Db, userId: string, name: string | null, googleName: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(userSettings)
      .values({ user_id: userId, display_name: name })
      .onConflictDoUpdate({ target: userSettings.user_id, set: { display_name: name, updated_at: sql`now()` } })
      .returning({ name: userSettings.display_name });
    await tx
      .update(userProfiles)
      .set({ display_name: (name ?? googleName).slice(0, 120) || "Traveler", updated_at: sql`now()` })
      .where(eq(userProfiles.user_id, userId));
    return row.name;
  });
}

export async function displayNameOverride(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db.select({ name: userSettings.display_name }).from(userSettings).where(eq(userSettings.user_id, userId));
  return row?.name ?? null;
}

/* ---------------------------- delivery gate ---------------------------- */

/**
 * Each recipient's notification switches (defaults for anyone without a row).
 * The notification service asks this before it writes; the schedulers ask it
 * before they claim work, so a type that is off stops future notifications
 * without touching anything already in the inbox.
 */
export async function notificationSettingsFor(db: Executor, userIds: string[]): Promise<Map<string, NotificationSettings>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const map = new Map<string, NotificationSettings>(unique.map((id) => [id, defaultNotificationSettings()]));
  if (unique.length === 0) return map;
  const rows = await db
    .select({ id: userSettings.user_id, notifications: userSettings.notifications })
    .from(userSettings)
    .where(inArray(userSettings.user_id, unique));
  for (const r of rows) map.set(r.id, parseNotificationSettings(r.notifications));
  return map;
}

export async function isGroupAllowed(db: Executor, userId: string, group: NotificationGroup): Promise<boolean> {
  return (await notificationSettingsFor(db, [userId])).get(userId)?.[group] ?? true;
}

/** The person's own evening-preview schedules, read-only, so Settings can show them next to the switch. */
export async function eveningPreviewSchedules(db: Executor, userId: string): Promise<EveningPreviewSchedule[]> {
  const rows = await db
    .select({ tripId: trips.id, title: trips.title, timeZone: trips.time_zone, sendTime: eveningPreviewPrefs.send_time, end: trips.end_date })
    .from(eveningPreviewPrefs)
    .innerJoin(trips, and(eq(trips.id, eveningPreviewPrefs.trip_id), eq(trips.owner_id, eveningPreviewPrefs.owner_id)))
    .where(and(eq(eveningPreviewPrefs.user_id, userId), eq(eveningPreviewPrefs.enabled, true)))
    .orderBy(asc(trips.start_date))
    .limit(20);
  return rows.map((r) => ({ tripId: r.tripId, title: r.title, timeZone: r.timeZone, sendTime: r.sendTime.slice(0, 5) }));
}
