-- Investors' visit (Friday 16 October 2026, the day before NyamaFest Main).
-- The "Investors" link in the store navigation opens a form: salutation, name,
-- occupation, email, and the names of the people coming with them. The
-- organiser tracks the list in the dashboard (Events & tickets > Investors).
--
-- Not linked to an event row: the visit is its own day, and nothing here
-- touches event capacity, tickets or reservations.
--
-- Guests are stored as a list of names, not just a number, because the
-- organiser wants to know who is coming; guest_count is derived from it so the
-- two can never disagree.
--
-- One active registration per email (case-insensitive). The Edge Function never
-- overwrites an existing one from the public form — anyone who knows an email
-- address could otherwise rewrite someone else's guest list — it re-sends the
-- confirmation instead. Changes go through support or an admin.
--
-- Access: no public access at all (RLS on, no anon policies). Writes happen in
-- the investor-register Edge Function with the service role; staff read and
-- admins update (cancel / restore, notes) from the dashboard. There is no
-- SECURITY DEFINER function here, so no EXECUTE grants to lock down.

create table if not exists public.investor_registrations (
  id               uuid primary key default gen_random_uuid(),
  reference_number text not null unique,                       -- INV-XXXXXX, for support
  salutation       text not null check (salutation in ('Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Hon')),
  name             text not null check (length(btrim(name)) between 2 and 120),
  occupation       text not null check (length(btrim(occupation)) between 2 and 120),
  email            text not null check (public.looks_like_email(email)),
  guests           text[] not null default '{}' check (cardinality(guests) <= 10),
  guest_count      integer generated always as (cardinality(guests)) stored,
  status           text not null default 'registered' check (status in ('registered', 'cancelled')),
  admin_note       text check (admin_note is null or length(admin_note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Each guest name is a real name, not blank and not an essay. (A CHECK cannot
-- contain a subquery, hence the helper.)
create or replace function public.investor_guest_names_ok(p_guests text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(length(btrim(g)) between 2 and 120), true) from unnest(p_guests) g
$$;
-- Not SECURITY DEFINER and harmless, but keep the house rule of no PUBLIC
-- execute. The CHECK runs as whoever writes the row: the Edge Function
-- (service_role) on insert and an admin (authenticated) on update.
revoke execute on function public.investor_guest_names_ok(text[]) from public;
grant execute on function public.investor_guest_names_ok(text[]) to authenticated, service_role;

alter table public.investor_registrations
  drop constraint if exists investor_registrations_guest_names;
alter table public.investor_registrations
  add constraint investor_registrations_guest_names check (public.investor_guest_names_ok(guests));

create index if not exists investor_registrations_created_idx on public.investor_registrations (created_at desc);
create unique index if not exists investor_registrations_one_per_email
  on public.investor_registrations (lower(email)) where status = 'registered';

alter table public.investor_registrations enable row level security;
revoke all on table public.investor_registrations from anon, authenticated;
grant select, update on table public.investor_registrations to authenticated;

drop policy if exists investor_registrations_staff_read on public.investor_registrations;
create policy investor_registrations_staff_read on public.investor_registrations
  for select to authenticated using (public.is_staff());

drop policy if exists investor_registrations_admin_update on public.investor_registrations;
create policy investor_registrations_admin_update on public.investor_registrations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
