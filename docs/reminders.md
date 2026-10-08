# Booking and task reminders — setup and operations

Reminders tell the right person at the right time: before a **confirmed
booking** starts, and before a **task assigned to them** is due. They arrive in
the Atlas inbox and, if the recipient turned it on and email is configured, by
email. There is no SMS and no push.

**Status of this repository: the worker, its secure trigger, the inbox
actions and the screens are built and tested, but nothing is delivered on a
schedule until you complete "Scheduler setup" below.** The app says so
honestly: the reminder dialogs show "Scheduled delivery isn't running for this
app yet" until the job has finished a run in the last 20 minutes (it reads
`scheduler_heartbeats`, job `reminders`).

## What was reused

- The **notification inbox**: reminders are the `reminder` type in the existing
  registry (`src/lib/notifications.ts`, `createNotifications` in
  `src/db/notifications.ts`) — same recipient / membership checks, text
  hygiene, dedupe and "No longer available" behaviour.
- The **scheduler pattern** of the evening preview: a secret-authenticated cron
  route (`src/lib/cron-auth.ts` now holds the shared check), a heartbeat row,
  claim / lease, idempotency-keyed email through the same Resend configuration
  (`APP_ORIGIN`, `RESEND_API_KEY`, `INVITE_EMAIL_FROM`, `INVITE_EMAIL_DEV_INBOX`).
- Existing models: bookings are `reservations` (status `confirmed` | `cancelled`),
  tasks are `packing_items` (completion = `is_packed`).

What did **not** exist, and was added: task assignment and due date/time
(`packing_items.assignee_id`, `due_date`, `due_time`, `due_time_zone`); per-person
reminder settings with quiet hours (`reminder_prefs` — the evening preview's
preferences are per trip and have no quiet hours); the `reminders` table.
Bookings have **no participants field**, so there is nothing to default
recipients from: the person setting a reminder up always chooses who.
There is **no stored "time to leave"** anywhere in the app, so no
leave-by reminder was built (and no airport / check-in buffer is invented).

## Rules

**Which records qualify**

- A booking: `status = 'confirmed'` **and** a start date **and** a start time.
  Cancelled bookings, date-only bookings, itinerary activities and Explore
  suggestions never qualify. Nothing is inferred from a title.
- A task: not completed, **assigned to a current member**, with a due date. A
  task with a date but no time is "date-only": the person must pick a time of
  day (their own default, `reminder_prefs.default_task_time`, is offered and
  displayed — never applied silently, never midnight).
- Nothing is created automatically. "Set up reminders" (bookings page, packing
  page) only *lists* what could have one; a reminder exists only after someone
  with edit rights saves it.

**Who receives it**

- Booking: the members explicitly ticked — never everyone because a booking
  exists. Task: only the current assignee. Reassignment cancels the previous
  assignee's reminder and the rule follows the task to the new assignee only if
  the task already had one; unassigning cancels; a task with no reminder never
  gains one.
- Owners and editors set reminders up (the same permission as editing the
  record). Viewers cannot, and being assigned a task does not give a viewer
  edit rights (they can snooze / turn off their own reminder, not complete the
  task). Every recipient controls their own settings, snooze and mute.

**When**

- Booking presets: 24 hours before, 2 hours before, custom, off. Task presets:
  at due time, 1 day before, custom, off. Custom is "N minutes / hours / days
  before" (booking: at least 1 minute, at most 30 days).
- Zones: a booking is counted in its **own** zone (a flight's departure
  airport zone, `start_time_zone`); if a booking has none, the trip's zone is
  used and the screen says so. A task uses the zone saved with it (the trip's
  zone when the due date was set). The preview always names the zone:
  "Remind Pavani on October 16 at 11:00 AM, Aruba time." Stored wall-clock
  values are never rewritten through UTC.
- **Freshness** (explicit, no backlog after downtime): a booking reminder is
  delivered only within **30 minutes** after its time and **never at or after the
  booking's start**; a task reminder within **2 hours**, and a date-only task's
  reminder never after the end of its due date. Anything later is recorded as
  `skipped / expired`, not sent.
- **Quiet hours** (per person, in a zone they choose): a booking reminder that
  would land inside them is moved **earlier**, to just before they begin, if
  that is still ahead and not more than 3 hours sooner — and the recipient is
  told ("Moved earlier to … so it arrives before your quiet hours"). Otherwise
  it is **not sent** (`skipped / quiet_hours`) unless the recipient chooses
  "Send it anyway". A task reminder is held until quiet hours end if that is
  still before it is due; otherwise the same choice applies. A snooze is the
  person's explicit choice and is not moved.

**Delivery and wording**

- Inbox item, minimal text: `Your “Spa appointment” starts in 2 hours.`,
  `Your task “Aruba packing” is due today.` Only the title and the time left —
  never confirmation codes, unit numbers, addresses, notes or links to bookings.
- Email (only if the recipient enabled it *and* the provider and their address
  exist): the same line and two links that open signed-in pages. **No link in
  an email changes anything** — completing and snoozing are authenticated
  Server Actions. "Sent" means the provider *accepted* the message, nothing more.
- Inbox actions (re-derived from live data each time the inbox is read):
  View booking / View task, Directions (only when the booking is linked to an
  itinerary place that already has a map link), Manage reminders, Mark complete
  (task, only if the viewer may edit and is the assignee), Snooze (clear new
  time shown; a booking snooze that would end after the booking starts is
  refused with a warning).

## How it stays correct

One row in `reminders` per (booking or task, recipient) is **both** the setting
and the job. It carries an `occurrence` that rises when the record's time
changes or the reminder is snoozed; the inbox dedupe key is
`reminder:<id>:<occurrence>`, so each occurrence is delivered at most once.

- Every write that can matter (booking edit / status / zone, task edit / assign /
  complete / un-complete, trip zone change, member removal or leaving, a
  person's own settings) calls one function, `reconcileRow`, in the same
  transaction, which recomputes what *should* happen from the live record:
  cancel (`booking_cancelled`, `task_done`, `reassigned`, `not_member`,
  `recipient_off`, …), reschedule (new fire time; a new occurrence if one was
  already delivered), or leave alone. Deleting a booking, task or trip deletes
  its reminders (cascade); a trigger first marks any inbox item already sent
  "Canceled".
- Delivery re-checks everything under a row lock: the record, membership,
  assignment, preferences, quiet hours, freshness, and that the stored
  `target_at` still matches the live time. If anything differs the job is
  canceled or rescheduled, never delivered. A job claimed while its record is
  edited loses its claim (`claim_token`) and is dropped.
- Workers claim with `FOR UPDATE SKIP LOCKED` and a 5-minute lease (a crashed
  worker's claim simply expires). Duplicate triggers and concurrent workers
  produce one inbox item. Failures retry after 2 minutes, up to 3 attempts,
  then `failed`. Email has its own leased, idempotency-keyed attempts (max 3),
  recorded separately so an email failure never undoes the inbox delivery.
- History is kept: an item already delivered stays in the inbox with a
  small indicator (Updated / Canceled / Completed / Snoozed); its link always
  opens the *current* booking or task. An email already sent cannot be recalled
  and the app never claims it was.

## Scheduler setup (still required)

1. Set `CRON_SECRET` (16+ characters, `openssl rand -base64 32`) in the
   deployment environment. Without it `/api/cron/reminders` answers 503.
2. Call `GET` or `POST /api/cron/reminders` with
   `Authorization: Bearer $CRON_SECRET` **about every 5 minutes**. More often is
   fine (overlapping calls are safe); much less often makes reminders late and,
   past their freshness window, skipped.
   - Vercel Cron sends the header itself, but a `*/5 * * * *` schedule needs a
     Pro plan (Hobby allows one call per day, which is too coarse for
     reminders). `vercel.json` was deliberately **not** added so a Hobby deploy
     is not broken. On Pro add `{ "crons": [{ "path": "/api/cron/reminders", "schedule": "*/5 * * * *" }] }`.
   - Or any external pinger (cron-job.org, GitHub Actions on a schedule, a
     small VM): `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/reminders`.
3. Apply migration `0010_reminders` (`npm run db:migrate`) — **not yet applied to
   Neon**; it was exercised only on a disposable local Postgres 17. It is
   additive (new tables, new nullable columns on `packing_items`, one unique
   constraint, one trigger); existing rows are untouched.
4. Optional email: the same Resend variables as invitations. Without them the
   email option is disabled in the settings dialog with the reason.
5. Check: open any reminder dialog — the yellow "isn't running yet" note
   disappears within one run. `?dryRun=1` (same secret) lists what *would* be
   delivered right now and writes nothing; `&at=<ISO instant>` pretends it is
   another time.

## Where things are

| | |
|---|---|
| Pure logic (presets, zones, quiet hours, freshness, wording) | `src/lib/reminders.ts` |
| Persistence, reconcile, setup, snooze, worker, email phase | `src/db/reminders.ts` |
| Email | `src/lib/email/reminder-email.ts` |
| Server Actions | `src/app/actions/reminders.ts` |
| Trigger | `src/app/api/cron/reminders/route.ts` (+ `src/lib/cron-auth.ts`) |
| Screens | `src/components/reminders/*`, `src/components/notifications/reminder-actions.tsx` |
| Tests | `scripts/test-reminder-logic.ts`, `scripts/test-reminders.ts` |
