# Running rove locally

rove uses one **Neon** project for both Postgres (your trips) and **Neon Auth**
(Google sign-in). Everything secret lives in `.env.local`, which git ignores.
Allow about 15 minutes.

> **Use one branch for everything.** Each Neon branch has its own database
> *and* its own Auth URL, users and settings. Take `DATABASE_URL` and
> `NEON_AUTH_BASE_URL` from the same branch (for local work, a `development`
> branch is a good choice).

## 1. Create a Neon project

Go to <https://console.neon.tech> → **New project**. Any region works; pick
one near you. Postgres 15 or newer is required (the default, 17, is fine).

## 2. Pick the branch and database

New projects start with a `production` branch. For local development,
create a branch: **Branches → New branch** → name it `development`.
Use the default database (`neondb`) on that branch for every step below.

## 3. Get the connection strings

On the `development` branch, click **Connect**:

- With **Connection pooling ON**, copy the string → this is `DATABASE_URL`
  (its host contains `-pooler`). The app uses this.
- With pooling **OFF**, copy the string → this is `DATABASE_URL_UNPOOLED`
  (optional; migrations use it if present, otherwise `DATABASE_URL`).

## 4. Enable Neon Auth on that branch

With the `development` branch selected: **Auth → Enable Neon Auth**.
Then open **Auth → Configuration** and copy the **Auth URL** — it looks like
`https://ep-….neonauth.<region>.aws.neon.tech/neondb/auth`. This is
`NEON_AUTH_BASE_URL`.

Neon Auth keeps its users and sessions in a `neon_auth` schema in this
database. rove never creates, edits or migrates those tables.

## 5. Google sign-in

Google is enabled by default using **Neon's shared development
credentials**. For local development that is enough:

- No Google Cloud setup is needed.
- Limitation: Google's consent screen shows **Neon's** name and logo, not
  rove's.
- Neon says shared credentials are for development only; use your own
  Google OAuth client before any real launch.

rove asks only for basic identity (name, email, profile photo). It never
requests Google Drive or Gmail access — Drive documents are saved as plain
links.

**Optional — your own Google OAuth client** (for rove branding):

1. Google Cloud Console → **APIs & Services → OAuth consent screen**: app
   name "rove", your support email, scopes `openid`, `email`, `profile`
   only. While in *Testing*, add your Google account under **Test users**.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorized redirect URIs:** add exactly
   `<NEON_AUTH_BASE_URL>/callback/google`
   e.g. `https://ep-….neonauth.us-east-2.aws.neon.tech/neondb/auth/callback/google`.
   Copy the exact Auth URL from the Neon Console — this callback belongs to
   Neon Auth, not to rove, and is different from rove's `callbackURL`.
4. In Neon: **Auth → Configuration → OAuth providers → Google** → switch to
   custom credentials and enter the Client ID and Client secret there (in
   the dashboard only — never in `.env.local` or the repo).

## 6. Allow localhost

Neon Auth only redirects back to **trusted domains**. In
**Auth → Configuration → Domains**, make sure localhost is allowed
(the "Allow localhost" setting), or add `http://localhost:3000` as a
trusted domain. Use `localhost`, not `127.0.0.1`, consistently.

After Google, Neon Auth returns the browser to
`http://localhost:3000/trips?neon_auth_session_verifier=…` (or the page you
were heading to). rove's proxy exchanges that one-time verifier for session
cookies. There is no `/auth/callback` route to configure in rove.

**Browser note:** Neon Auth's session cookies are `Secure`. Chrome, Edge and
Firefox accept them on `http://localhost`; Safari does not. Use Chrome/Firefox
locally, or run `npm run dev -- --experimental-https` and allow
`https://localhost:3000` in Neon Auth.

## 7. Fill in `.env.local`

```bash
cp .env.example .env.local
openssl rand -base64 32   # paste the output as NEON_AUTH_COOKIE_SECRET
```

Then fill in `DATABASE_URL`, optionally `DATABASE_URL_UNPOOLED`, and
`NEON_AUTH_BASE_URL` from steps 3–4. Edit the file directly; don't paste
these values into chats or issue trackers.

| Variable | Used by | Secret? |
|---|---|---|
| `DATABASE_URL` | app (pooled) | yes |
| `DATABASE_URL_UNPOOLED` | migrations (optional) | yes |
| `NEON_AUTH_BASE_URL` | auth proxy, server session checks | no, but server-only |
| `NEON_AUTH_COOKIE_SECRET` | signs the session cache cookie | yes |

None of these use `NEXT_PUBLIC_`; the browser never sees them.

## 8. Apply the database migrations

```bash
npm install
npm run db:migrate
```

This applies `drizzle/*.sql` (reviewed SQL files, tracked in
`drizzle.__drizzle_migrations`): `0000` trips / reservations / documents,
`0001` places / itinerary / packing / trip memories, `0002` booking status,
`0003` "would you go back?" as `yes | no | undecided` (existing answers are
converted: true → yes, false → no). Everything lives in `public`. It never touches the `neon_auth` schema, and it is
safe to re-run.

When you change `src/db/schema.ts` later: `npm run db:generate`, **read the
generated SQL**, then `npm run db:migrate`. Don't use `drizzle-kit push`
against a database that has data in it.

## 9. Run the app

```bash
npm run dev    # http://localhost:3000
```

Restart the dev server whenever you change `.env.local`.

## 10. Sign in and create your first trip

Open <http://localhost:3000> → **Continue with Google** → choose your
account. You land on `/trips`, greeted by your Google first name and photo,
with an empty dashboard (no sample trips are created). Click **New trip**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Connect rove to Neon" screen | A variable is missing from `.env.local`, or the dev server wasn't restarted. The screen names what's missing. |
| Google shows `redirect_uri_mismatch` | Custom Google client only: the redirect URI must be exactly `<NEON_AUTH_BASE_URL>/callback/google` from the same branch. |
| After Google you don't come back to rove | `localhost` isn't a trusted domain for this branch (step 6). |
| Back on the sign-in page with "couldn't finish signing you in" | The verifier couldn't be exchanged: sign-in started on a different host (`127.0.0.1` vs `localhost`), cookies blocked (Safari on http), or the Auth URL is from a different branch. |
| "We couldn't check your session" | The server can't reach `NEON_AUTH_BASE_URL` (typo, offline). |
| Trips page errors after sign-in | Migrations not applied to this branch's database (`npm run db:migrate`). |

## Verifying authorization locally (optional)

`npm run test:authz` runs the ownership checks (two accounts, forged IDs,
cross-trip documents) against a **disposable** database you have migrated:

```bash
TEST_DATABASE_URL=postgres://… npm run test:authz
```

It creates records under random test owner IDs and deletes only those. Point
it at a scratch Neon branch or a local Postgres 15+, not at real data.

`npm run test:itinerary` checks the pure itinerary logic (calendar days,
time zones, booking de-duplication, milestones) and needs no database. Try
it with `TZ=Pacific/Kiritimati` and `TZ=Pacific/Pago_Pago` too.
`npm run test:explore` does the same for Explore's filters and helpers, and
`npm run test:packing` for packing progress, merges and the checkbox save queue,
and `npm run test:memories` for the journal (phase, counts, grouping, capture).

A quick disposable Postgres for `test:authz` (Homebrew `postgresql@17`):

```bash
initdb -D /tmp/rove-pg -U postgres --auth=trust
pg_ctl -D /tmp/rove-pg -o "-p 55432 -k ''" start
createdb -h localhost -p 55432 -U postgres rove_test
for f in drizzle/000*.sql; do psql -h localhost -p 55432 -U postgres rove_test -v ON_ERROR_STOP=1 -f "$f"; done
TEST_DATABASE_URL=postgres://postgres@localhost:55432/rove_test npm run test:authz
```
