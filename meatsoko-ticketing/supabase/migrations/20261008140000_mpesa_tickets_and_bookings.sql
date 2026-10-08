-- M-Pesa (Daraja, through the payhero_payments ledger) for the two flows that
-- still used the legacy Daraja client: paid-ticket checkout and gate sales
-- (stk-push) and bookings with a paid pre-order (reserve). The user's call on
-- 2026-10-08: every payment goes through the new Daraja path to the till.
--
-- stk-push and reserve keep creating their orders exactly as before; they now
-- open a ledger row (kind 'event') and send the prompt with darajaStkPush, so
-- the money is verified by STK Push Query (verifyMpesa) like every other M-Pesa
-- payment. That needs two changes here:
--
-- 1. confirm_payhero_event_payment: its catch-all ("unsupported_order", flagged
--    for a human) becomes two real branches, copied from confirm_paystack_payment
--    (20261001120000): a booking whose order_id is this order is confirmed; a
--    ticket order mints its tickets (redeemed at once for a gate sale) after the
--    same quantity-cap check. Change a rule here, check the Paystack one too.
-- 2. fail_payhero_payment: stk-push lets a buyer retry by reusing the order, so a
--    failed first prompt must not fail an order a second prompt is still open for.
--
-- Both functions keep their grants (create or replace), re-stated below anyway.

create or replace function public.confirm_payhero_event_payment(p_reference text, p_amount_kes numeric, p_receipt text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pay   public.payhero_payments%rowtype;
  v_order public.orders%rowtype;
  v_res   public.reservations%rowtype;
  v_up    public.reservation_upgrades%rowtype;
  v_ad    public.reservation_addons%rowtype;
  v_out   jsonb;
  v_item  record;
  v_sold  int;
begin
  select * into v_pay from public.payhero_payments where reference = p_reference and kind = 'event' for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_pay.status = 'success' then
    return jsonb_build_object('result', 'already', 'order_id', v_pay.order_id, 'outcome', v_pay.outcome);
  end if;

  select * into v_order from public.orders where id = v_pay.order_id for update;
  if not found then
    v_out := jsonb_build_object('result', 'unknown_order');
  elsif v_order.paystack_reference is not null then
    -- Never a PayHero order (defence in depth: payhero-pay only creates fresh orders).
    v_out := jsonb_build_object('result', 'ignored', 'status', 'paystack_order');
  elsif v_order.status = 'paid' then
    v_out := jsonb_build_object('result', 'already', 'order_id', v_order.id);
  elsif v_order.status not in ('pending', 'failed') then
    v_out := jsonb_build_object('result', 'ignored', 'status', v_order.status);
  elsif v_order.amount_kes is distinct from p_amount_kes or v_pay.amount_kes is distinct from p_amount_kes then
    update public.orders set status = 'flagged', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
    v_out := jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  elsif v_order.status = 'failed' then
    -- Money arrived after we gave up on it (e.g. the PIN was entered very late):
    -- never dropped — flagged with paid_at set, for a refund or a manual apply.
    update public.orders set status = 'flagged', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
    v_out := jsonb_build_object('result', 'paid_after_failed', 'order_id', v_order.id);
  else
    select * into v_up from public.reservation_upgrades where order_id = v_order.id;
    if found then
      select * into v_res from public.reservations where id = v_up.reservation_id for update;
      select * into v_up from public.reservation_upgrades where id = v_up.id for update;
      if v_res.order_id is null
         and v_res.status in ('confirmed', 'checked_in')
         and v_up.status in ('pending', 'superseded')
         and exists (select 1 from public.reservation_types t
                      where t.id = v_res.reservation_type_id and t.is_general_admission) then
        update public.orders set status = 'paid', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
        update public.reservations
           set reservation_type_id = v_up.reservation_type_id,
               accompanying_guests = v_up.to_party_size - 1,
               order_id = v_order.id
         where id = v_res.id returning * into v_res;
        update public.reservation_upgrades set status = 'applied', applied_at = now() where id = v_up.id;
        v_out := jsonb_build_object('result', 'confirmed', 'order_id', v_order.id, 'kind', 'reservation',
          'upgraded', true, 'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number);
      else
        update public.orders set status = 'flagged', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
        update public.reservation_upgrades set status = 'conflict' where id = v_up.id;
        v_out := jsonb_build_object('result', 'upgrade_conflict', 'order_id', v_order.id,
          'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number);
      end if;
    else
      select * into v_ad from public.reservation_addons where order_id = v_order.id;
      if found then
        select * into v_res from public.reservations where id = v_ad.reservation_id for update;
        select * into v_ad from public.reservation_addons where id = v_ad.id for update;
        if v_res.status in ('confirmed', 'checked_in') and v_ad.status = 'pending' then
          update public.orders set status = 'paid', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
          update public.reservation_addons set status = 'applied', applied_at = now() where id = v_ad.id;
          v_out := jsonb_build_object('result', 'confirmed', 'order_id', v_order.id, 'kind', 'reservation',
            'addon', true, 'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number);
        else
          update public.orders set status = 'flagged', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
          update public.reservation_addons set status = 'conflict' where id = v_ad.id;
          v_out := jsonb_build_object('result', 'addon_conflict', 'order_id', v_order.id,
            'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number);
        end if;
      else
        select * into v_res from public.reservations where order_id = v_order.id for update;
        if found then
          -- A booking with a paid pre-order (reserve). Same rule as confirm_paystack_payment.
          update public.orders set status = 'paid', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
          update public.reservations
             set status = case when status = 'checked_in' then status else 'confirmed'::reservation_status end
           where id = v_res.id returning * into v_res;
          v_out := jsonb_build_object('result', 'confirmed', 'order_id', v_order.id, 'kind', 'reservation',
            'reservation_id', v_res.id, 'reservation_number', v_res.reservation_number);
        elsif exists (select 1 from public.order_items oi where oi.order_id = v_order.id and oi.ticket_type_id is not null) then
          -- A paid-ticket order (stk-push: web checkout or a gate sale). Same rules as
          -- confirm_paystack_payment, except that a cap overrun keeps paid_at: the money
          -- arrived and is flagged for a human, never dropped.
          for v_item in
            select oi.ticket_type_id, oi.qty, tt.name, tt.quantity_cap, tt.bundle_qty
              from public.order_items oi join public.ticket_types tt on tt.id = oi.ticket_type_id
             where oi.order_id = v_order.id
          loop
            if v_out is null and v_item.quantity_cap is not null then
              select coalesce(sum(tt2.bundle_qty), 0) into v_sold
                from public.tickets t join public.ticket_types tt2 on tt2.id = t.ticket_type_id
               where t.ticket_type_id = v_item.ticket_type_id and t.status <> 'refunded';
              if v_sold + v_item.qty * v_item.bundle_qty > v_item.quantity_cap then
                update public.orders set status = 'flagged', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
                v_out := jsonb_build_object('result', 'cap_exceeded', 'order_id', v_order.id, 'ticket_type', v_item.name);
              end if;
            end if;
          end loop;
          if v_out is null then
            update public.orders set status = 'paid', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
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
            v_out := jsonb_build_object('result', 'confirmed', 'order_id', v_order.id, 'kind', 'ticket');
          end if;
        else
          -- Nothing we know how to apply: for a human.
          update public.orders set status = 'flagged', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
          v_out := jsonb_build_object('result', 'unsupported_order', 'order_id', v_order.id);
        end if;
      end if;
    end if;
  end if;

  update public.payhero_payments
     set status = 'success', outcome = v_out->>'result', mpesa_receipt = p_receipt,
         confirmed_at = now(), updated_at = now()
   where id = v_pay.id;
  return v_out;
end; $$;

create or replace function public.fail_payhero_payment(p_reference text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_pay public.payhero_payments%rowtype;
begin
  select * into v_pay from public.payhero_payments where reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_pay.status <> 'queued' then return jsonb_build_object('result', 'ignored', 'status', v_pay.status); end if;
  update public.payhero_payments
     set status = 'failed', result_desc = left(p_reason, 300), updated_at = now() where id = v_pay.id;
  if v_pay.kind = 'event' then
    -- A retried ticket order (stk-push reuses the order) can have a newer prompt
    -- still open: the order stays pending for it.
    update public.orders set status = 'failed'
     where id = v_pay.order_id and status = 'pending' and paystack_reference is null
       and not exists (select 1 from public.payhero_payments p
                        where p.order_id = v_pay.order_id and p.id <> v_pay.id and p.status = 'queued');
    update public.reservation_upgrades set status = 'failed' where order_id = v_pay.order_id and status = 'pending';
    update public.reservation_addons set status = 'failed' where order_id = v_pay.order_id and status = 'pending';
  elsif v_pay.kind = 'merch' then
    update public.merch_orders set payment_status = 'failed'
     where id = v_pay.merch_order_id and payment_status = 'pending' and paystack_reference is null;
  end if;
  return jsonb_build_object('result', 'failed', 'kind', v_pay.kind);
end; $$;

revoke all on function public.confirm_payhero_event_payment(text, numeric, text) from public, anon, authenticated;
revoke all on function public.fail_payhero_payment(text, text) from public, anon, authenticated;
grant execute on function public.confirm_payhero_event_payment(text, numeric, text) to service_role;
grant execute on function public.fail_payhero_payment(text, text) to service_role;
