-- Cashless vendor payments, phase A (2026-10-14, the user's plan): attendees pay
-- vendors at the event by scanning the vendor's booth QR and approving an M-Pesa
-- STK prompt. Every shilling lands in ONE MeatSoko collection account — a till /
-- paybill SEPARATE from the ticket till (the user's choice), with its own Daraja
-- credentials (the "sales" account in _shared/daraja-express.ts). Each sale is
-- attributed internally to an event and a vendor; MeatSoko keeps a commission;
-- vendors see their sales on their own dashboard and are paid out after the
-- event (payouts, refunds and statement reconciliation are phase B).
--
-- Model:
--   vendors               a business, across events. user_id = its Supabase Auth
--                         account (email one-time code; created only by an admin
--                         through the vendor-invite Edge Function). Vendors are
--                         NEVER in admin_users, so is_staff()/requireStaff() stay
--                         closed to them.
--   event_vendors         a vendor's participation in one event: status
--                         (pending -> active | rejected; active <-> inactive;
--                         suspended), an optional commission override, and the
--                         commission policy the vendor accepted.
--   vendor_qr_codes       the booth QR. The QR holds only /pay/<code> (16 random
--                         base32 characters); event and vendor are resolved here,
--                         so nothing the attendee's phone sends can move a sale
--                         to another vendor. Regenerating deactivates the old code;
--                         rows are never deleted, so history keeps its code.
--   vendor_sales          one row per payment ATTEMPT (pending -> success |
--                         failed | flagged), with the commission rate and amount
--                         SNAPSHOTTED on the row: a later rate change never alters
--                         a sale.
--   vendor_ledger_entries APPEND-ONLY money owed to vendors (triggers refuse
--                         UPDATE/DELETE, even for postgres). Payable per
--                         participation = sum(amount_kes).
--   payhero_payments      the existing M-Pesa ledger gains kind 'sale' and an
--                         `account` column ('main' = ticket till, 'sales' = the
--                         vendor collection till), so verifyMpesa() queries
--                         Safaricom with the right credentials.
--
-- Money and rounding (KSh, numeric(12,2); M-Pesa charges whole shillings):
--   commission_kes = round(amount_kes * commission_bps / 10000, 2)  (half away
--   from zero, Postgres numeric round), computed ONCE when Safaricom confirms the
--   sale. Ledger on success: +amount (kind 'sale') and -commission (kind
--   'commission'). Failed, cancelled, flagged and pending attempts post nothing.
--   Phase B adds: refund -R with commission_reversal +round(R*bps/10000,2),
--   adjustment ±, payout -.  Payable = gross - refunds - commission on net sales
--   - payouts. M-Pesa collection fees are a MeatSoko expense: recorded on the sale
--   (collection_fee_kes) when known, NEVER posted to the vendor ledger.
--
-- Commission: events.vendor_commission_bps (default 500 = 5 %) with an optional
-- override per participation. Every change is audited (admin_audit) with a
-- reason. A vendor takes payments only after accepting the CURRENT effective
-- rate (policy_bps_accepted = effective rate), so a rate change can't apply to
-- a vendor silently; an admin may record acceptance given on paper (audited).
--
-- Payments are accepted only while: the code is active, the participation is
-- active, the vendor isn't suspended, the event is live and starts_at <= now() <
-- ends_at, and the policy is accepted. Confirmation is ONLY by verifyMpesa()
-- (Safaricom's STK Push Query), never by the unsigned callback or the browser.
--
-- Access: admins read everything; a vendor reads only its own rows (RLS through
-- vendors.user_id = auth.uid()); anon reads nothing — the pay page goes through
-- the vendor-pay Edge Function (service role). The payer's phone, the status
-- token and the idempotency key are not granted to `authenticated` at all;
-- vendors and the dashboard see payer_phone_masked. Writes only through the
-- SECURITY DEFINER functions below, each with EXECUTE revoked from PUBLIC (repo
-- CLAUDE.md §5) and the actor taken from auth.uid().

-- ---------------------------------------------------------------- commission
alter table public.events
  add column if not exists vendor_commission_bps integer not null default 500
  check (vendor_commission_bps between 0 and 5000);

-- ---------------------------------------------------------------- vendors
create table if not exists public.vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 2 and 120),
  phone          text not null check (phone ~ '^254[17][0-9]{8}$'),
  email          text not null check (public.looks_like_email(email)),
  payout_phone   text check (payout_phone is null or payout_phone ~ '^254[17][0-9]{8}$'),   -- set by admins only
  status         text not null default 'active' check (status in ('active', 'suspended')),
  user_id        uuid unique references auth.users(id) on delete set null,
  application_id uuid references public.vendor_applications(id) on delete set null,
  admin_note     text check (admin_note is null or length(admin_note) <= 500),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists vendors_email_uniq on public.vendors (lower(email));

create table if not exists public.event_vendors (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events(id) on delete restrict,
  vendor_id           uuid not null references public.vendors(id) on delete restrict,
  status              text not null default 'pending'
                      check (status in ('pending', 'active', 'inactive', 'suspended', 'rejected')),
  commission_bps      integer check (commission_bps is null or commission_bps between 0 and 5000),
  policy_bps_accepted integer,
  policy_accepted_at  timestamptz,
  policy_accepted_by  uuid references auth.users(id),
  status_reason       text check (status_reason is null or length(status_reason) <= 300),
  decided_by          uuid references auth.users(id),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (event_id, vendor_id)
);
create index if not exists event_vendors_vendor_idx on public.event_vendors (vendor_id);

create table if not exists public.vendor_qr_codes (
  id              uuid primary key default gen_random_uuid(),
  event_vendor_id uuid not null references public.event_vendors(id) on delete restrict,
  code            text not null unique check (code ~ '^[a-z2-7]{16}$'),
  active          boolean not null default true,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  deactivated_at  timestamptz,
  deactivated_by  uuid references auth.users(id),
  deactivated_reason text
);
create unique index if not exists vendor_qr_codes_one_active
  on public.vendor_qr_codes (event_vendor_id) where active;

-- ---------------------------------------------------------------- sales
create table if not exists public.vendor_sales (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique check (reference ~ '^VS-[A-Z2-9]{8}$'),   -- shown to payer, vendor, staff
  status_token          text not null unique check (status_token ~ '^[a-f0-9]{32}$'), -- the payer's key to the status
  idempotency_key       uuid not null,                                                -- from the payer's browser
  event_id              uuid not null references public.events(id) on delete restrict,
  event_vendor_id       uuid not null references public.event_vendors(id) on delete restrict,
  vendor_id             uuid not null references public.vendors(id) on delete restrict,
  qr_code_id            uuid not null references public.vendor_qr_codes(id) on delete restrict,
  amount_kes            numeric(12,2) not null check (amount_kes >= 1 and amount_kes = round(amount_kes)),
  currency              text not null default 'KES' check (currency = 'KES'),
  commission_bps        integer not null check (commission_bps between 0 and 5000),
  commission_kes        numeric(12,2),            -- set when confirmed
  collection_fee_kes    numeric(12,2),            -- MeatSoko's M-Pesa charge, when known (not the vendor's)
  payer_phone           text not null check (payer_phone ~ '^254[17][0-9]{8}$'),
  payer_phone_masked    text generated always as ('0' || substr(payer_phone, 4, 3) || '***' || right(payer_phone, 3)) stored,
  status                text not null default 'pending' check (status in ('pending', 'success', 'failed', 'flagged')),
  status_reason         text,
  mpesa_receipt         text,
  reconciliation_status text not null default 'unreconciled'
                        check (reconciliation_status in ('unreconciled', 'matched', 'discrepancy', 'resolved')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  paid_at               timestamptz,
  unique (qr_code_id, idempotency_key)
);
create index if not exists vendor_sales_ev_idx on public.vendor_sales (event_vendor_id, created_at desc);
create index if not exists vendor_sales_event_idx on public.vendor_sales (event_id, created_at desc);
create index if not exists vendor_sales_pending_idx on public.vendor_sales (created_at) where status = 'pending';
create unique index if not exists vendor_sales_receipt_uniq on public.vendor_sales (mpesa_receipt) where mpesa_receipt is not null;

-- The M-Pesa ledger: a sale is one more kind of payment, on the sales till.
alter table public.payhero_payments
  add column if not exists vendor_sale_id uuid references public.vendor_sales(id) on delete set null;
alter table public.payhero_payments
  add column if not exists account text not null default 'main' check (account in ('main', 'sales'));
alter table public.payhero_payments drop constraint if exists payhero_payments_kind_check;
alter table public.payhero_payments
  add constraint payhero_payments_kind_check check (kind in ('event', 'vendor', 'merch', 'sale'));
alter table public.payhero_payments drop constraint if exists payhero_payments_target;
alter table public.payhero_payments add constraint payhero_payments_target check (
  (kind = 'event'  and order_id is not null) or
  (kind = 'vendor' and vendor_application_id is not null) or
  (kind = 'merch'  and merch_order_id is not null) or
  (kind = 'sale'   and vendor_sale_id is not null and account = 'sales'));
-- One M-Pesa prompt per sale attempt: a retry is a new attempt (new sale row).
create unique index if not exists payhero_payments_sale_uniq on public.payhero_payments (vendor_sale_id) where vendor_sale_id is not null;

-- ---------------------------------------------------------------- ledger
create table if not exists public.vendor_ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  event_vendor_id uuid not null references public.event_vendors(id) on delete restrict,
  kind            text not null check (kind in ('sale', 'commission', 'refund', 'commission_reversal', 'adjustment', 'payout')),
  amount_kes      numeric(12,2) not null,
  sale_id         uuid references public.vendor_sales(id) on delete restrict,
  reason          text,
  actor           uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  check ((kind in ('sale', 'commission') and sale_id is not null) or kind not in ('sale', 'commission')),
  check ((kind in ('sale', 'commission_reversal') and amount_kes >= 0) or (kind in ('commission', 'refund', 'payout') and amount_kes <= 0) or kind = 'adjustment')
);
create index if not exists vendor_ledger_ev_idx on public.vendor_ledger_entries (event_vendor_id, created_at);
-- A sale is credited, and its commission taken, at most once.
create unique index if not exists vendor_ledger_once_per_sale
  on public.vendor_ledger_entries (sale_id, kind) where kind in ('sale', 'commission');

create or replace function public.vendor_ledger_is_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'vendor_ledger_entries is append-only: post an adjustment instead' using errcode = '42501';
end; $$;
revoke execute on function public.vendor_ledger_is_immutable() from public;
drop trigger if exists vendor_ledger_immutable on public.vendor_ledger_entries;
create trigger vendor_ledger_immutable before update or delete on public.vendor_ledger_entries
  for each row execute function public.vendor_ledger_is_immutable();

-- ---------------------------------------------------------------- access
create or replace function public.is_vendor_user(p_vendor_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.vendors where id = p_vendor_id and user_id = auth.uid() and auth.uid() is not null) $$;
revoke all on function public.is_vendor_user(uuid) from public, anon;
grant execute on function public.is_vendor_user(uuid) to authenticated, service_role;

alter table public.vendors enable row level security;
alter table public.event_vendors enable row level security;
alter table public.vendor_qr_codes enable row level security;
alter table public.vendor_sales enable row level security;
alter table public.vendor_ledger_entries enable row level security;

revoke all on table public.vendors, public.event_vendors, public.vendor_qr_codes,
                    public.vendor_sales, public.vendor_ledger_entries from anon, authenticated;
grant select on table public.vendors, public.event_vendors, public.vendor_qr_codes, public.vendor_ledger_entries to authenticated;
-- Not payer_phone, status_token or idempotency_key: nobody signed in needs them.
grant select (id, reference, event_id, event_vendor_id, vendor_id, qr_code_id, amount_kes, currency, commission_bps,
              commission_kes, collection_fee_kes, payer_phone_masked, status, status_reason, mpesa_receipt,
              reconciliation_status, created_at, updated_at, paid_at)
  on public.vendor_sales to authenticated;

drop policy if exists vendors_read on public.vendors;
create policy vendors_read on public.vendors for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists event_vendors_read on public.event_vendors;
create policy event_vendors_read on public.event_vendors for select to authenticated
  using (public.is_admin() or public.is_vendor_user(vendor_id));
drop policy if exists vendor_qr_codes_read on public.vendor_qr_codes;
create policy vendor_qr_codes_read on public.vendor_qr_codes for select to authenticated
  using (public.is_admin() or exists (select 1 from public.event_vendors ev
                                       where ev.id = event_vendor_id and public.is_vendor_user(ev.vendor_id)));
drop policy if exists vendor_sales_read on public.vendor_sales;
create policy vendor_sales_read on public.vendor_sales for select to authenticated
  using (public.is_admin() or public.is_vendor_user(vendor_id));
drop policy if exists vendor_ledger_read on public.vendor_ledger_entries;
create policy vendor_ledger_read on public.vendor_ledger_entries for select to authenticated
  using (public.is_admin() or exists (select 1 from public.event_vendors ev
                                       where ev.id = event_vendor_id and public.is_vendor_user(ev.vendor_id)));

-- Balances per participation, computed from the ledger and sales (security_invoker:
-- the caller's RLS applies, so a vendor sees only its own rows).
create or replace view public.vendor_balances with (security_invoker = true) as
select ev.id as event_vendor_id, ev.event_id, ev.vendor_id,
       e.vendor_commission_bps as event_commission_bps,
       coalesce(ev.commission_bps, e.vendor_commission_bps) as commission_bps,
       coalesce(l.gross, 0)       as gross_kes,
       coalesce(l.commission, 0)  as commission_kes,
       coalesce(l.refunds, 0)     as refunds_kes,
       coalesce(l.reversals, 0)   as commission_reversed_kes,
       coalesce(l.adjustments, 0) as adjustments_kes,
       coalesce(l.payouts, 0)     as paid_out_kes,
       coalesce(l.balance, 0) + coalesce(l.payouts, 0) as payable_kes,
       coalesce(l.balance, 0)     as outstanding_kes,
       coalesce(s.ok, 0) as successful_count, coalesce(s.pending, 0) as pending_count,
       coalesce(s.failed, 0) as failed_count, coalesce(s.flagged, 0) as flagged_count
  from public.event_vendors ev
  join public.events e on e.id = ev.event_id
  left join lateral (
    select sum(amount_kes) filter (where kind = 'sale') as gross,
           -sum(amount_kes) filter (where kind = 'commission') as commission,
           -sum(amount_kes) filter (where kind = 'refund') as refunds,
           sum(amount_kes) filter (where kind = 'commission_reversal') as reversals,
           sum(amount_kes) filter (where kind = 'adjustment') as adjustments,
           -sum(amount_kes) filter (where kind = 'payout') as payouts,
           sum(amount_kes) as balance
      from public.vendor_ledger_entries where event_vendor_id = ev.id) l on true
  left join lateral (
    select count(*) filter (where status = 'success') as ok, count(*) filter (where status = 'pending') as pending,
           count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'flagged') as flagged
      from public.vendor_sales where event_vendor_id = ev.id) s on true;
-- payable_kes = gross - commission - refunds + reversals + adjustments (owed in
-- total, before payouts); outstanding_kes = payable_kes - paid_out_kes.
revoke all on public.vendor_balances from anon, authenticated;
grant select on public.vendor_balances to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public.cashless_random(p_len int, p_alphabet text)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare b bytea := gen_random_bytes(p_len); out text := ''; i int;
begin
  -- 32-symbol alphabets: 256 is a multiple of 32, so byte % 32 is unbiased.
  for i in 0 .. p_len - 1 loop
    out := out || substr(p_alphabet, (get_byte(b, i) % length(p_alphabet)) + 1, 1);
  end loop;
  return out;
end; $$;
revoke all on function public.cashless_random(int, text) from public, anon, authenticated;

create or replace function public.event_vendor_effective_bps(p_event_vendor_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(ev.commission_bps, e.vendor_commission_bps)
    from public.event_vendors ev join public.events e on e.id = ev.event_id where ev.id = p_event_vendor_id
$$;
revoke all on function public.event_vendor_effective_bps(uuid) from public, anon, authenticated;
grant execute on function public.event_vendor_effective_bps(uuid) to service_role;

create or replace function public.cashless_audit(p_action text, p_subject uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit (actor, action, subject_id, detail) values (auth.uid(), p_action, p_subject, coalesce(p_detail, '{}'::jsonb))
$$;
revoke all on function public.cashless_audit(text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- admin: vendors
-- Create (p_vendor_id null) or edit a vendor. Phone numbers are normalised here.
create or replace function public.admin_save_vendor(
  p_vendor_id uuid, p_name text, p_phone text, p_email text, p_payout_phone text,
  p_application_id uuid default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone  text := public.event_orders_norm_phone(p_phone);
  v_payout text := case when nullif(btrim(coalesce(p_payout_phone, '')), '') is null then null
                        else public.event_orders_norm_phone(p_payout_phone) end;
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_old    public.vendors%rowtype;
  v_row    public.vendors%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 120 then return jsonb_build_object('error', 'invalid_name'); end if;
  if v_phone is null then return jsonb_build_object('error', 'invalid_phone'); end if;
  if nullif(btrim(coalesce(p_payout_phone, '')), '') is not null and v_payout is null then
    return jsonb_build_object('error', 'invalid_payout_phone');
  end if;
  if not public.looks_like_email(v_email) then return jsonb_build_object('error', 'invalid_email'); end if;
  if p_application_id is not null and not exists (select 1 from public.vendor_applications where id = p_application_id) then
    return jsonb_build_object('error', 'unknown_application');
  end if;
  if exists (select 1 from public.vendors where lower(email) = v_email and id is distinct from p_vendor_id) then
    return jsonb_build_object('error', 'email_taken');
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
    if v_old.user_id is not null and lower(v_old.email) <> v_email then
      -- The sign-in account is tied to the email; changing it would strand the vendor.
      return jsonb_build_object('error', 'email_locked_after_invite');
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

create or replace function public.admin_set_vendor_status(p_vendor_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old public.vendors%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended') then return jsonb_build_object('error', 'invalid_status'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_old from public.vendors where id = p_vendor_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  update public.vendors set status = p_status, updated_at = now() where id = p_vendor_id;
  perform public.cashless_audit('vendor_status', p_vendor_id, jsonb_build_object('from', v_old.status, 'to', p_status, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'saved', 'status', p_status);
end; $$;

-- Put a vendor forward for an event (pending until approved).
create or replace function public.admin_assign_vendor_event(p_vendor_id uuid, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.event_vendors%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id) then return jsonb_build_object('error', 'unknown_vendor'); end if;
  if not exists (select 1 from public.events where id = p_event_id) then return jsonb_build_object('error', 'unknown_event'); end if;
  insert into public.event_vendors (event_id, vendor_id) values (p_event_id, p_vendor_id)
  on conflict (event_id, vendor_id) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.event_vendors where event_id = p_event_id and vendor_id = p_vendor_id;
    return jsonb_build_object('result', 'existing', 'event_vendor', to_jsonb(v_row));
  end if;
  perform public.cashless_audit('event_vendor_assign', v_row.id, jsonb_build_object('vendor_id', p_vendor_id, 'event_id', p_event_id));
  return jsonb_build_object('result', 'assigned', 'event_vendor', to_jsonb(v_row));
end; $$;

-- Approve (active), reject, deactivate, reactivate or suspend a participation.
create or replace function public.admin_set_event_vendor_status(p_event_vendor_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old public.event_vendors%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('active', 'inactive', 'suspended', 'rejected') then return jsonb_build_object('error', 'invalid_status'); end if;
  select * into v_old from public.event_vendors where id = p_event_vendor_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p_status in ('suspended', 'rejected') and length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('error', 'reason_required');
  end if;
  if p_status = 'rejected' and v_old.status <> 'pending' then return jsonb_build_object('error', 'only_pending_can_be_rejected'); end if;
  if v_old.status = 'rejected' then return jsonb_build_object('error', 'rejected_is_final'); end if;
  update public.event_vendors
     set status = p_status, status_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = p_event_vendor_id;
  perform public.cashless_audit('event_vendor_status', p_event_vendor_id,
    jsonb_build_object('from', v_old.status, 'to', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  return jsonb_build_object('result', 'saved', 'status', p_status);
end; $$;

-- Commission: the event default, or a per-vendor override (null = use the event's).
-- Never touches existing sales (each carries its own snapshot).
create or replace function public.admin_set_event_commission(p_event_id uuid, p_bps integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old integer;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_bps is null or p_bps not between 0 and 5000 then return jsonb_build_object('error', 'invalid_rate'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
  select vendor_commission_bps into v_old from public.events where id = p_event_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  update public.events set vendor_commission_bps = p_bps where id = p_event_id;
  perform public.cashless_audit('commission_event', p_event_id, jsonb_build_object('from_bps', v_old, 'to_bps', p_bps, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'saved', 'bps', p_bps);
end; $$;

create or replace function public.admin_set_vendor_commission(p_event_vendor_id uuid, p_bps integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old public.event_vendors%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_bps is not null and p_bps not between 0 and 5000 then return jsonb_build_object('error', 'invalid_rate'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_old from public.event_vendors where id = p_event_vendor_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  update public.event_vendors set commission_bps = p_bps, updated_at = now() where id = p_event_vendor_id;
  perform public.cashless_audit('commission_vendor', p_event_vendor_id, jsonb_build_object(
    'from_bps', v_old.commission_bps, 'to_bps', p_bps, 'effective_bps', public.event_vendor_effective_bps(p_event_vendor_id),
    'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'saved', 'effective_bps', public.event_vendor_effective_bps(p_event_vendor_id));
end; $$;

-- The vendor accepts the current commission policy (or an admin records acceptance
-- given in person, with a note). Payments need acceptance of the CURRENT rate.
create or replace function public.accept_vendor_policy(p_event_vendor_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.event_vendors%rowtype; v_bps integer; v_admin boolean := public.is_admin();
begin
  select * into v_ev from public.event_vendors where id = p_event_vendor_id for update;
  if not found or not (v_admin or public.is_vendor_user(v_ev.vendor_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_admin and not public.is_vendor_user(v_ev.vendor_id) and length(btrim(coalesce(p_note, ''))) < 3 then
    return jsonb_build_object('error', 'note_required');
  end if;
  v_bps := public.event_vendor_effective_bps(p_event_vendor_id);
  update public.event_vendors
     set policy_bps_accepted = v_bps, policy_accepted_at = now(), policy_accepted_by = auth.uid(), updated_at = now()
   where id = p_event_vendor_id;
  perform public.cashless_audit('vendor_policy_accepted', p_event_vendor_id, jsonb_build_object(
    'bps', v_bps, 'by', case when public.is_vendor_user(v_ev.vendor_id) then 'vendor' else 'admin' end,
    'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('result', 'accepted', 'bps', v_bps);
end; $$;

-- Booth QR: issue a new code (deactivating the current one) or deactivate it.
create or replace function public.admin_issue_vendor_qr(p_event_vendor_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old public.vendor_qr_codes%rowtype; v_code text; v_row public.vendor_qr_codes%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.event_vendors where id = p_event_vendor_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select * into v_old from public.vendor_qr_codes where event_vendor_id = p_event_vendor_id and active;
  if found then
    update public.vendor_qr_codes
       set active = false, deactivated_at = now(), deactivated_by = auth.uid(),
           deactivated_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'regenerated')
     where id = v_old.id;
  end if;
  loop
    v_code := public.cashless_random(16, 'abcdefghijklmnopqrstuvwxyz234567');
    exit when not exists (select 1 from public.vendor_qr_codes where code = v_code);
  end loop;
  insert into public.vendor_qr_codes (event_vendor_id, code, created_by) values (p_event_vendor_id, v_code, auth.uid())
  returning * into v_row;
  perform public.cashless_audit('vendor_qr_issue', p_event_vendor_id, jsonb_build_object('qr_id', v_row.id, 'replaced', v_old.id));
  return jsonb_build_object('result', 'issued', 'qr', to_jsonb(v_row));
end; $$;

create or replace function public.admin_deactivate_vendor_qr(p_qr_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old public.vendor_qr_codes%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_old from public.vendor_qr_codes where id = p_qr_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not v_old.active then return jsonb_build_object('result', 'already'); end if;
  update public.vendor_qr_codes set active = false, deactivated_at = now(), deactivated_by = auth.uid(), deactivated_reason = btrim(p_reason)
   where id = p_qr_id;
  perform public.cashless_audit('vendor_qr_deactivate', v_old.event_vendor_id, jsonb_build_object('qr_id', p_qr_id, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'deactivated');
end; $$;

-- Full payer phone for an admin investigating one sale (audited; not in table grants).
create or replace function public.admin_vendor_sale_phone(p_sale_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select payer_phone into v from public.vendor_sales where id = p_sale_id;
  if v is not null then perform public.cashless_audit('vendor_sale_phone_viewed', p_sale_id, '{}'::jsonb); end if;
  return v;
end; $$;

-- ---------------------------------------------------------------- service role: accounts
-- vendor-invite links the Supabase Auth account (created there by email) to the vendor.
create or replace function public.link_vendor_user(p_vendor_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.vendors%rowtype; v_uid uuid;
begin
  if not exists (select 1 from public.admin_users where user_id = p_actor and role = 'admin') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into v from public.vendors where id = p_vendor_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select id into v_uid from auth.users where lower(email) = lower(v.email) order by id limit 1;
  if v_uid is null then return jsonb_build_object('error', 'no_auth_user'); end if;
  -- A staff/admin login must never double as a vendor login (or vice versa).
  if exists (select 1 from public.admin_users where user_id = v_uid) then return jsonb_build_object('error', 'email_is_staff'); end if;
  if exists (select 1 from public.vendors where user_id = v_uid and id <> p_vendor_id) then return jsonb_build_object('error', 'user_is_other_vendor'); end if;
  update public.vendors set user_id = v_uid, updated_at = now() where id = p_vendor_id;
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (p_actor, 'vendor_account_linked', p_vendor_id, jsonb_build_object('already', v.user_id = v_uid));
  return jsonb_build_object('result', case when v.user_id = v_uid then 'already' else 'linked' end, 'email', v.email, 'name', v.name);
end; $$;

-- ---------------------------------------------------------------- service role: sales
-- The pay page asked to pay p_amount to the vendor behind p_code. Everything that
-- decides attribution and price comes from here, not from the request.
-- A repeat of the same idempotency key returns the existing attempt.
create or replace function public.start_vendor_sale(p_code text, p_amount_kes numeric, p_phone text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_qr public.vendor_qr_codes%rowtype; v_ev public.event_vendors%rowtype; v_vendor public.vendors%rowtype;
  v_event public.events%rowtype; v_sale public.vendor_sales%rowtype; v_bps integer; v_ref text;
  v_phone text := public.event_orders_norm_phone(p_phone);
begin
  if p_code is null or p_code !~ '^[a-z2-7]{16}$' then return jsonb_build_object('error', 'unknown_code'); end if;
  select * into v_qr from public.vendor_qr_codes where code = p_code;
  if not found then return jsonb_build_object('error', 'unknown_code'); end if;
  if p_idempotency_key is null then return jsonb_build_object('error', 'idempotency_key_required'); end if;

  select * into v_sale from public.vendor_sales where qr_code_id = v_qr.id and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.amount_kes is distinct from p_amount_kes or v_sale.payer_phone is distinct from v_phone then
      return jsonb_build_object('error', 'idempotency_conflict');
    end if;
    return jsonb_build_object('result', 'existing', 'sale', to_jsonb(v_sale));
  end if;

  if not v_qr.active then return jsonb_build_object('error', 'code_inactive'); end if;
  select * into v_ev from public.event_vendors where id = v_qr.event_vendor_id for share;
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
  -- An unknown outcome from this phone at this booth must be settled first, or the
  -- payer may pay twice for one purchase.
  if exists (select 1 from public.vendor_sales where qr_code_id = v_qr.id and payer_phone = v_phone
              and status = 'pending' and created_at > now() - interval '3 minutes') then
    return jsonb_build_object('error', 'pending_payment_exists');
  end if;

  loop
    v_ref := 'VS-' || public.cashless_random(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    exit when not exists (select 1 from public.vendor_sales where reference = v_ref);
  end loop;
  insert into public.vendor_sales (reference, status_token, idempotency_key, event_id, event_vendor_id, vendor_id, qr_code_id,
                                   amount_kes, commission_bps, payer_phone)
  values (v_ref, encode(extensions.gen_random_bytes(16), 'hex'), p_idempotency_key, v_event.id, v_ev.id, v_vendor.id, v_qr.id,
          p_amount_kes, v_bps, v_phone)
  on conflict (qr_code_id, idempotency_key) do nothing
  returning * into v_sale;
  if v_sale.id is null then
    -- The same key raced in from a second tab: hand back that attempt.
    select * into v_sale from public.vendor_sales where qr_code_id = v_qr.id and idempotency_key = p_idempotency_key;
    return jsonb_build_object('result', 'existing', 'sale', to_jsonb(v_sale));
  end if;
  return jsonb_build_object('result', 'created', 'sale', to_jsonb(v_sale),
    'vendor_name', v_vendor.name, 'event_name', v_event.name);
end; $$;

-- Safaricom (STK Push Query, via verifyMpesa) says the prompt was paid.
create or replace function public.confirm_payhero_sale_payment(p_reference text, p_amount_kes numeric, p_receipt text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pay public.payhero_payments%rowtype; v_sale public.vendor_sales%rowtype; v_comm numeric(12,2); v_out jsonb;
begin
  select * into v_pay from public.payhero_payments where reference = p_reference and kind = 'sale' for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_pay.status = 'success' then
    return jsonb_build_object('result', 'already', 'sale_id', v_pay.vendor_sale_id, 'outcome', v_pay.outcome);
  end if;
  select * into v_sale from public.vendor_sales where id = v_pay.vendor_sale_id for update;
  if not found then
    v_out := jsonb_build_object('result', 'unknown_sale');
  elsif v_sale.status = 'success' then
    v_out := jsonb_build_object('result', 'already', 'sale_id', v_sale.id);
  elsif v_sale.amount_kes is distinct from p_amount_kes or v_pay.amount_kes is distinct from p_amount_kes then
    update public.vendor_sales set status = 'flagged', status_reason = 'amount_mismatch', paid_at = now(),
           mpesa_receipt = coalesce(mpesa_receipt, p_receipt), updated_at = now() where id = v_sale.id;
    v_out := jsonb_build_object('result', 'amount_mismatch', 'sale_id', v_sale.id);
  elsif v_sale.status <> 'pending' then
    -- Paid after we called it failed (a very late PIN): the payer may have been
    -- told it failed, so nothing is credited automatically — an admin decides.
    update public.vendor_sales set status = 'flagged', status_reason = 'paid_after_' || v_sale.status, paid_at = now(),
           mpesa_receipt = coalesce(mpesa_receipt, p_receipt), updated_at = now() where id = v_sale.id;
    v_out := jsonb_build_object('result', 'paid_after_failed', 'sale_id', v_sale.id);
  else
    v_comm := round(v_sale.amount_kes * v_sale.commission_bps / 10000.0, 2);
    update public.vendor_sales
       set status = 'success', commission_kes = v_comm, paid_at = now(), status_reason = null,
           mpesa_receipt = coalesce(mpesa_receipt, p_receipt), updated_at = now()
     where id = v_sale.id;
    insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, sale_id)
    values (v_sale.event_vendor_id, 'sale', v_sale.amount_kes, v_sale.id);
    if v_comm > 0 then
      insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, sale_id)
      values (v_sale.event_vendor_id, 'commission', -v_comm, v_sale.id);
    end if;
    v_out := jsonb_build_object('result', 'confirmed', 'sale_id', v_sale.id, 'reference', v_sale.reference,
      'amount_kes', v_sale.amount_kes, 'commission_kes', v_comm);
  end if;
  update public.payhero_payments
     set status = 'success', outcome = v_out->>'result', mpesa_receipt = p_receipt, confirmed_at = now(), updated_at = now()
   where id = v_pay.id;
  return v_out;
end; $$;

-- A sale whose STK prompt never left (the function died between the insert and
-- the push): failed after 2 minutes so the page and the vendor stop waiting.
create or replace function public.expire_unsent_vendor_sale(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.vendor_sales set status = 'failed', status_reason = 'stk_not_sent', updated_at = now()
   where id = p_sale_id and status = 'pending' and created_at < now() - interval '2 minutes'
     and not exists (select 1 from public.payhero_payments where vendor_sale_id = p_sale_id);
  return jsonb_build_object('result', case when found then 'expired' else 'ignored' end);
end; $$;

-- fail_payhero_payment, as in 20261008140000, plus the 'sale' kind.
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
  elsif v_pay.kind = 'sale' then
    update public.vendor_sales set status = 'failed', status_reason = left(p_reason, 200), updated_at = now()
     where id = v_pay.vendor_sale_id and status = 'pending';
  end if;
  return jsonb_build_object('result', 'failed', 'kind', v_pay.kind);
end; $$;

-- ---------------------------------------------------------------- vendor dashboard
-- Everything the signed-in vendor's dashboard shows, for that vendor only.
create or replace function public.vendor_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.vendors%rowtype;
begin
  select * into v from public.vendors where user_id = auth.uid() and auth.uid() is not null;
  if not found then return jsonb_build_object('error', 'not_a_vendor'); end if;
  return jsonb_build_object(
    'vendor', jsonb_build_object('id', v.id, 'name', v.name, 'status', v.status, 'email', v.email,
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
               'commission_bps', s.commission_bps, 'commission_kes', s.commission_kes, 'status', s.status,
               'reconciliation_status', s.reconciliation_status, 'payer', s.payer_phone_masked, 'mpesa_receipt', s.mpesa_receipt,
               'created_at', s.created_at, 'paid_at', s.paid_at) order by s.created_at desc)
      from (select * from public.vendor_sales where vendor_id = v.id order by created_at desc limit 500) s), '[]'::jsonb)
  );
end; $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.admin_save_vendor(uuid, text, text, text, text, uuid, text) from public, anon;
revoke all on function public.admin_set_vendor_status(uuid, text, text) from public, anon;
revoke all on function public.admin_assign_vendor_event(uuid, uuid) from public, anon;
revoke all on function public.admin_set_event_vendor_status(uuid, text, text) from public, anon;
revoke all on function public.admin_set_event_commission(uuid, integer, text) from public, anon;
revoke all on function public.admin_set_vendor_commission(uuid, integer, text) from public, anon;
revoke all on function public.accept_vendor_policy(uuid, text) from public, anon;
revoke all on function public.admin_issue_vendor_qr(uuid, text) from public, anon;
revoke all on function public.admin_deactivate_vendor_qr(uuid, text) from public, anon;
revoke all on function public.admin_vendor_sale_phone(uuid) from public, anon;
revoke all on function public.vendor_dashboard() from public, anon;
grant execute on function public.admin_save_vendor(uuid, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.admin_set_vendor_status(uuid, text, text) to authenticated;
grant execute on function public.admin_assign_vendor_event(uuid, uuid) to authenticated;
grant execute on function public.admin_set_event_vendor_status(uuid, text, text) to authenticated;
grant execute on function public.admin_set_event_commission(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_vendor_commission(uuid, integer, text) to authenticated;
grant execute on function public.accept_vendor_policy(uuid, text) to authenticated;
grant execute on function public.admin_issue_vendor_qr(uuid, text) to authenticated;
grant execute on function public.admin_deactivate_vendor_qr(uuid, text) to authenticated;
grant execute on function public.admin_vendor_sale_phone(uuid) to authenticated;
grant execute on function public.vendor_dashboard() to authenticated;

revoke all on function public.link_vendor_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_vendor_sale(text, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.confirm_payhero_sale_payment(text, numeric, text) from public, anon, authenticated;
revoke all on function public.expire_unsent_vendor_sale(uuid) from public, anon, authenticated;
revoke all on function public.fail_payhero_payment(text, text) from public, anon, authenticated;
grant execute on function public.link_vendor_user(uuid, uuid) to service_role;
grant execute on function public.start_vendor_sale(text, numeric, text, uuid) to service_role;
grant execute on function public.confirm_payhero_sale_payment(text, numeric, text) to service_role;
grant execute on function public.expire_unsent_vendor_sale(uuid) to service_role;
grant execute on function public.fail_payhero_payment(text, text) to service_role;
