-- ============================================================
-- Reservations + preorders
--
-- Architectural rule this migration encodes:
--
--     A RESERVATION is the admission/guest record.
--     An ORDER is the financial transaction attached to a reservation
--     when — and only when — money is involved.
--
-- A free reservation therefore has NO order. There is no KSh 0 order, no
-- zero-value STK push, and no payment columns duplicated onto reservations:
-- `orders` remains the single source of truth for payment state, reached from
-- a reservation through reservations.order_id.
--
-- Everything here is additive. Existing ticket purchases, caps, redemptions and
-- confirm_payment() behaviour for ticket orders are unchanged; the only edits to
-- existing objects are widening ones (nullable columns + CHECKs) that keep every
-- current row valid.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Supersede the exploratory reservations migration
--
-- 20260923080000 was applied to the shared project during design exploration and
-- has been marked reverted. It never held a row and was never committed, so the
-- teardown below is a no-op on a fresh database and safe on the existing one.
-- ------------------------------------------------------------
drop function if exists public.reservation_stats(uuid);
drop function if exists public.check_in_reservation(text, integer, text);
drop function if exists public.create_reservation(uuid, text, text, text, integer, time, text);
drop function if exists public.gen_reservation_code(text);
drop table if exists public.reservations;
drop type if exists reservation_status;

create extension if not exists pg_trgm with schema extensions;


-- ------------------------------------------------------------
-- 1. Event configuration
--
-- How an event sells is configuration, never code. The same build runs a
-- ticketed expo, a free RSVP festival, or an RSVP with optional paid preorders.
-- ------------------------------------------------------------
create type reservation_mode as enum (
  'off',                -- ticketed event; reservations disabled (existing behaviour)
  'free',               -- RSVP only, no money, no preorder items offered
  'optional_preorder',  -- RSVP confirmed immediately; preorders may be paid for
  'required_preorder'   -- RSVP only becomes valid once the preorder is paid
);

alter table public.events add column if not exists reservation_mode reservation_mode not null default 'off';
alter table public.events add column if not exists reservation_prefix text not null default 'RSV'
  check (reservation_prefix ~ '^[A-Z]{2,5}$');
alter table public.events add column if not exists capacity integer
  check (capacity is null or capacity > 0);
alter table public.events add column if not exists max_party_size integer not null default 10
  check (max_party_size between 1 and 50);
alter table public.events add column if not exists doors_open_at timestamptz;
alter table public.events add column if not exists reservations_open_at timestamptz;
alter table public.events add column if not exists reservations_close_at timestamptz;

-- Presentation + organizer contact. Supplied by the organizer, never hard-coded.
alter table public.events add column if not exists tagline text;
alter table public.events add column if not exists contact_phone text;
alter table public.events add column if not exists contact_email text;
alter table public.events add column if not exists gallery  jsonb not null default '[]'::jsonb;
alter table public.events add column if not exists sponsors jsonb not null default '[]'::jsonb;
alter table public.events add column if not exists socials  jsonb not null default '{}'::jsonb;

-- Where new reservations are announced. Both nullable: with neither set, the
-- admin dashboard is the only destination, which is a valid configuration.
alter table public.events add column if not exists notify_email text;
alter table public.events add column if not exists notify_whatsapp text;


-- ------------------------------------------------------------
-- 2. Preorder items — admin-configured, per event
--
-- Deliberately generic: "Food package", "Table for 6", "VIP" are data. No
-- NyamaFest product is named anywhere in the schema or the application.
-- ------------------------------------------------------------
create table public.preorder_items (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  description  text default '',
  price_kes    numeric(10,2) not null check (price_kes > 0),  -- a free "preorder" is not an order
  quantity_cap integer check (quantity_cap is null or quantity_cap > 0),
  max_per_reservation integer not null default 10 check (max_per_reservation between 1 and 50),
  position     integer not null default 0,
  is_active    boolean not null default true
);

create index preorder_items_event_idx on public.preorder_items (event_id, position);

alter table public.preorder_items enable row level security;

-- Mirrors the ticket_types policies exactly: public reads the catalogue of a
-- live event, admin writes it.
create policy "public read active preorder items of live events" on public.preorder_items
  for select using (is_active and exists (
    select 1 from public.events e where e.id = event_id and e.status = 'live'));
create policy "admin write preorder items" on public.preorder_items
  for all using (public.is_admin()) with check (public.is_admin());


-- ------------------------------------------------------------
-- 3. order_items carries both kinds of line
--
-- Reuses the existing order/order-item architecture rather than adding a
-- parallel one. Exactly one of ticket_type_id / preorder_item_id is set; the
-- CHECK makes a mixed or empty line impossible. Existing rows all have
-- ticket_type_id set, so they satisfy the constraint unchanged.
-- ------------------------------------------------------------
alter table public.order_items alter column ticket_type_id drop not null;
alter table public.order_items add column if not exists preorder_item_id uuid references public.preorder_items(id);
alter table public.order_items add constraint order_items_one_kind check (
  (ticket_type_id is not null and preorder_item_id is null) or
  (ticket_type_id is null and preorder_item_id is not null)
);


-- ------------------------------------------------------------
-- 4. Reservations
-- ------------------------------------------------------------
create type reservation_status as enum (
  'pending_payment',  -- has an order awaiting payment; not yet admissible
  'confirmed',        -- valid for admission
  'checked_in',       -- admitted at the door
  'cancelled'
);

create table public.reservations (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.events(id) on delete cascade,

  -- Two identifiers, on purpose.
  --   reservation_number is read aloud across a noisy gate and retyped by staff,
  --     so it is short and human-shaped — and therefore guessable, which is why
  --     it is only ever searchable by authenticated staff.
  --   access_token is what the QR and the public URL carry, so it is 128-bit and
  --     unguessable, matching tickets.qr_token (NFR-4).
  reservation_number text unique not null,
  access_token       text unique not null,

  guest_name         text not null check (length(btrim(guest_name)) between 2 and 120),
  phone              text not null,                 -- normalized 2547XXXXXXXX
  email              text,

  -- The form collects "how many people are accompanying you", which excludes the
  -- guest. Storing that verbatim and deriving the headcount removes the off-by-one
  -- that otherwise puts a venue over capacity.
  accompanying_guests integer not null default 0 check (accompanying_guests >= 0),
  party_size         integer generated always as (1 + accompanying_guests) stored,

  expected_arrival   time,                          -- local venue time (EAT)
  status             reservation_status not null default 'confirmed',

  -- The ONLY link to money. Null for a free reservation. Payment state is read
  -- through this join; it is never copied onto the reservation.
  order_id           uuid unique references public.orders(id) on delete set null,

  notes              text,
  source             text not null default 'web' check (source in ('web', 'door')),
  created_at         timestamptz not null default now(),
  checked_in_at      timestamptz,
  checked_in_by      uuid references auth.users(id),
  arrived_party_size integer check (arrived_party_size is null or arrived_party_size >= 0),

  -- One reservation per phone per event: re-submitting updates rather than
  -- duplicating, so the headcount stays honest.
  unique (event_id, phone)
);

create index reservations_event_created_idx on public.reservations (event_id, created_at desc);
create index reservations_event_status_idx  on public.reservations (event_id, status);
create index reservations_order_idx         on public.reservations (order_id);
-- Admin search by guest name without a scan per keystroke.
create index reservations_name_trgm_idx on public.reservations
  using gin (lower(guest_name) extensions.gin_trgm_ops);

alter table public.reservations enable row level security;

-- No public policies: guests reserve through the `reserve` Edge Function under
-- the service role, which is also where throttling and validation live. Staff
-- read and correct rows through their own session.
create policy "staff read reservations" on public.reservations
  for select using (public.is_staff());
create policy "staff update reservations" on public.reservations
  for update using (public.is_staff()) with check (public.is_staff());


-- ------------------------------------------------------------
-- 5. redemptions covers both kinds of pass
--
-- Widened rather than duplicated, so the scanner's duplicate-scan protection,
-- the offline outbox and the 23505-on-conflict behaviour all keep working
-- untouched for tickets and start working for reservations for free.
-- ------------------------------------------------------------
alter table public.redemptions alter column ticket_id drop not null;
alter table public.redemptions add column if not exists reservation_id uuid
  references public.reservations(id) on delete cascade;
alter table public.redemptions add constraint redemptions_one_subject check (
  (ticket_id is not null and reservation_id is null) or
  (ticket_id is null and reservation_id is not null)
);
-- The ticket-side guard is the existing unique(ticket_id, redemption_type).
-- This is its exact counterpart, and the source of duplicate-scan rejection.
create unique index redemptions_reservation_entry_idx
  on public.redemptions (reservation_id, redemption_type)
  where reservation_id is not null;


-- ------------------------------------------------------------
-- 6. Reservation number generation
--
-- Crockford-style alphabet: no 0/O, no 1/I/L, no U. A guest reads this aloud at
-- a gate and staff retype it; a character heard wrong costs time at the door.
-- ------------------------------------------------------------
create or replace function public.gen_reservation_number(p_prefix text)
returns text
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text;
  i int;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    v_code := coalesce(nullif(btrim(p_prefix), ''), 'RSV') || '-' || v_code;
    exit when not exists (select 1 from public.reservations where reservation_number = v_code);
  end loop;
  return v_code;
end; $$;


-- ------------------------------------------------------------
-- 7. Capacity — one number, both kinds of admission
--
-- Existing ticketing counts admissions as tickets x bundle_qty. Reservations
-- count party_size. A venue cares about the sum, so there is exactly one
-- function that produces it and both paths check against it. HYBRID RULE:
--
--   expected attendance =
--       SUM(reservation.party_size)  where status in (pending_payment, confirmed, checked_in)
--     + SUM(ticket.bundle_qty)       where ticket.status <> 'refunded'
--     + SUM(order_item.qty x bundle_qty) for ticket orders still pending and
--                                         younger than the STK window (soft hold)
--
-- pending_payment reservations are counted: they are holding a place while the
-- guest enters a PIN, exactly as an in-flight ticket order does.
-- ------------------------------------------------------------
create or replace function public.expected_attendance(p_event_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, extensions as $$
  with res as (
    select
      coalesce(sum(party_size) filter (
        where status in ('pending_payment', 'confirmed', 'checked_in')), 0)::int as admissions,
      count(*) filter (where status <> 'cancelled')::int as reservations,
      count(*) filter (where status = 'checked_in')::int as checked_in,
      coalesce(sum(coalesce(arrived_party_size, party_size))
        filter (where status = 'checked_in'), 0)::int as arrived
    from public.reservations where event_id = p_event_id
  ),
  tix as (
    select coalesce(sum(tt.bundle_qty), 0)::int as admissions
      from public.tickets t
      join public.ticket_types tt on tt.id = t.ticket_type_id
     where tt.event_id = p_event_id and t.status <> 'refunded'
  ),
  held as (
    select coalesce(sum(oi.qty * tt.bundle_qty), 0)::int as admissions
      from public.order_items oi
      join public.ticket_types tt on tt.id = oi.ticket_type_id
      join public.orders o on o.id = oi.order_id
     where tt.event_id = p_event_id
       and o.status = 'pending'
       and o.created_at > now() - interval '10 minutes'
  )
  select jsonb_build_object(
    'capacity',              e.capacity,
    'reservation_admissions', res.admissions,
    'ticket_admissions',      tix.admissions + held.admissions,
    'expected_attendance',    res.admissions + tix.admissions + held.admissions,
    'remaining',              case when e.capacity is null then null
                                   else greatest(0, e.capacity - (res.admissions + tix.admissions + held.admissions)) end,
    'reservations',           res.reservations,
    'checked_in',             res.checked_in,
    'arrived_guests',         res.arrived
  )
  from public.events e, res, tix, held
  where e.id = p_event_id;
$$;

grant execute on function public.expected_attendance(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- 8. Create / update a reservation
--
-- Returns the reservation identity plus, when a preorder was selected, an order
-- id for the caller to push through the EXISTING Daraja flow. This function
-- never talks to Daraja and never creates a zero-value order.
-- ------------------------------------------------------------
create or replace function public.create_reservation(
  p_event_id     uuid,
  p_guest_name   text,
  p_phone        text,
  p_email        text default null,
  p_accompanying integer default 0,
  p_arrival      time default null,
  p_preorders    jsonb default '[]'::jsonb,   -- [{"preorder_item_id":uuid,"qty":int}]
  p_source       text default 'web'
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_event    public.events%rowtype;
  v_existing public.reservations%rowtype;
  v_row      public.reservations%rowtype;
  v_item     record;
  v_amount   numeric(10,2) := 0;
  v_order_id uuid;
  v_party    int := 1 + greatest(0, coalesce(p_accompanying, 0));
  v_att      jsonb;
  v_current  int := 0;
  v_sold     int;
  v_line     jsonb;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then return jsonb_build_object('result', 'event_not_found'); end if;
  if v_event.status <> 'live' then
    return jsonb_build_object('result', 'event_not_live', 'status', v_event.status);
  end if;
  if v_event.reservation_mode = 'off' then
    return jsonb_build_object('result', 'reservations_disabled');
  end if;
  if v_event.reservations_open_at is not null and now() < v_event.reservations_open_at then
    return jsonb_build_object('result', 'not_open_yet', 'opens_at', v_event.reservations_open_at);
  end if;
  if v_event.reservations_close_at is not null and now() > v_event.reservations_close_at then
    return jsonb_build_object('result', 'closed', 'closed_at', v_event.reservations_close_at);
  end if;
  if v_party > v_event.max_party_size then
    return jsonb_build_object('result', 'party_too_large', 'max_party_size', v_event.max_party_size);
  end if;
  if v_event.reservation_mode = 'free' and jsonb_array_length(coalesce(p_preorders, '[]'::jsonb)) > 0 then
    return jsonb_build_object('result', 'preorders_not_offered');
  end if;

  -- Serialize capacity arithmetic for this event. Without it, N concurrent
  -- reservations each read the same pre-booking count and all pass the check.
  perform pg_advisory_xact_lock(hashtext('event_capacity:' || p_event_id::text));

  select * into v_existing from public.reservations
   where event_id = p_event_id and phone = p_phone for update;
  if found then v_current := v_existing.party_size; end if;

  if v_event.capacity is not null then
    v_att := public.expected_attendance(p_event_id);
    -- Exclude this guest's existing party so that editing a reservation is
    -- measured against the right baseline rather than double-counting itself.
    if (v_att->>'expected_attendance')::int - v_current + v_party > v_event.capacity then
      return jsonb_build_object(
        'result', 'full',
        'capacity', v_event.capacity,
        'remaining', greatest(0, v_event.capacity - ((v_att->>'expected_attendance')::int - v_current))
      );
    end if;
  end if;

  -- ---- price the preorder, server-side; never trust a client amount ----
  for v_line in select * from jsonb_array_elements(coalesce(p_preorders, '[]'::jsonb))
  loop
    select pi.* into v_item from public.preorder_items pi
     where pi.id = (v_line->>'preorder_item_id')::uuid
       and pi.event_id = p_event_id and pi.is_active;
    if not found then
      return jsonb_build_object('result', 'bad_preorder_item');
    end if;
    if coalesce((v_line->>'qty')::int, 0) < 1
       or (v_line->>'qty')::int > v_item.max_per_reservation then
      return jsonb_build_object('result', 'bad_preorder_qty', 'item', v_item.name,
                                'max_per_reservation', v_item.max_per_reservation);
    end if;
    if v_item.quantity_cap is not null then
      select coalesce(sum(oi.qty), 0) into v_sold
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
       where oi.preorder_item_id = v_item.id
         and (o.status = 'paid' or (o.status = 'pending' and o.created_at > now() - interval '10 minutes'));
      if v_sold + (v_line->>'qty')::int > v_item.quantity_cap then
        return jsonb_build_object('result', 'preorder_sold_out', 'item', v_item.name,
                                  'remaining', greatest(0, v_item.quantity_cap - v_sold));
      end if;
    end if;
    v_amount := v_amount + v_item.price_kes * (v_line->>'qty')::int;
  end loop;

  -- Daraja takes whole shillings and rejects anything under 1.
  v_amount := round(v_amount);
  if v_event.reservation_mode = 'required_preorder' and v_amount < 1 then
    return jsonb_build_object('result', 'preorder_required');
  end if;

  -- ---- upsert the reservation ----
  if v_existing.id is not null then
    update public.reservations
       set guest_name = p_guest_name,
           email = coalesce(nullif(btrim(p_email), ''), email),
           accompanying_guests = greatest(0, coalesce(p_accompanying, 0)),
           expected_arrival = coalesce(p_arrival, expected_arrival),
           status = case when status = 'checked_in' then status
                         when v_amount > 0 then 'pending_payment'::reservation_status
                         else 'confirmed'::reservation_status end
     where id = v_existing.id
     returning * into v_row;
  else
    insert into public.reservations (
      event_id, reservation_number, access_token, guest_name, phone, email,
      accompanying_guests, expected_arrival, source, status
    ) values (
      p_event_id,
      public.gen_reservation_number(v_event.reservation_prefix),
      encode(gen_random_bytes(16), 'hex'),
      p_guest_name, p_phone, nullif(btrim(p_email), ''),
      greatest(0, coalesce(p_accompanying, 0)), p_arrival, coalesce(p_source, 'web'),
      case when v_amount > 0 then 'pending_payment'::reservation_status
           else 'confirmed'::reservation_status end
    ) returning * into v_row;
  end if;

  -- ---- attach an order only when there is money ----
  if v_amount > 0 then
    insert into public.orders (event_id, buyer_phone, buyer_email, channel, amount_kes, status)
    values (p_event_id, p_phone, nullif(btrim(p_email), ''), coalesce(p_source, 'web'), v_amount, 'pending')
    returning id into v_order_id;

    for v_line in select * from jsonb_array_elements(p_preorders)
    loop
      select pi.* into v_item from public.preorder_items pi
       where pi.id = (v_line->>'preorder_item_id')::uuid;
      insert into public.order_items (order_id, preorder_item_id, qty, unit_price_kes)
      values (v_order_id, v_item.id, (v_line->>'qty')::int, v_item.price_kes);
    end loop;

    update public.reservations set order_id = v_order_id where id = v_row.id
      returning * into v_row;
  end if;

  return jsonb_build_object(
    'result', case when v_existing.id is not null then 'updated' else 'created' end,
    'reservation_id', v_row.id,
    'reservation_number', v_row.reservation_number,
    'access_token', v_row.access_token,
    'party_size', v_row.party_size,
    'status', v_row.status,
    'order_id', v_row.order_id,
    'amount_kes', v_amount
  );
end; $$;


-- ------------------------------------------------------------
-- 9. confirm_payment() — one added branch
--
-- Everything about the existing ticket path is byte-identical to the previous
-- version: same idempotency guards, same cap check, same ticket minting, same
-- gate auto-redemption. The single change is that an order which belongs to a
-- reservation confirms THAT reservation instead of minting tickets, because the
-- reservation's access_token is already the pass.
-- ------------------------------------------------------------
create or replace function public.confirm_payment(
  p_checkout_request_id text, p_receipt text, p_amount numeric
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_order public.orders%rowtype;
  v_item  record;
  v_sold  int;
  v_res   public.reservations%rowtype;
begin
  select * into v_order from public.orders
   where mpesa_checkout_request_id = p_checkout_request_id
   for update;

  if not found then
    return jsonb_build_object('result', 'unknown');
  end if;
  if v_order.status = 'paid' then
    return jsonb_build_object('result', 'already', 'order_id', v_order.id);
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('result', 'ignored', 'status', v_order.status);
  end if;
  if v_order.amount_kes is distinct from p_amount then
    update public.orders set status = 'flagged' where id = v_order.id;
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  end if;

  select * into v_res from public.reservations where order_id = v_order.id for update;

  -- ---- Reservation-backed order: confirm the guest, mint nothing ----
  if found then
    update public.orders
       set status = 'paid', mpesa_receipt = p_receipt, paid_at = now()
     where id = v_order.id;

    update public.reservations
       set status = case when status = 'checked_in' then status
                         else 'confirmed'::reservation_status end
     where id = v_res.id
     returning * into v_res;

    return jsonb_build_object(
      'result', 'confirmed', 'order_id', v_order.id,
      'kind', 'reservation',
      'reservation_id', v_res.id,
      'reservation_number', v_res.reservation_number
    );
  end if;

  -- ---- Ticket order: unchanged from here down ----
  for v_item in
    select oi.ticket_type_id, oi.qty, tt.name, tt.quantity_cap, tt.bundle_qty
      from public.order_items oi
      join public.ticket_types tt on tt.id = oi.ticket_type_id
     where oi.order_id = v_order.id
  loop
    if v_item.quantity_cap is not null then
      select coalesce(sum(tt2.bundle_qty), 0) into v_sold
        from public.tickets t
        join public.ticket_types tt2 on tt2.id = t.ticket_type_id
       where t.ticket_type_id = v_item.ticket_type_id
         and t.status <> 'refunded';
      if v_sold + v_item.qty * v_item.bundle_qty > v_item.quantity_cap then
        update public.orders set status = 'flagged' where id = v_order.id;
        return jsonb_build_object('result', 'cap_exceeded', 'ticket_type', v_item.name);
      end if;
    end if;
  end loop;

  update public.orders
     set status = 'paid', mpesa_receipt = p_receipt, paid_at = now()
   where id = v_order.id;

  for v_item in
    select oi.ticket_type_id, oi.qty
      from public.order_items oi
     where oi.order_id = v_order.id and oi.ticket_type_id is not null
  loop
    for i in 1..v_item.qty loop
      insert into public.tickets (order_id, ticket_type_id, qr_token, status, redeemed_at)
      values (v_order.id, v_item.ticket_type_id, encode(gen_random_bytes(16), 'hex'),
              case when v_order.channel = 'gate' then 'redeemed'::ticket_status
                   else 'active'::ticket_status end,
              case when v_order.channel = 'gate' then now() else null end);
    end loop;
  end loop;

  if v_order.channel = 'gate' then
    insert into public.redemptions (ticket_id, redemption_type, station, scanned_by)
    select t.id, 'entry', 'gate-sale', null
      from public.tickets t where t.order_id = v_order.id
    on conflict do nothing;
  end if;

  return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id, 'kind', 'ticket');
end; $$;


-- ------------------------------------------------------------
-- 10. resolve_pass() — one shape for both kinds of QR
--
-- Lets the existing scanner keep a single admission flow. Read-only; the write
-- happens in admit_pass().
-- ------------------------------------------------------------
create or replace function public.resolve_pass(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  v_t   record;
  v_r   record;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then
    return jsonb_build_object('kind', 'unknown', 'status', 'invalid');
  end if;

  select t.id, t.status, t.redeemed_at, t.qr_token,
         tt.name as type_name, tt.bundle_qty, e.name as event_name, e.status as event_status
    into v_t
    from public.tickets t
    join public.ticket_types tt on tt.id = t.ticket_type_id
    join public.events e on e.id = tt.event_id
   where t.qr_token = p_token;

  if found then
    return jsonb_build_object(
      'kind', 'ticket',
      'pass_number', left(v_t.qr_token, 8),
      'holder_name', null,
      'party_size', v_t.bundle_qty,
      'status', v_t.status,
      'paid', true,                       -- a ticket only exists for a paid order
      'type_name', v_t.type_name,
      'event_name', v_t.event_name,
      'event_status', v_t.event_status,
      'ticket_id', v_t.id
    );
  end if;

  select r.*, e.name as event_name, e.status as event_status, o.status as order_status
    into v_r
    from public.reservations r
    join public.events e on e.id = r.event_id
    left join public.orders o on o.id = r.order_id
   where r.access_token = p_token;

  if found then
    return jsonb_build_object(
      'kind', 'reservation',
      'pass_number', v_r.reservation_number,
      'holder_name', v_r.guest_name,
      'party_size', v_r.party_size,
      'status', v_r.status,
      -- Payment truth is read through the order, never copied onto the row.
      'paid', case when v_r.order_id is null then true
                   else v_r.order_status = 'paid' end,
      'order_status', v_r.order_status,
      'expected_arrival', v_r.expected_arrival,
      'event_name', v_r.event_name,
      'event_status', v_r.event_status,
      'reservation_id', v_r.id
    );
  end if;

  return jsonb_build_object('kind', 'unknown', 'status', 'not_found');
end; $$;


-- ------------------------------------------------------------
-- 11. admit_pass() — the single admission write
--
-- Duplicate protection comes from the same unique constraints the scanner
-- already relies on, so the offline outbox needs no change: a queued scan that
-- loses the race is rejected on insert exactly as before.
-- ------------------------------------------------------------
create or replace function public.admit_pass(
  p_token    text,
  p_station  text default 'gate-1',
  p_scanned_by uuid default null,
  p_scanned_at timestamptz default null,
  p_arrived  integer default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_pass jsonb := public.resolve_pass(p_token);
  v_kind text := v_pass->>'kind';
  v_first record;
begin
  if v_kind = 'unknown' then
    return jsonb_build_object('result',
      case when v_pass->>'status' = 'invalid' then 'invalid' else 'not_found' end);
  end if;
  if v_pass->>'event_status' = 'closed' then
    return jsonb_build_object('result', 'event_closed');
  end if;

  if v_kind = 'ticket' then
    if v_pass->>'status' = 'refunded' then
      return jsonb_build_object('result', 'refunded');
    end if;
    begin
      insert into public.redemptions (ticket_id, redemption_type, station, scanned_by, scanned_at)
      values ((v_pass->>'ticket_id')::uuid, 'entry', coalesce(p_station, 'gate-1'),
              p_scanned_by, coalesce(p_scanned_at, now()));
    exception when unique_violation then
      select scanned_at, station into v_first from public.redemptions
       where ticket_id = (v_pass->>'ticket_id')::uuid and redemption_type = 'entry';
      return jsonb_build_object('result', 'already_redeemed',
        'first_scanned_at', v_first.scanned_at, 'station', v_first.station,
        'kind', 'ticket', 'party_size', v_pass->'party_size');
    end;
    update public.tickets set status = 'redeemed', redeemed_at = coalesce(p_scanned_at, now())
     where id = (v_pass->>'ticket_id')::uuid and status = 'active';
    return jsonb_build_object('result', 'admitted', 'kind', 'ticket',
      'party_size', v_pass->'party_size', 'pass_number', v_pass->>'pass_number');
  end if;

  -- reservation
  if v_pass->>'status' = 'cancelled' then
    return jsonb_build_object('result', 'cancelled', 'holder_name', v_pass->>'holder_name');
  end if;
  -- An unpaid required preorder is not admissible. The order is the authority.
  if (v_pass->>'paid')::boolean is not true then
    return jsonb_build_object('result', 'unpaid',
      'holder_name', v_pass->>'holder_name', 'order_status', v_pass->>'order_status');
  end if;

  begin
    insert into public.redemptions (reservation_id, redemption_type, station, scanned_by, scanned_at)
    values ((v_pass->>'reservation_id')::uuid, 'entry', coalesce(p_station, 'gate-1'),
            p_scanned_by, coalesce(p_scanned_at, now()));
  exception when unique_violation then
    select scanned_at, station into v_first from public.redemptions
     where reservation_id = (v_pass->>'reservation_id')::uuid and redemption_type = 'entry';
    return jsonb_build_object('result', 'already_redeemed',
      'first_scanned_at', v_first.scanned_at, 'station', v_first.station,
      'kind', 'reservation', 'holder_name', v_pass->>'holder_name',
      'party_size', v_pass->'party_size');
  end;

  update public.reservations
     set status = 'checked_in', checked_in_at = coalesce(p_scanned_at, now()),
         checked_in_by = p_scanned_by,
         arrived_party_size = coalesce(p_arrived, party_size)
   where id = (v_pass->>'reservation_id')::uuid;

  return jsonb_build_object('result', 'admitted', 'kind', 'reservation',
    'holder_name', v_pass->>'holder_name',
    'pass_number', v_pass->>'pass_number',
    'party_size', v_pass->'party_size',
    'expected_arrival', v_pass->'expected_arrival');
end; $$;
