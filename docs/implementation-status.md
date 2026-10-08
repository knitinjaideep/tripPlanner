# Atlas — implementation status

_Last updated: 2026-10-07 (booking and task reminders; scheduler setup and migrations 0007–0010 pending on Neon)._

This file is the hand-off point for later prompts: what exists, how it is
put together, and what comes next.

## Settings (2026-10-07)

Personal settings at `/settings` (account menu → Settings): Appearance, Notifications, Travel preferences, Display preferences, Account. Trip details, members, invitations and protected rest stay in each trip's own settings.

- **Migration `0011_user_settings`** (additive; applied only to a disposable local Postgres 17 — **not applied to Neon; run `npm run db:migrate`** after 0007–0010): `user_settings` (one row per user; jsonb column per section — appearance, notifications, travel, display — plus `display_name`). Saving a section merges into that column only (`jsonb ||`), so partial updates never touch other fields or sections. Missing / unknown stored values read as defaults. Existing `reminder_prefs` / `evening_preview_prefs` are untouched.
- **Access:** DAL only (`getSettingsForUser`, `saveSettingsSectionForUser`, `saveDisplayNameForUser`, `getDisplayPrefsForUser`); none takes a user id. Actions in `src/app/actions/settings.ts`, strict Zod schemas in `validation.ts`, return the stored values so "Saved" is shown only from server confirmation; drafts survive failures.
- **Appearance (global backgrounds, 2026-10-07):** one typed `Appearance` model (`src/lib/settings.ts`), one background **registry** (`src/lib/backgrounds.ts`: stable hyphenated ids, label, description, WebP url + thumbnail, base colour, wide/narrow position hints, subtle/standard ivory-wash opacity) read by Settings, the availability check and the renderer. State lives in a pure reducer (`src/lib/appearance-state.ts`, `npm run test:appearance`) run by `SettingsProvider` (mounted in `(app)/layout.tsx`, keyed by user id): `saved` (+ server `version`), `draft` (memory only, survives client navigation, dropped on refresh with a `beforeunload` warning), `effective = draft ?? saved`. Selection only edits the draft and repaints the whole app; Save sends only changed fields with the base version (`saveAppearance` action → `saveAppearanceForUser` → `UPDATE … WHERE appearance_version = $n`); a newer save from another device is a conflict (draft kept; bar offers "Save mine instead" / "Use theirs"); focus refresh adopts a newer saved appearance unless there is a draft (then it is parked). Editing is locked while a save is pending. The single global `AppearanceBar` (sticky under the header, publishes `--atlas-bar-h` for sticky offsets and `scroll-padding-top`) holds the only Save/Cancel, the "Saved" confirmation and the image-failure notice. `BackgroundLayer` (one fixed `aria-hidden`/`inert` layer, `100lvh`, no `background-attachment: fixed`) paints ivory base → picture → ivory wash; a picture is preloaded first (latest choice wins, the old one stays until the new is ready, 0.35 s crossfade off under reduced motion), a failed picture shows Plain Ivory + "couldn't load / Try again" and never touches the saved value. Only the active full picture is fetched (+ SSR `preload`); thumbnails are 480 px; hovering a choice preloads that one picture. Compact density and mascot-hide are emitted as a document-level `<style>` so portals (dialogs, drawers) follow too. **Migration `0012_appearance_version`** (additive column `user_settings.appearance_version`, not applied to Neon). Assets: the supplied JPEGs are kept untouched in `assets/backgrounds-src/`; `scripts/optimize-backgrounds.mjs` (sharp, devDependency) writes real WebP copies to `public/backgrounds/` (17–53 KB full, 2–6 KB thumb). Retired underscore ids (`forest_mist`) still read correctly.
- **Notifications:** six switches (invitations, polls, shared changes, evening previews, booking reminders, task reminders). Gate: `createNotifications` (all types), evening-preview worker (before claiming) and reminder planning (`effectivePrefs`, which cancels / revives rows). History is never deleted; trip schedules are read-only in Settings. Turning a reminder switch on lifts the person's own "reminders off" master switch.
- **Travel preferences:** stored only; nothing uses them yet (said in the UI).
- **Display:** `formatTime(time, clock)` plus `src/lib/display-format.ts` (`formatDistance`, `formatMoney`). 24-hour is wired through itinerary, bookings, overview cards, packing, Explore, plan update, outing notices, memories and the evening-preview dialog. Not converted: text stored at creation (inbox notifications, emails, evening previews, polls) stays 12-hour. No numeric distances or manual money amounts exist in the app yet, so unit / currency are stored and have no visible effect; currency is never converted.
- **Account:** Atlas-only display name (applied by `requireUser` and `upsertProfile`; Google account untouched), photo, email, provider, sign out. **No account deletion exists, so none is shown (follow-up).**
- **Checks:** typecheck, lint, build, `db:check`; new `test:settings` 25, `test:display-format` 8 (also at two extreme `TZ`s); gate checks added to `test:reminders` 65 and `test:evening` 37; all other suites pass (`test:authz` 119).
- **Not tested:** the screens in a browser (a dev server was already running, so no fixture was served), real sign-in, phone / iPad widths, Neon.

## Booking and task reminders (2026-10-07)

Reminders before a **confirmed booking** and before a **task assigned to a person** is due. Full rules, scheduler setup and where things live: **`docs/reminders.md`**.

- **Delivery status: built and tested; NOT active until the scheduler is configured.** `GET|POST /api/cron/reminders` (same `CRON_SECRET`, shared check in `src/lib/cron-auth.ts`; 503 when unset) must be called about every 5 minutes (Vercel Cron on Pro, or any pinger; `vercel.json` deliberately not added). The reminder dialogs show a yellow "isn't running yet" note until `scheduler_heartbeats` (job `reminders`) shows a run within 20 minutes. No SMS / push.
- **Migration `0010_reminders`** (additive; applied only to a disposable local Postgres 17 — **not applied to Neon; run `npm run db:migrate`**, after 0007–0009): `packing_items` + `assignee_id`, `due_date`, `due_time`, `due_time_zone` (+ `unique(id, trip_id)`, checks); `reminder_prefs` (per user: enabled default **true**, inbox default true, **email default false**, quiet hours, default task time of day); `reminders` (one row per booking-or-task × recipient: rule, current `occurrence`, status, `target_at`, `fire_at`, `expires_at`, claim token / lease, per-channel delivery state; composite FKs to the trip, the booking and the task, so a reminder can never point across trips; cascade on delete); a hand-written trigger that marks an already-sent inbox item "canceled" when its reminder is deleted.
- **Reused:** the notification inbox (`reminder` type enabled in the registry, destinations `…/bookings?booking=<id>` and `…/packing?task=<id>` added to the strict allow-list), the cron / heartbeat / lease / idempotency-key pattern and Resend configuration of the evening preview. **Did not exist, added:** task assignment + due date/time, per-person reminder settings with quiet hours (evening-preview prefs are per trip, without quiet hours). Bookings have no participants field, so the person setting a reminder up always chooses recipients. There is no stored "time to leave", so no leave-by reminder was built.
- **Setup flow:** bookings page / packing page → "Set up reminders" (review list of what *could* have one; reads only; nothing is ever created implicitly) → per-record control (booking details, bell on a task row, or "Manage reminders" in an inbox item): presets (booking: 24 h / 2 h / custom / off; task: at due time / 1 day before / custom / off), recipients (booking: ticked members, none preselected; task: the assignee only), a server-computed preview per person in the right zone ("Remind Pavani on October 16 at 11:00 AM, Aruba time."), a mandatory time of day for date-only tasks (the person's default is offered, never applied silently). Owners / editors set up; each recipient snoozes / turns off their own and owns "Your reminder settings".
- **Cancellation / rescheduling:** one function (`reconcileRow`) recomputes what should happen from the live record, called in the same transaction as every relevant write (booking edit / status / zone, task edit / assign / complete, trip zone change, member removal, a person's own settings) and again inside the delivery transaction. Time change → new fire time (new `occurrence` and the old inbox item marked **Updated** if already sent); cancelled / no start time / completed / no due date / unassigned / reassigned / removed member / recipient off → canceled (with the reason; sent items marked Canceled / Completed); un-cancel, un-complete, due date back, reminders back on → revived if still ahead. Reassignment moves the rule to the new assignee only if the task already had a reminder. Deleting a booking, task or trip deletes its reminders. Delivery refuses when stored `target_at` ≠ the live time (stale-job protection), when the booking has started, or outside the freshness window (booking 30 min and never past the start; task 2 h / end of a date-only task's due date) — after downtime nothing old is sent.
- **Quiet hours:** booking → moved earlier (≤ 3 h, still ahead) and said so, else not sent unless the recipient chooses "Send it anyway"; task → held until quiet hours end if still before due, else the same choice; a snooze is never moved.
- **Checks:** typecheck, lint, build, `db:check`; new `test:reminder-logic` 24 (no DB; also at `TZ=Pacific/Kiritimati`, `Pacific/Pago_Pago`) and `test:reminders` 63 (eligibility, recipients, flight zones, date-only tasks, delivery / duplicates / six concurrent workers, reschedule / cancel / reassign / complete / delete, member removal incl. behind-the-back, preferences, quiet hours, freshness and downtime, stale job and claim races, retries and give-up, email with a **mock** provider incl. failure / retry / email-only / withdrawal, snooze persistence and limits, authorization of recipient actions, inbox actions by role, directions only from an existing link, trip zone change); all earlier suites pass (`test:authz` 119 with the new cron route and DAL entry point in its guards, a client-component guard that caught a type import and was fixed). The real route was exercised over HTTP against the disposable database (503 unconfigured, 401 wrong / missing, 200 with counts, dry run, bad `at`).
- **Not tested:** the screens in a browser (no sign-in is possible here: they were typechecked, linted and built, but not exercised at phone / iPad widths — do that before relying on them), a real Resend send, a real cron run, the live Neon database, real second accounts.
- **Limitations:** quiet hours are one window per person; the "earlier" move is capped at 3 h; reminders are per recipient (editing the rule for a booking re-applies it to the chosen people); an inbox item's Snooze options are those offered when the inbox was read; the freshness windows are constants (`src/lib/reminders.ts`), not settings; no "time to leave" reminder; bookings without a start time cannot be reminded.

## Evening preview of tomorrow (2026-10-07)

An optional, per-person, per-trip preview in the inbox (and email if configured). Full setup in **`docs/evening-preview.md`**.

- **Delivery status: built and tested; NOT active until the scheduler is configured.** The repo had no job infrastructure (Vercel + Neon, no `vercel.json`). The worker is `runEveningPreviews` (`src/db/evening-preview.ts`), triggered by `GET|POST /api/cron/evening-preview` (secret `CRON_SECRET`, constant-time bearer check, 503 when unset, bypasses the sign-in proxy). Needs `CRON_SECRET` + a caller every 15 min (Vercel Cron on Pro, or any external pinger; Hobby only allows daily crons, so `vercel.json` was deliberately not added). The settings dialog shows a yellow "isn't running yet" note until `scheduler_heartbeats` shows a run within 2 h.
- **Migration `0009_evening_preview`** (additive; applied only to a disposable local Postgres 17 — **not applied to Neon; run `npm run db:migrate`**): `evening_preview_prefs` (per trip + user: enabled default **false**, `send_time` default 19:00 limited to 16:00–22:00, `in_app`, `email`; ≥ 1 channel; deleted with membership), `evening_preview_deliveries` (ledger, unique `(trip, user, target_date, channel)`, status / attempts / lease; no content), `scheduler_heartbeats`.
- **Rules:** tomorrow = trip-local date + 1 (pure date arithmetic, DST-safe); only if tomorrow is a trip day (includes the evening before day one, nothing after the last day); due from the chosen time for 3 h, later = recorded `skipped/stale` and never sent; no backlog after outages; membership and preference re-checked at delivery; in-app = ledger row + notification in one transaction (exactly once, also under 6 concurrent workers); email = leased claim, `Idempotency-Key`, ≤ 3 attempts within the window, at-least-once with provider dedup only. Reuses Resend / `APP_ORIGIN` / `INVITE_EMAIL_FROM`; email control is disabled with an honest reason when the provider or an address is missing. No push, no new provider.
- **Content** (`src/lib/evening-preview.ts`, deterministic, saved data only): up to 3 highlights in day order (meals / rest blocks count, skipped and cancelled left out, flights / check-ins labelled), first start time, trip-zone times, "As of …" snapshot time, or "Tomorrow is open. Keep it flexible or choose something from Explore." One poll: (1) open, unanswered by the recipient, attached to tomorrow (its day or one of its activities) → link to tomorrow's plan (the poll sits beside it); (2) else unanswered, closing within ~36 h and before the activity / day / planned place visit it is about → link to the poll; (3) else none. Never mentions votes or a leader. No addresses, booking numbers, document links, notes or tokens.
- **UI:** "Evening preview" button in the trip header (any member): sample from the current plan before enabling, opt-in checkbox, time (suggested 7:00 PM, trip zone shown), inbox / email, scheduler honesty note, "Turn off previews"; emails link to it (`?evening=1`). Notification type `evening_preview` is now enabled.
- **Checks:** typecheck, lint, build, `db:check`; new `test:evening` 36 (schedule at date boundaries / DST NY & London / Kiritimati / Pago Pago, opt-in / out, removed members, duplicate + concurrent workers, stale + no backlog, snapshot not resent, empty day, privacy, poll selection incl. answered / closed / canceled / expired / decided / not asked, email unavailable / failing / retry / lease expiry / withdrawn, dry run, scheduler status); all earlier suites pass (`test:authz` guards extended for the cron route and the session-less scheduler entry point). Not tested: a real Resend send, a real cron run, real sign-in, WebKit / a physical iPad. The dialog was checked in headless Chromium (temporary fixture, since deleted) at 390 / 820 / 1440 px: off by default, sample first, honest notes, saves once.

## Ask the group — polls (2026-10-07)

Small group decisions on top of shared trips and the notification service.

- **Migration `0008_polls`** (additive; applied only to a disposable local Postgres 17 — **not yet applied to Neon; run `npm run db:migrate` after `0007`**). Tables `polls` (trip + owner composite FK, creator, question ≤140, description ≤500, parent `trip|day|activity|place` with composite same-trip FKs that `SET NULL` the link — hand-edited column-list form, Postgres 15+ — status `open|closed|canceled`, `closes_at`, `any_option`, the organizer's `result_option_id` + `result_tally` snapshot, `replaces_poll_id`), `poll_options` (stable ids, 1–3, label snapshot, optional same-trip `place_id`), `poll_participants` (explicit asked people), `poll_votes` (PK `(poll_id, user_id)` = one response per person; `option_id` null = "Any works for me"). Also `UNIQUE (id, trip_id)` on `itinerary_items`. Poll tables are in the live-refresh fingerprint.
- **Permissions:** new capability `participate` (owner, editor, **viewer**) — the only write a viewer has; it never reaches the itinerary (`contribute` still gates that; test-sharing now asserts the exception explicitly). Create / edit: owners + editors. Close, cancel, choose the final answer, revise: the asker or the trip owner. Apply a result to the itinerary: owners + editors (the existing Add-to-itinerary flow). Everything is checked in the data layer inside the write transaction (`participateTrip` in the DAL).
- **Behaviour:** the deadline is typed in the TRIP's zone, stored as an instant, and enforced against the database clock inside the vote transaction (works with no job). Votes upsert on the primary key (concurrent requests → one row). "Any works for me" is an abstention (separate count, never a vote for an option). Ties stay ties; leaders are labelled "not final". The organizer's choice is its own column, closes the poll, snapshots the totals and notifies; nothing is added to the itinerary. Content can change only while nobody has answered; afterwards "Create a revised poll" cancels the original and links the new one. Departed members: cannot vote (write gate), history kept, excluded from live totals, never notified, and a decided result's snapshot is never rewritten. Votes and who voted are visible to the whole group (stated in the UI).
- **Notifications:** `poll_vote_needed` (asked members, not the creator, when a poll opens or someone is added by an edit) and new `poll_result` (asked members when the organizer decides); no notification per vote; deduped by `poll_vote_needed:<id>` / `poll_result:<id>`; the service refuses former members. Destination `/trips/<id>/polls?poll=<id>` (added to the strict allow-list). Evening previews / reminders are still reserved.
- **UI:** `PollCard` (radio group, totals, voters, participant dots, organizer actions), `PollFormDialog` (question, details, 2–3 options as text or Explore places of the trip, "Any works for me", optional deadline with the trip zone shown, participant checklist), `PollsNearby` on the itinerary day (day polls + polls about that day's activities, "Ask the group" button, and "Ask the group" in an activity's menu) and in the Explore place detail, and a trip-level list at `/trips/[id]/polls` (tab "Ask the group", under More on phones). **There was no existing member picker** (only the share dialog's member list), so the participant checklist is new; it only lists current members and never adds anyone.
- **Applying a result:** an Explore option links to `/trips/<id>/explore?place=<id>&action=schedule&day=<day>` — the existing Add-to-itinerary form with the place and day prefilled (conflict / protected-rest checks unchanged, creates a planned activity). If the place already has a planned/completed visit the card links to it instead. Text results show a summary only. Nothing is applied automatically.
- **Checks:** typecheck, lint, build, `db:check`; new `test:polls` 26 (roles, membership, concurrency, deadline, vote change, abstention / tie, departed members, cross-trip rejection incl. DB-level FKs, no auto-scheduling, duplicate-safe apply, notifications, revisions); `test:notifications` 36, `test:notification-format` 23, `test:authz` 119, `test:sharing` 37 and the rest pass. Browser (headless Chromium, temporary fixture, mocked actions; deleted): 17 checks at 390 / 820 / 1440 px — radio-group semantics and arrow keys, viewer vs organizer controls, deadline-ended state, dialog fit, no overflow, no console errors.
- **Limitations:** the wording of notifications and cards was not tested signed in, with real accounts, or on WebKit / a physical iPad; poll text is user-written (cleaned in notifications, shown as plain text in cards); no scheduled follow-ups (the evening preview should surface open polls); no reminders for non-voters; participants are fixed at creation (an edit before the first vote can add people; people who join later are not asked); bulk "Create a revised poll" copies content only via the form; a poll about a removed place/activity keeps its wording but loses the link.

## Notification inbox (2026-10-07)

A personal inbox (bell + panel + `/notifications`) and one server-side service
every later feature creates notifications through.

- **What exists to notify about:** trips are shared (owner / editors / viewers), invitations are
  email-bound or single-use links, the itinerary is edited by several people. Polls, evening previews
  and reminders do **not** exist yet — they are reserved types the service refuses to create.
- **Schema — migration `0007_notifications` (additive; applied only to a disposable local Postgres 17 —
  NOT yet applied to Neon, run `npm run db:migrate`):** table `notifications` — `recipient_id`,
  optional `trip_id` + `trip_owner_id` (composite FK to `trips(id, owner_id)` ON DELETE CASCADE, the usual
  pattern, so deleting a trip deletes its notifications), `type`, `title` (≤120), `body` (≤400),
  `resource_type` / `resource_id` (uuid), `actor_id`, `dedupe_key`, `metadata` jsonb (object, ≤1 KB),
  `created_at`, `read_at`, `archived_at`. `UNIQUE (recipient_id, dedupe_key)`; CHECKs for the type shape,
  lengths, "actor ≠ recipient", and trip/owner pairing. Indexes: recipient + newest, partial unread,
  trip + recipient. **There is no URL column** — destinations are derived (below). Existing data untouched.
- **Service — `src/db/notifications.ts` (DAL-only, like `sharing.ts`) + pure `src/lib/notifications.ts`:**
  `createNotifications(db, drafts)` is the only way a row is written. Drafts are typed
  (`NotificationDraft`), built on the server from verified state, and checked again at write time: type
  must be `enabled` in `NOTIFICATION_KINDS`; recipient ≠ actor; recipient must currently own / belong to the
  trip (invitation types: an open, unexpired invitation to that trip); text goes through `cleanText`
  (one line, URLs → "a link", token-like strings → "…", control / bidi characters removed);
  `ON CONFLICT (recipient, dedupe_key) DO NOTHING`. Event helpers run in the caller's transaction inside
  a savepoint (`safely`): a rollback removes the notification; a notification bug is logged and never undoes
  or blocks the edit.
- **Events:** (1) **invitation created** (email-bound): existing account (matched on `user_profiles.email`)
  is notified at once; people without an account are picked up by `reconcileInvitationNotifications`, run
  for the *verified* email whenever the inbox / bell is read (layout, poll, `/notifications`). Never accepts
  anything. (2) **invitation accepted** → the trip owner, inside the accepting transaction. (3) **itinerary**
  (`withItineraryAnnouncement`, wrapped around create / update / delete / move / duplicate in the DAL): added,
  removed, rescheduled (date, start, end), or place changed → every other current member, never the actor.
  Text e.g. "Dinner moved from 6:00 PM to 6:30 PM. — Sam", formatted in the **trip's** zone (entries stored in
  another zone are converted for display only). Not announced: notes, renames, status / favorite / reorder,
  booking-backed rows (their data is a booking's), "Capture a moment" entries, and bulk plan applies /
  collection imports. Place **names** only, never addresses; booking references / documents / tokens are
  never read into text.
- **Reads / mutations:** every query is constrained by `recipient_id` and re-checks access at read time
  (member of the trip, or an open invitation to the viewer's **verified** email). Lost access → the item
  becomes "No longer available" (title/body replaced, no link, not counted as unread) — nothing old leaks.
  Removing / leaving a trip also deletes that person's notifications for it. Unread state is per
  recipient. `GET /api/notifications?filter=&cursor=` (keyset paging, 20 per page) and
  `GET /api/notifications/summary` (`{unread, latest}`) read the session user's own rows; actions
  `openNotification` / `markNotificationRead` / `markAllNotificationsRead(upTo)` (Zod ids, `guarded()`) take
  an id only — **never a recipient or a URL**. "Mark all" only covers items up to the newest one the person
  saw. Opening the inbox marks nothing; opening an item marks just that item.
- **Destinations:** derived from (type, trip, resource, metadata) by the registry, then checked against a
  strict allow-list (`isSafeInternalPath`: `/trips/<uuid>[/tab][?day=YYYY-MM-DD]`, `/invitations/<uuid>`,
  `/notifications`). Tampered metadata falls back to the trip's itinerary.
- **Invitation page for signed-in invitees:** `/invitations/[invitationId]` (same view as `/invite/[token]`,
  addressed by id so the raw token never enters the inbox). Shown only to the verified invited email (or
  someone already on the trip); any other id looks unknown. "Accept invitation" is still an explicit click
  and `acceptInvitation` still requires the verified-email match; **by id it only works for email-bound
  invitations** (an id is not a secret, so link invitations still need their token).
- **UI:** `NotificationBell` in the header (gold count badge, `aria-label` with the count; ≥ `md`: popover
  panel, < `md` incl. narrow Split View: a link to the full-screen `/notifications` route — both in the
  markup, CSS picks). `NotificationList` (All / Unread, Today / Yesterday / Earlier in the viewer's zone —
  `rove-tz` cookie → browser zone → UTC, per-item "Mark as read", Mark all as read, "Show earlier",
  mascot empty state on the page / icon in the panel, error + retry, offline notice). `NotificationsProvider`
  polls the summary every 60 s **only while the tab is visible**, immediately on focus / visibility /
  online, and stops when signed out; open lists merge-refresh when it changes. No WebSocket service. 44 px
  targets, `env(safe-area-inset-*)` padding, focus lands on the page heading, Esc returns focus to the bell.
- **Extension points** (polls, evening previews, reminders): flip `enabled` + give `destination` on the
  existing registry entry in `src/lib/notifications.ts`, add a draft builder next to the domain write, pick
  a `dedupeKeys.*` key, call `createNotifications` inside the same transaction (`safely`). Icons are an
  exhaustive `Record<NotificationType, …>` so the UI cannot forget one. Evening previews / reminders will
  need a scheduler (cron) calling the same service — not built here. No email / push was added.
- **Checks:** typecheck, lint, build, `db:check`; new `test:notifications` 36 (DB: isolation, personal
  read state, dedupe incl. concurrent, recipients, removed members, rollback, savepoint isolation, invitations
  incl. no auto-accept / by-id rules / reconcile, tampered destinations, pagination), new
  `test:notification-format` 22 (no DB; also at `TZ=Pacific/Kiritimati` and `Pacific/Pago_Pago`),
  `test:authz` 119 (guards extended for the inbox routes / session helper), `test:sharing` 37 and the other
  suites unchanged and passing. Browser (headless Chromium, temporary fixture route since deleted, mocked
  API): 24 checks at 320 / 390 / 505 / 767 / 768 / 1180 / 1440 px — bell link vs panel, tap → `/notifications`,
  groups, filters, mark read / all, load more, unavailable item, open → navigation, Esc / focus return,
  Tab order, no overflow, no console errors, polling pauses while hidden. **Not tested:** real Google
  sign-in, a real second account, real email, WebKit / physical iPad (the headless WebKit build was not run
  for this feature), the live Neon database.

## Shared trips + phone/iPad layouts (2026-10-07)

- **Model:** one owner per trip (`trips.owner_id`, unchanged). Migration `0006_trip_sharing` (additive; applied only to a disposable local Postgres 17 — **not yet applied to Neon, run `npm run db:migrate`**): `trip_members` (editor/viewer; CHECK + composite FK keep the owner out and tied to the trip), `trip_invitations` (SHA-256 token hash, expiry, accepted/revoked, delivery state), `user_profiles` (display names from the verified session), `place_member_state` (private Explore heart + "Your notes"), `created_by`/`updated_by` on shared content filled by a trigger from `app.actor` (set per transaction by the DAL). Existing rows are back-filled to the owner; existing places' hearts/notes moved into the owner's private state.
- **Access:** the DAL resolves the caller's role on THE trip (`resolveTripAccess`), then calls the existing owner-scoped queries with the trip's real owner (child rows carry it). Writes go through `runTripWrite` (role check inside the write transaction). No access → same "not found"; viewer write → `ForbiddenError`. Owner-only: trip settings/delete, invitations, members, "copy packing from another trip". Editors: all planning content. Viewers: read only (they may keep private Explore hearts/notes).
- **Invitations:** `/invite/[token]` (no-store, noindex, no-referrer). Signed-out visitors keep the token in a 30-min first-party cookie; only `/invite` goes through sign-in, so the token never reaches the auth provider. Signing in never accepts; "Accept invitation" does (single transaction, row locked). Email-bound invitations require the provider-verified email (trim + lower-case only). Copied links are single-use, 7 days. Resend / "New link" replaces the token. Limits: 20 invitations/trip/hour, 60 s resend cooldown, 10 sends/invitation, 20 members, 30 open invitations.
- **Email:** `src/lib/email/invitation-email.ts`, Resend over fetch, one provider. Needs `APP_ORIGIN`, `RESEND_API_KEY`, `INVITE_EMAIL_FROM` (optional `INVITE_EMAIL_DEV_INBOX`). Otherwise "Email delivery is not configured" and nothing is sent. "Sent" only when the provider accepts. The provider necessarily receives the email body (which holds the link). App request logs on the host may include the invite URL path.
- **Collaboration:** open tabs poll `/api/trips/[id]/version` (opaque fingerprint, access-checked) every 20 s while visible, and on focus/online; `router.refresh()` keeps form state, and is deferred while a dialog/field is in use. Edit forms send `expected_updated_at`; a stale save returns a conflict, keeps the draft, and offers "Save my version anyway" / "Discard mine". Offline banner is honest.
- **Files/uploads:** the app has no file storage (memories are album links, documents are links), so there are no upload/download endpoints to protect.
- **Layout:** bottom nav (Overview, Itinerary, Bookings, Explore, More) below `md`, top tabs above; full-screen dialogs on phones; dynamic-viewport heights; 44 px targets; reorder has menu alternatives (arrows hidden on coarse pointers).
- Checks: typecheck, lint, build, `db:check`; `test:authz` 119, new `test:sharing` 37, other suites pass. Responsive audit (temporary fixtures, since deleted) in headless Chromium and WebKit at 320×568, 390×844, 430×932, 600×900, 768×1024, 820×1180, 1180×820, 1440×900: no horizontal overflow; touch targets ≥ 44 px except desktop-only reorder arrows. Not tested: real Google sign-in, real email, physical devices.

## Aruba Explore recommendations (2026-10-06)

A curated, version-controlled collection added to Explore on request — never
seeded, never written during build or render.

- **Dataset:** `src/lib/collections/aruba-2026-explore.ts` — 17 items (7
  outings, 7 restaurants with vegetarian options, 3 spas), stable source keys
  (`aruba-butterfly-farm` …), content as researched by the traveler on
  2026-10-06 (stored as `reviewedOn`, `verification: "editorial"` — not
  independently verified). No addresses, coordinates, ratings, hours beyond
  the quoted research, or anything identifying the apartment. Unknown prices
  say "Unknown — request a current quote."
- **Import plan (pure):** `src/lib/collections/collection.ts`
  `planCollectionImport` — same `source_key` → existing (editorial
  `recommendation` refreshed if the dataset changed); the traveler's own place
  with the same normalized name / alias and kind, unique → claimed (their
  name, category, priority, notes, favorite, visits kept); several → skipped
  and flagged; similar name → added and flagged as a possible duplicate.
- **Migration `0005_explore_recommendations`** (additive): `places.is_favorite`
  (bool, default false), `source_key`, `recommendation` jsonb (needs a
  source key), unique `(trip_id, source_key)`; `spa` added to place
  categories. Applied 2026-10-06 to the database in `.env.local` — which is
  the Neon branch named **`development`** (`ep-autumn-leaf-…`), not
  `production` (`ep-silent-truth-…`, no Neon Auth). Earlier notes calling it
  `production` were wrong. 1 trip, 3 bookings, 48 itinerary entries, 0
  places before and after.
- **Live (2026-10-06):** Vercel `trip-planner` → https://travel.nitinkotcherlakota.com
  (also https://trip-planner-green-three.vercel.app), commit `989ce28`.
  Production env vars `DATABASE_URL`, `NEON_AUTH_BASE_URL`,
  `NEON_AUTH_COOKIE_SECRET` point at the `development` branch, and both
  domains are Neon Auth trusted domains there. The `production` branch has
  only Neon Auth's own tables (no app tables or data). Signed-out smoke test passes
  (redirects to `/login` with `next`, auth proxy responds); not yet tested
  signed in.
- **Server:** `importExploreCollection` (trip row locked, one transaction,
  `ON CONFLICT DO NOTHING` on the unique key; refuses non-Aruba trips),
  `setPlaceFavorite` (set, not toggle), `updatePlaceNotes` — queries → DAL
  (`importExploreCollectionForUser`, `setPlaceFavoriteForUser`,
  `updatePlaceNotesForUser`, read-only `getExploreCollectionsForUser` which
  also lists the user's other matching trips) → actions in
  `src/app/actions/places.ts` (Zod, `guarded()`). Never touches bookings or
  the itinerary. Personal state (favorite, notes) is owner-scoped like
  everything else — there is no shared household state yet.
- **UI:** "Explore Aruba" heading; "Add Aruba recommendations" card (hidden
  once all 17 are in, "Add the other N" if some were skipped; result summary
  with linked / skipped / possible duplicates stays until dismissed; links to
  other Aruba trips). Tabs All / Beaches & outings / Food / Spas; chips
  Favorites / Near stay (max drive ≤ 15) / Short outings (max visit ≤ 60,
  excl. travel; meals and spas never count) / Vegetarian options / Parent
  solo time (`?only=`); search over name, area, cuisine, tags; order:
  priority (tier) → max drive → name. Cards: eyebrow, priority badge (gold
  "Top pick"), summary, "est. N–M min drive", ≤ 3 tags, heart, next step.
  Detail: facts, long-drive callout, Open in Maps (Google Maps search for
  name + "Aruba"), Website, favorite, Add to itinerary, Mark visited, spa
  "Take turns" + "Plan a turn at these times", published price with
  integer-cent estimate (ZoiA $224.25 / $448.50), notes lists with the
  family-notes disclaimer, Your notes editor, Sources + review date.
- **Add to itinerary:** existing `saveItineraryItem`; prefilled category,
  end time from the suggested length (spa: total time away), editable note
  ("Suggestion from Explore — not booked.", drive estimate, source). Pure
  `src/lib/outing-check.ts` checks the day as you type: overlaps, drive
  buffers, protected rest blocks (whole-family → must tick "Keep this time
  anyway"; solo spa → informational), two overlapping solo spa turns,
  arrival day (+ ~3 h after landing) and departure day (+ ~5 h before the
  flight, the saved plan's buffers). Nothing is moved; no participants model
  exists, so turn-taking stays as guidance/notes.
- Checks: typecheck, lint, build, `db:check`; new `test:recommendations` 27
  (also at TZ Pacific/Kiritimati and Pacific/Pago_Pago); `test:authz` 119
  (9 new: 17 added, re-import preserves favorite / notes / edits / visits /
  links, editorial refresh, itinerary link in America/Aruba, concurrent
  imports, DB uniqueness, claiming + skip + duplicate flags, cross-owner
  refusals, non-Aruba refusal) on disposable Postgres 17 with 0000–0005;
  explore / itinerary / plan / packing / memories pass. Rendered with
  fixture data on a temporary, since-deleted route at 1440 / 390 px: no
  overflow, ≤ 1 mascot, no console errors; Baby Beach 09:30 on Day 2 warns
  about the rest block and blocks saving until kept; a spa turn at 12:30 is
  informational. Not run signed in.

## Aruba itinerary update (2026-10-06)

A saved, typed plan applied through a preview — not a generic importer.

- **Plan data:** `src/lib/plans/aruba-2026.ts` (47 entries, day themes,
  flight anchors 15:20 arrival / 15:10 departure, outdated-entry rules).
  Flights and the stay are never written — they come from the bookings.
  Categories: Travel → `transport`, Stay → `lodging`, Beach → `activity`
  (no new category).
- **Diff (pure):** `src/lib/plans/itinerary-plan.ts` — `planPreview`
  matches by `source_key` (`aruba-2026:<key>`), else same day + normalized
  title / alias; hand-edited, completed or reflected entries are conflicts
  (default "keep mine"); untouched entries from an earlier version update;
  outdated unsourced entries (noon arrival, 15:00 nap, 17:00 sunset, Day 6
  nap, flight copies) are conflicts. Checks: trip dates (mismatch blocks
  apply), trip zone (opt-in switch), travelers, flight times / zones, stay
  name and check-in/out, rental booking. User notes are never dropped
  (`mergeNotes`). Explore places link only on one exact name match.
- **Migration `0004_itinerary_plan_fields`** (additive, applied to the Neon
  `production` branch 2026-10-06): `itinerary_items.is_optional`,
  `is_protected_rest` (bool, default false), `source_key`,
  `source_fingerprint`; unique `(trip_id, source_key)`. The fingerprint is
  always the plan's own values, so merged / edited rows are never
  overwritten automatically.
- **Server:** `previewItineraryPlan` / `applyItineraryPlan` (queries → DAL
  `previewItineraryPlanForUser` / `applyItineraryPlanForUser` → actions in
  `src/app/actions/itinerary-plan.ts`, Zod `planApplySchema`, `guarded()`).
  Apply locks the trip row, recomputes the preview, refuses a stale token
  (returns the fresh preview), writes in one transaction. Never writes
  status / rating / reflection / favorite / place links or bookings.
- **UI:** "Update Aruba family plan" card on the itinerary (sheet with
  checks, conflicts, changes by day, zone opt-in, Apply, summary). Scenic
  cover panel around the day strip + day header, mascot once (64–80 px),
  day theme once the plan is applied. Entries: "Protected rest" (sage card,
  moon icon), "Optional", subtle "Estimated" on plan times, notes in an
  expandable row, gentle rest-window overlap note. Form: Optional /
  Protected rest checkboxes. Overlaps: a point at an interval's start, or
  two different points at one moment, no longer count.
- **Known:** a same-day flight is still one row (departure time; "arrives
  3:20 PM" in its detail). Saved bookings use `America/New_York` for AUA
  ends (same clock in October) and the stay checks out 10:00 vs the plan's
  10:15 — flagged in the preview, not changed.
- Checks: typecheck, lint, build; `test:plan` 28 (new), `test:authz` 110
  (9 new: cross-owner, idempotent re-apply, concurrent double apply,
  unique source, keep / use-plan conflicts, zone opt-in, blocked dates) on
  disposable Postgres 17 with 0000–0004; itinerary / explore / packing /
  memories pass; all at TZ Pacific/Kiritimati and Pacific/Pago_Pago.
  Rendered with fixture data at 1440 / 390 px: no overflow, one mascot, no
  console errors. Not run signed in (Google sign-in unavailable here).

## Atlas rebrand (2026-10-06)

The app is renamed **rove → Atlas** (UI, metadata, docs, `package.json`).
Internal identifiers keep their old names on purpose: the `rove-tz`
cookie, `roveDb`, `[rove]` log prefixes, `rove.invalid`.

- **Mascot:** `public/brand/atlas-mascot.png` (the smiling earth guardian,
  used as supplied). `src/components/mascot.tsx`: `MascotImage`
  (`xs`–`hero`, `variant="glow"`, `decorative`), `BrandGlowCard`,
  `MascotEmptyState` (`card` / `quiet`, `action` or `actionLabel` +
  `actionHref` / `onAction`), `MascotLoader`. At most one mascot per screen.
- **Where:** sign-in hero, dashboard first-trip welcome
  (`first-trip-welcome.tsx`), `/trips` loading, 404, trip not found, app
  error, setup notice, Explore empty + no matches, Packing empty, Memories
  empty journal. App icons `src/app/icon.png` / `apple-icon.png` are resized
  from the mascot (default `favicon.ico` removed). Header mark: forest
  badge with a gold compass star.
- **Wordmark:** `ATLAS` in capitals (`Wordmark` in `brand.tsx`) with a gold
  glint sweeping across every ~7 s and three twinkling sparkles
  (`.atlas-wordmark`, `.atlas-sparkle`); static under reduced motion, plain
  text in forced-colors mode. In prose and titles the name is "Atlas".
- **Dashboard greeting:** the mascot waves beside "Good morning, …" when the
  traveler has trips (the first-trip welcome card has its own).
- **Palette** (`globals.css`): ivory `#FAF6EC`, forest `#183A2F`, moss
  `#4F8F4A` (fills / rings), moss-ink `#3E7A3A` (buttons, links — AA),
  gold `#F5C451` / gold-soft `#FFE7A3`, earth `#8B6F47`, sage `#A7C957`,
  info `#5EC3E6`, border `#D9E6C7`, muted text `#666B55` (AA on ivory).
  Tokens renamed teal → moss, lavender → earth / surface-warm, sun →
  gold-soft. Coral is kept only as a terracotta for hearts, "Today" and
  error eyebrows. Also `bg-atlas-*` / `text-atlas-*` names for the palette.
- Checks: typecheck, lint, build, itinerary / explore / packing / memories
  tests pass. Rendered with headless Chromium at 1440 and 390 px (sign-in,
  404, and the real components with sample data on a since-deleted page):
  no overflow, no broken images, no console errors.

## Deployment readiness (2026-10-06)

Not deployed yet. Steps: **`docs/vercel-deployment.md`** (target
`https://travel.nitinkotcherlakota.com`).

- Runtime env (Vercel, Production only): `DATABASE_URL` (pooled),
  `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`. No variable sets the
  public origin; it comes from the request. Neon Auth's trusted domains
  decide where sign-in may return.
- No hardcoded localhost in `src/`. Auth cookies are `__Secure-`, `Secure`,
  `HttpOnly`, `SameSite=Lax`, host-only (no `cookies.domain`).
- Changes: `engines.node = 22.x` in `package.json`; the `rove-tz` cookie
  is `Secure` on HTTPS.
- Migrations 0000–0004 are applied on the Neon `production` branch
  (checked 2026-10-06).
- Checks: typecheck, lint, build, `db:check`, `test:authz` (101, disposable
  Postgres 17, 0000–0003), and the itinerary / explore / packing / memories
  suites pass. `next start` responses for dynamic pages are
  `private, no-store`.

## Stage 1 checklist

| | Item | Notes |
|---|---|---|
| ✅ | Next.js 16 App Router, TypeScript strict, Tailwind 4, shadcn/ui (Radix), Lucide | Versions pinned exactly; `package-lock.json` committed. |
| ✅ | Design tokens (ivory / navy / teal / coral / sun / lavender) | `src/app/globals.css`. Teal text and coral buttons darkened for WCAG AA. |
| ✅ | Fonts: Fraunces (display serif) + DM Sans (UI) | `next/font/google`, self-hosted at build. |
| ✅ | Neon Auth (`@neondatabase/auth` 0.5.0-beta, pinned) | `src/lib/auth/*`, `/api/auth/[...path]`, `src/proxy.ts`. |
| ✅ | Google sign-in, OAuth verifier exchange, sign-out, safe `next` return paths | `src/app/login`, `src/app/actions/auth.ts`, `src/lib/auth/redirects.ts`. |
| ✅ | Drizzle schema + reviewed SQL migration | `src/db/schema.ts`, `drizzle/0000_initial_schema.sql`. |
| ✅ | Data access layer with per-call session verification | `src/lib/dal.ts` → `src/db/queries.ts`. |
| ✅ | Personalized dashboard (greeting, avatar, current/upcoming/past, empty state) | `src/app/(app)/trips/page.tsx`. |
| ✅ | Trip create / edit / delete | Dedicated pages `/trips/new`, `/trips/[id]/edit`; delete from hero menu. |
| ✅ | Trip overview (hero, tabs, flight pass, stay, glance, coming up, documents, notes) | `src/app/(app)/trips/[tripId]/(tabs)/page.tsx`, `src/components/trip/overview-cards.tsx`. |
| ✅ | Bookings: add / view / edit / delete, 7 kinds | Side sheet; `/trips/[id]/bookings` lists all by day. |
| ✅ | Trip time zone; per-booking start/end zones (departure/arrival) | Times shown with zone labels, e.g. "8:20 AM EDT → 1:15 PM AST". |
| ✅ | Type-specific booking details (flight no., room, party size…) | `src/lib/reservation-details.ts`, validated per kind. |
| ✅ | Confirmation codes (copy), notes, booking links | Stored per booking. |
| ✅ | Document links (Drive-aware), per trip or per booking | Dialog form; edit/remove from row menu. |
| ✅ | Loading skeletons, error boundary, not-found pages, toasts | |
| ✅ | All trip tabs live | Overview, Itinerary (2b), Bookings, Explore (2c), Packing (2d), Memories (2e). No inert tabs remain. |
| ✅ | Local, licensed imagery with credits | `public/images/covers/`, `docs/image-credits.md`. |
| ⏳ | **Neon project + Neon Auth on a branch** | Needs the owner's Neon account. Follow `docs/local-setup.md`. |
| ⏳ | Real Google sign-in tested in a browser | Blocked on the item above — not yet verified. |

Checks run after the Neon migration (2026-10-05): `npm run typecheck`,
`npm run lint`, `npm run build` — pass. `npm run test:authz` — 24 checks pass
against a local Postgres 17 with the migration applied, run with the process
zone at UTC+14 and UTC−11. HTTP checks against `next start` with an
unreachable auth server: protected pages redirect to `/login` (with `next`),
forged session cookies are rejected, a bad OAuth verifier lands on the
callback error, `/api/auth/*` is the only route handler. Not yet tested:
real Google OAuth, session persistence, two real accounts in a browser.

## Stage 2a — trip-feature foundation (data + server layer)

| | Item | Notes |
|---|---|---|
| ✅ | Tables `places`, `itinerary_items`, `packing_categories`, `packing_items`, `trip_memories` | `src/db/schema.ts`; migration `drizzle/0001_trip_features.sql` (additive only). |
| ✅ | Migration applied to the Neon dev branch | 2026-10-05. Existing trips/bookings untouched (1 trip, 3 bookings before and after). |
| ✅ | Shared option sets (kinds, categories, priorities, statuses, labels) | `src/lib/plan-options.ts` — used by CHECK constraints, Zod and UI. |
| ✅ | Zod schemas | `placeSchema`, `itineraryItemSchema`, `visitReviewSchema`, `packingCategorySchema`, `packingItemSchema`, `deletePackingCategorySchema`, `deletePlaceSchema`, `tripMemorySchema` in `src/lib/validation.ts`. |
| ✅ | Owner-scoped queries + DAL | `src/db/queries.ts`, `src/lib/dal.ts` (`get*ForUser` reads, `*ForUser` mutations). |
| ✅ | Server Actions | `src/app/actions/places.ts`, `itinerary.ts`, `packing.ts`, `memories.ts`. |
| ✅ | Schedule helpers | `src/lib/schedule.ts` — `itemSchedule`, `reservationSchedule`, `buildAgenda`, `standaloneScheduleFromReservation`, `addDays`, `datesBetween`. |
| ✅ | Booking edit/delete aware of linked visits | Date can't be cleared while a visit uses it; delete keeps reviewed visits. |
| ✅ | Itinerary tab | Stage 2b, below. |
| ✅ | Explore tab | Stage 2c, below. |
| ✅ | Packing tab | Stage 2d, below. |
| ✅ | Memories tab | Stage 2e, below. |

Checks (2026-10-05): `npm run typecheck`, `npm run lint`, `npm run build`,
`npx drizzle-kit check` — pass. `npm run test:authz` — 49 checks pass
(24 previous + 25 new) against a disposable local Postgres 17 with both
migrations applied, at process zones UTC+14 and UTC−11.

## Stage 2e — Memories tab and integration pass

| | Item | Notes |
|---|---|---|
| ✅ | Route `/trips/[id]/memories` | `MemoriesView` (`src/components/memories/*`), route `loading.tsx` + `error.tsx`. Tab enabled. `?show=favorites` filter and `?capture=1` (opens "Capture a moment") live in the URL. |
| ✅ | Editorial layout | Journal masthead (illustrative cover labelled as such, destination, dates, travelers, overall stars, "Would go back"), derived stats, reflection card (summary in serif, favorite moment, lessons), photo-album card, favorites strip, "Day by day" journal with a day rail on desktop. |
| ✅ | Trip phase (`journalPhase`, today in the trip's zone) | **Before**: welcome copy, "Write a note", album link; journal empty state explains it fills itself; no capture button, nothing invented. **During**: journal + "Capture a moment" first, reflection below. **After**: reflection, favorites and lessons first, then the journal. |
| ✅ | Trip reflection (`trip_memories`, one row per trip) | Dialog with overall rating (keyboard radios, Clear), summary, favorite moment, would return (Yes / No / Undecided + Clear → not answered), lessons. Explicit Save with pending / success toast / inline error (inputs kept, sign-in link when signed out). |
| ✅ | Atomic, partial upsert | `saveTripMemory` writes only the given fields via `INSERT … ON CONFLICT (trip_id) DO UPDATE` — the reflection and the album link save separately without erasing each other; concurrent first saves converge on one row. |
| ✅ | Unsaved changes | `EditDialog`: Esc / X / outside click / Cancel with edits asks "Discard your changes?" (Keep editing returns focus to the form); `beforeunload` warns while dirty; can't close mid-save. Used by every Memories dialog. |
| ✅ | Photo album | Add / change / remove / open an https link (Zod: https, real domain, no credentials). Shows the service name only; copy says Atlas can't see inside the album. No uploads, imports, Drive API or new OAuth scopes. Removing the link never touches the album. |
| ✅ | Completed visits | Read from `itinerary_items` (`status = completed`) — never copied. Grouped by day (booking-backed visits dated by their booking), repeat visits stay separate, visits outside the trip dates or undated are listed, not hidden. Each shows time + zone, category (+ place category), stars, reflection, favorite heart, "Add a reflection" when empty, links to Explore place / booking sheet / itinerary day. Cancelled bookings are labelled. |
| ✅ | Edit in place | Reflection dialog → `saveReflection`; heart → `setItineraryFavorite` (optimistic, reverted with a toast on failure). Same rows as Itinerary and Explore, all revalidated. |
| ✅ | Favorites | `favoriteVisits` = completed rows with `is_favorite`; the strip and the All / Favorites filter use those same rows (repeat visits show their day). |
| ✅ | Counts (only when something is done) | Activities completed = completed rows; places visited = distinct `place_id`s; food & drink spots = distinct food-kind places. No photo count. |
| ✅ | Capture a moment | "From the itinerary": plans and bookings on trip days up to today that aren't done (cancelled and check-out / arrival halves excluded), completed with optional review on that row (blank fields never erase). "Something new": a completed standalone activity (title, day ≤ today within the trip, category, rating, reflection, favorite, optional "Also save to Explore") — idempotent `request_id`. |
| ✅ | Overview by phase | Same cards in every phase, only order / weight change. Before: flights, stay, glance, first-day plan, documents, packing. During: today's plan + documents first, then flight / stay / glance, `MomentsCard` (count, latest, "Capture a moment") + packing. After: `TripMemoryCard` (stars, summary, up to 3 favorites, "Open photo album") + documents, then bookings, last-day plan, packing. Bookings and documents are in every phase; navigation is unchanged. |

Data changes: migration **`0003_memories_would_return`** — `trip_memories.would_return`
boolean → text `yes | no | undecided` (null = not answered) with a CHECK;
hand-edited `USING` maps true → yes, false → no (verified on seeded rows).
`saveTripMemory` takes a partial input. `createItineraryItem` gained
`options.completed` (create already done with its review; trip days ≤ today
in the trip's zone, else `outside_trip` / `in_future`; not for bookings).
New actions in `src/app/actions/memories.ts`: `saveTripSummary`,
`saveTripAlbum`, `removeTripAlbum`, `captureExistingMoment`,
`captureNewMoment` (the full-row `saveTripMemory` action was removed).
Schemas `tripSummarySchema`, `tripAlbumSchema`, `captureMomentSchema`.
Pure helpers in `src/lib/memories.ts`. Overview cards accept `className`.

Fixed along the way: `httpsUrl` threw (→ generic "Something went wrong")
on unparseable links such as "not a link", because Zod 4 still runs the
credentials refine after a failed url check. It now returns the field
error. Affected every link field (bookings, documents, Explore, album).

Checks (2026-10-05): `npm run typecheck`, `npm run lint`, `npm run build`,
`npx drizzle-kit check` — pass. `npm run test:authz` — **101 checks** (17 new)
against a disposable local Postgres 17 with migrations 0000–0003 applied, at
the local zone, UTC+14 and UTC−11. New: partial + concurrent upserts,
undecided kept distinct, DB rejects bad answers / ratings / http albums,
cross-owner summary refusals, capture (idempotent incl. concurrent, refuses
outside / future / booking / other owner, requestId can't be claimed by
another owner), cross-owner review refusals, capture + save-to-Explore
links the existing place, repeat visits + edits visible in Itinerary and
Explore, unrated memories, reviewed booking cancelled then deleted keeps its
memory, place delete (keep visits) and trip shortening never drop memories,
and the **17-step workflow** at the data layer (trip, cross-zone flight +
stay on the agenda, restaurant → schedule → rename → complete → Memories +
visited → favorite filter, packing progress → copy unpacked and
independent, reflection + album persisted on a fresh read, second account
can't read or change anything). `npm run test:memories` (new, no DB) — 10
checks at three zones; `test:itinerary` 18, `test:explore` 7, `test:packing` 22 pass.

UI QA: real components rendered with fixture data on a temporary,
since-deleted route (production build, auth unconfigured on that instance,
no DB) in headless Chromium at **1440, 768 and 390 px**, every phase plus
empty / favorites / overview variants: no horizontal overflow, no broken
images, no console errors, no tap targets under 32 px, six tabs present.
Interactions: arrow keys move the star rating, Clear empties it, Esc with
edits asks to discard (Keep editing keeps text + focus), an untouched
dialog closes directly, saving without a session shows the sign-in message
and keeps input, the heart rolls back with a toast when the server refuses,
`?capture=1` opens the capture dialog and closing it drops the param,
capture without a choice shows a field error, an http album link is
refused. Fixed from QA: unreadable "Illustrative photo" label, identical
favorite tiles for repeat visits (now dated), focus lost after "Keep editing".
Signed-out `/trips/…/memories?show=favorites` → 307 to `/login` with the
query kept in `next` (checked against the real-auth dev server).

**Not yet verified signed in** against the real database in a browser
(Google sign-in can't run here; no auth bypass was added). **Migration 0003
is not applied** to the branch in `.env.local` — it is named `production`
(1 trip, 3 bookings, 0 `trip_memories` rows), so it was left for the owner.
Until it is applied, saving "Would you go back?" fails there.

## Stage 2d — Packing tab

| | Item | Notes |
|---|---|---|
| ✅ | Route `/trips/[id]/packing` | `PackingView` (`src/components/packing/*`); route `loading.tsx` + `error.tsx`. Tab enabled. |
| ✅ | Layout | Desktop: compact progress under the heading, category nav (counts `packed/total`) on the left, checklist in the middle, compact sunny "Still to pack" panel (by category / traveler, "Show what's left") on xl only. Phone: native category `<select>` with counts, full-width checklist, 48 px checkbox rows (whole label is the target), 44 px menus, sticky "Add item" button. Small teal category icons guessed from the name (`category-icon.tsx`); no product pictures. |
| ✅ | Empty state | Three explicit choices — starter checklist, copy from another trip (disabled with a reason when no other trip has a list), start an empty list (name a first category, "Essentials" prefilled). Nothing is inserted on page load. |
| ✅ | Item operations | Add (sheet: label, quantity, "For" with trip-traveler suggestions via `<datalist>`, category, notes; or inline quick-add per category — Enter, stays focused), edit, packed toggle, "Move to…" another category (appended last), delete, Move up / Move down in the row menu (shown only when no filter is active). Quantity is a whole number 1–999; the checkbox packs the whole row. |
| ✅ | Travelers | Optional free-text label, never an identity. Suggestions = the trip's travelers + any names already on the list, so names removed from the trip stay assigned and filterable. |
| ✅ | Category operations | Add, rename, Move category up / down, delete. Names are unique per trip ignoring case / accents (needed for merging). Delete with items: dialog defaults to "Move the N items to [category]"; "Delete the category and its N items" must be picked explicitly and the button says so. If items appear meanwhile the server refuses (`has_items`) and the dialog refreshes. |
| ✅ | Progress | Always computed from rows (`progressOf` in `src/lib/packing.ts`): packed / total, floored % (never "100%" with something left), remaining, per category. 0 items → 0 %, empty-state copy. Nothing stored. Uses optimistic checkmarks, so it moves immediately. |
| ✅ | Filters | All / To pack / Packed (with counts) and a traveler filter (Everyone, each name, Not assigned); client state, compact. |
| ✅ | Checkbox persistence | `src/lib/packed-sync.ts` (pure) + `use-packed-toggles.ts`: shows the click at once, at most one request in flight per item, then sends the latest wanted value if it differs — writes are always "set to X" (`setPackingItemPacked(trip, item, packed)`), never "invert". Row shows "Saving…" until the final write succeeds; any failure drops the optimistic value (row returns to the saved state) and toasts why. |
| ✅ | Starter checklist | Local template (`STARTER_CATEGORIES`): Essentials, Clothes, Toiletries, Baby, Beach, Electronics; practical items, quantity 1, no medical items. Choose categories first; the preview shows "N new · M already on your list" per category. Applying merges (below), so repeating it adds nothing and says so. |
| ✅ | Copy from another trip | Choose one of your other trips (category / item counts; trips without a list disabled) → choose all or some categories → confirm (adds / skips / new categories, "start unpacked"). Copies category names + order, labels, quantities, notes, traveler labels; new IDs and timestamps, `is_packed = false`. One transaction with the destination trip locked; the source trip and every category ID are re-checked against the verified owner (anything else → `source_not_found`, nothing written). Source is only read. |
| ✅ | Merging into an existing list | `planMerge`: same-name category (case / accents / spacing ignored) is combined; an item already in it with the same name **and** traveler is skipped; everything else is appended. Never replaces or edits existing rows. Explained in both dialogs. |
| ✅ | Mark everything unpacked | Menu → confirmation naming the count and "every category"; one statement for the whole trip; items kept. |
| ✅ | Overview | `PackingCard`: "N of M packed", bar, %, remaining by category; whole card links to the tab. No items → "Start packing list". Sits beside Trip notes (or spans the row without notes). |

New server surface (DAL-verified, owner-scoped, Zod, `guarded()`):
`createPackingItem(…, requestId)` (idempotent), `updatePackingItem` (category
change → appended last), `movePackingItem`, `reorderPackingItems(category,
ids)` / `reorderPackingCategories(ids)` (must be exactly the current set, else
`stale` and nothing changes), `unpackAllPackingItems`, `applyPackingStarter(keys)`,
`listPackingSources` (owner's other trips with lists), `copyPackingFromTrip(source,
"all" | categoryIds)`. `createPackingCategory` / `updatePackingCategory` now
return `{ ok, id } | { ok: false, reason: "not_found" | "duplicate_name" }`.
Actions in `src/app/actions/packing.ts`; schemas `packingOrderSchema`,
`packingStarterSchema`, `packingCopySchema`. No schema change, no migration.

Checks (2026-10-05): `npm run typecheck`, `npm run lint`, `npm run build`,
`npx drizzle-kit check` — pass. `npm run test:authz` — 84 checks (13 new:
item CRUD + category move, explicit packed set incl. concurrent writes,
progress empty / partial / complete, unpack-all scope, idempotent create,
item / category order + stale / cross-trip / cross-owner refusals, unique
category names, no item loss on move / category delete, starter merge +
repeat, copy resets packed + leaves source unchanged + independence,
merge into existing list, copy refused from another owner / unknown
categories / itself / into another owner's trip) against a disposable
local Postgres 17 (migrations applied with psql) at the local zone,
UTC+14 and UTC−11. New `npm run test:packing` (no DB) — 22 checks incl.
the save queue: rapid clicks, last value wins, failure rollback, offline.
UI rendered with fixture data on a temporary, since-deleted route in
headless Chromium at 1360 px and 390 px: no console errors, no page
overflow, progress, filters, category nav / select, starter preview,
3-step copy flow, delete-category choices, empty state, 48 px rows. A real
checkbox click there hit the Server Action without a session: the row
ticked, progress moved, then both rolled back with an explanation.
**Not yet verified signed in** against the real database.

## Stage 2c — Explore tab

| | Item | Notes |
|---|---|---|
| ✅ | Route `/trips/[id]/explore` | Personal list of places and food (no search engine, no external data). |
| ✅ | Compact cards | Category art tile (gradient + icon per category — no stock photos posing as the place), kind · category, "Must do", one-line planning note, status chips, one primary action ("Add to itinerary" / "Record a visit" / "Plan another visit"). |
| ✅ | Filters in the URL | One toolbar: All / Places / Food (with counts), search by name (accent- and case-insensitive, debounced `replace`), priority, visit status, Clear. `?kind=&q=&priority=&status=`; unknown values fall back to "all". |
| ✅ | Visit states (derived, never stored) | Visited = ≥1 completed visit; Scheduled = ≥1 planned visit (both can show); Unscheduled = neither — skipped-only places count as unscheduled. The itinerary's Explore panel uses the same definition. |
| ✅ | Add / edit place | Required: name, Place or Food. Optional: category (blank → "Other"), priority (blank → "Maybe"), address, Google Maps link, website, notes. Server-validated; links must be `https://` on a real domain name with no embedded credentials (no localhost / IPs). Nothing is fetched from links. |
| ✅ | Maps links | Saved link → "Open in Google Maps" (exact). Otherwise "Search Google Maps" for name + address, with a note saying it's a search. |
| ✅ | Place detail (`?place=<id>`) | Side sheet: details, notes, priority, links, planned visits ("Open day"), completed visits with their own ratings / reflections / favorite, skipped count, Add to itinerary, Record a visit, Edit, Delete. Direct links and back/forward work. A new place opens straight into its detail. |
| ✅ | Add to itinerary | Day (defaults to today in the trip's zone, kept within the trip), optional start/end, visit note → a planned visit linked to the place. |
| ✅ | Record a visit | With planned visits the traveler must pick one ("mark the visit on Day 5 as done") or "a separate visit" — no default, and the server refuses to guess (`has_planned_visits`). Completing keeps the planned visit's date and notes; blank rating/reflection never erase what's there. Otherwise a completed visit is created on the chosen day — it appears in the Itinerary and in Memories (`completedOnly`). |
| ✅ | Ratings | Per visit only. Cards / detail show the average of *your* rated completed visits (one star + number, "average of your 2 ratings") only when ratings exist; never zero stars, never a public rating. |
| ✅ | Shared data | Visits join the place (never copy it): editing a place changes every itinerary / memory display; visit notes and reflections stay on visits. Removing a visit keeps the place. |
| ✅ | Delete | Policy from 2a: a place with visits is only removed by explicitly keeping the visits ("Remove place, keep visits", with counts and what is kept). If visits appear between opening and confirming, the server refuses and the dialog switches to the explanation. |
| ✅ | Duplicates | Gentle "You already have “…”" hint while typing (accents, case, "the", containment) — never blocks. Double submits can't create twins: forms send a one-time `request_id` used as the new row's id (`ON CONFLICT DO NOTHING` + owner/trip re-check). Applies to new places, scheduled visits, recorded visits and itinerary "Add". |

Data changes: `listPlaces` now also returns `planned_count`,
`completed_count`, `rating_avg`, `rated_count`, `next_planned_date`,
`last_completed_date` (cast to float / text so no `Date` objects).
New `recordPlaceVisit` query + `recordPlaceVisit` action; `createPlace` /
`createItineraryItem` accept a `requestId`; the "Add to this day" guard
now ignores skipped visits. Pure helpers in `src/lib/explore.ts`. No schema
change, no migration.

Checks (2026-10-05): `npm run typecheck`, `npm run lint`, `npm run build`,
`npx drizzle-kit check` — pass. `npm run test:authz` — 71 checks (12 new:
CRUD + defaults, safe links, idempotent place / visit creates incl.
concurrent, derived states + rating average, filters, schedule → itinerary
→ complete → Explore, record-a-visit choice / completion / Memories,
cross-trip and cross-owner refusals, place edits reaching visits and
memories, delete keeping the place / detaching visits) at UTC+14 and
UTC−11. `npm run test:itinerary` 18 and new `npm run test:explore` 7
(no DB) pass. UI rendered in headless Chromium at 1360 px and 390 px with
fixture data on a temporary, since-deleted route: no console errors, no
page overflow, URL filters, detail + record form, duplicate hint. Signed-in
use against the real database is still not verified in a browser.
Signed-out `/trips/…/explore?…` redirects to `/login`, keeping the filters
in `next`.

## Stage 2b — Itinerary tab

| | Item | Notes |
|---|---|---|
| ✅ | Route `/trips/[id]/itinerary`, selected day in `?day=` | Links (not client state), so direct links, refresh and back/forward keep the day. Invalid / non-trip `?day=` falls back to the default. |
| ✅ | Default day | Today **in the trip's zone** while the trip is on, else day 1 (`defaultItineraryDay`). |
| ✅ | Compact header on inner tabs | `TripHeaderCompact`; `TripHeaderSwitch` (`useSelectedLayoutSegment`) keeps the full hero on the overview only. Bookings uses it too. |
| ✅ | Day strip | Weekday + date pills, horizontally scrollable inside its own box (no page overflow), auto-centres the selected day, "Today" marker, dot when a day has plans; prev/next buttons; a date field to jump on trips over 10 days. |
| ✅ | Timeline + Flexible | Timed entries in time order with time/zone column (inline on phones); untimed entries in a labelled **Flexible** list with persisted move up/down (optimistic, keyboard focus kept). No drag-and-drop. |
| ✅ | Add / edit sheet, 3 modes | New activity (title, category, day, optional start/end, overnight end date, zone defaulting to the trip's, notes); From Explore (place picker with name/address/maps link, visit notes); A booking (link a dated booking to add itinerary notes; undated ones offer "Add a date" → booking form). |
| ✅ | "Also save to Explore" | Standalone activities whose category is a place (`exploreKindFor`): links to an existing place with the same name (case-insensitive) or creates one, in the same transaction. Never duplicates. |
| ✅ | Merged schedule | One entry per booking (its itinerary row if any). Stays → check-in / check-out milestones; flights, trains, cars → departure / arrival milestones on their own dates with each end's zone. A milestone outside the trip whose other end is inside (red-eye out, flight home) isn't listed as "outside". |
| ✅ | Cancelled bookings | New `reservations.status` (`confirmed` / `cancelled`, migration `0002`), a checkbox on the existing booking form (edit only). Hidden from itinerary and overview by default; "Show N cancelled" toggle (`?cancelled=1`) shows them struck through and labelled. Bookings list and booking sheet label them. |
| ✅ | Actions per entry | Activities/visits: edit, move to day, duplicate, remove. Bookings: itinerary notes, view / edit booking (existing sheet — no booking fields are copied). Everyone (not cancelled, not end milestones): done / skipped / planned, favorite, reflection. |
| ✅ | Completion + reflection | Status-only changes keep rating / reflection / favorite. After "done", an optional inline panel (1–5 stars, reflection, favorite) — "Not now" closes it. Same columns feed Memories (`completedOnly`). |
| ✅ | Overlaps | Gentle "Overlaps with …" note, compared by real instant across zones; skipped, cancelled and stays ignored. Never blocks saving. |
| ✅ | Explore panel | Unscheduled places with "Add to this day" (refused server-side if the place already has a visit — repeated clicks can't stack). "Already scheduled" list → "Add again" with an explicit confirm. Single column below the day on phones. |
| ✅ | Outside trip dates | Section at the top listing entries before / after the trip, with "Move to a trip day" (activities) or "Edit booking dates" (bookings). Nothing is deleted or redated. |
| ✅ | Overview preview | `DayPlanCard` replaces the bookings-only "Coming up" card: the merged agenda for today (during the trip), day 1 (before), or the last day (after). Flight/stay/glance cards ignore cancelled bookings. |
| ✅ | States | Route `loading.tsx` + `error.tsx` inside the trip layout; pending spinners on every action; toasts only after the server confirms; forms keep input on errors. |

New server surface (all through the DAL, owner-scoped, Zod-validated,
`guarded()`): `setItineraryStatus` / `setItineraryFavorite` (take
`{ itemId } | { reservationId }` — a booking gets its single link row on
first use), `saveReflection`, `moveItineraryItem` (trip days only; a
multi-day end shifts with it; goes last), `duplicateItineraryItem` (plan
only — status / rating / reflection / favorite reset; refused for booking
links), `reorderFlexibleEntries` (`i:<id>` / `r:<id>` keys; all must belong
to the trip or nothing changes), `schedulePlace(…, again)`, and
`saveItineraryItem` now reads `save_to_explore`. `reviewItineraryItem`
query accepts a partial review.

Checks (2026-10-05): `npm run typecheck`, `npm run lint`, `npm run build`,
`npx drizzle-kit check` — pass. `npm run test:authz` — 59 checks (10 new:
duplicate reset, move limits, reorder persistence + cross-trip/owner
rejection, concurrent "Add to this day" → one visit, save-to-Explore
dedupe, status keeps reflection, cancelled persistence, edits/moves after
shortening the trip) pass against local Postgres 17 at process zones
UTC+14 and UTC−11. New `npm run test:itinerary` (no DB) — 18 checks:
calendar days across month/year/leap/DST, today in the trip's zone,
booking de-duplication, stay and overnight-flight milestones, cross-zone
ordering and overlaps, cancelled hiding, outside-trip grouping — pass at
both zones. Migration `0002` applied to the Neon dev branch (1 trip,
3 bookings before and after, all `confirmed`).

UI verified in headless Chromium (1360 px and 390 px) by rendering the
real components with fixture data on a temporary, since-deleted route:
no console errors, no horizontal page overflow, `?day=` honoured, add
sheet fields, empty-day state. **Not yet verified signed in** (Google
sign-in can't run here): the full flow against the real database in a
browser. Signed-out `/trips/…/itinerary?day=…` redirects to `/login` with
the day kept in `next`.

### Product model

- **Explore** (`places`) — places and food being considered for a trip.
  `kind ∈ place | food`; `category` is validated per kind (DB CHECK + Zod);
  `priority ∈ must_do | maybe`. No stored "visited" flag: `visited` and
  `visit_count` are derived from itinerary rows (`listPlaces`).
- **Itinerary** (`itinerary_items`) — one row per visit or standalone
  activity. A place may have many visits; a booking at most one (partial
  unique index). Status `planned | completed | skipped`.
- **Memories** — completed itinerary rows *are* the per-activity memories
  (rating 1–5, reflection, favorite, `completed_at`). `trip_memories` holds
  only the optional one-per-trip summary. Nothing is copied.
- **Packing** — categories with ordered items (quantity ≥ 1, optional
  traveler name, packed flag).

### Decisions

- **Schedule source.** Standalone and place visits store `local_date`
  (required), optional `local_start_time`, optional end (`local_end_date`,
  `local_end_time`) and an IANA `timezone` (blank → the trip's zone).
  Reservation-backed visits store **no** schedule — a CHECK forces those
  columns to null; the booking's date/times/zones are used
  (`itemSchedule`). An end time that isn't after the start on the same day
  requires an explicit later end date (DB CHECK + Zod message). A same-day
  end date is normalized to null.
- **Agenda.** `buildAgenda` returns every trip day (even empty) in
  `days`, and any other date with entries in `outside` — so shortening a
  trip never hides visits. Dated bookings without a visit appear
  automatically, so nothing is entered twice. Within a day: timed entries
  by real instant (zones respected), then flexible entries by
  `sort_order`. (Updated in stage 2b — see below.)
- **Putting a booking on the itinerary** (`addReservationToItinerary` /
  `ensureReservationVisit`) is idempotent and needs a dated booking. While
  a visit uses a booking, the booking's date can't be cleared.
- **Place shared details.** Visits reference the place; address and links
  are read from it (joined as `entry.place`), never copied. Display title:
  `item.title ?? place.name ?? reservation.title` (`entryTitle`).
- **Deletion rules** (FKs to places / reservations / packing categories are
  NO ACTION, so the DB refuses to orphan rows; the app resolves them in one
  transaction first):
  - Trip → cascades to places, visits, packing, memories (checked: NO
    ACTION constraints are evaluated at end of statement, so this works).
  - Visit → deletes only the visit.
  - Place with visits → refused by default (`has_visits`, with a count);
    with `visits: "detach"` each visit keeps its schedule, notes and
    reflection and takes the place's name as its title.
  - Booking → documents stay on the trip (as before). A linked visit with
    anything the traveler wrote (status ≠ planned, rating, reflection,
    notes, favorite, place, title — `visitHasUserContent`) is converted to a
    standalone visit using the booking's title and schedule (the end is kept
    only if it is in the same zone and well-formed); a bare link is removed.
    The delete confirmation says so.
  - Packing category with items → refused unless the caller chooses
    `{ items: "move", target_category_id }` (same trip, appended after the
    target's items) or `{ items: "delete" }`.
  - Trip summary → cleared on its own; per-visit reflections are untouched.
- **Relationship integrity.** Composite FKs `(place_id, trip_id)`,
  `(reservation_id, trip_id)` and `(category_id, trip_id)` make Postgres
  reject cross-trip links; `(trip_id, owner_id)` pins every row to its
  owner's trip. Mutations also re-check links explicitly (precise errors:
  `place_not_in_trip`, `reservation_not_in_trip`, `category_not_in_trip`,
  `reservation_unscheduled`, `reservation_already_linked`).
- **Sort order.** New visits get `max + 1` per trip, new packing items
  `max + 1` per category, new categories `max + 1` per trip (the trip row is
  locked while assigning). Packing reorders rewrite `1..n` for the full set
  (stage 2d).
- **No sample data.** Nothing is seeded into real trips; tests use random
  disposable owners and delete their rows.

### API surface for the feature prompts

| Area | Reads (pages) | Mutations (Server Actions) |
|---|---|---|
| Explore | `getPlacesForUser(tripId)` → `PlaceWithVisits[] \| null` | `savePlace(tripId, placeId\|null)`, `deletePlace(tripId, placeId, "block"\|"detach")` |
| Itinerary | `getItineraryForUser(tripId)` → `ItineraryEntry[] \| null`; combine with `trip.reservations` in `buildAgenda` | `saveItineraryItem(tripId, itemId\|null)`, `reviewItineraryItem(tripId, itemId)`, `addReservationToItinerary(tripId, reservationId)`, `deleteItineraryItem(tripId, itemId)` |
| Packing | `getPackingForUser(tripId)` → `PackingCategoryWithItems[] \| null`; `getPackingSourcesForUser(tripId)` → `PackingSource[]` | `savePackingCategory`, `deletePackingCategory(tripId, id, choice)`, `savePackingItem`, `movePackingItem`, `setPackingItemPacked(tripId, id, packed)`, `unpackAllPackingItems`, `deletePackingItem`, `reorderPackingItems`, `reorderPackingCategories`, `applyPackingStarter(keys)`, `copyPackingFromTrip(tripId, { source_trip_id, categories })` |
| Memories | `getMemoriesForUser(tripId)` → `{ memory, visits } \| null`; capture candidates from `getItineraryForUser` + `trip.reservations` (`captureCandidates`) | `saveTripSummary(tripId)`, `saveTripAlbum(tripId)`, `removeTripAlbum(tripId)`, `captureExistingMoment(tripId, { itemId } \| { reservationId })`, `captureNewMoment(tripId)`, `deleteTripMemory(tripId)`; per-visit edits use `saveReflection` / `setItineraryFavorite` |

Form actions take `(tripId, id | null, prevState, formData)` like the
existing booking/document actions and return `ActionState`; `null` reads
mean "not found" (call `notFound()`).

## Architecture in brief

- **Auth (Neon Auth).** `createNeonAuth()` in `src/lib/auth/server.ts`.
  `/api/auth/[...path]` proxies the auth protocol to the branch's Neon Auth
  service. The browser client (`src/lib/auth/client.ts`) only calls that
  same-origin proxy. Sign-in: `authClient.signIn.social({ provider: "google",
  callbackURL })` → Google → Neon Auth → back to `callbackURL` with
  `?neon_auth_session_verifier=…`, which the proxy exchanges for cookies.
  `src/proxy.ts` runs Neon Auth's middleware on every app route (verifier
  exchange, session refresh, optimistic redirect to `/login?next=…`).
- **Session checks.** `getCurrentUser()` (`src/lib/user.ts`, per-request
  React `cache`) uses Neon Auth's server `getSession()`: it trusts the
  HS256-signed session cookie (`NEON_AUTH_COOKIE_SECRET`, 5-minute cache) or
  asks Neon Auth. Name/photo are display-only; `user.id` is the owner key.
- **Authorization.** No RLS: the app connects as one Postgres role, so RLS
  would not see the user. Instead every function in `src/lib/dal.ts`
  re-verifies the session (layouts/proxy are not trusted) and calls
  `src/db/queries.ts`, where every statement includes `owner_id = <verified
  id>`. Child rows also store `owner_id`; composite FKs make Postgres reject
  a booking/document on another user's trip, or a document pointing at
  another trip's booking. Bad/inaccessible IDs all return "not found".
- **Database.** Drizzle over node-postgres (`pg`), one small pool per server
  process on Neon's pooled URL (`src/db/index.ts`, server-only). Migrations
  with Drizzle Kit (`drizzle/`), `schemaFilter: ["public"]`.
- **Mutations.** Server Actions in `src/app/actions/*` validate `FormData`
  with Zod and return `ActionState` (`ok`, `message`, `fieldErrors`,
  `signedOut`). `guarded()` maps signed-out → "sign in again" (inputs
  kept), and DB errors → a generic message (details logged server-side).
  Forms use `useFormAction`, which keeps inputs on errors.
- **Caching.** No cross-request caching of user data: reads use React
  `cache` (per request), pages are dynamic, mutations `revalidatePath`.
- **Dates & time zones.** Trip dates are `date` (returned as strings, never
  parsed through UTC). Bookings store local `date` + `time` and an IANA zone
  per end; zone abbreviations are computed only for display. "Today" uses
  the viewer's zone (`rove-tz` cookie).
- **Trip workspace / imagery.** Unchanged from stage 1 (`TripWorkspace`
  context; curated cover photos, labelled illustrative).

## Data model

```
trips         id uuid, owner_id text, title, destination, start_date, end_date,
              time_zone (IANA), travelers text[], cover_image, notes, timestamps
reservations  id uuid, trip_id, owner_id, kind, status (confirmed|cancelled), title, provider,
              confirmation_code text, start_date, start_time, start_time_zone,
              end_date, end_time, end_time_zone, origin, destination, location,
              booking_url, notes, details jsonb, timestamps
documents     id uuid, trip_id, owner_id, reservation_id?, label, url, timestamps
places        id uuid, trip_id, owner_id, name, kind, category, priority,
              address?, maps_url?, website_url?, planning_notes?, timestamps
itinerary_items
              id uuid, trip_id, owner_id, place_id?, reservation_id? (unique),
              title?, category, local_date?, local_start_time?,
              local_end_date?, local_end_time?, timezone?, sort_order,
              status, planning_notes?, rating? (1–5), reflection?,
              is_favorite, completed_at?, timestamps
packing_categories
              id uuid, trip_id, owner_id, name, sort_order, timestamps
packing_items id uuid, trip_id, owner_id, category_id, label, quantity,
              traveler_name?, notes?, is_packed, sort_order, timestamps
trip_memories id uuid, trip_id (unique), owner_id, overall_rating?, summary?,
              favorite_moment?, would_return? (yes|no|undecided), lessons_for_next_time?,
              photo_album_url?, timestamps
```

`kind ∈ flight | lodging | car | train | activity | restaurant | other`.
Deleting a trip cascades to its reservations and documents; deleting a
reservation keeps its documents on the trip (`ON DELETE SET NULL
("reservation_id")`, a hand edit in the migration — needs Postgres 15+).
`owner_id` has no FK into `neon_auth` (Neon doesn't document that as
supported); it holds the Neon Auth user ID as text.

## Next prompt — suggested order

1. **Add Aruba recommendations** from the Explore tab, and **apply the
   Aruba plan** from the Itinerary tab (preview → Apply).
   Migrations are current on `production`; consider a separate dev branch
   for future stages.
2. **Signed-in smoke test** (`docs/local-setup.md`) of the whole flow in a
   browser: sign in → trip → flight + stay → Itinerary → Explore restaurant →
   schedule → rename → complete with rating → Memories / Explore visited →
   favorite + filter → packing + copy → reflection + album → refresh →
   sign out / in → a second Google account sees nothing.
3. Phone-sized check of dialogs with the on-screen keyboard open (Safari).
4. **Deploy** following `docs/vercel-deployment.md`.
5. **Household sharing**, **Google Drive API** — as before;
   sharing must replace the `owner_id` predicates in all queries, including
   the new tables.

## Known limitations / decisions

- No automatic sample trips or sample places/packing — the dashboard and
  every tab start empty by design.
- Travelers are free-text names (no accounts) until household sharing.
- `@neondatabase/auth` is a beta SDK (pinned to 0.5.0-beta). It depends on
  `@supabase/auth-js` internally (for its optional Supabase-compatible
  adapter); Atlas has no direct Supabase dependency.
- A revoked session can stay valid for up to 5 minutes via the signed
  session cache cookie (SDK default `sessionDataTtl`). Sign-out clears it
  immediately in that browser.
- Safari won't keep Neon Auth's `Secure` cookies on `http://localhost`.
- No dark mode; the visual direction is a light, ivory consumer site.
- Itinerary overlap hints compare same-day timed entries only; a stay's
  check-in/out never counts as a clash.
- "Save to Explore" maps itinerary categories to a generic place category
  (e.g. food → "Other" food) until the Explore form lets you refine it.
- Explore has no photos: places use category artwork. Real photos would
  need an upload/storage decision (no external image fetching).
- Packing filters and the selected category are client state (not in the
  URL), so a refresh shows all items again.
- Packing reorder uses menu "Move up / down" (no drag-and-drop) and is
  hidden while a filter is active.
- Copy / starter match items by name + traveler within a same-name
  category only; the same item in a different category is added again.
- The Explore search box keeps its text if you use browser back/forward
  past a search; the list itself always follows the URL.
- Memories phase ("before / during / after") uses today in the trip's zone;
  the header badge uses the viewer's zone, so they can differ by a day near
  midnight across zones.
- "Capture a moment" only offers days up to today; future plans are added
  in the Itinerary instead.
- The album card shows only the link's service name — Atlas never fetches
  it, so there's no preview, photo count or access check.

## Arjun's Aruba packing list (import)

- **Migration `0013_baby_packing`** (additive): `packing_items.quantity_text` (exact supplied wording: ranges, units, supply instructions), `packing_items.source_key` (stable import key) + partial unique index `(trip_id, source_key)`.
- **Data + planner:** `src/lib/baby-packing.ts` (pure). Sections are encoded in category names (`Cabin luggage — Arjun · Feeding`, `Checked luggage — Arjun · …`, `Airport / gate-check gear`, `Cabin essentials — Parents`). Key = section + category + label, so cabin and checked copies are separate rows. Matching: key → same category + label + traveler (adopts the key) → "ambiguous" if a similar item sits in another category (not added unless ticked).
- **Action:** packing "More" menu → "Add Arjun's Aruba packing list…" (preview in `BabyImportDialog`); `importBabyPacking` (editors/owner only) re-plans on the server in one transaction. Quantity differences are never applied unless ticked; packed state, notes and assignments are never touched. Adult assignment is never set.
- **Display:** `quantityLabel` (wording, else ×N). Editing the number clears `quantity_text`. Diaper total is derived (`diaperSummary`: 15 cabin + 30 checked = 45).
- **Not built:** collapsible luggage sections / section-level progress (categories are still flat), luggage-bag (diaper bag / carry-on) field; bag and section notes are shown in the import preview only.
