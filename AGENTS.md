<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Atlas project notes

- Read `docs/implementation-status.md` first — it records what is built, the architecture, and the next steps.
- Stack: Neon Postgres + Neon Auth (`@neondatabase/auth`), Drizzle ORM over node-postgres. No Supabase, no RLS.
- All database access is server-only and goes through `src/lib/dal.ts`, which verifies the session in every function and passes the verified Neon Auth user ID to the owner-scoped queries in `src/db/queries.ts`. Never import `@/db` anywhere else, never from a Client Component, and never add a generic query action/route.
- New tables follow the existing pattern: `owner_id text not null`, composite FK `(trip_id, owner_id)` → `trips(id, owner_id)`, every query constrained by `owner_id`. Never FK into or migrate the `neon_auth` schema.
- Schema changes: edit `src/db/schema.ts`, `npm run db:generate`, review the SQL, `npm run db:migrate`. No `drizzle-kit push` against real data.
- Mutations are Server Actions in `src/app/actions/*`, validated with Zod in `src/lib/validation.ts`, wrapped in `guarded()`.
- Booking times are local wall-clock values plus an IANA zone; do not convert them through UTC.
- Run `npm run test:authz` (disposable DB) after touching queries or the DAL.
- Update `docs/implementation-status.md` at the end of each stage.
