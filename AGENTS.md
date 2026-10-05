<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# rove project notes

- Read `docs/implementation-status.md` first — it records what is built, the architecture, and the next steps.
- All data access goes through Supabase as the signed-in user; RLS is the privacy boundary. Never use a service-role key in app code.
- New tables follow the existing pattern: `owner_id default auth.uid()`, composite FK `(trip_id, owner_id)` → `trips(id, owner_id)`, owner-only RLS with `(select auth.uid())`.
- Mutations are Server Actions in `src/app/actions/*`, validated with Zod in `src/lib/validation.ts`.
- Booking times are local wall-clock values; do not convert them through UTC.
- Update `docs/implementation-status.md` at the end of each stage.
