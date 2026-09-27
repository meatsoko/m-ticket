-- Paystack hosted checkout references coexist with the existing M-Pesa checkout IDs.
alter table public.orders
  add column if not exists paystack_reference text unique,
  add column if not exists payment_provider text not null default 'mpesa'
    check (payment_provider in ('mpesa', 'paystack'));

-- Paystack confirmations share the ticket/reservation issuance rules with M-Pesa,
-- while being keyed by a server-generated reference rather than a browser value.
create or replace function public.confirm_paystack_payment(
  p_reference text, p_amount_kes numeric
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_order public.orders%rowtype;
  v_res public.reservations%rowtype;
  v_item record;
  v_sold int;
begin
  select * into v_order from public.orders
   where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_order.status = 'paid' then
    return jsonb_build_object('result', 'already', 'order_id', v_order.id);
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
end; $$;

revoke all on function public.confirm_paystack_payment(text, numeric) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text, numeric) to service_role;
