-- PayHero: M-Pesa STK payments ALONGSIDE Paystack (2026-10-07, the user's
-- decision). Paystack's code and functions are untouched on purpose: PayHero
-- has its own ledger and its own confirmation functions below, which copy the
-- business rules of confirm_paystack_payment, confirm_vendor_payment and
-- merch_confirm_payment rather than calling them (the user chose a separate
-- implementation over a shared core). If you change a rule in one, check the
-- other.
--
-- How a PayHero payment works:
--   1. payhero-pay creates the order the usual way (start_reservation_upgrade,
--      start_platter_addon, a vendor registration, merch_create_order), records
--      a row here with our reference ("PH" + 32 hex) and asks PayHero to send an
--      STK prompt to the payer's phone.
--   2. PayHero calls payhero-callback. The callback is NOT signed, so it is only
--      a nudge: the function asks PayHero's transaction-status API itself and
--      only a SUCCESS from there reaches confirm_payhero_*.
--   3. payhero-status (the page waiting for the PIN) and payhero-reconcile (cron)
--      ask the same question, so a lost callback never loses a payment.
--
-- PayHero orders never carry a Paystack reference, so the Paystack paths
-- (paystack-verify, paystack-reconcile, confirm_paystack_payment) never see
-- them: event orders keep payment_provider 'mpesa' with paystack_reference
-- null, and merch orders paid by PayHero have their generated MS reference
-- cleared by payhero-pay before the STK push.
--
-- Access: RLS on, staff read the ledger; only the service role writes. Every
-- function here is SECURITY DEFINER with EXECUTE revoked from PUBLIC (see the
-- repo CLAUDE.md §5).

create table if not exists public.payhero_payments (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique check (reference ~ '^PH[a-f0-9]{32}$'),
  kind                  text not null check (kind in ('event', 'vendor', 'merch')),
  order_id              uuid references public.orders(id) on delete set null,
  vendor_application_id uuid references public.vendor_applications(id) on delete set null,
  merch_order_id        uuid references public.merch_orders(id) on delete set null,
  phone                 text not null check (phone ~ '^254[0-9]{9}$'),   -- the M-Pesa number prompted
  amount_kes            numeric(12,2) not null check (amount_kes >= 1),
  status                text not null default 'queued'
                        check (status in ('queued', 'success', 'failed')),
  outcome               text,          -- what confirmation did with the money (confirmed, already, upgrade_conflict, ...)
  payhero_reference     text,          -- PayHero's own reference, for transaction-status
  checkout_request_id   text,
  mpesa_receipt         text,
  result_desc           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  confirmed_at          timestamptz,
  constraint payhero_payments_target check (
    (kind = 'event'  and order_id is not null) or
    (kind = 'vendor' and vendor_application_id is not null) or
    (kind = 'merch'  and merch_order_id is not null))
);
create index if not exists payhero_payments_queued_idx on public.payhero_payments (created_at) where status = 'queued';
create index if not exists payhero_payments_order_idx on public.payhero_payments (order_id);
create index if not exists payhero_payments_vendor_idx on public.payhero_payments (vendor_application_id);
create index if not exists payhero_payments_merch_idx on public.payhero_payments (merch_order_id);

alter table public.payhero_payments enable row level security;
revoke all on table public.payhero_payments from anon, authenticated;
grant select on table public.payhero_payments to authenticated;
drop policy if exists payhero_payments_staff_read on public.payhero_payments;
create policy payhero_payments_staff_read on public.payhero_payments
  for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Event payments: table upgrades, platter add-ons. Same rules as
-- confirm_paystack_payment's upgrade and add-on branches (20261001120000), keyed
-- on the ledger row instead of a Paystack reference.
-- ---------------------------------------------------------------------------
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
        -- payhero-pay only opens upgrades and add-ons; anything else is for a human.
        update public.orders set status = 'flagged', paid_at = now(), mpesa_receipt = p_receipt where id = v_order.id;
        v_out := jsonb_build_object('result', 'unsupported_order', 'order_id', v_order.id);
      end if;
    end if;
  end if;

  update public.payhero_payments
     set status = 'success', outcome = v_out->>'result', mpesa_receipt = p_receipt,
         confirmed_at = now(), updated_at = now()
   where id = v_pay.id;
  return v_out;
end; $$;

-- ---------------------------------------------------------------------------
-- Vendor tent fee. Same rules as confirm_vendor_payment (20260930180000).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_payhero_vendor_payment(p_reference text, p_amount_kes numeric, p_receipt text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pay public.payhero_payments%rowtype;
  v     public.vendor_applications%rowtype;
  v_out jsonb;
begin
  select * into v_pay from public.payhero_payments where reference = p_reference and kind = 'vendor' for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_pay.status = 'success' then
    return jsonb_build_object('result', 'already', 'id', v_pay.vendor_application_id, 'outcome', v_pay.outcome);
  end if;

  select * into v from public.vendor_applications where id = v_pay.vendor_application_id for update;
  if not found then
    v_out := jsonb_build_object('result', 'unknown_registration');
  elsif v.status = 'paid' then
    -- Already paid (another tab, or Paystack): keep the tent, flag the extra money.
    update public.vendor_applications
       set flag_reason = concat_ws('; ', flag_reason, 'duplicate_payment ' || p_reference), updated_at = now()
     where id = v.id;
    v_out := jsonb_build_object('result', 'duplicate_payment', 'id', v.id);
  elsif v.status <> 'pending_payment' then
    update public.vendor_applications set status = 'flagged', flag_reason = 'paid_after_' || v.status,
           paid_at = now(), updated_at = now() where id = v.id;
    v_out := jsonb_build_object('result', 'flagged', 'id', v.id);
  elsif v.amount_kes is distinct from p_amount_kes or v_pay.amount_kes is distinct from p_amount_kes then
    update public.vendor_applications set status = 'flagged', flag_reason = 'amount_mismatch',
           paid_at = now(), updated_at = now() where id = v.id;
    v_out := jsonb_build_object('result', 'amount_mismatch', 'id', v.id);
  else
    update public.vendor_applications set status = 'paid', paid_at = now(), updated_at = now() where id = v.id;
    v_out := jsonb_build_object('result', 'confirmed', 'id', v.id, 'reference_number', v.reference_number);
  end if;

  update public.payhero_payments
     set status = 'success', outcome = v_out->>'result', mpesa_receipt = p_receipt,
         confirmed_at = now(), updated_at = now()
   where id = v_pay.id;
  return v_out;
end; $$;

-- ---------------------------------------------------------------------------
-- Merchandise. Same rules as merch_confirm_payment (20260929120000): amount
-- check, stock taken from what is on hand (flag if it ran out), movement ledger.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_payhero_merch_payment(p_reference text, p_amount_kes numeric, p_receipt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay   public.payhero_payments%rowtype;
  v_order public.merch_orders%rowtype;
  v_item  record;
  v_new   int;
  v_out   jsonb;
begin
  select * into v_pay from public.payhero_payments where reference = p_reference and kind = 'merch' for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_pay.status = 'success' then
    return jsonb_build_object('result', 'already', 'order_id', v_pay.merch_order_id, 'outcome', v_pay.outcome);
  end if;

  select * into v_order from public.merch_orders where id = v_pay.merch_order_id for update;
  if not found then
    v_out := jsonb_build_object('result', 'unknown_order');
  elsif v_order.paystack_reference is not null then
    v_out := jsonb_build_object('result', 'ignored', 'status', 'paystack_order');
  elsif v_order.payment_status = 'paid' then
    v_out := jsonb_build_object('result', 'already', 'order_id', v_order.id);
  elsif v_order.payment_status not in ('pending', 'failed') then
    v_out := jsonb_build_object('result', 'ignored', 'status', v_order.payment_status);
  elsif v_order.total_kes is distinct from p_amount_kes or v_pay.amount_kes is distinct from p_amount_kes then
    update public.merch_orders set payment_status = 'flagged', flag_reason = 'amount_mismatch' where id = v_order.id;
    v_out := jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  else
    perform 1 from public.merch_variants
     where id in (select variant_id from public.merch_order_items where order_id = v_order.id)
     order by id for update;
    for v_item in
      select i.variant_id, i.qty, i.sku, v.stock_on_hand
        from public.merch_order_items i join public.merch_variants v on v.id = i.variant_id
       where i.order_id = v_order.id
    loop
      if v_item.stock_on_hand is not null and v_item.stock_on_hand < v_item.qty then
        update public.merch_orders set payment_status = 'flagged', flag_reason = 'stock_exhausted:' || v_item.sku
         where id = v_order.id;
        v_out := jsonb_build_object('result', 'stock_exhausted', 'order_id', v_order.id, 'sku', v_item.sku);
        exit;
      end if;
    end loop;
    if v_out is null then
      perform set_config('merch.stock_write', 'on', true);
      for v_item in
        select i.variant_id, i.qty from public.merch_order_items i
          join public.merch_variants v on v.id = i.variant_id
         where i.order_id = v_order.id and v.stock_on_hand is not null
      loop
        update public.merch_variants set stock_on_hand = stock_on_hand - v_item.qty
         where id = v_item.variant_id returning stock_on_hand into v_new;
        insert into public.merch_stock_movements (variant_id, delta, reason, order_id, balance)
        values (v_item.variant_id, -v_item.qty, 'sale', v_order.id, v_new);
      end loop;
      perform set_config('merch.stock_write', 'off', true);
      update public.merch_orders set payment_status = 'paid', paid_at = now(), flag_reason = null where id = v_order.id;
      v_out := jsonb_build_object('result', 'confirmed', 'order_id', v_order.id,
        'order_number', v_order.order_number, 'access_token', v_order.access_token, 'email', v_order.email);
    end if;
  end if;

  update public.payhero_payments
     set status = 'success', outcome = v_out->>'result', mpesa_receipt = p_receipt,
         confirmed_at = now(), updated_at = now()
   where id = v_pay.id;
  return v_out;
end; $$;

-- ---------------------------------------------------------------------------
-- PayHero says the payment failed (cancelled, wrong PIN, timed out, no funds).
-- Releases what the order held: the upgrade or add-on is marked failed (the
-- booking stays as it was), a merch order releases its stock hold; a vendor
-- registration simply stays pending_payment so they can try again.
-- ---------------------------------------------------------------------------
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
    update public.orders set status = 'failed'
     where id = v_pay.order_id and status = 'pending' and paystack_reference is null;
    update public.reservation_upgrades set status = 'failed' where order_id = v_pay.order_id and status = 'pending';
    update public.reservation_addons set status = 'failed' where order_id = v_pay.order_id and status = 'pending';
  elsif v_pay.kind = 'merch' then
    update public.merch_orders set payment_status = 'failed'
     where id = v_pay.merch_order_id and payment_status = 'pending' and paystack_reference is null;
  end if;
  return jsonb_build_object('result', 'failed', 'kind', v_pay.kind);
end; $$;

revoke all on function public.confirm_payhero_event_payment(text, numeric, text) from public, anon, authenticated;
revoke all on function public.confirm_payhero_vendor_payment(text, numeric, text) from public, anon, authenticated;
revoke all on function public.confirm_payhero_merch_payment(text, numeric, text) from public, anon, authenticated;
revoke all on function public.fail_payhero_payment(text, text) from public, anon, authenticated;
grant execute on function public.confirm_payhero_event_payment(text, numeric, text) to service_role;
grant execute on function public.confirm_payhero_vendor_payment(text, numeric, text) to service_role;
grant execute on function public.confirm_payhero_merch_payment(text, numeric, text) to service_role;
grant execute on function public.fail_payhero_payment(text, text) to service_role;
