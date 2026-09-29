-- General Admission first, table as an upgrade (NyamaFest, "Option B").
--
-- The event page now leads with a free, one-person General Admission ticket:
-- the normal booking, booking number and QR pass. A table package (Basic 3 /
-- Moderate 7 / Big Family 10, each with its platter) is bought afterwards as an
-- UPGRADE of that same booking:
--
--   - same row, same reservation_number, same access_token (so the same QR);
--   - party_size becomes the table's fixed size;
--   - the platter and its Paystack payment are attached to the booking;
--   - nothing about the booking changes until Paystack says the money arrived
--     (confirm_paystack_payment). A failed, cancelled or abandoned payment
--     leaves it exactly as General Admission.
--
-- WHO MAY UPGRADE. Only the holder of the pass: start_reservation_upgrade takes
-- the 128-bit access_token (the QR/pass link that was emailed), never a phone
-- number or email. create_reservation is changed so that, on an event with a
-- General Admission type, the web form can ONLY issue/amend the free ticket —
-- re-submitting someone's phone + email can no longer attach a table to (or
-- strip one from) their booking.
--
-- CONCURRENCY. start_reservation_upgrade runs under the same per-event capacity
-- advisory lock as create_reservation and locks the reservation row. A newer
-- attempt supersedes older unpaid ones (they stop holding seats). If two
-- attempts are both paid, the first confirmation applies and the second is
-- flagged (paid_at set) for a refund — money is never silently ignored. Lock
-- order everywhere is order -> reservation -> upgrade row.
--
-- CAPACITY. A pending upgrade holds its extra seats for 30 minutes
-- (expected_attendance). Once paid it is applied even if that hold lapsed:
-- refusing a guest who has paid is worse than one table over the soft limit.
--
-- Events WITHOUT a General Admission type behave exactly as before.

alter table public.reservation_types
  add column if not exists is_general_admission boolean not null default false;

alter table public.reservation_types
  add constraint reservation_types_general_admission_shape check (
    not is_general_admission
    or (fixed_party_size = 1 and included_preorder_item_id is null)
  );

create unique index if not exists reservation_types_one_general_admission
  on public.reservation_types (event_id) where is_general_admission and is_active;

create table if not exists public.reservation_upgrades (
  id                  uuid primary key default gen_random_uuid(),
  reservation_id      uuid not null references public.reservations(id) on delete cascade,
  reservation_type_id uuid not null references public.reservation_types(id),
  order_id            uuid not null unique references public.orders(id) on delete cascade,
  from_party_size     int  not null check (from_party_size >= 1),
  to_party_size       int  not null check (to_party_size >= 1),
  -- pending: waiting for Paystack. superseded: a newer attempt was started
  -- (still applied if it turns out to be paid first). applied: done.
  -- conflict: paid but could not apply (flagged order, refund). failed:
  -- Paystack could not be opened.
  status              text not null default 'pending'
                      check (status in ('pending', 'superseded', 'applied', 'conflict', 'failed')),
  created_at          timestamptz not null default now(),
  applied_at          timestamptz
);

create index if not exists reservation_upgrades_reservation_idx
  on public.reservation_upgrades (reservation_id);
create unique index if not exists reservation_upgrades_one_applied
  on public.reservation_upgrades (reservation_id) where status = 'applied';

-- Server-side only; staff may read it (the dashboard), nobody writes it directly.
alter table public.reservation_upgrades enable row level security;
revoke all on table public.reservation_upgrades from anon, authenticated;
grant select on table public.reservation_upgrades to authenticated;
drop policy if exists reservation_upgrades_staff_read on public.reservation_upgrades;
create policy reservation_upgrades_staff_read on public.reservation_upgrades
  for select to authenticated using (public.is_staff());

-- expected_attendance: pending upgrades hold their extra seats (see header).
CREATE OR REPLACE FUNCTION public.expected_attendance(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  ),
  -- Table upgrades being paid for right now (start_reservation_upgrade) hold
  -- their extra seats for 30 minutes, like a ticket order holds for 10.
  upg as (
    select coalesce(sum(u.to_party_size - u.from_party_size), 0)::int as admissions
      from public.reservation_upgrades u
      join public.reservations r on r.id = u.reservation_id
      join public.orders o on o.id = u.order_id
     where r.event_id = p_event_id
       and u.status = 'pending'
       and r.order_id is null
       and r.status in ('confirmed', 'checked_in')
       and o.status = 'pending'
       and o.created_at > now() - interval '30 minutes'
  )
  select jsonb_build_object(
    'capacity',              e.capacity,
    'reservation_admissions', res.admissions + upg.admissions,
    'ticket_admissions',      tix.admissions + held.admissions,
    'expected_attendance',    res.admissions + upg.admissions + tix.admissions + held.admissions,
    'remaining',              case when e.capacity is null then null
                                   else greatest(0, e.capacity - (res.admissions + upg.admissions + tix.admissions + held.admissions)) end,
    'reservations',           res.reservations,
    'checked_in',             res.checked_in,
    'arrived_guests',         res.arrived
  )
  from public.events e, res, tix, held, upg
  where e.id = p_event_id;
$function$;

-- create_reservation: the live body (20260929170000) plus the two General
-- Admission guards marked in the code. Nothing else changed.
CREATE OR REPLACE FUNCTION public.create_reservation(p_event_id uuid, p_guest_name text, p_phone text, p_email text DEFAULT NULL::text, p_accompanying integer DEFAULT 0, p_arrival time without time zone DEFAULT NULL::time without time zone, p_preorders jsonb DEFAULT '[]'::jsonb, p_source text DEFAULT 'web'::text, p_reservation_type_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_email    text := nullif(btrim(p_email), '');
  v_has_preorders boolean := jsonb_array_length(coalesce(p_preorders, '[]'::jsonb)) > 0;
  v_ga       public.reservation_types%rowtype;
begin
  if coalesce(p_source, 'web') = 'web' and not public.looks_like_email(v_email) then
    return jsonb_build_object('result', 'email_required');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then return jsonb_build_object('result', 'event_not_found'); end if;
  if v_event.status <> 'live' then
    return jsonb_build_object('result', 'event_not_live', 'status', v_event.status);
  end if;
  if v_event.reservation_mode = 'off' then
    return jsonb_build_object('result', 'reservations_disabled');
  end if;

  -- General Admission events: a web booking is only ever the free one-person
  -- ticket. A table is added later by start_reservation_upgrade(), which needs
  -- the pass token — never by re-submitting someone's phone and email here.
  if coalesce(p_source, 'web') = 'web' then
    select * into v_ga from public.reservation_types
     where event_id = p_event_id and is_general_admission and is_active
     order by position limit 1;
    if v_ga.id is not null then
      if v_has_preorders
         or (p_reservation_type_id is not null and p_reservation_type_id <> v_ga.id) then
        return jsonb_build_object('result', 'upgrade_required');
      end if;
      p_reservation_type_id := v_ga.id;
    end if;
  end if;

  -- Payments switched off: reservations continue, preorders do not.
  if v_has_preorders and not v_event.payments_enabled then
    return jsonb_build_object('result', 'payments_unavailable');
  end if;
  if v_event.reservation_mode = 'required_preorder' and not v_event.payments_enabled then
    return jsonb_build_object('result', 'payments_unavailable');
  end if;

  if v_event.reservations_open_at is not null and now() < v_event.reservations_open_at then
    return jsonb_build_object('result', 'not_open_yet', 'opens_at', v_event.reservations_open_at);
  end if;
  if v_event.reservations_close_at is not null and now() > v_event.reservations_close_at then
    return jsonb_build_object('result', 'closed', 'closed_at', v_event.reservations_close_at);
  end if;

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
    v_party := 1 + greatest(0, coalesce(p_accompanying, 0));
  end if;

  if v_party > v_event.max_party_size then
    return jsonb_build_object('result', 'party_too_large', 'max_party_size', v_event.max_party_size);
  end if;
  if v_event.reservation_mode = 'free' and v_has_preorders then
    return jsonb_build_object('result', 'preorders_not_offered');
  end if;

  perform pg_advisory_xact_lock(hashtext('event_capacity:' || p_event_id::text));

  select * into v_existing from public.reservations
   where event_id = p_event_id and phone = p_phone
     and lower(email) is not distinct from lower(v_email)
   for update;
  if found then v_current := v_existing.party_size; end if;

  -- An upgraded (or older table) booking is never rewritten by the free form:
  -- that would drop a paid table back to one person.
  if v_ga.id is not null and v_existing.id is not null
     and (v_existing.order_id is not null or v_existing.reservation_type_id is distinct from v_ga.id) then
    return jsonb_build_object('result', 'already_booked',
      'reservation_id', v_existing.id, 'reservation_number', v_existing.reservation_number,
      'party_size', v_existing.party_size, 'status', v_existing.status);
  end if;

  if v_event.capacity is not null then
    v_att := public.expected_attendance(p_event_id);
    if (v_att->>'expected_attendance')::int - v_current + v_party > v_event.capacity then
      return jsonb_build_object('result', 'full', 'capacity', v_event.capacity,
        'remaining', greatest(0, v_event.capacity - ((v_att->>'expected_attendance')::int - v_current)));
    end if;
  end if;

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
           email = coalesce(v_email, email),
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
      p_guest_name, p_phone, v_email,
      greatest(0, v_party - 1), p_arrival, coalesce(p_source, 'web'),
      case when v_amount > 0 then 'pending_payment'::reservation_status
           else 'confirmed'::reservation_status end,
      p_reservation_type_id
    ) returning * into v_row;
  end if;

  if v_amount > 0 then
    insert into public.orders (event_id, buyer_phone, buyer_email, channel, amount_kes, status)
    values (p_event_id, p_phone, v_email, coalesce(p_source, 'web'), v_amount, 'pending')
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
    'reservation_id', v_row.id, 'reservation_number', v_row.reservation_number,
    'access_token', v_row.access_token, 'party_size', v_row.party_size,
    'status', v_row.status, 'order_id', v_row.order_id, 'amount_kes', v_amount
  );
end; $function$;

revoke all on function public.create_reservation(uuid, text, text, text, integer, time without time zone, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.create_reservation(uuid, text, text, text, integer, time without time zone, jsonb, text, uuid) to service_role;

-- Start a table upgrade for the holder of a pass. Creates a pending order for the
-- table's platter; the booking itself is untouched until payment confirms.
create or replace function public.start_reservation_upgrade(p_token text, p_reservation_type_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_res    public.reservations%rowtype;
  v_event  public.events%rowtype;
  v_type   public.reservation_types%rowtype;
  v_item   public.preorder_items%rowtype;
  v_att    jsonb;
  v_sold   int;
  v_order  uuid;
  v_amount numeric(10,2);
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then
    return jsonb_build_object('result', 'not_found');
  end if;
  select * into v_res from public.reservations where access_token = p_token;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  perform pg_advisory_xact_lock(hashtext('event_capacity:' || v_res.event_id::text));
  select * into v_res from public.reservations where id = v_res.id for update;

  select * into v_event from public.events where id = v_res.event_id;
  if v_event.status <> 'live' then
    return jsonb_build_object('result', 'event_not_live');
  end if;
  if not v_event.payments_enabled then
    return jsonb_build_object('result', 'payments_unavailable');
  end if;
  if v_event.reservations_close_at is not null and now() > v_event.reservations_close_at then
    return jsonb_build_object('result', 'closed');
  end if;

  if v_res.order_id is not null then
    return jsonb_build_object('result', 'already_upgraded');
  end if;
  if not exists (select 1 from public.reservation_types t
                  where t.id = v_res.reservation_type_id and t.is_general_admission) then
    return jsonb_build_object('result', 'not_general_admission');
  end if;
  if v_res.status <> 'confirmed' then
    return jsonb_build_object('result', 'not_upgradable', 'status', v_res.status);
  end if;

  select * into v_type from public.reservation_types
   where id = p_reservation_type_id and event_id = v_res.event_id and is_active
     and not is_general_admission
     and included_preorder_item_id is not null and fixed_party_size is not null;
  if not found then return jsonb_build_object('result', 'bad_reservation_type'); end if;
  select * into v_item from public.preorder_items
   where id = v_type.included_preorder_item_id and is_active;
  if not found then return jsonb_build_object('result', 'bad_reservation_type'); end if;

  -- A newer attempt replaces older unpaid ones: they stop holding seats. Their
  -- orders stay pending, so if one of them is paid first it still applies.
  update public.reservation_upgrades set status = 'superseded'
   where reservation_id = v_res.id and status = 'pending';

  if v_item.quantity_cap is not null then
    select coalesce(sum(oi.qty), 0) into v_sold
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where oi.preorder_item_id = v_item.id
       and (o.status = 'paid' or (o.status = 'pending' and o.created_at > now() - interval '10 minutes'));
    if v_sold + 1 > v_item.quantity_cap then
      return jsonb_build_object('result', 'preorder_sold_out', 'item', v_item.name);
    end if;
  end if;

  if v_event.capacity is not null then
    v_att := public.expected_attendance(v_res.event_id);
    if (v_att->>'expected_attendance')::int - v_res.party_size + v_type.fixed_party_size > v_event.capacity then
      return jsonb_build_object('result', 'full', 'capacity', v_event.capacity,
        'remaining', greatest(0, v_event.capacity - (v_att->>'expected_attendance')::int));
    end if;
  end if;

  insert into public.orders (event_id, buyer_phone, buyer_email, channel, amount_kes, status)
  values (v_res.event_id, v_res.phone, v_res.email, 'web', v_item.price_kes, 'pending')
  returning id into v_order;
  insert into public.order_items (order_id, preorder_item_id, qty, unit_price_kes)
  values (v_order, v_item.id, 1, v_item.price_kes);
  -- Early-bird / regular price, exactly as reserve prices a table booking.
  v_amount := public.reprice_pending_reservation_order(v_order);

  insert into public.reservation_upgrades
    (reservation_id, reservation_type_id, order_id, from_party_size, to_party_size)
  values (v_res.id, v_type.id, v_order, v_res.party_size, v_type.fixed_party_size);

  return jsonb_build_object('result', 'created', 'order_id', v_order, 'amount_kes', v_amount,
    'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number,
    'email', v_res.email, 'event_id', v_res.event_id, 'event_slug', v_event.slug,
    'type_name', v_type.name, 'party_size', v_type.fixed_party_size);
end; $$;

revoke all on function public.start_reservation_upgrade(text, uuid) from public, anon, authenticated;
grant execute on function public.start_reservation_upgrade(text, uuid) to service_role;

-- confirm_paystack_payment: the live body plus the table-upgrade branch.

CREATE OR REPLACE FUNCTION public.confirm_paystack_payment(p_reference text, p_amount_kes numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_order public.orders%rowtype;
  v_res public.reservations%rowtype;
  v_item record;
  v_sold int;
  v_up public.reservation_upgrades%rowtype;
begin
  select * into v_order from public.orders
   where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_order.status = 'paid' then
    return jsonb_build_object('result', 'already', 'order_id', v_order.id);
  end if;
  -- A table upgrade (start_reservation_upgrade). Lock order: order, then the
  -- reservation, then the upgrade row — the same order start_reservation_upgrade
  -- uses after its reservation lock, so two payments cannot deadlock.
  select * into v_up from public.reservation_upgrades where order_id = v_order.id;
  if found then
    if v_order.status <> 'pending' or v_order.payment_provider is distinct from 'paystack' then
      return jsonb_build_object('result', 'ignored', 'status', v_order.status);
    end if;
    if v_order.amount_kes is distinct from p_amount_kes then
      update public.orders set status = 'flagged' where id = v_order.id;
      return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
    end if;
    select * into v_res from public.reservations where id = v_up.reservation_id for update;
    select * into v_up from public.reservation_upgrades where id = v_up.id for update;
    if v_res.order_id is null
       and v_res.status in ('confirmed', 'checked_in')
       and v_up.status in ('pending', 'superseded')
       and exists (select 1 from public.reservation_types t
                    where t.id = v_res.reservation_type_id and t.is_general_admission) then
      update public.orders set status = 'paid', paid_at = now() where id = v_order.id;
      update public.reservations
         set reservation_type_id = v_up.reservation_type_id,
             accompanying_guests = v_up.to_party_size - 1,
             order_id = v_order.id
       where id = v_res.id returning * into v_res;
      update public.reservation_upgrades set status = 'applied', applied_at = now() where id = v_up.id;
      return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id,
        'kind', 'reservation', 'upgraded', true, 'reservation_id', v_res.id,
        'reservation_number', v_res.reservation_number);
    end if;
    -- Paid, but the booking was already upgraded (a second tab) or is no longer
    -- valid. Never silently dropped: flagged with paid_at set, for a refund.
    update public.orders set status = 'flagged', paid_at = now() where id = v_order.id;
    update public.reservation_upgrades set status = 'conflict' where id = v_up.id;
    return jsonb_build_object('result', 'upgrade_conflict', 'order_id', v_order.id,
      'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number);
  end if;

  if v_order.status <> 'pending' or v_order.payment_provider <> 'paystack' then
    return jsonb_build_object('result', 'ignored', 'status', v_order.status);
  end if;
  if v_order.amount_kes is distinct from p_amount_kes then
    update public.orders set status = 'flagged' where id = v_order.id;
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  end if;

  select * into v_res from public.reservations where order_id = v_order.id for update;
  if found then
    update public.orders set status = 'paid', paid_at = now() where id = v_order.id;
    update public.reservations
       set status = case when status = 'checked_in' then status
                         else 'confirmed'::reservation_status end
     where id = v_res.id returning * into v_res;
    return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id,
      'kind', 'reservation', 'reservation_id', v_res.id,
      'reservation_number', v_res.reservation_number);
  end if;

  for v_item in
    select oi.ticket_type_id, oi.qty, tt.name, tt.quantity_cap, tt.bundle_qty
      from public.order_items oi join public.ticket_types tt on tt.id = oi.ticket_type_id
     where oi.order_id = v_order.id
  loop
    if v_item.quantity_cap is not null then
      select coalesce(sum(tt2.bundle_qty), 0) into v_sold
        from public.tickets t join public.ticket_types tt2 on tt2.id = t.ticket_type_id
       where t.ticket_type_id = v_item.ticket_type_id and t.status <> 'refunded';
      if v_sold + v_item.qty * v_item.bundle_qty > v_item.quantity_cap then
        update public.orders set status = 'flagged' where id = v_order.id;
        return jsonb_build_object('result', 'cap_exceeded', 'ticket_type', v_item.name);
      end if;
    end if;
  end loop;

  update public.orders set status = 'paid', paid_at = now() where id = v_order.id;
  for v_item in
    select oi.ticket_type_id, oi.qty from public.order_items oi
     where oi.order_id = v_order.id and oi.ticket_type_id is not null
  loop
    for i in 1..v_item.qty loop
      insert into public.tickets (order_id, ticket_type_id, qr_token, status, redeemed_at)
      values (v_order.id, v_item.ticket_type_id, encode(gen_random_bytes(16), 'hex'),
        case when v_order.channel = 'gate' then 'redeemed'::ticket_status else 'active'::ticket_status end,
        case when v_order.channel = 'gate' then now() else null end);
    end loop;
  end loop;
  if v_order.channel = 'gate' then
    insert into public.redemptions (ticket_id, redemption_type, station, scanned_by)
    select t.id, 'entry', 'gate-sale', null from public.tickets t where t.order_id = v_order.id
    on conflict do nothing;
  end if;
  return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id, 'kind', 'ticket');
end; $function$;

revoke all on function public.confirm_paystack_payment(text, numeric) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text, numeric) to service_role;

-- NyamaFest's General Admission ticket. Shown first on the event page; the three
-- table packages become upgrades.
insert into public.reservation_types
  (event_id, name, description, fixed_party_size, min_party_size, max_party_size, position, is_active, is_general_admission)
select e.id, 'General Admission', 'Free entry for one person.', 1, 1, 1, 0, true, true
  from public.events e
 where e.slug = 'nyamafest-main'
   and not exists (select 1 from public.reservation_types t
                    where t.event_id = e.id and t.is_general_admission);
