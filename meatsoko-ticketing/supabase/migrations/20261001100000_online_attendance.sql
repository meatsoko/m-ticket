-- Online attendance (NyamaFest online): anyone, in Kenya or abroad, registers
-- free with name, email and country — no phone — and gets a private watch link
-- (/watch/<access_code>) that embeds the event's YouTube Live stream.
--
-- Deliberately a separate table, not reservations or tickets:
--   - it never touches physical capacity: expected_attendance() reads only
--     reservations/tickets, so online registrations cannot reduce the 500;
--   - no QR / gate pass is ever issued (the gate resolves reservation and ticket
--     tokens only; an online access code is not an admission credential);
--   - no phone column, so nothing phone-shaped is required.
--
-- Future paid online tickets: events.online_price_kes (null/0 = free) and the
-- nullable order_id are the hooks; the registration function refuses a price
-- > 0 until payment is implemented, so it can't silently become free-for-paid.
--
-- The stream is configured in ONE place: events.stream_youtube_id (Event
-- settings). online-access returns it only while the event is live.
--
-- Access: no public access (RLS on). Edge Functions use the service role.
-- Staff read (dashboard); admins update (revoke / restore access).

alter table public.events add column if not exists online_enabled boolean not null default false;
alter table public.events add column if not exists stream_youtube_id text;
alter table public.events add column if not exists online_price_kes numeric(10,2) check (online_price_kes is null or online_price_kes >= 0);

create table if not exists public.online_registrations (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events(id) on delete cascade,
  registration_number text not null unique,                       -- ONL-XXXXXX, for support
  name                text not null check (length(btrim(name)) between 2 and 120),
  email               text not null check (public.looks_like_email(email)),
  country             text not null check (country ~ '^[A-Z]{2}$'), -- ISO 3166-1 alpha-2
  access_code         text not null unique check (access_code ~ '^[a-f0-9]{32}$'),
  status              text not null default 'active' check (status in ('active', 'revoked')),
  order_id            uuid references public.orders(id),           -- future paid online tickets
  created_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users(id),
  last_access_at      timestamptz,
  access_count        integer not null default 0
);
create index if not exists online_registrations_event_idx on public.online_registrations (event_id, created_at desc);
create index if not exists online_registrations_email_idx on public.online_registrations (lower(email));
-- One active registration per email per event (a revoked one doesn't block re-registering).
create unique index if not exists online_registrations_one_per_email
  on public.online_registrations (event_id, lower(email)) where status = 'active';

alter table public.online_registrations enable row level security;
revoke all on table public.online_registrations from anon, authenticated;
grant select, update on table public.online_registrations to authenticated;
drop policy if exists online_registrations_staff_read on public.online_registrations;
create policy online_registrations_staff_read on public.online_registrations
  for select to authenticated using (public.is_staff());
drop policy if exists online_registrations_admin_update on public.online_registrations;
create policy online_registrations_admin_update on public.online_registrations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- NyamaFest offers online attendance; the stream ID is set later in Event settings.
update public.events set online_enabled = true where slug = 'nyamafest-main';
