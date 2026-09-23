-- ============================================================
-- Reservation types (Single / Group / Family) and door verification
--
-- Reservation types are admin-configured per event, exactly like preorder items.
-- "Single", "Group" and "Family" are DATA — the application knows only that a
-- type either fixes the party size or lets the guest enter it.
--
-- Preorders remain independent of reservation type: any guest, on any type, may
-- order any active item. Nothing here couples the two.
-- ============================================================

create table public.reservation_types (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  description text default '',

  -- NULL means the guest enters the number (a "Group"). A value fixes it, so
  -- "Single" is 1 and "Family" is whatever the organizer decides.
  fixed_party_size integer check (fixed_party_size is null or fixed_party_size >= 1),
  min_party_size   integer not null default 1 check (min_party_size >= 1),
  max_party_size   integer check (max_party_size is null or max_party_size >= 1),

  position   integer not null default 0,
  is_active  boolean not null default true,

  constraint reservation_types_range check (
    max_party_size is null or max_party_size >= min_party_size
  )
);

create index reservation_types_event_idx on public.reservation_types (event_id, position);

alter table public.reservation_types enable row level security;

-- Mirrors preorder_items and ticket_types: public reads a live event's
-- catalogue, admin writes it.
create policy "public read active reservation types of live events" on public.reservation_types
  for select using (is_active and exists (
    select 1 from public.events e where e.id = event_id and e.status = 'live'));
create policy "admin write reservation types" on public.reservation_types
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.reservations
  add column if not exists reservation_type_id uuid references public.reservation_types(id);
create index reservations_type_idx on public.reservations (reservation_type_id);


-- ------------------------------------------------------------
-- create_reservation(): accept a reservation type and let it decide the party
--
-- Replaces the previous signature. The party size now comes from the type when
-- the type fixes it, so a guest picking "Single" cannot arrive with four people
-- by editing the form, and "Group" is bounded by the type's own range.
-- ------------------------------------------------------------
create or replace function public.create_reservation(
  p_event_id     uuid,
  p_guest_name   text,
  p_phone        text,
  p_email        text default null,
  p_accompanying integer default 0,
  p_arrival      time default null,
  p_preorders    jsonb default '[]'::jsonb,
  p_source       text default 'web',
  p_reservation_type_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_event    public.events%rowtype;
  v_type     public.reservation_types%rowtype;
  v_existing public.reservations%rowtype;
  v_row      public.reservations%rowtype;
  v_item     record;
  v_amount   numeric(10,2) := 0;
  v_order_id uuid;
  v_party    int;
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

  -- ---- the type decides the party size ----
  if p_reservation_type_id is not null then
    select * into v_type from public.reservation_types
     where id = p_reservation_type_id and event_id = p_event_id and is_active;
    if not found then return jsonb_build_object('result', 'bad_reservation_type'); end if;

    if v_type.fixed_party_size is not null then
      v_party := v_type.fixed_party_size;
    else
      v_party := 1 + greatest(0, coalesce(p_accompanying, 0));
      if v_party < v_type.min_party_size then
        return jsonb_build_object('result', 'party_too_small',
          'min_party_size', v_type.min_party_size, 'type', v_type.name);
      end if;
      if v_type.max_party_size is not null and v_party > v_type.max_party_size then
        return jsonb_build_object('result', 'party_too_large',
          'max_party_size', v_type.max_party_size, 'type', v_type.name);
      end if;
    end if;
  else
    -- No types configured for this event: fall back to the plain party count.
    v_party := 1 + greatest(0, coalesce(p_accompanying, 0));
  end if;

  if v_party > v_event.max_party_size then
    return jsonb_build_object('result', 'party_too_large', 'max_party_size', v_event.max_party_size);
  end if;
  if v_event.reservation_mode = 'free' and jsonb_array_length(coalesce(p_preorders, '[]'::jsonb)) > 0 then
    return jsonb_build_object('result', 'preorders_not_offered');
  end if;

  perform pg_advisory_xact_lock(hashtext('event_capacity:' || p_event_id::text));

  select * into v_existing from public.reservations
   where event_id = p_event_id and phone = p_phone for update;
  if found then v_current := v_existing.party_size; end if;

  if v_event.capacity is not null then
    v_att := public.expected_attendance(p_event_id);
    if (v_att->>'expected_attendance')::int - v_current + v_party > v_event.capacity then
      return jsonb_build_object(
        'result', 'full',
        'capacity', v_event.capacity,
        'remaining', greatest(0, v_event.capacity - ((v_att->>'expected_attendance')::int - v_current))
      );
    end if;
  end if;

  -- ---- price the preorder, server-side ----
  for v_line in select * from jsonb_array_elements(coalesce(p_preorders, '[]'::jsonb))
  loop
    select pi.* into v_item from public.preorder_items pi
     where pi.id = (v_line->>'preorder_item_id')::uuid
       and pi.event_id = p_event_id and pi.is_active;
    if not found then return jsonb_build_object('result', 'bad_preorder_item'); end if;
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

  v_amount := round(v_amount);
  if v_event.reservation_mode = 'required_preorder' and v_amount < 1 then
    return jsonb_build_object('result', 'preorder_required');
  end if;

  if v_existing.id is not null then
    update public.reservations
       set guest_name = p_guest_name,
           email = coalesce(nullif(btrim(p_email), ''), email),
           accompanying_guests = greatest(0, v_party - 1),
           reservation_type_id = coalesce(p_reservation_type_id, reservation_type_id),
           expected_arrival = coalesce(p_arrival, expected_arrival),
           status = case when status = 'checked_in' then status
                         when v_amount > 0 then 'pending_payment'::reservation_status
                         else 'confirmed'::reservation_status end
     where id = v_existing.id
     returning * into v_row;
  else
    insert into public.reservations (
      event_id, reservation_number, access_token, guest_name, phone, email,
      accompanying_guests, expected_arrival, source, status, reservation_type_id
    ) values (
      p_event_id,
      public.gen_reservation_number(v_event.reservation_prefix),
      encode(gen_random_bytes(16), 'hex'),
      p_guest_name, p_phone, nullif(btrim(p_email), ''),
      greatest(0, v_party - 1), p_arrival, coalesce(p_source, 'web'),
      case when v_amount > 0 then 'pending_payment'::reservation_status
           else 'confirmed'::reservation_status end,
      p_reservation_type_id
    ) returning * into v_row;
  end if;

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

-- The 8-arg signature is superseded; drop it so PostgREST stops offering an
-- overload that silently ignores the reservation type.
drop function if exists public.create_reservation(uuid, text, text, text, integer, time, jsonb, text);


-- ------------------------------------------------------------
-- resolve_pass(): carry what the door needs to VERIFY a paid order
--
-- Staff at the gate must be able to confirm what a guest actually paid for, so
-- the pass now carries its preorder lines and the reservation type name.
-- ------------------------------------------------------------
create or replace function public.resolve_pass(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  v_t record;
  v_r record;
  v_pre jsonb;
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
      'kind', 'ticket', 'pass_number', left(v_t.qr_token, 8), 'holder_name', null,
      'party_size', v_t.bundle_qty, 'status', v_t.status, 'paid', true,
      'type_name', v_t.type_name, 'event_name', v_t.event_name,
      'event_status', v_t.event_status, 'ticket_id', v_t.id
    );
  end if;

  select r.*, e.name as event_name, e.venue as event_venue, e.status as event_status,
         o.status as order_status, o.amount_kes, o.mpesa_receipt,
         rt.name as type_name
    into v_r
    from public.reservations r
    join public.events e on e.id = r.event_id
    left join public.orders o on o.id = r.order_id
    left join public.reservation_types rt on rt.id = r.reservation_type_id
   where r.access_token = p_token;

  if not found then
    return jsonb_build_object('kind', 'unknown', 'status', 'not_found');
  end if;

  -- What the guest paid for, so the door can hand over the right thing.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', pi.name, 'qty', oi.qty, 'unit_price_kes', oi.unit_price_kes)
         order by pi.position), '[]'::jsonb)
    into v_pre
    from public.order_items oi
    join public.preorder_items pi on pi.id = oi.preorder_item_id
   where oi.order_id = v_r.order_id;

  return jsonb_build_object(
    'kind', 'reservation',
    'pass_number', v_r.reservation_number,
    'holder_name', v_r.guest_name,
    'party_size', v_r.party_size,
    'status', v_r.status,
    'paid', case when v_r.order_id is null then true else v_r.order_status = 'paid' end,
    'order_status', v_r.order_status,
    'amount_kes', v_r.amount_kes,
    'mpesa_receipt', v_r.mpesa_receipt,
    'preorder', coalesce(v_pre, '[]'::jsonb),
    'type_name', v_r.type_name,
    'expected_arrival', v_r.expected_arrival,
    'event_name', v_r.event_name,
    'event_venue', v_r.event_venue,
    'event_status', v_r.event_status,
    'reservation_id', v_r.id
  );
end; $$;


-- ------------------------------------------------------------
-- refund_order(): handle reservation-backed orders
--
-- Manual refund policy: the money is reversed in M-Pesa outside the system and
-- the reference recorded here. A refunded preorder leaves the reservation in
-- place — the guest may still attend — but resolve_pass() reads payment from the
-- order, so a required-preorder event stops admitting them automatically.
-- ------------------------------------------------------------
create or replace function public.refund_order(
  p_order_id uuid, p_reason text, p_reversal_ref text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_res   public.reservations%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('result', 'forbidden');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_order.status not in ('paid', 'flagged') then
    return jsonb_build_object('result', 'ignored', 'status', v_order.status);
  end if;

  update public.orders
     set status = 'refunded', refund_reason = p_reason, reversal_ref = p_reversal_ref,
         refunded_by = v_actor, refunded_at = now()
   where id = p_order_id;

  update public.tickets set status = 'refunded'
   where order_id = p_order_id and status <> 'refunded';

  select * into v_res from public.reservations where order_id = p_order_id;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, 'refund_order', p_order_id, jsonb_build_object(
    'reason', p_reason, 'reversal_ref', p_reversal_ref,
    'previous_status', v_order.status, 'amount_kes', v_order.amount_kes,
    'reservation_number', v_res.reservation_number
  ));

  return jsonb_build_object('result', 'refunded', 'order_id', p_order_id,
    'reservation_number', v_res.reservation_number);
end; $$;
