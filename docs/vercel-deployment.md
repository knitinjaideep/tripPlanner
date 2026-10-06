# Deploying Atlas to Vercel

Target: **https://travel.nitinkotcherlakota.com** (Vercel project, Neon
`production` branch, Neon Auth with your own Google OAuth client).

Checked on 2026-10-06 against this repository (Next.js 16.3.8,
`@neondatabase/auth` 0.5.0-beta) and the current Neon Auth docs:
[production checklist](https://neon.com/docs/auth/production-checklist),
[trusted domains](https://neon.com/docs/auth/guides/configure-domains),
[OAuth setup](https://neon.com/docs/auth/guides/setup-oauth).

Do the steps in order. Step 1 changes the production database; the other
steps don't touch data.

---

## 0. What the app needs

### Environment variables (runtime, server-only)

| Name | Purpose | Vercel environments |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`) for the `production` branch. Every app query uses it (`src/db/index.ts`). | Production |
| `NEON_AUTH_BASE_URL` | The `production` branch's Neon Auth URL (`https://ep-….neonauth.us-east-2.aws.neon.tech/neondb/auth`). The `/api/auth/*` proxy and `getSession()` talk to it. | Production |
| `NEON_AUTH_COOKIE_SECRET` | Signs the session-cache cookie (HS256). At least 32 characters. Use a **new** value for production, not the one in `.env.local`. | Production |

Not needed on Vercel:

- `DATABASE_URL_UNPOOLED` is read only by `drizzle.config.ts` for
  `npm run db:migrate`. Migrations run from your machine (step 1), never
  during the build.
- `NEON_BRANCH` is in `.env.local` but nothing in the app reads it.
- `TEST_DATABASE_URL` is used only by `npm run test:authz`, against a
  disposable database.

None of these names starts with `NEXT_PUBLIC_`, so they never reach the
browser. When any is missing, the app shows a "Setup needed" page that lists
missing variable **names** (never values) instead of crashing.

### The public origin

**No variable sets the public origin.** The app takes it from each request:

- The Google button builds `callbackURL` / `errorCallbackURL` from
  `window.location.origin` (`src/app/login/google-button.tsx`).
- Redirects in `src/proxy.ts` and `redirect()` calls are relative or built
  from `request.url`.
- The Neon Auth SDK forwards the request's `Origin` (or `Referer`) header to
  Neon Auth.

**Neon Auth's trusted-domains list** decides which origins sign-in may
return to. For production it must contain exactly
`https://travel.nitinkotcherlakota.com`. There are no hardcoded `localhost`
URLs in `src/`, so local development (`http://localhost:3000`) keeps working
unchanged.

---

## 1. Neon: prepare the `production` branch

`.env.local` already points at the `production` branch of your Neon project
(region `us-east-2`). It holds real data.

### 1a. Back up, then apply the pending migration

| Migration | On `production`? |
|---|---|
| `0000_initial_schema` | applied |
| `0001_trip_features` | applied |
| `0002_reservation_status` | applied |
| `0003_memories_would_return` | **pending** |

`0003` changes `trip_memories.would_return` from `boolean` to `text`
(`true` → `yes`, `false` → `no`, null stays null) and adds a CHECK. It keeps
your data and deletes nothing. The deployed code needs it: until it's
applied, saving "Would you go back?" fails.

1. Neon Console → project → **Backup & Restore** (or **Branches → New
   branch** from `production`, named `pre-0003-backup`). This gives you a
   restore point.
2. From your machine, with `.env.local` still pointing at `production`:
   ```bash
   npm run db:check     # expect "Everything's fine"
   npm run db:migrate   # uses DATABASE_URL_UNPOOLED; applies only 0003
   ```
3. Check that the Neon Console → **Tables → trip_memories** column
   `would_return` is now `text`.

Never run `drizzle-kit push` or a branch reset against `production`.

### 1b. Neon Auth on the `production` branch

Neon Console → select the **`production`** branch → **Auth** (Settings →
Auth / Configuration):

1. **Trusted domains:** add `https://travel.nitinkotcherlakota.com`
   (with the scheme, no trailing slash). Or use the CLI:
   `neon neon-auth domain add https://travel.nitinkotcherlakota.com`
   (on the production branch).
2. **OAuth providers → Google:** switch from shared credentials to your own
   Client ID and Client secret (from step 2). Enter them only here, never in
   Vercel or the repo.
3. **Application name:** `atlas`.
4. **Allow localhost:** turn this **off** on `production` once you do local
   development on a separate branch (1c). While it is on, a local dev server
   can complete sign-in against production users.
5. Email/SMTP and email verification: Atlas offers Google sign-in only, so
   the custom-SMTP item in Neon's checklist doesn't apply yet.
6. Copy the **Auth URL**. It becomes `NEON_AUTH_BASE_URL` in Vercel.

### 1c. Recommended: a separate development branch

Today, local development uses the production branch. Create a branch named
`development` from `production`, enable Neon Auth on it (Neon's shared Google
credentials and "Allow localhost" are fine there), and point `.env.local` at
its `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `NEON_AUTH_BASE_URL`. Each
branch has its own users, so you'll sign in again there.

---

## 2. Google Cloud: your own OAuth client

Google Cloud Console → a project for Atlas:

1. **Google Auth Platform → Branding:** app name `atlas`, your support email,
   app home page `https://travel.nitinkotcherlakota.com`, authorized domain
   `nitinkotcherlakota.com`, developer contact email. Add privacy-policy and
   terms links if you publish the app.
2. **Data access (scopes):** `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile` only. Atlas never asks for Drive or Gmail.
3. **Clients → Create client → Web application**, name `atlas production`:
   - **Authorized JavaScript origins:** `https://travel.nitinkotcherlakota.com`
   - **Authorized redirect URIs:** `<NEON_AUTH_BASE_URL>/callback/google`,
     using the **production** branch's Auth URL. For example:
     `https://ep-….neonauth.us-east-2.aws.neon.tech/neondb/auth/callback/google`.
     This callback belongs to Neon Auth, not to Atlas.
4. Copy the Client ID and secret into Neon (step 1b-2).
5. **Audience:** while the app is in *Testing*, only listed **test users**
   can sign in, so add your Google account(s). To let anyone sign in,
   **Publish app**. With only the basic scopes, verification is usually
   quick but can take a few business days.

---

## 3. Vercel: create the project

Vercel dashboard → **Add New → Project** → import the Git repository.

| Setting | Value | Why |
|---|---|---|
| Framework preset | **Next.js** | Detected from `next` in `package.json`. |
| Root directory | `./` (repository root) | Not a monorepo. |
| Install command | default (`npm ci` / `npm install`) | `package-lock.json` is committed; `npm ci --dry-run` validates it. |
| Build command | default (`npm run build` → `next build`) | No `prebuild`/`postbuild`/`postinstall` hooks. The build runs no migrations or seeds and writes no data. |
| Output directory | default (`.next`) | |
| Node.js version | **22.x** | Pinned in `package.json` `engines` (what the app is tested on). Vercel reads `engines`, so the dashboard setting is overridden. 24.x should also work; change `engines` if you move. |
| Function region | **`cle1` (Cleveland)** | Settings → Functions. Puts functions next to the Neon database in `us-east-2` (Ohio). The default `iad1` also works, with a few ms more per query. |

Don't add a `vercel.json` / `vercel.ts`; the defaults are correct.

### Environment variables

Settings → Environment Variables. Add the three variables from section 0
with scope **Production only**, and mark each one **Sensitive**:

```
DATABASE_URL              = <production branch, pooled, ?sslmode=require&channel_binding=require>
NEON_AUTH_BASE_URL        = <production branch Auth URL>
NEON_AUTH_COOKIE_SECRET   = <output of: openssl rand -base64 32>
```

- Take `DATABASE_URL` from Neon → `production` → **Connect** with
  **Connection pooling ON**. The app upgrades `sslmode=require` to
  certificate-verified TLS itself (`withVerifiedSsl`).
- Set these by hand rather than through Vercel's Neon Marketplace
  integration. The integration writes its own `DATABASE_URL`/`PG*`
  variables, can create a database branch per preview, and doesn't set the
  matching `NEON_AUTH_BASE_URL`. A preview could then pair one branch's
  database with another branch's users.

### Preview deployments

Preview deployments get **no** environment variables, so they show
"Setup needed" and can't touch production data or users. That is
deliberate. If you later want working previews, give the **Preview** scope
the `development` branch's three values, add a narrow preview wildcard
(e.g. your team's `https://*-<team-slug>.vercel.app`, never a bare
`https://*.vercel.app`) to that branch's trusted domains, and keep Vercel
Deployment Protection on for previews.

---

## 4. Domain and DNS

1. Vercel → project → **Settings → Domains → Add**
   `travel.nitinkotcherlakota.com`, assigned to Production.
2. At your DNS provider for `nitinkotcherlakota.com`, add the record Vercel
   shows. It is normally:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `travel` | the target Vercel displays (e.g. `cname.vercel-dns.com` or a project-specific `…vercel-dns…` host) | default / 3600 |

   - Use the exact target shown in the Vercel dashboard.
   - On Cloudflare, set the record to **DNS only** (grey cloud) so Vercel can
     issue the certificate and see the real host.
   - If the apex has **CAA** records, make sure one allows `letsencrypt.org`.
   - Don't change the apex or other subdomains. Atlas sets no cookies on them
     (see section 6).
3. Wait until Vercel shows the domain as **Valid Configuration** with a
   certificate issued.

The automatic `*.vercel.app` production URL keeps serving the app, but
sign-in only works on the trusted custom domain. Share only
`https://travel.nitinkotcherlakota.com`.

---

## 5. Deploy and smoke test

1. Do steps 1–4 first. Then deploy: push to the production branch of the
   Git repo, or click **Deploy**.
2. Signed out, open `https://travel.nitinkotcherlakota.com/trips/x/itinerary?day=2026-01-01`.
   Expect a redirect to `/login?next=…`.
3. **Continue with Google.** The consent screen says *Atlas*, not Neon. You
   land back on the requested page.
4. DevTools → Application → Cookies → `travel.nitinkotcherlakota.com`:
   the `__Secure-neon-auth.*` cookies are `Secure`, `HttpOnly`,
   `SameSite=Lax`, and their Domain is `travel.nitinkotcherlakota.com`
   (host-only, no leading dot).
5. Your existing trip is visible. Create, edit and delete a test trip. Open
   Memories → "Would you go back?" → save (proves `0003` is applied).
6. Reload, then sign out and back in. Sign in with a second Google account
   (a test user while in Testing) and confirm it sees no trips.
7. Cover photos load on the dashboard and login page.

Rollback: Vercel → Deployments → previous deployment → **Promote**. The
database change from `0003` stays; the backup branch from 1a is your restore
point.

---

## 6. Production review (what was verified, 2026-10-06)

- **Checks:** `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run db:check` pass. `npm run test:authz` passes 101 checks against a
  disposable local Postgres 17 with migrations 0000–0003. `test:itinerary`
  (18), `test:explore` (7), `test:packing` (22) and `test:memories` (10) pass.
- **Hardcoded URLs:** none in auth, redirects, links or callbacks. The only
  fixed URL is `http://rove.invalid`, a parsing base in `safeNextPath` that
  is never emitted.
- **Neon Auth SDK** (`createNeonAuth` from `@neondatabase/auth/next/server`)
  is set up as Neon documents: `baseUrl` + `cookies.secret`, the
  `/api/auth/[...path]` handler, and `auth.middleware()` in `src/proxy.ts`.
  Production requirements from Neon's checklist (trusted domain, own Google
  credentials, app name, localhost off) are dashboard settings, covered in
  step 1b.
- **Cookies:** the SDK always sets the `__Secure-` prefix, `Secure`,
  `HttpOnly` and `SameSite=Lax`. Atlas passes no `cookies.domain`, so the
  cookies are **host-only** for `travel.nitinkotcherlakota.com` and are never
  sent to sibling subdomains or the apex. Sign-out clears them with the same
  attributes. The non-sensitive `rove-tz` preference cookie is host-only
  and now also `Secure` on HTTPS.
- **Server-only database access:** `src/db/index.ts` imports `server-only`.
  `@/db` is imported only by `src/lib/dal.ts` (`src/lib/types.ts` uses
  `import type` from the schema). Every DAL function re-verifies the
  session and passes the verified user ID into owner-scoped queries.
  `test:authz` enforces this statically and with cross-owner tests.
- **No cross-user caching:** there is no `"use cache"`, `unstable_cache`,
  `fetch` caching or `revalidate` export. Reads use React `cache()` (one
  request only). Every authenticated route is dynamic (`ƒ` in the build
  output), and responses carry
  `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`,
  so Vercel's CDN doesn't store them.
- **Build safety:** `npm run build` is just `next build`. The database pool
  is created lazily on the first request, so the build opens no database
  connection and runs no migrations or seeds. No sample data exists in the
  code.
- **Assets:** cover photos are local files in `public/images/covers`,
  imported statically and served through `next/image` (no
  `remotePatterns` needed). Fonts are self-hosted by `next/font` at build
  time. Google profile photos load as plain `<img>` from Google with
  `referrerPolicy="no-referrer"`. No asset references localhost.
- **SDK note:** `@neondatabase/auth` is pinned at `0.5.0-beta`. Re-check the
  Neon Auth docs before upgrading it.
