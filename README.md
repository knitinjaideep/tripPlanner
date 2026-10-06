# rove

A personal travel organizer: sign in with Google, keep each trip's flights,
stays and other reservations — with confirmation codes, local times and time
zones, notes and Google Drive document links — in one calm, private place.

Each trip has six tabs: **Overview** (re-weighted before / during / after the
trip), **Itinerary** (bookings and plans merged day by day), **Bookings**,
**Explore** (your own list of places and food), **Packing** (a shared
checklist), and **Memories** (a journal built from what you marked as done,
plus a trip reflection and a link to your photo album).

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in Neon DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
npm run db:migrate           # create the app tables
npm run dev                  # http://localhost:3000
```

First-time Neon + Google sign-in setup: **[docs/local-setup.md](docs/local-setup.md)**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, strict |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` (review the SQL!) |
| `npm run db:migrate` | Apply migrations in `drizzle/` |
| `npm run db:check` | Check migration files are consistent |
| `npm run test:authz` | Ownership/authorization checks against a disposable DB (`TEST_DATABASE_URL`) |
| `npm run test:itinerary` | Pure itinerary logic checks (dates, zones, de-duplication) — no DB |
| `npm run test:explore` | Pure Explore checks (URL filters, visit states, duplicate hints, maps links) — no DB |
| `npm run test:packing` | Pure packing checks (progress, merges, checkbox save queue) — no DB |
| `npm run test:memories` | Pure Memories checks (trip phase, counts, day grouping, capture candidates, schemas) — no DB |

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 ·
shadcn/ui (Radix) · Lucide · Neon Postgres · Neon Auth (`@neondatabase/auth`,
Google) · Drizzle ORM + Drizzle Kit (node-postgres) · Zod · date-fns.

## Docs

- [docs/implementation-status.md](docs/implementation-status.md) — what's built, architecture, next steps
- [docs/local-setup.md](docs/local-setup.md) — Neon, Neon Auth and Google sign-in setup
- [docs/vercel-deployment.md](docs/vercel-deployment.md) — production deployment to Vercel (travel.nitinkotcherlakota.com)
- [docs/image-credits.md](docs/image-credits.md) — photo sources and licences
