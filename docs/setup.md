# Setting up rove locally

rove needs one Supabase project (Postgres + Auth) and a Google OAuth client.
Nothing secret goes in the repository: the two values the app reads are the
public project URL and publishable key, kept in `.env.local` (git-ignored).

Allow about 15 minutes.

## 1. Create a Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Note the **Project URL** (`https://<project-ref>.supabase.co`) from
   **Project Settings → API Keys / Data API**.
3. Copy the **Publishable key** (`sb_publishable_…`) from
   **Project Settings → API Keys**.
   Do **not** use the secret / `service_role` key anywhere in this app.

## 2. Create the database schema

Open **SQL Editor → New query**, paste the full contents of
[`supabase/migrations/20261005120000_initial_schema.sql`](../supabase/migrations/20261005120000_initial_schema.sql)
and click **Run**.

(Alternatively, with the Supabase CLI: `supabase link --project-ref <ref>`
then `supabase db push`.)

This creates `trips`, `bookings` and `document_links`, enables Row Level
Security on all three, and adds owner-only policies.

Check: **Table Editor** shows the three tables, each marked "RLS enabled".
Under **Integrations → Data API → Settings**, make sure the `public` schema
is exposed (the default).

## 3. Create a Google OAuth client

1. Open <https://console.cloud.google.com/apis/credentials> (create or pick a
   project).
2. **OAuth consent screen**: user type *External*; app name "rove"; your
   email as support and developer contact. Scopes: `openid`, `email`,
   `profile` (the defaults). While the app is in *Testing*, add your own
   Google account under **Test users**.
3. **Credentials → Create credentials → OAuth client ID** → *Web application*.
   - **Authorized JavaScript origins:** `http://localhost:3000`
   - **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.

## 4. Enable Google in Supabase Auth

1. **Authentication → Sign In / Providers → Google**: enable, paste the Client
   ID and Client secret, save.
2. **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** add `http://localhost:3000/auth/callback`

The Google client secret lives only in Supabase; the app never sees it.

## 5. Configure the app

```bash
cp .env.example .env.local
```

Fill in:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## 6. Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, choose **Continue with Google**, and you should
land on your (empty) trips dashboard greeted by name.

If a dev server was already running, restart it after creating `.env.local`
so the variables are picked up.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in page says "Almost ready" | `.env.local` missing or dev server not restarted. |
| Google shows `redirect_uri_mismatch` | Google's redirect URI must be the **Supabase** callback (`…supabase.co/auth/v1/callback`), not localhost. |
| Back on `/login?error=callback` after Google | `http://localhost:3000/auth/callback` not in Supabase **Redirect URLs**, or the sign-in was started on a different host (e.g. `127.0.0.1` vs `localhost`). |
| "Access blocked: app not verified" | Add your account as a **Test user** on the consent screen. |
| Dashboard error "Could not load trips" | Migration not run, or `public` schema not exposed in Data API settings. |
