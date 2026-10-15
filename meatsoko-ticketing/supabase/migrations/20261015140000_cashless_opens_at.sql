-- Cashless payments can open before the event starts (2026-10-15, the user's choice):
-- events.cashless_opens_at (null = the event's start). Lets MeatSoko run a live
-- KSh 1 test at a real booth before the doors open, and lets booths sell during
-- setup if the organiser wants. Payments still stop at ends_at. Changing it is an
-- admin action with a reason, audited; it doesn't touch tickets or the event's
-- public times.

alter table public.events add column if not exists cashless_opens_at timestamptz;

create or replace function public.admin_set_cashless_opens_at(p_event_id uuid, p_opens_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old timestamptz; v_ends timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
  select cashless_opens_at, ends_at into v_old, v_ends from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p_opens_at is not null and p_opens_at >= v_ends then return jsonb_build_object('error', 'after_event_end'); end if;
  update public.events set cashless_opens_at = p_opens_at where id = p_event_id;
  perform public.cashless_audit('cashless_opens_at', p_event_id, jsonb_build_object('from', v_old, 'to', p_opens_at, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'saved', 'opens_at', p_opens_at);
end; $$;

-- As in 20261015100000, opening at cashless_opens_at (or the event start).
create or replace function public.start_vendor_sale_for(
  p_event_vendor_id uuid, p_qr_id uuid, p_channel text, p_actor uuid,
  p_amount_kes numeric, p_phone text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev public.event_vendors%rowtype; v_vendor public.vendors%rowtype; v_event public.events%rowtype;
  v_sale public.vendor_sales%rowtype; v_bps integer; v_ref text;
  v_phone text := public.event_orders_norm_phone(p_phone);
begin
  if p_idempotency_key is null then return jsonb_build_object('error', 'idempotency_key_required'); end if;
  select * into v_sale from public.vendor_sales where event_vendor_id = p_event_vendor_id and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.amount_kes is distinct from p_amount_kes or v_sale.payer_phone is distinct from v_phone
       or v_sale.qr_code_id is distinct from p_qr_id or v_sale.channel <> p_channel then
      return jsonb_build_object('error', 'idempotency_conflict');
    end if;
    return jsonb_build_object('result', 'existing', 'sale', to_jsonb(v_sale));
  end if;

  select * into v_ev from public.event_vendors where id = p_event_vendor_id for share;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into v_vendor from public.vendors where id = v_ev.vendor_id;
  select * into v_event from public.events where id = v_ev.event_id;
  if v_vendor.status <> 'active' then return jsonb_build_object('error', 'vendor_suspended'); end if;
  if v_ev.status <> 'active' then return jsonb_build_object('error', 'vendor_not_active'); end if;
  if v_event.status <> 'live' or now() >= v_event.ends_at then return jsonb_build_object('error', 'event_closed'); end if;
  if now() < coalesce(v_event.cashless_opens_at, v_event.starts_at) then return jsonb_build_object('error', 'event_not_started'); end if;
  v_bps := coalesce(v_ev.commission_bps, v_event.vendor_commission_bps);
  if v_ev.policy_bps_accepted is distinct from v_bps then return jsonb_build_object('error', 'policy_not_accepted'); end if;
  if p_amount_kes is null or p_amount_kes <> round(p_amount_kes) or p_amount_kes < 1 or p_amount_kes > 150000 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;
  if v_phone is null then return jsonb_build_object('error', 'invalid_phone'); end if;
  -- An unknown outcome from this phone at this booth must be settled first.
  if exists (select 1 from public.vendor_sales where event_vendor_id = p_event_vendor_id and payer_phone = v_phone
              and status = 'pending' and created_at > now() - interval '3 minutes') then
    return jsonb_build_object('error', 'pending_payment_exists');
  end if;

  loop
    v_ref := 'VS-' || public.cashless_random(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    exit when not exists (select 1 from public.vendor_sales where reference = v_ref);
  end loop;
  insert into public.vendor_sales (reference, status_token, idempotency_key, event_id, event_vendor_id, vendor_id, qr_code_id,
                                   amount_kes, commission_bps, payer_phone, channel, initiated_by)
  values (v_ref, encode(extensions.gen_random_bytes(16), 'hex'), p_idempotency_key, v_event.id, v_ev.id, v_vendor.id, p_qr_id,
          p_amount_kes, v_bps, v_phone, p_channel, p_actor)
  on conflict (event_vendor_id, idempotency_key) do nothing
  returning * into v_sale;
  if v_sale.id is null then
    select * into v_sale from public.vendor_sales where event_vendor_id = p_event_vendor_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object('result', 'existing', 'sale', to_jsonb(v_sale));
  end if;
  return jsonb_build_object('result', 'created', 'sale', to_jsonb(v_sale), 'vendor_name', v_vendor.name, 'event_name', v_event.name);
end; $$;

-- As in 20261015100000, plus the event's cashless opening time.
create or replace function public.vendor_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.vendors%rowtype;
begin
  select * into v from public.vendors where user_id = auth.uid() and auth.uid() is not null;
  if not found then return jsonb_build_object('error', 'not_a_vendor'); end if;
  return jsonb_build_object(
    'vendor', jsonb_build_object('id', v.id, 'name', v.name, 'status', v.status, 'email', v.email, 'login_method', v.login_method,
                                 'phone_masked', '0' || substr(v.phone, 4, 3) || '***' || right(v.phone, 3),
                                 'payout_phone_masked', case when v.payout_phone is null then null
                                   else '0' || substr(v.payout_phone, 4, 3) || '***' || right(v.payout_phone, 3) end),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_vendor_id', ev.id, 'status', ev.status, 'status_reason', ev.status_reason,
        'event', jsonb_build_object('id', e.id, 'name', e.name, 'venue', e.venue, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'status', e.status,
                                 'cashless_opens_at', coalesce(e.cashless_opens_at, e.starts_at)),
        'commission_bps', coalesce(ev.commission_bps, e.vendor_commission_bps),
        'policy_bps_accepted', ev.policy_bps_accepted, 'policy_accepted_at', ev.policy_accepted_at,
        'qr_code', (select q.code from public.vendor_qr_codes q where q.event_vendor_id = ev.id and q.active),
        'balance', (select to_jsonb(b) - 'event_vendor_id' - 'event_id' - 'vendor_id' from public.vendor_balances b where b.event_vendor_id = ev.id),
        'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n, 'amount_kes', d.amt) order by d.day)
                              from (select (s.paid_at at time zone 'Africa/Nairobi')::date as day, count(*) as n, sum(s.amount_kes) as amt
                                      from public.vendor_sales s where s.event_vendor_id = ev.id and s.status = 'success'
                                     group by 1) d), '[]'::jsonb)
      ) order by e.starts_at desc)
      from public.event_vendors ev join public.events e on e.id = ev.event_id
     where ev.vendor_id = v.id and ev.status <> 'rejected'), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'reference', s.reference, 'event_id', s.event_id, 'amount_kes', s.amount_kes,
               'commission_bps', s.commission_bps, 'commission_kes', s.commission_kes, 'status', s.status, 'channel', s.channel,
               'reconciliation_status', s.reconciliation_status, 'payer', s.payer_phone_masked, 'mpesa_receipt', s.mpesa_receipt,
               'created_at', s.created_at, 'paid_at', s.paid_at) order by s.created_at desc)
      from (select * from public.vendor_sales where vendor_id = v.id order by created_at desc limit 500) s), '[]'::jsonb)
  );
end; $$;

revoke all on function public.admin_set_cashless_opens_at(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_set_cashless_opens_at(uuid, timestamptz, text) to authenticated;
revoke all on function public.start_vendor_sale_for(uuid, uuid, text, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.start_vendor_sale_for(uuid, uuid, text, uuid, numeric, text, uuid) to service_role;
revoke all on function public.vendor_dashboard() from public, anon;
grant execute on function public.vendor_dashboard() to authenticated;
