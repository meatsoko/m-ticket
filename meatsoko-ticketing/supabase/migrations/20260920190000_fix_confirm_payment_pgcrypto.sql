-- Fix: confirm_payment() could never create tickets.
--
-- Supabase installs pgcrypto into the `extensions` schema, not `public`. Because the
-- function pinned `search_path = public`, the gen_random_bytes(16) call used to mint QR
-- tokens raised 42883 "function gen_random_bytes(integer) does not exist", aborting the
-- whole transaction — so a confirmed M-Pesa payment left the order `pending` with no
-- tickets. (gen_random_uuid() is unaffected: it is core Postgres since 13.)
--
-- Only the search_path changes; the body is identical to schema.sql.
create or replace function public.confirm_payment(
  p_checkout_request_id text, p_receipt text, p_amount numeric
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_order public.orders%rowtype;
  v_item  record;
  v_sold  int;
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

  -- Enforce caps transactionally (R3)
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

  -- Create tickets; gate-channel orders are admitted immediately (FR-G2)
  for v_item in
    select oi.ticket_type_id, oi.qty
      from public.order_items oi where oi.order_id = v_order.id
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

  return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id);
end; $$;
