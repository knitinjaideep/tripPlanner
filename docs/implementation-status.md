# rove — implementation status

_Last updated: 2026-10-06 (deployment readiness for Vercel)._

This file is the hand-off point for later prompts: what exists, how it is
put together, and what comes next.

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
- **Migration `0003` is still pending on the Neon `production` branch**
  (0000–0002 applied; checked read-only). Apply it before the first deploy.
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
| ✅ | Photo album | Add / change / remove / open an https link (Zod: https, real domain, no credentials). Shows the service name only; copy says rove can't see inside the album. No uploads, imports, Drive API or new OAuth scopes. Removing the link never touches the album. |
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

1. **Apply migration 0003** to the database in `.env.local` once you've
   confirmed which branch it is (`npm run db:migrate`). It's named
   `production`; consider a separate dev branch for future stages.
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
  adapter); rove has no direct Supabase dependency.
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
- The album card shows only the link's service name — rove never fetches
  it, so there's no preview, photo count or access check.
