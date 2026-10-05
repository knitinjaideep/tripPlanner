-- rove: initial schema — trips, bookings, and document links.
--
-- Every row belongs to exactly one owner (auth.users). Row Level Security
-- restricts all reads and writes to that owner. Composite foreign keys
-- (child.trip_id, child.owner_id) -> trips(id, owner_id) guarantee at the
-- database level that a booking or document can only hang off a trip owned
-- by the same user.
--
-- Reservation times are stored as local wall-clock values (date + time
-- without zone): "departs 08:20 in Newark, arrives 13:15 in Aruba" is what a
-- ticket says, and converting through UTC would show the wrong hour to
-- anyone viewing from another zone.

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  destination text not null check (char_length(destination) between 1 and 120),
  start_date date not null,
  end_date date not null,
  travelers text[] not null default '{}' check (cardinality(travelers) <= 20),
  cover_image text not null default 'beach' check (char_length(cover_image) <= 40),
  notes text check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_dates_ordered check (end_date >= start_date),
  constraint trips_id_owner_unique unique (id, owner_id)
);

create index trips_owner_start_idx on public.trips (owner_id, start_date);

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (
    kind in ('flight', 'lodging', 'car', 'train', 'activity', 'restaurant', 'other')
  ),
  title text not null check (char_length(title) between 1 and 160),
  provider text check (char_length(provider) <= 120),
  confirmation_code text check (char_length(confirmation_code) <= 80),
  start_date date,
  start_time time,
  end_date date,
  end_time time,
  origin text check (char_length(origin) <= 120),
  destination text check (char_length(destination) <= 120),
  location text check (char_length(location) <= 240),
  booking_url text check (booking_url ~ '^https://' and char_length(booking_url) <= 2048),
  notes text check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_dates_ordered check (
    end_date is null or start_date is null or end_date >= start_date
  ),
  constraint bookings_id_owner_unique unique (id, owner_id),
  constraint bookings_trip_same_owner
    foreign key (trip_id, owner_id) references public.trips (id, owner_id) on delete cascade
);

create index bookings_trip_start_idx on public.bookings (trip_id, start_date, start_time);
create index bookings_owner_idx on public.bookings (owner_id);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- document_links (e.g. Google Drive files), optionally tied to one booking
-- ---------------------------------------------------------------------------
create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  booking_id uuid,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  url text not null check (url ~ '^https://' and char_length(url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_links_trip_same_owner
    foreign key (trip_id, owner_id) references public.trips (id, owner_id) on delete cascade,
  -- Deleting a booking keeps its documents on the trip (only booking_id is nulled).
  constraint document_links_booking_same_owner
    foreign key (booking_id, owner_id) references public.bookings (id, owner_id)
    on delete set null (booking_id)
);

create index document_links_trip_idx on public.document_links (trip_id, created_at);
create index document_links_booking_idx on public.document_links (booking_id);
create index document_links_owner_idx on public.document_links (owner_id);

create trigger document_links_set_updated_at
  before update on public.document_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges: signed-in users only; anon gets nothing.
-- ---------------------------------------------------------------------------
revoke all on public.trips, public.bookings, public.document_links from anon;
grant select, insert, update, delete
  on public.trips, public.bookings, public.document_links
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only on every operation.
-- ---------------------------------------------------------------------------
alter table public.trips enable row level security;
alter table public.bookings enable row level security;
alter table public.document_links enable row level security;

create policy "Owners can read their trips" on public.trips
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can create trips" on public.trips
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update their trips" on public.trips
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete their trips" on public.trips
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Owners can read their bookings" on public.bookings
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can create bookings" on public.bookings
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update their bookings" on public.bookings
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete their bookings" on public.bookings
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Owners can read their documents" on public.document_links
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can create documents" on public.document_links
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update their documents" on public.document_links
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Owners can delete their documents" on public.document_links
  for delete to authenticated using ((select auth.uid()) = owner_id);
