-- ============================================================
-- A kill switch for payments, so an event can take reservations while M-Pesa
-- is still being provisioned.
--
-- Safaricom rejected the shortcode with "The shortcode does not support the API
-- product selected" — Lipa Na M-Pesa Online is not enabled on it. That is a
-- provisioning step on their side, not something the application can work
-- around, and it should not hold up free reservations.
--
-- With payments_enabled = false an event still takes reservations and issues
-- passes; preorder items stay visible but unbuyable, shown as coming soon.
-- Flipping it back to true is the only change needed once the shortcode is
-- provisioned — no migration, no redeploy.
--
-- Defaults to TRUE so existing ticketed events are untouched.
-- ============================================================
alter table public.events
  add column if not exists payments_enabled boolean not null default true;

comment on column public.events.payments_enabled is
  'When false, preorders are displayed but cannot be bought and no STK push is attempted. Used while M-Pesa provisioning is pending.';


-- create_reservation(): refuse to build an order for an event whose payments
-- are switched off. Checked before any row is written, so a guest cannot end up
-- with a pending_payment reservation that can never be paid.
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
  v_email    text := nullif(btrim(p_email), '');
  v_has_preorders boolean := jsonb_array_length(coalesce(p_preorders, '[]'::jsonb)) > 0;
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
   where event_id = p_event_id and phone = p_phone for update;
  if found then v_current := v_existing.party_size; end if;

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
end; $$;
