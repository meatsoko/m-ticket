-- Platter add-ons: an in-person attendee (General Admission or a table) can
-- pre-order family platters separately, from their pass. Table bundles are
-- unchanged. Online attendees have no reservation, so they can't reach this.
--
-- Same shape as table upgrades (20260929180000): the pass token is the only
-- authorisation (start_platter_addon takes the 32-hex access_token, never a
-- phone or email); an order is created pending, Paystack is opened, and only
-- confirm_paystack_payment attaches the platters. The booking itself — party
-- size, ticket type, QR — never changes. Add-on order lines are ordinary
-- order_items, so platter quantity caps already count them.
--
-- A booking can have several add-ons (one per payment). Refunds go through
-- refund_event_order (outcome 'keep' = refund the platters, booking stays).

create table if not exists public.reservation_addons (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  order_id       uuid not null unique references public.orders(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'applied', 'failed', 'refunded', 'conflict')),
  created_at     timestamptz not null default now(),
  applied_at     timestamptz
);
create index if not exists reservation_addons_reservation_idx on public.reservation_addons (reservation_id);

alter table public.reservation_addons enable row level security;
revoke all on table public.reservation_addons from anon, authenticated;
grant select on table public.reservation_addons to authenticated;
drop policy if exists reservation_addons_staff_read on public.reservation_addons;
create policy reservation_addons_staff_read on public.reservation_addons
  for select to authenticated using (public.is_staff());

create or replace function public.start_platter_addon(p_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_res    public.reservations%rowtype;
  v_event  public.events%rowtype;
  v_item   public.preorder_items%rowtype;
  v_line   jsonb;
  v_qty    int;
  v_sold   int;
  v_order  uuid;
  v_amount numeric(10,2);
  v_count  int := 0;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then return jsonb_build_object('result', 'not_found'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 10 then
    return jsonb_build_object('result', 'bad_items');
  end if;

  select * into v_res from public.reservations where access_token = p_token for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_res.status <> 'confirmed' then
    return jsonb_build_object('result', 'not_eligible', 'status', v_res.status);
  end if;
  select * into v_event from public.events where id = v_res.event_id;
  if v_event.status <> 'live' then return jsonb_build_object('result', 'event_not_live'); end if;
  if not v_event.payments_enabled then return jsonb_build_object('result', 'payments_unavailable'); end if;
  if v_event.reservations_close_at is not null and now() > v_event.reservations_close_at then
    return jsonb_build_object('result', 'closed');
  end if;

  insert into public.orders (event_id, buyer_phone, buyer_email, channel, amount_kes, status)
  values (v_res.event_id, v_res.phone, v_res.email, 'web', 0, 'pending')
  returning id into v_order;

  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_line->>'qty')::int, 0);
    -- Only the platters sold with this event's table packages (the "family
    -- platters"), and only while active.
    select pi.* into v_item from public.preorder_items pi
     where pi.id = (v_line->>'preorder_item_id')::uuid and pi.event_id = v_res.event_id and pi.is_active
       and exists (select 1 from public.reservation_types t
                    where t.event_id = v_res.event_id and t.is_active and t.included_preorder_item_id = pi.id);
    if not found then raise exception using message = 'bad_item', errcode = 'P0001'; end if;
    if v_qty < 1 or v_qty > v_item.max_per_reservation then
      raise exception using message = 'bad_qty:' || v_item.name || ':' || v_item.max_per_reservation, errcode = 'P0001';
    end if;
    if v_item.quantity_cap is not null then
      select coalesce(sum(oi.qty), 0) into v_sold
        from public.order_items oi join public.orders o on o.id = oi.order_id
       where oi.preorder_item_id = v_item.id
         and (o.status = 'paid' or (o.status = 'pending' and o.created_at > now() - interval '10 minutes'));
      if v_sold + v_qty > v_item.quantity_cap then
        raise exception using message = 'sold_out:' || v_item.name, errcode = 'P0001';
      end if;
    end if;
    insert into public.order_items (order_id, preorder_item_id, qty, unit_price_kes)
    values (v_order, v_item.id, v_qty, v_item.price_kes);
    v_count := v_count + 1;
  end loop;

  v_amount := public.reprice_pending_reservation_order(v_order);
  insert into public.reservation_addons (reservation_id, order_id) values (v_res.id, v_order);
  return jsonb_build_object('result', 'created', 'order_id', v_order, 'amount_kes', v_amount,
    'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number,
    'email', v_res.email, 'lines', v_count);
exception
  -- A bad line undoes the whole add-on (the order insert included).
  when sqlstate 'P0001' then
    if sqlerrm = 'bad_item' then return jsonb_build_object('result', 'bad_item'); end if;
    if sqlerrm like 'bad_qty:%' then
      return jsonb_build_object('result', 'bad_qty', 'item', split_part(sqlerrm, ':', 2), 'max', split_part(sqlerrm, ':', 3)::int);
    end if;
    if sqlerrm like 'sold_out:%' then return jsonb_build_object('result', 'preorder_sold_out', 'item', split_part(sqlerrm, ':', 2)); end if;
    raise;
end; $$;

revoke all on function public.start_platter_addon(text, jsonb) from public, anon, authenticated;
grant execute on function public.start_platter_addon(text, jsonb) to service_role;

-- confirm_paystack_payment: the current body (20260929180000) plus the add-on branch.
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
  v_ad public.reservation_addons%rowtype;
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

  -- A platter add-on (start_platter_addon). Same lock order as upgrades:
  -- order, then the reservation, then the add-on row. The booking itself is
  -- not changed — the platters are attached to it.
  select * into v_ad from public.reservation_addons where order_id = v_order.id;
  if found then
    if v_order.status <> 'pending' or v_order.payment_provider is distinct from 'paystack' then
      return jsonb_build_object('result', 'ignored', 'status', v_order.status);
    end if;
    if v_order.amount_kes is distinct from p_amount_kes then
      update public.orders set status = 'flagged' where id = v_order.id;
      return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
    end if;
    select * into v_res from public.reservations where id = v_ad.reservation_id for update;
    select * into v_ad from public.reservation_addons where id = v_ad.id for update;
    if v_res.status in ('confirmed', 'checked_in') and v_ad.status = 'pending' then
      update public.orders set status = 'paid', paid_at = now() where id = v_order.id;
      update public.reservation_addons set status = 'applied', applied_at = now() where id = v_ad.id;
      return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id,
        'kind', 'reservation', 'addon', true, 'reservation_id', v_res.id,
        'reservation_number', v_res.reservation_number);
    end if;
    -- Paid for a booking that was cancelled meanwhile: flagged (paid_at set) for a refund.
    update public.orders set status = 'flagged', paid_at = now() where id = v_order.id;
    update public.reservation_addons set status = 'conflict' where id = v_ad.id;
    return jsonb_build_object('result', 'addon_conflict', 'order_id', v_order.id,
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

-- refund_event_order: the current body (20260930160000); also finds the booking
-- through reservation_addons and marks a refunded add-on 'refunded'.
create or replace function public.refund_event_order(
  p_order_id uuid, p_reason text, p_reversal_ref text default null, p_outcome text default 'keep'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_res   public.reservations%rowtype;
  v_up    public.reservation_upgrades%rowtype;
  v_ad    public.reservation_addons%rowtype;
  v_ga    uuid;
  v_note  text := null;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_outcome not in ('cancel', 'keep_ga', 'keep') then return jsonb_build_object('result', 'bad_outcome'); end if;
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('result', 'reason_required'); end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_order.status not in ('paid', 'flagged') then
    return jsonb_build_object('result', 'ignored', 'status', v_order.status);
  end if;

  -- The booking this payment belongs to: a table booking (order_id) or, for a
  -- table upgrade, the upgraded booking.
  select * into v_up from public.reservation_upgrades where order_id = p_order_id;
  select * into v_ad from public.reservation_addons where order_id = p_order_id;
  select * into v_res from public.reservations
   where id = coalesce(v_up.reservation_id, v_ad.reservation_id,
                       (select r.id from public.reservations r where r.order_id = p_order_id))
   for update;

  if p_outcome = 'keep_ga' then
    if v_up.id is null or v_res.id is null or v_res.order_id is distinct from p_order_id then
      return jsonb_build_object('result', 'not_an_upgrade');
    end if;
    select t.id into v_ga from public.reservation_types t
     where t.event_id = v_res.event_id and t.is_general_admission order by t.is_active desc, t.position limit 1;
    if v_ga is null then return jsonb_build_object('result', 'no_general_admission'); end if;
  end if;

  update public.orders
     set status = 'refunded', refund_reason = p_reason, reversal_ref = p_reversal_ref,
         refunded_by = v_actor, refunded_at = now()
   where id = p_order_id;
  update public.tickets set status = 'refunded' where order_id = p_order_id and status <> 'refunded';

  if p_outcome = 'cancel' and v_res.id is not null then
    if v_res.status in ('confirmed', 'pending_payment') then
      update public.reservations set status = 'cancelled' where id = v_res.id;
    else
      v_note := 'booking_' || v_res.status::text;   -- e.g. already checked in: left as is
    end if;
  end if;
  -- A refunded platter add-on no longer counts as ordered (whatever the outcome).
  if v_ad.id is not null then
    update public.reservation_addons set status = 'refunded' where id = v_ad.id;
  end if;
  if p_outcome = 'keep_ga' then
    update public.reservations
       set reservation_type_id = v_ga, accompanying_guests = 0, order_id = null
     where id = v_res.id;
    update public.reservation_upgrades set status = 'refunded' where id = v_up.id;
  end if;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, 'refund_event_order', p_order_id, jsonb_build_object(
    'reason', p_reason, 'reversal_ref', p_reversal_ref, 'outcome', p_outcome, 'note', v_note,
    'previous_status', v_order.status, 'amount_kes', v_order.amount_kes,
    'reservation_number', v_res.reservation_number));

  return jsonb_build_object('result', 'refunded', 'order_id', p_order_id, 'outcome', p_outcome,
    'reservation_number', v_res.reservation_number, 'note', v_note);
end; $$;

revoke all on function public.refund_event_order(uuid, text, text, text) from public, anon;
grant execute on function public.refund_event_order(uuid, text, text, text) to authenticated, service_role;

-- NyamaFest's family platters: allow up to 5 of each as add-ons. Table bundles
-- still add exactly one (reserve forces qty 1 for the included platter).
update public.preorder_items pi set max_per_reservation = 5
  from public.events e
 where e.id = pi.event_id and e.slug = 'nyamafest-main' and pi.max_per_reservation < 5
   and exists (select 1 from public.reservation_types t where t.included_preorder_item_id = pi.id);
