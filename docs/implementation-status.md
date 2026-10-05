# rove — implementation status

_Last updated: 2026-10-05 (stage 1: foundation)._

This file is the hand-off point for later prompts: what exists, how it is
put together, and what comes next.

## Stage 1 checklist

| | Item | Notes |
|---|---|---|
| ✅ | Next.js 16 App Router, TypeScript strict, Tailwind 4, shadcn/ui (Radix), Lucide | Versions pinned exactly; `package-lock.json` committed. |
| ✅ | Design tokens (ivory / navy / teal / coral / sun / lavender) | `src/app/globals.css`. Teal text and coral buttons darkened for WCAG AA. |
| ✅ | Fonts: Fraunces (display serif) + DM Sans (UI) | `next/font/google`, self-hosted at build. |
| ✅ | Supabase SSR clients + session-refreshing proxy | `src/lib/supabase/*`, `src/proxy.ts`. |
| ✅ | Google sign-in (PKCE), callback, sign-out | `src/app/login`, `src/app/auth/callback`, `src/app/actions/auth.ts`. |
| ✅ | Database schema + RLS | `supabase/migrations/20261005120000_initial_schema.sql`. |
| ✅ | Personalized dashboard (greeting, avatar, current/upcoming/past, empty state) | `src/app/(app)/trips/page.tsx`. |
| ✅ | Trip create / edit / delete | Dedicated pages `/trips/new`, `/trips/[id]/edit`; delete from hero menu. |
| ✅ | Trip overview (hero, tabs, flight pass, stay, glance, coming up, documents, notes) | `src/app/(app)/trips/[tripId]/(tabs)/page.tsx`, `src/components/trip/overview-cards.tsx`. |
| ✅ | Bookings: add / view / edit / delete, 7 kinds | Side sheet; `/trips/[id]/bookings` lists all by day. |
| ✅ | Confirmation codes (copy), notes, booking links | Stored per booking. |
| ✅ | Document links (Drive-aware), per trip or per booking | Dialog form; edit/remove from row menu. |
| ✅ | Loading skeletons, error boundary, not-found pages, toasts | |
| ✅ | Coming-soon tabs (Itinerary, Explore, Packing, Memories) | Rendered inert with `aria-disabled`, no routes. |
| ✅ | Local, licensed imagery with credits | `public/images/covers/`, `docs/image-credits.md`. |
| ⏳ | **Real Supabase project + Google OAuth credentials** | Not available in the build environment. Follow `docs/setup.md`. |
| ⏳ | End-to-end sign-in test against a live project | Blocked on the item above. |

Checks run at the end of stage 1: `npm run typecheck`, `npm run lint`,
`npm run build` — all pass. UI verified visually at 1440px, 1280px and 390px
by rendering the real components with sample data on a throwaway route (since
removed); no horizontal overflow on mobile.

## Architecture in brief

- **Auth.** `@supabase/ssr` with cookie sessions. `src/proxy.ts` refreshes the
  session on every request (`getClaims()`) and optimistically redirects
  signed-out visitors to `/login`. Pages call `requireUser()`
  (`src/lib/user.ts`) and every Server Action re-verifies via `authedClient()`.
  Display name/avatar come from Google `user_metadata` and are used for
  display only — never for authorization.
- **Data access.** All reads/writes run as the signed-in user, so Postgres RLS
  is the privacy boundary. Composite foreign keys `(trip_id, owner_id)` stop a
  booking/document from being attached to another user's trip even if a
  policy were mis-edited. `src/lib/data.ts` holds the cached server reads.
- **Mutations.** Server Actions in `src/app/actions/*` validate `FormData`
  with Zod (`src/lib/validation.ts`) and return `ActionState`
  (`ok`, `message`, `fieldErrors`). Forms use `useFormAction`
  (`src/components/forms/use-form-action.ts`), which submits via a transition so
  React does not reset the form on validation errors.
- **Dates & time zones.** Trip dates are `date`; booking moments are local
  wall-clock `date` + `time` (what the ticket says), never shifted through
  UTC. "Today" (countdowns, grouping, greeting) uses the viewer's IANA zone,
  which `TimeZoneSync` writes to the `rove-tz` cookie.
- **Trip workspace.** `TripWorkspace` (client context) owns the booking sheet,
  document dialog and delete confirmations for a trip. Server components
  render small trigger buttons (`AddBookingButton`, `ViewBookingButton`,
  `AddDocumentButton`).
- **Imagery.** Eight curated cover photos chosen per trip
  (`src/lib/covers.ts`). The stay card reuses the trip cover and is labelled
  "Illustrative destination photo" — it never claims to show the actual hotel.

## Data model

```
trips          id, owner_id, title, destination, start_date, end_date,
               travelers text[], cover_image, notes, timestamps
bookings       id, trip_id, owner_id, kind, title, provider, confirmation_code,
               start_date, start_time, end_date, end_time,
               origin, destination, location, booking_url, notes, timestamps
document_links id, trip_id, booking_id?, owner_id, label, url, timestamps
```

`kind ∈ flight | lodging | car | train | activity | restaurant | other`.
Deleting a trip cascades to its bookings and documents; deleting a booking
keeps its documents on the trip (only `booking_id` is cleared).

## Next prompt — suggested order

1. **Connect a live project** (follow `docs/setup.md`), then smoke-test:
   sign in → create trip → add flight + stay → add Drive link → edit → delete
   → sign out/in → data persists. Try a second Google account to confirm it
   sees nothing.
2. **Itinerary editor** — new `itinerary_items` table (trip_id, owner_id, day
   date, time, title, notes, optional booking_id, sort order). Enable the
   Itinerary tab in `src/components/trip/trip-tabs.tsx` by adding an `href`.
   Bookings can seed the timeline.
3. **Explore / saved places** (activities & food), then **Packing** checklists,
   then **Memories & ratings** — each gets its own table with the same
   owner-only RLS + composite FK pattern.
4. **Household sharing** — introduce `households` / `trip_members`; replace
   owner-only policies with membership checks (security-definer helper in a
   private schema, per Supabase guidance). `owner_id` stays as creator.
5. **Google Drive API** — optional picker/metadata on top of `document_links`
   (currently plain https links; Drive URLs are only detected for icons).
6. **Deployment** — add the production URL to Supabase Redirect URLs and
   Google origins; review `x-forwarded-host` handling in the auth callback.

## Known limitations / decisions

- No automatic sample trips — the dashboard starts empty by design.
- Travelers are free-text names (no accounts) until household sharing.
- Booking times have no time-zone field; they display exactly as entered.
- No dark mode; the visual direction is a light, ivory consumer site.
- Supabase TypeScript types are hand-written (`src/lib/types.ts`); generate
  them with `supabase gen types` once the CLI is linked.
