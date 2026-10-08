# Evening preview of tomorrow — setup and operations

Each member can opt in, per trip, to one short message each trip evening:
tomorrow's saved plan (up to three highlights, first start time) and at most
one question still waiting for their answer. It arrives in the Atlas inbox and,
optionally, by email.

**Status of this repository: the worker and its secure trigger are built and
tested, but nothing runs on a schedule until you complete the setup below.**
The app says so honestly: in the "Evening preview" dialog, a yellow note
("Scheduled delivery isn't running for this app yet") shows until the job has
completed a run within the last 2 hours (it reads `scheduler_heartbeats`).

## What was inspected

- Deployment: Vercel (`docs/vercel-deployment.md`), Next.js 16 on the Node.js
  runtime, Neon Postgres. There is **no** existing job runner, no `vercel.json`
  / `vercel.ts`, and no queue in the repo.
- Email: the only transactional provider is Resend, already used for
  invitations (`APP_ORIGIN`, `RESEND_API_KEY`, `INVITE_EMAIL_FROM`). Evening
  email reuses exactly that configuration — no new provider, no new variable.
  Push notifications were not added.
- No quiet-hours feature exists, so none is applied (the choosable send times
  are already limited to 4:00–10:00 PM trip time).

## How it works

- `GET|POST /api/cron/evening-preview` is the trigger. It has no user session;
  it requires `Authorization: Bearer $CRON_SECRET` (constant-time comparison)
  and refuses everything (503) when `CRON_SECRET` is unset or shorter than 16
  characters. It bypasses the sign-in proxy on purpose (`src/proxy.ts`).
- Each call is one idempotent pass (`runEveningPreviews`). For every opted-in
  person it works out **tomorrow on the trip's own calendar** (date arithmetic
  on the local date, so DST can't shift it), and acts only if tomorrow is a
  trip day (the evening before day one counts; nothing after the last day),
  the current local time is within **3 hours after** their chosen time
  (later than that the night is recorded as `skipped / stale` and never sent
  late), and they are *still a member* with the preference still on.
  After an outage there is no backlog: only tonight's target date is ever
  considered.
- Delivery ledger `evening_preview_deliveries`, unique per
  (trip, person, target date, channel).
  - **In-app:** the ledger row and the inbox notification commit in one
    transaction; concurrent workers, reruns and restarts end with exactly one
    notification (also deduplicated by the notification service's key).
  - **Email:** the worker claims the row with a 5-minute lease, re-checks the
    preference and membership, sends with an `Idempotency-Key`
    (`evening-preview:<trip>:<user>:<date>`), then records the result. Failures
    are retried by later runs, at most 3 attempts, only while the preview is
    still inside its window.
- Content is composed from saved data only (no LLM, no weather, hours or
  travel times). It contains titles and times and one poll question — never
  addresses, confirmation numbers, document links, notes or invitation tokens.
  It is a snapshot ("As of 7:05 PM AST"); its link opens the current plan. Later
  edits use the existing plan-change notifications; the digest is never resent.

## Setup (required, once)

1. Generate a secret and set it in Vercel (Production):
   ```bash
   openssl rand -base64 32          # → CRON_SECRET
   vercel env add CRON_SECRET production
   ```
2. Apply migrations `0007`–`0009` (`npm run db:migrate`) on the Neon branch the
   app uses, then redeploy.
3. Make something call the endpoint **every 15 minutes** (the job is cheap and
   idempotent; the 3-hour window means a missed call is harmless). Choose one:

   **A. Vercel Cron (Pro plan or higher).** Create `vercel.json`:
   ```json
   { "crons": [{ "path": "/api/cron/evening-preview", "schedule": "*/15 * * * *" }] }
   ```
   Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. **Hobby
   plans only allow once-a-day crons** — a `*/15` schedule makes the deployment
   fail there, which is why this file was not added for you. On Hobby use B.

   **B. Any external pinger** (GitHub Actions `schedule:`, cron-job.org, a
   server's crontab):
   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
     https://travel.nitinkotcherlakota.com/api/cron/evening-preview
   ```
4. Check it works: the call returns JSON counts, e.g.
   `{"considered":3,"due":1,"inAppCreated":1,…}`, and within a minute the
   "Evening preview" dialog stops showing the "isn't running yet" note.

Optional email: set `APP_ORIGIN`, `RESEND_API_KEY`, `INVITE_EMAIL_FROM` (the
same variables as invitations). Without them the email checkbox is disabled
with an explanation and the inbox delivery is unaffected.

## How to enable it as a traveler

Open a trip → **Evening preview** (moon button in the trip header) → read the
sample → tick "Send me an evening preview of tomorrow", pick a time (suggested
7:00 PM, shown in the trip's zone, e.g. Aruba `America/Aruba` AST), choose
inbox and/or email → Save. "Turn off previews" is in the same dialog; email
messages link straight to it.

## Dry runs (no messages, no writes)

- Operator CLI (needs database credentials):
  ```bash
  npm run evening:dry-run -- --trip <trip-uuid> --user <user-id> --date 2026-10-15
  ```
- Through the trigger, behind the same secret:
  `POST /api/cron/evening-preview?dryRun=1&trip=<uuid>&user=<id>&at=2026-10-14T23:05:00Z`
  returns what *would* be delivered at that moment.
- Ordinary users can only see a sample for **themselves** (the dialog); there is
  no user-facing way to trigger or preview anyone else's.

## Limits (be honest about them)

- Scheduled delivery is **not active until step 3 is done**.
- Inbox delivery is exactly-once per person, trip and date. Email is
  **at-least-once with provider-side deduplication**: if a worker crashes after
  the provider accepted a message but before it is recorded, the retry uses the
  same idempotency key, which Resend honours only within its own window (about
  24 hours). A duplicate email in that rare case is possible.
- The email goes to the address saved on the person's Atlas profile (taken from
  their sign-in). It is not separately re-verified.
- The job's clock is the database's `now()` for leases and the worker's clock
  for "is it 7 PM in the trip's zone"; keep the host clock sane.
- Poll mention rule 2 ("closing soon") means: open, unanswered by that person,
  deadline within about 36 hours and *before* the activity / day / planned
  place visit it is about. Trip-level polls without a date are never raised.
