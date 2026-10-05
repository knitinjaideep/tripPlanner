# rove

A personal travel organizer: sign in with Google, keep each trip's flights,
stays and other reservations — with confirmation codes, notes and Google
Drive document links — in one calm, private place.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL + publishable key
npm run dev                  # http://localhost:3000
```

First-time Supabase and Google OAuth setup: **[docs/setup.md](docs/setup.md)**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, strict |
| `npm run lint` | ESLint |

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 ·
shadcn/ui (Radix) · Lucide · Supabase Postgres + Auth (`@supabase/ssr`) ·
Zod · date-fns.

## Docs

- [docs/implementation-status.md](docs/implementation-status.md) — what's built, architecture, next steps
- [docs/setup.md](docs/setup.md) — Supabase + Google sign-in setup
- [docs/image-credits.md](docs/image-credits.md) — photo sources and licences
