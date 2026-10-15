-- Cashless vendor payments, phase B (written 2026-10-14, deployed 2026-10-15 after the
-- live test passed; renamed from 20261015190000 so it runs after the onboarding,
-- opening-time and ticket-till migrations already on production): refunds,
-- adjustments, flagged-sale resolution, M-Pesa statement reconciliation and
-- vendor payouts. Builds on 20261014150000_cashless_vendor_sales.sql (read its
-- header for the model and the money rules).
--
-- Nothing here moves money. Safaricom's Reversal, Transaction Status and B2C APIs
-- are not available on the collection account, so:
--   * a refund is REQUESTED here, sent back by a person (M-Pesa portal / bank),
--     and COMPLETED here only with the reversal reference once it is confirmed;
--   * a payout is requested, approved, sent by a person, and marked PAID only with
--     the payout reference once it is confirmed. verification = 'manual' on every
--     payout: nothing claims Safaricom verified it.
--
-- Ledger effects (vendor_ledger_entries, append-only):
--   refund completed  -> refund -R, commission_reversal +c, where
--                        c = round(R * bps / 10000, 2), except the refund that
--                        brings the sale to fully refunded reverses exactly the
--                        commission not yet reversed (no rounding drift: a fully
--                        refunded sale nets to zero for vendor and MeatSoko).
--   adjustment        -> adjustment ± (admin, reason required)
--   payout paid       -> payout -approved_amount
--   flagged sale credited by an admin -> sale + commission, as a normal confirm
--
-- Available for payout (under a per-participation advisory lock):
--   outstanding (sum of the ledger)
--   - refunds requested but not yet completed (their full amount, conservatively)
--   - payouts approved or processing (not yet paid)
-- A payout can be requested only after the event has ended; it can be APPROVED
-- only when the participation has nothing unresolved: no pending or flagged
-- sales, every successful sale matched to a statement line (or resolved by an
-- admin with a reason), and no refund in progress. There is no blanket override.
--
-- Reconciliation: an admin imports the collection account's statement (CSV from
-- the M-Pesa org portal or the bank, parsed in the browser into rows; every row
-- is re-validated here). Lines match sales by M-Pesa receipt; a sale with no
-- receipt (callback lost) matches a single line with the same amount, payer
-- phone suffix and a completion time within 15 minutes. A receipt already
-- imported is skipped; a receipt twice in one file is a duplicate. After an
-- import, successful sales paid inside the statement's period that no line
-- matched become 'discrepancy' (missing_from_statement).
--
-- Access as in phase A: admins read all; vendors read their own payouts and
-- refunds; anon nothing. Writes only through the SECURITY DEFINER functions
-- below (EXECUTE revoked from PUBLIC; actor from auth.uid(); all audited).

-- ---------------------------------------------------------------- sales
alter table public.vendor_sales add column if not exists refunded_kes numeric(12,2) not null default 0 check (refunded_kes >= 0);
alter table public.vendor_sales drop constraint if exists vendor_sales_status_check;
-- 'returned': flagged money sent back to the payer, never the vendor's.
alter table public.vendor_sales add constraint vendor_sales_status_check
  check (status in ('pending', 'success', 'failed', 'flagged', 'returned'));
alter table public.vendor_sales add column if not exists reconciliation_note text;
grant select (refunded_kes, reconciliation_note) on public.vendor_sales to authenticated;

-- ---------------------------------------------------------------- refunds
create table if not exists public.vendor_refunds (
  id                 uuid primary key default gen_random_uuid(),
  sale_id            uuid not null references public.vendor_sales(id) on delete restrict,
  event_vendor_id    uuid not null references public.event_vendors(id) on delete restrict,
  amount_kes         numeric(12,2) not null check (amount_kes > 0),
  reason             text not null check (length(btrim(reason)) between 3 and 500),
  status             text not null default 'requested' check (status in ('requested', 'completed', 'failed', 'cancelled')),
  reversal_reference text,
  outcome_note       text,
  requested_by       uuid references auth.users(id),
  requested_at       timestamptz not null default now(),
  decided_by         uuid references auth.users(id),
  decided_at         timestamptz
);
create index if not exists vendor_refunds_ev_idx on public.vendor_refunds (event_vendor_id, requested_at desc);
-- One refund in progress per sale; a reversal reference is used once.
create unique index if not exists vendor_refunds_one_open on public.vendor_refunds (sale_id) where status = 'requested';
create unique index if not exists vendor_refunds_reference_uniq on public.vendor_refunds (upper(reversal_reference)) where reversal_reference is not null;

-- ---------------------------------------------------------------- payouts
create table if not exists public.vendor_payouts (
  id               uuid primary key default gen_random_uuid(),
  event_vendor_id  uuid not null references public.event_vendors(id) on delete restrict,
  requested_amount numeric(12,2) not null check (requested_amount >= 1),
  approved_amount  numeric(12,2) check (approved_amount is null or (approved_amount >= 1 and approved_amount <= requested_amount)),
  status           text not null default 'requested'
                   check (status in ('requested', 'approved', 'rejected', 'processing', 'paid', 'failed')),
  request_note     text check (request_note is null or length(request_note) <= 300),
  decision_reason  text,
  payout_phone     text check (payout_phone is null or payout_phone ~ '^254[17][0-9]{8}$'),   -- snapshot when approved
  payout_reference text,
  verification     text not null default 'manual' check (verification in ('manual')),
  requested_by     uuid references auth.users(id),
  requested_at     timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  processing_by    uuid references auth.users(id),
  processing_at    timestamptz,
  confirmed_by     uuid references auth.users(id),
  confirmed_at     timestamptz
);
create index if not exists vendor_payouts_ev_idx on public.vendor_payouts (event_vendor_id, requested_at desc);
-- One payout in progress per participation: the same balance can't be requested twice.
create unique index if not exists vendor_payouts_one_open on public.vendor_payouts (event_vendor_id)
  where status in ('requested', 'approved', 'processing');
create unique index if not exists vendor_payouts_reference_uniq on public.vendor_payouts (upper(payout_reference)) where payout_reference is not null;

-- ---------------------------------------------------------------- ledger links
alter table public.vendor_ledger_entries add column if not exists refund_id uuid references public.vendor_refunds(id) on delete restrict;
alter table public.vendor_ledger_entries add column if not exists payout_id uuid references public.vendor_payouts(id) on delete restrict;
create unique index if not exists vendor_ledger_once_per_refund on public.vendor_ledger_entries (refund_id, kind) where refund_id is not null;
create unique index if not exists vendor_ledger_once_per_payout on public.vendor_ledger_entries (payout_id) where payout_id is not null;
-- Sales credited by an admin (flagged -> success) post kind 'sale' too: the
-- existing unique (sale_id, kind) still allows it at most once.

-- ---------------------------------------------------------------- statements
create table if not exists public.mpesa_statement_imports (
  id           uuid primary key default gen_random_uuid(),
  filename     text check (filename is null or length(filename) <= 200),
  source       text not null default 'mpesa_portal' check (source in ('mpesa_portal', 'bank', 'other')),
  period_from  timestamptz,
  period_to    timestamptz,
  rows_total   integer not null default 0,
  matched      integer not null default 0,
  unmatched    integer not null default 0,
  duplicates   integer not null default 0,
  skipped      integer not null default 0,
  imported_by  uuid references auth.users(id),
  imported_at  timestamptz not null default now()
);

create table if not exists public.mpesa_statement_lines (
  id             uuid primary key default gen_random_uuid(),
  import_id      uuid not null references public.mpesa_statement_imports(id) on delete restrict,
  receipt        text not null check (receipt ~ '^[A-Z0-9]{8,12}$'),
  completed_at   timestamptz not null,
  amount_kes     numeric(12,2) not null check (amount_kes > 0),
  payer_hint     text check (payer_hint is null or length(payer_hint) <= 60),      -- e.g. "2547****123 - J..." as the statement prints it
  account_ref    text check (account_ref is null or length(account_ref) <= 40),
  fee_kes        numeric(12,2),                                                   -- the charge linked to this receipt, when the file has it
  match_status   text not null check (match_status in ('matched', 'amount_mismatch', 'unmatched', 'duplicate_in_file', 'ignored', 'linked')),
  matched_sale_id uuid references public.vendor_sales(id) on delete restrict,
  note           text,
  created_at     timestamptz not null default now()
);
-- A receipt is imported once, whatever file it comes from (duplicates in a file are
-- kept as their own rows, flagged, with a suffix-free receipt — hence partial).
create unique index if not exists mpesa_statement_lines_receipt_uniq on public.mpesa_statement_lines (receipt) where match_status <> 'duplicate_in_file';
create index if not exists mpesa_statement_lines_sale_idx on public.mpesa_statement_lines (matched_sale_id);
create index if not exists mpesa_statement_lines_import_idx on public.mpesa_statement_lines (import_id);

create table if not exists public.reconciliation_resolutions (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid references public.vendor_sales(id) on delete restrict,
  line_id    uuid references public.mpesa_statement_lines(id) on delete restrict,
  action     text not null,
  reason     text not null,
  actor      uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (sale_id is not null or line_id is not null)
);
drop trigger if exists reconciliation_resolutions_immutable on public.reconciliation_resolutions;
create trigger reconciliation_resolutions_immutable before update or delete on public.reconciliation_resolutions
  for each row execute function public.vendor_ledger_is_immutable();

-- ---------------------------------------------------------------- access
alter table public.vendor_refunds enable row level security;
alter table public.vendor_payouts enable row level security;
alter table public.mpesa_statement_imports enable row level security;
alter table public.mpesa_statement_lines enable row level security;
alter table public.reconciliation_resolutions enable row level security;
revoke all on table public.vendor_refunds, public.vendor_payouts, public.mpesa_statement_imports,
                    public.mpesa_statement_lines, public.reconciliation_resolutions from anon, authenticated;
grant select on table public.vendor_refunds, public.vendor_payouts, public.mpesa_statement_imports,
                      public.mpesa_statement_lines, public.reconciliation_resolutions to authenticated;

drop policy if exists vendor_refunds_read on public.vendor_refunds;
create policy vendor_refunds_read on public.vendor_refunds for select to authenticated
  using (public.is_admin() or exists (select 1 from public.event_vendors ev where ev.id = event_vendor_id and public.is_vendor_user(ev.vendor_id)));
drop policy if exists vendor_payouts_read on public.vendor_payouts;
create policy vendor_payouts_read on public.vendor_payouts for select to authenticated
  using (public.is_admin() or exists (select 1 from public.event_vendors ev where ev.id = event_vendor_id and public.is_vendor_user(ev.vendor_id)));
drop policy if exists mpesa_statement_imports_read on public.mpesa_statement_imports;
create policy mpesa_statement_imports_read on public.mpesa_statement_imports for select to authenticated using (public.is_admin());
drop policy if exists mpesa_statement_lines_read on public.mpesa_statement_lines;
create policy mpesa_statement_lines_read on public.mpesa_statement_lines for select to authenticated using (public.is_admin());
drop policy if exists reconciliation_resolutions_read on public.reconciliation_resolutions;
create policy reconciliation_resolutions_read on public.reconciliation_resolutions for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- helpers
-- Serialise every money decision for one participation.
create or replace function public.lock_event_vendor(p_event_vendor_id uuid)
returns void language sql security definer set search_path = public as
$$ select pg_advisory_xact_lock(hashtextextended('event_vendor:' || p_event_vendor_id::text, 0)) $$;
revoke all on function public.lock_event_vendor(uuid) from public, anon, authenticated;

create or replace function public.vendor_payout_position(p_event_vendor_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (select coalesce(sum(amount_kes), 0) v from public.vendor_ledger_entries where event_vendor_id = p_event_vendor_id),
       r as (select coalesce(sum(amount_kes), 0) v from public.vendor_refunds where event_vendor_id = p_event_vendor_id and status = 'requested'),
       p as (select coalesce(sum(coalesce(approved_amount, requested_amount)), 0) v from public.vendor_payouts
              where event_vendor_id = p_event_vendor_id and status in ('approved', 'processing'))
  select jsonb_build_object('outstanding_kes', o.v, 'refunds_in_progress_kes', r.v, 'payouts_in_progress_kes', p.v,
                            'available_kes', greatest(o.v - r.v - p.v, 0))
    from o, r, p
$$;
revoke all on function public.vendor_payout_position(uuid) from public, anon, authenticated;

-- What stops a payout being approved (empty array = nothing).
create or replace function public.vendor_settlement_blockers(p_event_vendor_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(b) filter (where b is not null), '[]'::jsonb) from (
    select case when exists (select 1 from public.event_vendors ev join public.events e on e.id = ev.event_id
                              where ev.id = p_event_vendor_id and now() < e.ends_at and e.status <> 'closed')
                then 'event_not_ended' end b
    union all select case when exists (select 1 from public.vendor_sales where event_vendor_id = p_event_vendor_id and status = 'pending') then 'pending_sales' end
    union all select case when exists (select 1 from public.vendor_sales where event_vendor_id = p_event_vendor_id and status = 'flagged') then 'flagged_sales' end
    union all select case when exists (select 1 from public.vendor_sales where event_vendor_id = p_event_vendor_id and status = 'success'
                                        and reconciliation_status in ('unreconciled', 'discrepancy')) then 'unreconciled_sales' end
    union all select case when exists (select 1 from public.vendor_refunds where event_vendor_id = p_event_vendor_id and status = 'requested') then 'refund_in_progress' end
  ) x
$$;
revoke all on function public.vendor_settlement_blockers(uuid) from public, anon, authenticated;
grant execute on function public.vendor_settlement_blockers(uuid) to service_role;
-- (vendors get theirs through vendor_dashboard(); admins through admin_payout_overview())

-- ---------------------------------------------------------------- refunds
create or replace function public.admin_request_vendor_refund(p_sale_id uuid, p_amount_kes numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sale public.vendor_sales%rowtype; v_open numeric; v_row public.vendor_refunds%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_sale from public.vendor_sales where id = p_sale_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform public.lock_event_vendor(v_sale.event_vendor_id);
  select * into v_sale from public.vendor_sales where id = p_sale_id for update;
  if v_sale.status <> 'success' then return jsonb_build_object('error', 'sale_not_refundable', 'status', v_sale.status); end if;
  if exists (select 1 from public.vendor_refunds where sale_id = p_sale_id and status = 'requested') then
    return jsonb_build_object('error', 'refund_in_progress');
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 or p_amount_kes <> round(p_amount_kes, 2) then return jsonb_build_object('error', 'invalid_amount'); end if;
  if p_amount_kes > v_sale.amount_kes - v_sale.refunded_kes then
    return jsonb_build_object('error', 'exceeds_refundable', 'refundable_kes', v_sale.amount_kes - v_sale.refunded_kes);
  end if;
  insert into public.vendor_refunds (sale_id, event_vendor_id, amount_kes, reason, requested_by)
  values (p_sale_id, v_sale.event_vendor_id, p_amount_kes, btrim(p_reason), auth.uid()) returning * into v_row;
  perform public.cashless_audit('vendor_refund_requested', p_sale_id, jsonb_build_object('refund_id', v_row.id, 'amount_kes', p_amount_kes, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'requested', 'refund', to_jsonb(v_row));
end; $$;

-- The money went back to the payer (confirmed outside): post the refund.
create or replace function public.admin_complete_vendor_refund(p_refund_id uuid, p_reversal_reference text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref public.vendor_refunds%rowtype; v_sale public.vendor_sales%rowtype; v_rev numeric(12,2); v_prior numeric(12,2);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reversal_reference, ''))) < 4 then return jsonb_build_object('error', 'reference_required'); end if;
  select * into v_ref from public.vendor_refunds where id = p_refund_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform public.lock_event_vendor(v_ref.event_vendor_id);
  select * into v_ref from public.vendor_refunds where id = p_refund_id for update;
  if v_ref.status <> 'requested' then return jsonb_build_object('error', 'not_open', 'status', v_ref.status); end if;
  if exists (select 1 from public.vendor_refunds where upper(reversal_reference) = upper(btrim(p_reversal_reference))) then
    return jsonb_build_object('error', 'reference_used');
  end if;
  select * into v_sale from public.vendor_sales where id = v_ref.sale_id for update;
  if v_ref.amount_kes > v_sale.amount_kes - v_sale.refunded_kes then return jsonb_build_object('error', 'exceeds_refundable'); end if;
  select coalesce(sum(amount_kes), 0) into v_prior from public.vendor_ledger_entries
   where kind = 'commission_reversal' and refund_id in (select id from public.vendor_refunds where sale_id = v_sale.id);
  if v_sale.refunded_kes + v_ref.amount_kes = v_sale.amount_kes then
    v_rev := coalesce(v_sale.commission_kes, 0) - v_prior;          -- the last refund: exactly what is left
  else
    v_rev := least(round(v_ref.amount_kes * v_sale.commission_bps / 10000.0, 2), coalesce(v_sale.commission_kes, 0) - v_prior);
  end if;
  update public.vendor_refunds
     set status = 'completed', reversal_reference = btrim(p_reversal_reference), outcome_note = nullif(btrim(coalesce(p_note, '')), ''),
         decided_by = auth.uid(), decided_at = now()
   where id = p_refund_id;
  update public.vendor_sales set refunded_kes = refunded_kes + v_ref.amount_kes, updated_at = now() where id = v_sale.id;
  insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, sale_id, refund_id, reason, actor)
  values (v_ref.event_vendor_id, 'refund', -v_ref.amount_kes, v_sale.id, p_refund_id, v_ref.reason, auth.uid());
  if v_rev > 0 then
    insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, sale_id, refund_id, reason, actor)
    values (v_ref.event_vendor_id, 'commission_reversal', v_rev, v_sale.id, p_refund_id, 'commission on refunded amount', auth.uid());
  end if;
  perform public.cashless_audit('vendor_refund_completed', v_sale.id, jsonb_build_object(
    'refund_id', p_refund_id, 'amount_kes', v_ref.amount_kes, 'commission_reversed_kes', v_rev, 'reversal_reference', btrim(p_reversal_reference)));
  return jsonb_build_object('result', 'completed', 'amount_kes', v_ref.amount_kes, 'commission_reversed_kes', v_rev);
end; $$;

-- The refund attempt failed or was called off: nothing is posted.
create or replace function public.admin_close_vendor_refund(p_refund_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref public.vendor_refunds%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('failed', 'cancelled') then return jsonb_build_object('error', 'invalid_status'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_ref from public.vendor_refunds where id = p_refund_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_ref.status <> 'requested' then return jsonb_build_object('error', 'not_open', 'status', v_ref.status); end if;
  update public.vendor_refunds set status = p_status, outcome_note = btrim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p_refund_id;
  perform public.cashless_audit('vendor_refund_' || p_status, v_ref.sale_id, jsonb_build_object('refund_id', p_refund_id, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', p_status);
end; $$;

-- ---------------------------------------------------------------- adjustments
create or replace function public.admin_record_vendor_adjustment(p_event_vendor_id uuid, p_amount_kes numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then return jsonb_build_object('error', 'reason_required'); end if;
  if p_amount_kes is null or p_amount_kes = 0 or p_amount_kes <> round(p_amount_kes, 2) or abs(p_amount_kes) > 1000000 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;
  if not exists (select 1 from public.event_vendors where id = p_event_vendor_id) then return jsonb_build_object('error', 'not_found'); end if;
  perform public.lock_event_vendor(p_event_vendor_id);
  insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, reason, actor)
  values (p_event_vendor_id, 'adjustment', p_amount_kes, btrim(p_reason), auth.uid());
  perform public.cashless_audit('vendor_adjustment', p_event_vendor_id, jsonb_build_object('amount_kes', p_amount_kes, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'recorded', 'position', public.vendor_payout_position(p_event_vendor_id));
end; $$;

-- ---------------------------------------------------------------- flagged sales
-- 'credit': the vendor did hand over the goods -> credit it like a normal sale
--           (commission at the sale's own snapshot rate).
-- 'return': the money was sent back to the payer (reference required) -> 'returned',
--           never the vendor's.
create or replace function public.admin_resolve_flagged_sale(p_sale_id uuid, p_action text, p_reason text, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sale public.vendor_sales%rowtype; v_comm numeric(12,2);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action not in ('credit', 'return') then return jsonb_build_object('error', 'invalid_action'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_sale from public.vendor_sales where id = p_sale_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform public.lock_event_vendor(v_sale.event_vendor_id);
  select * into v_sale from public.vendor_sales where id = p_sale_id for update;
  if v_sale.status <> 'flagged' then return jsonb_build_object('error', 'not_flagged', 'status', v_sale.status); end if;
  if p_action = 'credit' then
    if v_sale.status_reason = 'amount_mismatch' then
      -- What M-Pesa took isn't what the sale says: refund the payer instead.
      return jsonb_build_object('error', 'amount_mismatch_cannot_be_credited');
    end if;
    v_comm := round(v_sale.amount_kes * v_sale.commission_bps / 10000.0, 2);
    update public.vendor_sales set status = 'success', commission_kes = v_comm,
           status_reason = 'credited_by_admin: ' || left(btrim(p_reason), 150), updated_at = now() where id = p_sale_id;
    insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, sale_id, reason, actor)
    values (v_sale.event_vendor_id, 'sale', v_sale.amount_kes, p_sale_id, btrim(p_reason), auth.uid());
    if v_comm > 0 then
      insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, sale_id, reason, actor)
      values (v_sale.event_vendor_id, 'commission', -v_comm, p_sale_id, btrim(p_reason), auth.uid());
    end if;
  else
    if length(btrim(coalesce(p_reference, ''))) < 4 then return jsonb_build_object('error', 'reference_required'); end if;
    update public.vendor_sales set status = 'returned',
           status_reason = 'returned_to_payer ' || btrim(p_reference) || ': ' || left(btrim(p_reason), 150), updated_at = now()
     where id = p_sale_id;
  end if;
  insert into public.reconciliation_resolutions (sale_id, action, reason, actor)
  values (p_sale_id, 'flagged_' || p_action, btrim(p_reason) || coalesce(' [' || btrim(p_reference) || ']', ''), auth.uid());
  perform public.cashless_audit('vendor_sale_flag_resolved', p_sale_id, jsonb_build_object('action', p_action, 'reason', btrim(p_reason), 'reference', p_reference));
  return jsonb_build_object('result', case when p_action = 'credit' then 'credited' else 'returned' end);
end; $$;

-- ---------------------------------------------------------------- reconciliation
-- p_rows: [{ receipt, completed_at, amount_kes, payer_hint?, account_ref?, fee_kes? }]
-- (incoming payments only; the browser drops withdrawals and failed rows).
create or replace function public.admin_import_mpesa_statement(p_rows jsonb, p_filename text, p_source text default 'mpesa_portal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_imp public.mpesa_statement_imports%rowtype; r jsonb; v_receipt text; v_at timestamptz; v_amt numeric; v_fee numeric;
  v_hint text; v_sale public.vendor_sales%rowtype; v_status text; v_sale_id uuid; v_n int := 0;
  v_matched int := 0; v_unmatched int := 0; v_dup int := 0; v_skipped int := 0; v_seen text[] := '{}';
  v_from timestamptz; v_to timestamptz; v_missing int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return jsonb_build_object('error', 'no_rows'); end if;
  if jsonb_array_length(p_rows) > 20000 then return jsonb_build_object('error', 'too_many_rows'); end if;
  if coalesce(p_source, '') not in ('mpesa_portal', 'bank', 'other') then return jsonb_build_object('error', 'invalid_source'); end if;
  -- One import at a time: matching must see the previous import's lines.
  perform pg_advisory_xact_lock(hashtextextended('mpesa_statement_import', 0));

  -- Validate everything before writing anything.
  for r in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_receipt := upper(btrim(coalesce(r->>'receipt', '')));
    begin
      v_at := (r->>'completed_at')::timestamptz;
      v_amt := (r->>'amount_kes')::numeric;
      v_fee := nullif(r->>'fee_kes', '')::numeric;
    exception when others then
      return jsonb_build_object('error', 'invalid_row', 'row', v_n);
    end;
    if v_receipt !~ '^[A-Z0-9]{8,12}$' or v_at is null or v_amt is null or v_amt <= 0 or (v_fee is not null and v_fee < 0) then
      return jsonb_build_object('error', 'invalid_row', 'row', v_n);
    end if;
    v_from := least(coalesce(v_from, v_at), v_at); v_to := greatest(coalesce(v_to, v_at), v_at);
  end loop;

  insert into public.mpesa_statement_imports (filename, source, period_from, period_to, rows_total, imported_by)
  values (left(p_filename, 200), p_source, v_from, v_to, v_n, auth.uid()) returning * into v_imp;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_receipt := upper(btrim(r->>'receipt'));
    v_at := (r->>'completed_at')::timestamptz; v_amt := (r->>'amount_kes')::numeric;
    v_fee := nullif(r->>'fee_kes', '')::numeric; v_hint := left(nullif(btrim(coalesce(r->>'payer_hint', '')), ''), 60);
    v_sale_id := null;
    if v_receipt = any(v_seen) then
      insert into public.mpesa_statement_lines (import_id, receipt, completed_at, amount_kes, payer_hint, account_ref, fee_kes, match_status, note)
      values (v_imp.id, v_receipt, v_at, v_amt, v_hint, left(r->>'account_ref', 40), v_fee, 'duplicate_in_file', 'receipt appears more than once in this file');
      v_dup := v_dup + 1; continue;
    end if;
    v_seen := v_seen || v_receipt;
    if exists (select 1 from public.mpesa_statement_lines where receipt = v_receipt and match_status <> 'duplicate_in_file') then
      v_skipped := v_skipped + 1; continue;               -- imported before: an overlapping statement
    end if;

    select * into v_sale from public.vendor_sales where mpesa_receipt = v_receipt;
    if not found then
      -- Callback lost (no receipt stored): one sale with the same amount, a
      -- matching phone suffix and a time within 15 minutes.
      select s.* into v_sale from public.vendor_sales s
       where s.mpesa_receipt is null and s.status in ('success', 'flagged') and s.amount_kes = v_amt
         and abs(extract(epoch from (coalesce(s.paid_at, s.created_at) - v_at))) <= 900
         and (v_hint is null or v_hint ~ right(s.payer_phone, 3))
         and (select count(*) from public.vendor_sales s2 where s2.mpesa_receipt is null and s2.status in ('success', 'flagged')
               and s2.amount_kes = v_amt and abs(extract(epoch from (coalesce(s2.paid_at, s2.created_at) - v_at))) <= 900
               and (v_hint is null or v_hint ~ right(s2.payer_phone, 3))) = 1;
      if found then
        update public.vendor_sales set mpesa_receipt = v_receipt, updated_at = now() where id = v_sale.id;
      end if;
    end if;

    if v_sale.id is null then
      v_status := 'unmatched'; v_unmatched := v_unmatched + 1;
    elsif v_sale.amount_kes <> v_amt then
      v_status := 'amount_mismatch'; v_sale_id := v_sale.id; v_unmatched := v_unmatched + 1;
      update public.vendor_sales set reconciliation_status = 'discrepancy', reconciliation_note = 'statement amount ' || v_amt, updated_at = now()
       where id = v_sale.id and reconciliation_status <> 'resolved';
    else
      v_status := 'matched'; v_sale_id := v_sale.id; v_matched := v_matched + 1;
      update public.vendor_sales set reconciliation_status = 'matched', reconciliation_note = null,
             collection_fee_kes = coalesce(v_fee, collection_fee_kes), updated_at = now()
       where id = v_sale.id and reconciliation_status <> 'resolved';
    end if;
    insert into public.mpesa_statement_lines (import_id, receipt, completed_at, amount_kes, payer_hint, account_ref, fee_kes, match_status, matched_sale_id)
    values (v_imp.id, v_receipt, v_at, v_amt, v_hint, left(r->>'account_ref', 40), v_fee, v_status, v_sale_id);
    v_sale := null;
  end loop;

  -- Successful sales inside this statement's period that no line confirmed.
  update public.vendor_sales s set reconciliation_status = 'discrepancy', reconciliation_note = 'missing_from_statement', updated_at = now()
   where s.status = 'success' and s.reconciliation_status = 'unreconciled' and s.paid_at between v_from and v_to + interval '5 minutes'
     and not exists (select 1 from public.mpesa_statement_lines l where l.matched_sale_id = s.id);
  get diagnostics v_missing = row_count;

  update public.mpesa_statement_imports set matched = v_matched, unmatched = v_unmatched, duplicates = v_dup, skipped = v_skipped where id = v_imp.id;
  perform public.cashless_audit('mpesa_statement_import', v_imp.id, jsonb_build_object('filename', p_filename, 'rows', v_n,
    'matched', v_matched, 'unmatched', v_unmatched, 'duplicates', v_dup, 'skipped', v_skipped, 'missing_from_statement', v_missing));
  return jsonb_build_object('result', 'imported', 'import_id', v_imp.id, 'rows', v_n, 'matched', v_matched, 'unmatched', v_unmatched,
                            'duplicates', v_dup, 'skipped', v_skipped, 'missing_from_statement', v_missing,
                            'period_from', v_from, 'period_to', v_to);
end; $$;

-- An admin settles a reconciliation question, with a reason (audited, append-only log).
--   sale: 'resolve'  -> reconciliation_status resolved (e.g. confirmed in the portal by hand)
--   line: 'ignore'   -> not a vendor sale (other income to the account)
--         'link'     -> it IS this sale (p_sale_id), amount must match
create or replace function public.admin_resolve_reconciliation(p_sale_id uuid, p_line_id uuid, p_action text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_line public.mpesa_statement_lines%rowtype; v_sale public.vendor_sales%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then return jsonb_build_object('error', 'reason_required'); end if;
  if p_action = 'resolve' then
    select * into v_sale from public.vendor_sales where id = p_sale_id for update;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    if v_sale.status <> 'success' or v_sale.reconciliation_status = 'matched' then return jsonb_build_object('error', 'nothing_to_resolve'); end if;
    update public.vendor_sales set reconciliation_status = 'resolved', reconciliation_note = left(btrim(p_reason), 300), updated_at = now() where id = p_sale_id;
  elsif p_action in ('ignore', 'link') then
    select * into v_line from public.mpesa_statement_lines where id = p_line_id for update;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    if v_line.match_status not in ('unmatched', 'amount_mismatch') then return jsonb_build_object('error', 'nothing_to_resolve'); end if;
    if p_action = 'ignore' then
      update public.mpesa_statement_lines set match_status = 'ignored', note = left(btrim(p_reason), 300) where id = p_line_id;
    else
      select * into v_sale from public.vendor_sales where id = p_sale_id for update;
      if not found then return jsonb_build_object('error', 'not_found'); end if;
      if v_sale.amount_kes <> v_line.amount_kes then return jsonb_build_object('error', 'amount_differs'); end if;
      if v_sale.mpesa_receipt is not null and v_sale.mpesa_receipt <> v_line.receipt then return jsonb_build_object('error', 'sale_has_other_receipt'); end if;
      if exists (select 1 from public.mpesa_statement_lines where matched_sale_id = p_sale_id and id <> p_line_id and match_status in ('matched', 'linked')) then
        return jsonb_build_object('error', 'sale_already_matched');
      end if;
      update public.mpesa_statement_lines set match_status = 'linked', matched_sale_id = p_sale_id, note = left(btrim(p_reason), 300) where id = p_line_id;
      update public.vendor_sales set mpesa_receipt = coalesce(mpesa_receipt, v_line.receipt), collection_fee_kes = coalesce(v_line.fee_kes, collection_fee_kes),
             reconciliation_status = case when status = 'success' then 'matched' else reconciliation_status end, reconciliation_note = null, updated_at = now()
       where id = p_sale_id;
    end if;
  else
    return jsonb_build_object('error', 'invalid_action');
  end if;
  insert into public.reconciliation_resolutions (sale_id, line_id, action, reason, actor) values (p_sale_id, p_line_id, p_action, btrim(p_reason), auth.uid());
  perform public.cashless_audit('reconciliation_' || p_action, coalesce(p_sale_id, p_line_id), jsonb_build_object('sale_id', p_sale_id, 'line_id', p_line_id, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'resolved');
end; $$;

-- Same payer, same booth, same amount, several successful payments within 10
-- minutes: maybe a double payment (the payer may want one back).
create or replace function public.admin_possible_duplicate_sales(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('event_vendor_id', a.event_vendor_id, 'payer', a.payer_phone_masked, 'amount_kes', a.amount_kes,
                     'references', (select jsonb_agg(s.reference order by s.paid_at) from public.vendor_sales s
                                     where s.event_vendor_id = a.event_vendor_id and s.payer_phone = a.payer_phone and s.amount_kes = a.amount_kes
                                       and s.status = 'success' and s.paid_at between a.paid_at and a.paid_at + interval '10 minutes'))
           order by a.paid_at)
      from public.vendor_sales a
     where a.event_id = p_event_id and a.status = 'success'
       and exists (select 1 from public.vendor_sales b where b.event_vendor_id = a.event_vendor_id and b.payer_phone = a.payer_phone
                    and b.amount_kes = a.amount_kes and b.status = 'success' and b.id <> a.id
                    and b.paid_at > a.paid_at and b.paid_at <= a.paid_at + interval '10 minutes')
       and not exists (select 1 from public.vendor_sales c where c.event_vendor_id = a.event_vendor_id and c.payer_phone = a.payer_phone
                    and c.amount_kes = a.amount_kes and c.status = 'success' and c.paid_at < a.paid_at and c.paid_at >= a.paid_at - interval '10 minutes')
  ), '[]'::jsonb);
end; $$;

-- ---------------------------------------------------------------- payouts
-- The vendor (own participation) or an admin on their behalf. After the event only.
create or replace function public.request_vendor_payout(p_event_vendor_id uuid, p_amount_kes numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev public.event_vendors%rowtype; v_event public.events%rowtype; v_vendor public.vendors%rowtype; v_pos jsonb; v_row public.vendor_payouts%rowtype;
begin
  select * into v_ev from public.event_vendors where id = p_event_vendor_id;
  if not found or not (public.is_admin() or public.is_vendor_user(v_ev.vendor_id)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_event from public.events where id = v_ev.event_id;
  select * into v_vendor from public.vendors where id = v_ev.vendor_id;
  if now() < v_event.ends_at and v_event.status <> 'closed' then return jsonb_build_object('error', 'event_not_ended'); end if;
  if v_ev.status = 'rejected' then return jsonb_build_object('error', 'not_a_participant'); end if;
  if v_vendor.status <> 'active' and not public.is_admin() then return jsonb_build_object('error', 'vendor_suspended'); end if;
  if p_amount_kes is null or p_amount_kes < 1 or p_amount_kes <> round(p_amount_kes, 2) then return jsonb_build_object('error', 'invalid_amount'); end if;
  perform public.lock_event_vendor(p_event_vendor_id);
  if exists (select 1 from public.vendor_payouts where event_vendor_id = p_event_vendor_id and status in ('requested', 'approved', 'processing')) then
    return jsonb_build_object('error', 'payout_in_progress');
  end if;
  v_pos := public.vendor_payout_position(p_event_vendor_id);
  if p_amount_kes > (v_pos->>'available_kes')::numeric then
    return jsonb_build_object('error', 'exceeds_available', 'available_kes', (v_pos->>'available_kes')::numeric);
  end if;
  insert into public.vendor_payouts (event_vendor_id, requested_amount, request_note, requested_by)
  values (p_event_vendor_id, p_amount_kes, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()) returning * into v_row;
  perform public.cashless_audit('vendor_payout_requested', p_event_vendor_id, jsonb_build_object('payout_id', v_row.id, 'amount_kes', p_amount_kes,
    'by', case when public.is_vendor_user(v_ev.vendor_id) then 'vendor' else 'admin' end));
  return jsonb_build_object('result', 'requested', 'payout', to_jsonb(v_row));
end; $$;

create or replace function public.admin_decide_vendor_payout(p_payout_id uuid, p_approve boolean, p_amount_kes numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p public.vendor_payouts%rowtype; v_pos jsonb; v_blockers jsonb; v_phone text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_p from public.vendor_payouts where id = p_payout_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform public.lock_event_vendor(v_p.event_vendor_id);
  select * into v_p from public.vendor_payouts where id = p_payout_id for update;
  if v_p.status <> 'requested' then return jsonb_build_object('error', 'not_open', 'status', v_p.status); end if;
  if not p_approve then
    if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
    update public.vendor_payouts set status = 'rejected', decision_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p_payout_id;
    perform public.cashless_audit('vendor_payout_rejected', v_p.event_vendor_id, jsonb_build_object('payout_id', p_payout_id, 'reason', btrim(p_reason)));
    return jsonb_build_object('result', 'rejected');
  end if;
  v_blockers := public.vendor_settlement_blockers(v_p.event_vendor_id);
  if jsonb_array_length(v_blockers) > 0 then return jsonb_build_object('error', 'unresolved', 'blockers', v_blockers); end if;
  if p_amount_kes is null or p_amount_kes < 1 or p_amount_kes > v_p.requested_amount or p_amount_kes <> round(p_amount_kes, 2) then
    return jsonb_build_object('error', 'invalid_amount');
  end if;
  v_pos := public.vendor_payout_position(v_p.event_vendor_id);
  if p_amount_kes > (v_pos->>'available_kes')::numeric then
    return jsonb_build_object('error', 'exceeds_available', 'available_kes', (v_pos->>'available_kes')::numeric);
  end if;
  select coalesce(v.payout_phone, v.phone) into v_phone from public.vendors v join public.event_vendors ev on ev.vendor_id = v.id where ev.id = v_p.event_vendor_id;
  update public.vendor_payouts set status = 'approved', approved_amount = p_amount_kes, payout_phone = v_phone,
         decision_reason = nullif(btrim(coalesce(p_reason, '')), ''), decided_by = auth.uid(), decided_at = now()
   where id = p_payout_id;
  perform public.cashless_audit('vendor_payout_approved', v_p.event_vendor_id, jsonb_build_object('payout_id', p_payout_id,
    'requested_kes', v_p.requested_amount, 'approved_kes', p_amount_kes, 'payout_phone', v_phone));
  return jsonb_build_object('result', 'approved', 'approved_amount', p_amount_kes);
end; $$;

-- approved -> processing (the person is sending it) -> paid (confirmed, reference)
--                                                  -> failed (didn't go; nothing posted)
create or replace function public.admin_update_vendor_payout(p_payout_id uuid, p_status text, p_reference text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p public.vendor_payouts%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('processing', 'paid', 'failed') then return jsonb_build_object('error', 'invalid_status'); end if;
  select * into v_p from public.vendor_payouts where id = p_payout_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform public.lock_event_vendor(v_p.event_vendor_id);
  select * into v_p from public.vendor_payouts where id = p_payout_id for update;
  if p_status = 'processing' then
    if v_p.status <> 'approved' then return jsonb_build_object('error', 'not_approved', 'status', v_p.status); end if;
    update public.vendor_payouts set status = 'processing', processing_by = auth.uid(), processing_at = now() where id = p_payout_id;
  elsif p_status = 'paid' then
    if v_p.status not in ('approved', 'processing') then return jsonb_build_object('error', 'not_payable', 'status', v_p.status); end if;
    if length(btrim(coalesce(p_reference, ''))) < 4 then return jsonb_build_object('error', 'reference_required'); end if;
    if exists (select 1 from public.vendor_payouts where upper(payout_reference) = upper(btrim(p_reference))) then
      return jsonb_build_object('error', 'reference_used');
    end if;
    update public.vendor_payouts set status = 'paid', payout_reference = btrim(p_reference), confirmed_by = auth.uid(), confirmed_at = now(),
           processing_at = coalesce(processing_at, now()), processing_by = coalesce(processing_by, auth.uid()),
           decision_reason = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_reason)
     where id = p_payout_id;
    insert into public.vendor_ledger_entries (event_vendor_id, kind, amount_kes, payout_id, reason, actor)
    values (v_p.event_vendor_id, 'payout', -v_p.approved_amount, p_payout_id, 'payout ' || btrim(p_reference) || ' (recorded manually)', auth.uid());
  else
    if v_p.status not in ('approved', 'processing') then return jsonb_build_object('error', 'not_open', 'status', v_p.status); end if;
    if length(btrim(coalesce(p_note, ''))) < 3 then return jsonb_build_object('error', 'reason_required'); end if;
    update public.vendor_payouts set status = 'failed', decision_reason = btrim(p_note) where id = p_payout_id;
  end if;
  perform public.cashless_audit('vendor_payout_' || p_status, v_p.event_vendor_id, jsonb_build_object('payout_id', p_payout_id,
    'amount_kes', v_p.approved_amount, 'reference', nullif(btrim(coalesce(p_reference, '')), ''), 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('result', p_status);
end; $$;

-- Positions and blockers for every participation of one event (admin dashboard).
create or replace function public.admin_payout_overview(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(ev.id, jsonb_build_object('position', public.vendor_payout_position(ev.id),
                                                                     'blockers', public.vendor_settlement_blockers(ev.id)))
                     from public.event_vendors ev where ev.event_id = p_event_id), '{}'::jsonb);
end; $$;
revoke all on function public.admin_payout_overview(uuid) from public, anon;
grant execute on function public.admin_payout_overview(uuid) to authenticated;

-- ---------------------------------------------------------------- vendor dashboard
-- vendor_dashboard() as in 20261015140000 (opening time, sale channel, login
-- method), plus payouts, refunded amounts, the payout position and what blocks
-- settlement, per participation.
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
        'position', public.vendor_payout_position(ev.id),
        'blockers', public.vendor_settlement_blockers(ev.id),
        'payouts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'requested_amount', p.requested_amount, 'approved_amount', p.approved_amount,
                     'status', p.status, 'decision_reason', p.decision_reason, 'payout_reference', p.payout_reference, 'requested_at', p.requested_at,
                     'decided_at', p.decided_at, 'confirmed_at', p.confirmed_at, 'verification', p.verification) order by p.requested_at desc)
                     from public.vendor_payouts p where p.event_vendor_id = ev.id), '[]'::jsonb),
        'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n, 'amount_kes', d.amt) order by d.day)
                              from (select (s.paid_at at time zone 'Africa/Nairobi')::date as day, count(*) as n, sum(s.amount_kes) as amt
                                      from public.vendor_sales s where s.event_vendor_id = ev.id and s.status = 'success'
                                     group by 1) d), '[]'::jsonb)
      ) order by e.starts_at desc)
      from public.event_vendors ev join public.events e on e.id = ev.event_id
     where ev.vendor_id = v.id and ev.status <> 'rejected'), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'reference', s.reference, 'event_id', s.event_id, 'amount_kes', s.amount_kes,
               'commission_bps', s.commission_bps, 'commission_kes', s.commission_kes, 'refunded_kes', s.refunded_kes, 'status', s.status, 'channel', s.channel,
               'reconciliation_status', s.reconciliation_status, 'payer', s.payer_phone_masked, 'mpesa_receipt', s.mpesa_receipt,
               'created_at', s.created_at, 'paid_at', s.paid_at) order by s.created_at desc)
      from (select * from public.vendor_sales where vendor_id = v.id order by created_at desc limit 500) s), '[]'::jsonb)
  );
end; $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.vendor_payout_position(uuid) from public, anon, authenticated;
grant execute on function public.vendor_payout_position(uuid) to service_role;
revoke all on function public.admin_request_vendor_refund(uuid, numeric, text) from public, anon;
revoke all on function public.admin_complete_vendor_refund(uuid, text, text) from public, anon;
revoke all on function public.admin_close_vendor_refund(uuid, text, text) from public, anon;
revoke all on function public.admin_record_vendor_adjustment(uuid, numeric, text) from public, anon;
revoke all on function public.admin_resolve_flagged_sale(uuid, text, text, text) from public, anon;
revoke all on function public.admin_import_mpesa_statement(jsonb, text, text) from public, anon;
revoke all on function public.admin_resolve_reconciliation(uuid, uuid, text, text) from public, anon;
revoke all on function public.admin_possible_duplicate_sales(uuid) from public, anon;
revoke all on function public.request_vendor_payout(uuid, numeric, text) from public, anon;
revoke all on function public.admin_decide_vendor_payout(uuid, boolean, numeric, text) from public, anon;
revoke all on function public.admin_update_vendor_payout(uuid, text, text, text) from public, anon;
revoke all on function public.vendor_dashboard() from public, anon;
grant execute on function public.admin_request_vendor_refund(uuid, numeric, text) to authenticated;
grant execute on function public.admin_complete_vendor_refund(uuid, text, text) to authenticated;
grant execute on function public.admin_close_vendor_refund(uuid, text, text) to authenticated;
grant execute on function public.admin_record_vendor_adjustment(uuid, numeric, text) to authenticated;
grant execute on function public.admin_resolve_flagged_sale(uuid, text, text, text) to authenticated;
grant execute on function public.admin_import_mpesa_statement(jsonb, text, text) to authenticated;
grant execute on function public.admin_resolve_reconciliation(uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_possible_duplicate_sales(uuid) to authenticated;
grant execute on function public.request_vendor_payout(uuid, numeric, text) to authenticated;
grant execute on function public.admin_decide_vendor_payout(uuid, boolean, numeric, text) to authenticated;
grant execute on function public.admin_update_vendor_payout(uuid, text, text, text) to authenticated;
grant execute on function public.vendor_dashboard() to authenticated;
