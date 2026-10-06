-- Occasion booking ("Celebrations"): birthdays, anniversaries, graduations,
-- weddings, baby showers, family gatherings, corporate days. Phase 1 of the
-- plan agreed on 2026-10-07: request -> the team calls back with a plan and a
-- quote -> confirmed. There are no prices here on purpose: the organiser has
-- not set packages or a deposit rule yet, and nothing on the site may invent
-- them. Paystack deposits/instalments are phase 2, once those rules exist.
--
-- This replaces the parked sketch in drafts/celebrations.sql and fixes the
-- three problems listed there:
--   * no public read of bookings: RLS on, anon has no access at all; the guest
--     sees their own request only through the celebration-request Edge
--     Function, by its 32-hex access_token (a bearer link, like a pass)
--   * no unprotected payment function: there is no function at all, so
--     nothing to lock down (no SECURITY DEFINER, no EXECUTE grants)
--   * the CB- reference is for phone support only, never a lookup key
--
-- Writes: the Edge Function (service role) creates a request and lets the
-- guest cancel it while it is still open. Staff read every request and update
-- only the follow-up columns (status, reply to the guest, internal note, who
-- handled it) — column-level UPDATE grants, so a staff session cannot rewrite
-- the guest's details.

create table if not exists public.celebration_requests (
  id               uuid primary key default gen_random_uuid(),
  reference_number text not null unique,                       -- CB-XXXXXX, for support
  access_token     text not null unique check (access_token ~ '^[a-f0-9]{32}$'),
  occasion         text not null check (occasion in ('birthday', 'anniversary', 'graduation', 'wedding', 'baby_shower', 'family', 'corporate', 'other')),
  occasion_other   text check (occasion_other is null or length(btrim(occasion_other)) between 2 and 60),
  honoree          text check (honoree is null or length(btrim(honoree)) between 2 and 80),   -- who it's for
  event_date       date not null,
  guests           integer not null check (guests between 1 and 2000),
  setting          text not null check (setting in ('meatsoko', 'own_venue', 'not_sure')),
  area             text check (area is null or length(btrim(area)) between 2 and 120),
  budget           text check (budget is null or budget in ('under_25k', '25k_50k', '50k_100k', '100k_250k', 'over_250k')),
  notes            text check (notes is null or length(notes) <= 1000),
  name             text not null check (length(btrim(name)) between 2 and 120),
  phone            text not null check (phone ~ '^2547[0-9]{8}$'),
  email            text not null check (public.looks_like_email(email)),
  status           text not null default 'new'
                   check (status in ('new', 'contacted', 'confirmed', 'declined', 'cancelled', 'completed')),
  reply            text check (reply is null or length(reply) <= 1000),        -- shown to the guest
  staff_note       text check (staff_note is null or length(staff_note) <= 1000), -- internal only
  handled_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint celebration_requests_other_named check (occasion <> 'other' or occasion_other is not null)
);

create index if not exists celebration_requests_created_idx on public.celebration_requests (created_at desc);
create index if not exists celebration_requests_date_idx on public.celebration_requests (event_date);

alter table public.celebration_requests enable row level security;
revoke all on table public.celebration_requests from anon, authenticated;
grant select on table public.celebration_requests to authenticated;
grant update (status, reply, staff_note, handled_by, updated_at) on table public.celebration_requests to authenticated;

drop policy if exists celebration_requests_staff_read on public.celebration_requests;
create policy celebration_requests_staff_read on public.celebration_requests
  for select to authenticated using (public.is_staff());

drop policy if exists celebration_requests_staff_update on public.celebration_requests;
create policy celebration_requests_staff_update on public.celebration_requests
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
