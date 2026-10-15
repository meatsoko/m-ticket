-- Cashless vendors, onboarding round (2026-10-15, the user's plan):
--
-- 1. Vendors are identified by their PHONE NUMBER (the user onboards them by
--    phone + M-Pesa name; most have no tent registration and no email). Phone is
--    now unique; email becomes optional contact data.
-- 2. Logins are "custom": phone number + a password an admin generates and hands
--    over (vendor-invite, method phone_password). The Supabase Auth user gets an
--    internal address v<phone>@vendors.meatsokogroup.com that is never emailed;
--    the vendor only ever types the phone number. vendors.login_method records it.
-- 3. admin_bulk_add_vendors(): paste phone + name rows -> create (or find) each
--    vendor, add to the event, approve, optionally record commission acceptance
--    given in person, and issue the booth QR — in one audited call.
-- 4. A vendor (or an admin) can SEND the M-Pesa prompt to a customer's phone from
--    the dashboard, for a failed QR scan or a customer without a smartphone
--    (start_vendor_prompt_sale). Same checks as a QR payment; the server picks
--    the participation from the caller's own vendor record, so a vendor can only
--    ever charge into its own booth. vendor_sales records where each sale came
--    from (channel qr | vendor_prompt | admin_prompt) and who started it.
--    Idempotency moves from per-QR to per-participation.
--
-- Every new SECURITY DEFINER function revokes EXECUTE from PUBLIC (repo CLAUDE.md §5).

-- ---------------------------------------------------------------- vendors
alter table public.vendors alter column email drop not null;
-- looks_like_email(null) is false, not null, so the old check would still refuse a missing email.
alter table public.vendors drop constraint if exists vendors_email_check;
alter table public.vendors add constraint vendors_email_check check (email is null or public.looks_like_email(email));
alter table public.vendors add column if not exists login_method text check (login_method is null or login_method in ('email', 'phone_password'));
create unique index if not exists vendors_phone_uniq on public.vendors (phone);
update public.vendors set login_method = 'email' where user_id is not null and login_method is null;

-- ---------------------------------------------------------------- sales: origin
alter table public.vendor_sales alter column qr_code_id drop not null;
alter table public.vendor_sales add column if not exists channel text not null default 'qr'
  check (channel in ('qr', 'vendor_prompt', 'admin_prompt'));
alter table public.vendor_sales add column if not exists initiated_by uuid references auth.users(id);
alter table public.vendor_sales drop constraint if exists vendor_sales_channel_qr;
alter table public.vendor_sales add constraint vendor_sales_channel_qr check ((channel = 'qr') = (qr_code_id is not null));
alter table public.vendor_sales drop constraint if exists vendor_sales_qr_code_id_idempotency_key_key;
create unique index if not exists vendor_sales_idempotency_uniq on public.vendor_sales (event_vendor_id, idempotency_key);
grant select (channel, initiated_by) on public.vendor_sales to authenticated;

-- ---------------------------------------------------------------- admin: vendors
-- As in 20261014150000, but the email is optional (vendors identified by phone).
create or replace function public.admin_save_vendor(
  p_vendor_id uuid, p_name text, p_phone text, p_email text, p_payout_phone text,
  p_application_id uuid default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone  text := public.event_orders_norm_phone(p_phone);
  v_payout text := case when nullif(btrim(coalesce(p_payout_phone, '')), '') is null then null
                        else public.event_orders_norm_phone(p_payout_phone) end;
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_old    public.vendors%rowtype;
  v_row    public.vendors%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 120 then return jsonb_build_object('error', 'invalid_name'); end if;
  if v_phone is null then return jsonb_build_object('error', 'invalid_phone'); end if;
  if nullif(btrim(coalesce(p_payout_phone, '')), '') is not null and v_payout is null then
    return jsonb_build_object('error', 'invalid_payout_phone');
  end if;
  if v_email is not null and not public.looks_like_email(v_email) then return jsonb_build_object('error', 'invalid_email'); end if;
  if p_application_id is not null and not exists (select 1 from public.vendor_applications where id = p_application_id) then
    return jsonb_build_object('error', 'unknown_application');
  end if;
  if v_email is not null and exists (select 1 from public.vendors where lower(email) = v_email and id is distinct from p_vendor_id) then
    return jsonb_build_object('error', 'email_taken');
  end if;
  if exists (select 1 from public.vendors where phone = v_phone and id is distinct from p_vendor_id) then
    return jsonb_build_object('error', 'phone_taken');
  end if;

  if p_vendor_id is null then
    insert into public.vendors (name, phone, email, payout_phone, application_id, admin_note, created_by)
    values (btrim(p_name), v_phone, v_email, coalesce(v_payout, v_phone), p_application_id,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning * into v_row;
    perform public.cashless_audit('vendor_create', v_row.id, jsonb_build_object('name', v_row.name, 'application_id', p_application_id));
  else
    select * into v_old from public.vendors where id = p_vendor_id for update;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    -- The sign-in is tied to the email (email logins) or the phone (phone logins).
    if v_old.user_id is not null and v_old.login_method = 'email' and lower(coalesce(v_old.email, '')) <> coalesce(v_email, '') then
      return jsonb_build_object('error', 'email_locked_after_invite');
    end if;
    if v_old.user_id is not null and v_old.login_method = 'phone_password' and v_old.phone <> v_phone then
      return jsonb_build_object('error', 'phone_locked_after_invite');
    end if;
    update public.vendors
       set name = btrim(p_name), phone = v_phone, email = v_email, payout_phone = coalesce(v_payout, v_phone),
           application_id = coalesce(p_application_id, application_id),
           admin_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where id = p_vendor_id returning * into v_row;
    perform public.cashless_audit('vendor_update', v_row.id, jsonb_build_object(
      'before', jsonb_build_object('name', v_old.name, 'phone', v_old.phone, 'email', v_old.email, 'payout_phone', v_old.payout_phone),
      'after',  jsonb_build_object('name', v_row.name, 'phone', v_row.phone, 'email', v_row.email, 'payout_phone', v_row.payout_phone)));
  end if;
  return jsonb_build_object('result', 'saved', 'vendor', to_jsonb(v_row));
end; $$;

-- Paste phone + name rows; each vendor ends up active at the event with a booth QR.
-- p_rows: [{ "phone": "0703…", "name": "…" }]. p_policy_note: when given, records
-- that each vendor accepted the commission in person (otherwise they accept on
-- first sign-in and their booth stays closed until then).
create or replace function public.admin_bulk_add_vendors(p_event_id uuid, p_rows jsonb, p_policy_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_phone text; v_name text; v_vendor public.vendors%rowtype; v_ev public.event_vendors%rowtype;
  v_qr text; v_created boolean; v_out jsonb := '[]'::jsonb; v_bps integer; v_seen text[] := '{}';
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then return jsonb_build_object('error', 'unknown_event'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return jsonb_build_object('error', 'no_rows'); end if;
  if jsonb_array_length(p_rows) > 200 then return jsonb_build_object('error', 'too_many_rows'); end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_phone := public.event_orders_norm_phone(r->>'phone');
    v_name := btrim(coalesce(r->>'name', ''));
    if v_phone is null then
      v_out := v_out || jsonb_build_object('phone', r->>'phone', 'name', v_name, 'error', 'invalid_phone'); continue;
    end if;
    if v_phone = any(v_seen) then
      v_out := v_out || jsonb_build_object('phone', v_phone, 'name', v_name, 'error', 'duplicate_in_list'); continue;
    end if;
    v_seen := v_seen || v_phone;
    v_created := false;
    select * into v_vendor from public.vendors where phone = v_phone for update;
    if not found then
      if length(v_name) not between 2 and 120 then
        v_out := v_out || jsonb_build_object('phone', v_phone, 'name', v_name, 'error', 'invalid_name'); continue;
      end if;
      insert into public.vendors (name, phone, payout_phone, created_by) values (v_name, v_phone, v_phone, auth.uid()) returning * into v_vendor;
      v_created := true;
      perform public.cashless_audit('vendor_create', v_vendor.id, jsonb_build_object('name', v_name, 'via', 'bulk'));
    end if;

    insert into public.event_vendors (event_id, vendor_id) values (p_event_id, v_vendor.id)
    on conflict (event_id, vendor_id) do nothing;
    select * into v_ev from public.event_vendors where event_id = p_event_id and vendor_id = v_vendor.id for update;
    if v_ev.status = 'rejected' then
      v_out := v_out || jsonb_build_object('phone', v_phone, 'name', v_vendor.name, 'vendor_id', v_vendor.id, 'error', 'rejected_for_event'); continue;
    end if;
    if v_ev.status <> 'active' then
      update public.event_vendors set status = 'active', decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = v_ev.id;
      perform public.cashless_audit('event_vendor_status', v_ev.id, jsonb_build_object('from', v_ev.status, 'to', 'active', 'via', 'bulk'));
    end if;
    if length(btrim(coalesce(p_policy_note, ''))) >= 3 then
      v_bps := public.event_vendor_effective_bps(v_ev.id);
      update public.event_vendors set policy_bps_accepted = v_bps, policy_accepted_at = now(), policy_accepted_by = auth.uid(), updated_at = now()
       where id = v_ev.id and policy_bps_accepted is distinct from v_bps;
      if found then
        perform public.cashless_audit('vendor_policy_accepted', v_ev.id, jsonb_build_object('bps', v_bps, 'by', 'admin', 'note', btrim(p_policy_note), 'via', 'bulk'));
      end if;
    end if;
    select code into v_qr from public.vendor_qr_codes where event_vendor_id = v_ev.id and active;
    if v_qr is null then
      loop
        v_qr := public.cashless_random(16, 'abcdefghijklmnopqrstuvwxyz234567');
        exit when not exists (select 1 from public.vendor_qr_codes where code = v_qr);
      end loop;
      insert into public.vendor_qr_codes (event_vendor_id, code, created_by) values (v_ev.id, v_qr, auth.uid());
      perform public.cashless_audit('vendor_qr_issue', v_ev.id, jsonb_build_object('via', 'bulk'));
    end if;
    v_out := v_out || jsonb_build_object('phone', v_phone, 'name', v_vendor.name, 'vendor_id', v_vendor.id, 'event_vendor_id', v_ev.id,
      'created', v_created, 'qr_code', v_qr, 'has_login', v_vendor.user_id is not null,
      'policy_accepted', (select policy_bps_accepted = public.event_vendor_effective_bps(id) from public.event_vendors where id = v_ev.id));
  end loop;
  return jsonb_build_object('result', 'done', 'rows', v_out);
end; $$;

-- vendor-invite (phone_password) created the Auth user itself and links it by id.
create or replace function public.link_vendor_user_id(p_vendor_id uuid, p_user_id uuid, p_actor uuid, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.vendors%rowtype;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor and role = 'admin') then return jsonb_build_object('error', 'forbidden'); end if;
  if p_method not in ('email', 'phone_password') then return jsonb_build_object('error', 'invalid_method'); end if;
  select * into v from public.vendors where id = p_vendor_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if exists (select 1 from public.admin_users where user_id = p_user_id) then return jsonb_build_object('error', 'email_is_staff'); end if;
  if exists (select 1 from public.vendors where user_id = p_user_id and id <> p_vendor_id) then return jsonb_build_object('error', 'user_is_other_vendor'); end if;
  update public.vendors set user_id = p_user_id, login_method = p_method, updated_at = now() where id = p_vendor_id;
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (p_actor, 'vendor_account_linked', p_vendor_id, jsonb_build_object('method', p_method, 'already', v.user_id = p_user_id));
  return jsonb_build_object('result', case when v.user_id = p_user_id then 'already' else 'linked' end, 'name', v.name, 'phone', v.phone);
end; $$;

-- ---------------------------------------------------------------- sales
-- The checks and the insert, shared by the QR path and the prompt path.
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
  if now() < v_event.starts_at then return jsonb_build_object('error', 'event_not_started'); end if;
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

-- The QR path (same signature and answers as before).
create or replace function public.start_vendor_sale(p_code text, p_amount_kes numeric, p_phone text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_qr public.vendor_qr_codes%rowtype; v_sale public.vendor_sales%rowtype;
begin
  if p_code is null or p_code !~ '^[a-z2-7]{16}$' then return jsonb_build_object('error', 'unknown_code'); end if;
  select * into v_qr from public.vendor_qr_codes where code = p_code;
  if not found then return jsonb_build_object('error', 'unknown_code'); end if;
  if p_idempotency_key is null then return jsonb_build_object('error', 'idempotency_key_required'); end if;
  -- A repeat of an attempt made on this code is answered even if the code was retired since.
  select * into v_sale from public.vendor_sales where event_vendor_id = v_qr.event_vendor_id and idempotency_key = p_idempotency_key;
  if not found and not v_qr.active then return jsonb_build_object('error', 'code_inactive'); end if;
  return public.start_vendor_sale_for(v_qr.event_vendor_id, v_qr.id, 'qr', null, p_amount_kes, p_phone, p_idempotency_key);
end; $$;

-- The prompt path: a signed-in vendor (its own participation only) or an admin.
create or replace function public.start_vendor_prompt_sale(
  p_event_vendor_id uuid, p_actor uuid, p_amount_kes numeric, p_phone text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.event_vendors%rowtype; v_channel text;
begin
  select * into v_ev from public.event_vendors where id = p_event_vendor_id;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;
  if exists (select 1 from public.vendors where id = v_ev.vendor_id and user_id = p_actor) then
    v_channel := 'vendor_prompt';
  elsif exists (select 1 from public.admin_users where user_id = p_actor and role = 'admin') then
    v_channel := 'admin_prompt';
  else
    return jsonb_build_object('error', 'forbidden');
  end if;
  return public.start_vendor_sale_for(p_event_vendor_id, null, v_channel, p_actor, p_amount_kes, p_phone, p_idempotency_key);
end; $$;

-- ---------------------------------------------------------------- vendor dashboard
-- As in 20261014150000, plus each sale's channel and the vendor's login method.
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
        'event', jsonb_build_object('id', e.id, 'name', e.name, 'venue', e.venue, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'status', e.status),
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

-- ---------------------------------------------------------------- grants
revoke all on function public.admin_save_vendor(uuid, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.admin_save_vendor(uuid, text, text, text, text, uuid, text) to authenticated;
revoke all on function public.admin_bulk_add_vendors(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_bulk_add_vendors(uuid, jsonb, text) to authenticated;
revoke all on function public.vendor_dashboard() from public, anon;
grant execute on function public.vendor_dashboard() to authenticated;
revoke all on function public.link_vendor_user_id(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.link_vendor_user_id(uuid, uuid, uuid, text) to service_role;
revoke all on function public.start_vendor_sale_for(uuid, uuid, text, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.start_vendor_sale_for(uuid, uuid, text, uuid, numeric, text, uuid) to service_role;
revoke all on function public.start_vendor_sale(text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.start_vendor_sale(text, numeric, text, uuid) to service_role;
revoke all on function public.start_vendor_prompt_sale(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.start_vendor_prompt_sale(uuid, uuid, numeric, text, uuid) to service_role;
