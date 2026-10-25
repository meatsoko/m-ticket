-- Merchandise inventory: stock batches, manual sales, returns/refunds/exchanges,
-- and one report over all of them.
--
-- WHAT THE ORGANISER ASKED FOR (2026-10-25)
--   * Stock received, removed (with a reason), counted, and an opening count that
--     an admin verifies before a size is tracked.
--   * Sales made outside the website (event stand, office) recorded by admins, in
--     KES, with the payment method and the M-Pesa code; corrected by voiding and
--     re-entering, never by editing.
--   * Partial and full refunds, returns and exchanges for website orders and
--     manual sales, with their stock changes recorded separately.
--   * Website orders, manual sales and stock adjustments stay in their own tables;
--     inventory and reporting see them together.
--
-- ONE LEDGER
-- merch_stock_movements (20260929120000) stays the only record of stock changes.
-- Every change goes through merch_move_stock(), which updates the cached
-- merch_variants.stock_on_hand and writes the movement in the same statement
-- sequence, so the cached number always equals the sum of its movements
-- (merch_stock_check() proves it). Movements now say which batch, manual sale or
-- return caused them, beside the existing order_id for website sales.
--
-- TRACKING
-- stock_on_hand NULL still means "not tracked: sold to order, no limit". From now
-- on a size starts being tracked only when an admin confirms an opening count
-- (merch_stock_apply('opening') straight away, or as a draft confirmed later with
-- merch_stock_confirm). merch_adjust_stock() no longer starts tracking.
-- Sales of an untracked size are recorded in full but move no stock
-- (merch_manual_sale_items.stock_tracked = false); an opening count is a physical
-- count, so anything sold before it is already off the shelf.
--
-- HOLDS
-- A website checkout holds stock for 30 minutes (merch_held_qty). A manual sale or
-- an exchange may only use on hand minus held, so the stand cannot sell the unit a
-- web buyer is paying for. Stock-takes and removals record physical fact and only
-- refuse to go below zero.
--
-- RETURNS
-- One merch_returns row per refund/return/exchange, for either a website order or a
-- manual sale. 'in' lines say which sold item came back (or was refunded without
-- coming back: qty 0), how much money was refunded for it, and whether it went back
-- on the shelf. 'out' lines are exchange replacements. Money is recorded, not moved:
-- the refund itself is made in Paystack or by M-Pesa/cash outside this system.
-- Cumulative caps: an item can't be returned more times than it was sold, a line
-- can't be refunded more than it cost, a sale can't be refunded more than its total.
-- A website order becomes 'refunded' once its whole total is refunded.
-- merch_refund_order() (the dashboard's whole-order refund) is now a wrapper over
-- the same code.
--
-- APPEND-ONLY
-- Batches, manual sales, returns and movements are never edited or deleted. A
-- trigger refuses UPDATE/DELETE unless the function doing it set
-- merch.ledger_write — only status changes (draft → confirmed, recorded → voided)
-- and the cached refunded_kes are ever updated.
--
-- SECURITY — CLAUDE.md §5. Every function revokes EXECUTE from PUBLIC, anon and
-- authenticated, then grants only what is needed. Admin functions check
-- is_admin() themselves and take the actor from auth.uid(). Internal helpers are
-- granted to nobody. New tables: RLS on, admins read, nobody writes directly.

-- ---------------------------------------------------------------------------
-- Ledger: an opening count of 0 is a real (zero) movement
-- ---------------------------------------------------------------------------
alter table public.merch_stock_movements drop constraint if exists merch_stock_movements_delta_check;
alter table public.merch_stock_movements
  add constraint merch_stock_movements_delta_check check (delta <> 0 or reason = 'opening');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.merch_stock_batches (
  id                uuid primary key default gen_random_uuid(),
  batch_number      text not null unique,                       -- SB-XXXXXX
  kind              text not null check (kind in ('opening', 'count', 'receive', 'issue', 'reversal')),
  status            text not null default 'confirmed' check (status in ('draft', 'confirmed', 'discarded')),
  supplier          text check (supplier is null or length(supplier) <= 120),
  reference         text check (reference is null or length(reference) <= 80),   -- delivery note, invoice
  issue_reason      text check (issue_reason in ('damaged', 'giveaway', 'sample', 'staff_use', 'lost', 'other')),
  note              text check (note is null or length(note) <= 500),
  reverses_batch_id uuid unique references public.merch_stock_batches(id),
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  confirmed_by      uuid references auth.users(id),
  confirmed_at      timestamptz,
  check (status = 'draft' or kind = 'opening' or status = 'confirmed'),
  check ((kind = 'issue') = (issue_reason is not null)),
  check ((kind = 'reversal') = (reverses_batch_id is not null))
);
create index merch_stock_batches_created_idx on public.merch_stock_batches (created_at desc);

create table public.merch_stock_batch_lines (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.merch_stock_batches(id),
  variant_id       uuid not null references public.merch_variants(id),
  counted          integer check (counted is null or counted between 0 and 100000),   -- opening / count
  qty              integer check (qty is null or qty between 1 and 100000),           -- receive / issue
  expected_on_hand integer,                                  -- what the admin saw when counting
  unit_cost_kes    numeric(12,2) check (unit_cost_kes is null or unit_cost_kes >= 0), -- receive, optional
  outcome          text not null check (outcome in ('draft', 'applied', 'unchanged', 'conflict')),
  delta            integer,                                  -- what was applied (null unless applied)
  unique (batch_id, variant_id)
);
create index merch_stock_batch_lines_variant_idx on public.merch_stock_batch_lines (variant_id);

create table public.merch_manual_sales (
  id               uuid primary key default gen_random_uuid(),
  sale_number      text not null unique,                     -- MM-XXXXXX
  sold_at          timestamptz not null,
  payment_method   text not null check (payment_method in ('cash', 'mpesa', 'card', 'other')),
  mpesa_code       text check (mpesa_code ~ '^[A-Z0-9]{10}$'),
  payment_ref      text check (payment_ref is null or length(payment_ref) <= 80),
  buyer_name       text check (buyer_name is null or length(buyer_name) <= 120),
  location         text check (location is null or length(location) <= 120),
  event_id         uuid references public.events(id),
  note             text check (note is null or length(note) <= 500),
  subtotal_kes     numeric(12,2) not null check (subtotal_kes > 0),
  refunded_kes     numeric(12,2) not null default 0 check (refunded_kes >= 0),
  status           text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason      text check (void_reason is null or length(void_reason) <= 500),
  voided_by        uuid references auth.users(id),
  voided_at        timestamptz,
  replaces_sale_id uuid unique references public.merch_manual_sales(id),   -- a correction
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  check ((payment_method = 'mpesa') = (mpesa_code is not null)),
  check (refunded_kes <= subtotal_kes),
  check ((status = 'voided') = (voided_at is not null))
);
-- An M-Pesa code pays for one sale. A voided sale frees its code for the correction.
create unique index merch_manual_sales_mpesa_code_idx on public.merch_manual_sales (mpesa_code)
  where status = 'recorded';
create index merch_manual_sales_sold_idx on public.merch_manual_sales (sold_at desc);

create table public.merch_manual_sale_items (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references public.merch_manual_sales(id),
  variant_id     uuid not null references public.merch_variants(id),
  product_name   text not null,
  color          text not null,
  size           text not null,
  sku            text not null,
  qty            integer not null check (qty between 1 and 100),
  unit_price_kes numeric(12,2) not null check (unit_price_kes > 0),
  line_total_kes numeric(12,2) generated always as (unit_price_kes * qty) stored,
  stock_tracked  boolean not null,              -- false: sold before the size was tracked
  unique (sale_id, variant_id)
);
create index merch_manual_sale_items_variant_idx on public.merch_manual_sale_items (variant_id);

create table public.merch_returns (
  id                  uuid primary key default gen_random_uuid(),
  return_number       text not null unique,                  -- MR-XXXXXX
  source              text not null check (source in ('web', 'manual')),
  merch_order_id      uuid references public.merch_orders(id),
  manual_sale_id      uuid references public.merch_manual_sales(id),
  reason              text not null check (length(btrim(reason)) between 1 and 500),
  refund_kes          numeric(12,2) not null default 0 check (refund_kes >= 0),   -- lines + delivery
  delivery_refund_kes numeric(12,2) not null default 0 check (delivery_refund_kes >= 0),
  refund_method       text check (refund_method in ('paystack', 'mpesa', 'cash', 'card', 'other')),
  refund_ref          text check (refund_ref is null or length(refund_ref) <= 80),
  extra_paid_kes      numeric(12,2) not null default 0 check (extra_paid_kes >= 0),  -- exchange top-up
  extra_method        text check (extra_method in ('cash', 'mpesa', 'card', 'other')),
  extra_ref           text check (extra_ref is null or length(extra_ref) <= 80),
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  check ((source = 'web') = (merch_order_id is not null)),
  check ((source = 'manual') = (manual_sale_id is not null)),
  check (source = 'web' or delivery_refund_kes = 0),
  check (refund_kes = 0 or refund_method is not null),
  check (extra_paid_kes = 0 or extra_method is not null)
);
create index merch_returns_order_idx on public.merch_returns (merch_order_id);
create index merch_returns_sale_idx on public.merch_returns (manual_sale_id);

create table public.merch_return_lines (
  id                  uuid primary key default gen_random_uuid(),
  return_id           uuid not null references public.merch_returns(id),
  direction           text not null check (direction in ('in', 'out')),
  order_item_id       uuid references public.merch_order_items(id),
  manual_sale_item_id uuid references public.merch_manual_sale_items(id),
  variant_id          uuid not null references public.merch_variants(id),
  product_name        text not null,
  color               text not null,
  size                text not null,
  sku                 text not null,
  qty                 integer not null check (qty between 0 and 100),
  refund_kes          numeric(12,2) not null default 0 check (refund_kes >= 0),
  stock_moved         boolean not null default false,   -- in: back on the shelf; out: taken off it
  check (direction = 'in' or (order_item_id is null and manual_sale_item_id is null and qty >= 1 and refund_kes = 0)),
  check (direction = 'out' or num_nonnulls(order_item_id, manual_sale_item_id) = 1),
  check (direction = 'out' or qty > 0 or refund_kes > 0)
);
create index merch_return_lines_return_idx on public.merch_return_lines (return_id);
create index merch_return_lines_order_item_idx on public.merch_return_lines (order_item_id);
create index merch_return_lines_sale_item_idx on public.merch_return_lines (manual_sale_item_id);

-- What a website order has had refunded so far (cached; merch_returns is the record).
alter table public.merch_orders
  add column if not exists refunded_kes numeric(12,2) not null default 0 check (refunded_kes >= 0);

-- Movements say what caused them.
alter table public.merch_stock_movements
  add column if not exists batch_id       uuid references public.merch_stock_batches(id),
  add column if not exists manual_sale_id uuid references public.merch_manual_sales(id),
  add column if not exists return_id      uuid references public.merch_returns(id);
create index if not exists merch_stock_movements_batch_idx on public.merch_stock_movements (batch_id);
create index if not exists merch_stock_movements_order_idx on public.merch_stock_movements (order_id);

-- ---------------------------------------------------------------------------
-- Append-only guard
-- ---------------------------------------------------------------------------
create or replace function public.merch_guard_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('merch.ledger_write', true), '') <> 'on' then
    raise exception '% is append-only; use the merchandise inventory functions', tg_table_name
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger merch_stock_movements_append_only before update or delete on public.merch_stock_movements
  for each row execute function public.merch_guard_append_only();
create trigger merch_stock_batches_append_only before update or delete on public.merch_stock_batches
  for each row execute function public.merch_guard_append_only();
create trigger merch_stock_batch_lines_append_only before update or delete on public.merch_stock_batch_lines
  for each row execute function public.merch_guard_append_only();
create trigger merch_manual_sales_append_only before update or delete on public.merch_manual_sales
  for each row execute function public.merch_guard_append_only();
create trigger merch_manual_sale_items_append_only before update or delete on public.merch_manual_sale_items
  for each row execute function public.merch_guard_append_only();
create trigger merch_returns_append_only before update or delete on public.merch_returns
  for each row execute function public.merch_guard_append_only();
create trigger merch_return_lines_append_only before update or delete on public.merch_return_lines
  for each row execute function public.merch_guard_append_only();

-- ---------------------------------------------------------------------------
-- RLS: admins read; every write goes through the functions below
-- ---------------------------------------------------------------------------
alter table public.merch_stock_batches     enable row level security;
alter table public.merch_stock_batch_lines enable row level security;
alter table public.merch_manual_sales      enable row level security;
alter table public.merch_manual_sale_items enable row level security;
alter table public.merch_returns           enable row level security;
alter table public.merch_return_lines      enable row level security;
create policy "admin read stock batches"      on public.merch_stock_batches     for select using (public.is_admin());
create policy "admin read stock batch lines"  on public.merch_stock_batch_lines for select using (public.is_admin());
create policy "admin read manual sales"       on public.merch_manual_sales      for select using (public.is_admin());
create policy "admin read manual sale items"  on public.merch_manual_sale_items for select using (public.is_admin());
create policy "admin read merch returns"      on public.merch_returns           for select using (public.is_admin());
create policy "admin read merch return lines" on public.merch_return_lines      for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Internal helpers (granted to nobody; called by the functions below)
-- ---------------------------------------------------------------------------
-- SB-/MM-/MR- numbers for phone support and receipts, like MS- for orders.
create or replace function public.merch_gen_number(p_prefix text, p_table regclass, p_column text)
returns text language plpgsql volatile security definer
set search_path = public as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text;
  v_hit  boolean;
begin
  loop
    v_code := p_prefix || '-';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    execute format('select exists (select 1 from %s where %I = $1)', p_table, p_column) into v_hit using v_code;
    exit when not v_hit;
  end loop;
  return v_code;
end; $$;

-- The one way stock changes. The caller has locked the variant row. p_start: the
-- opening count, which takes an untracked size (NULL) to p_delta. Returns the new
-- balance. Going below zero fails the CHECK on merch_variants, so callers check first.
create or replace function public.merch_move_stock(
  p_variant_id uuid, p_delta integer, p_reason public.merch_stock_reason,
  p_order_id uuid default null, p_batch_id uuid default null,
  p_manual_sale_id uuid default null, p_return_id uuid default null,
  p_note text default null, p_start boolean default false
) returns integer
language plpgsql security definer
set search_path = public as $$
declare v_new integer;
begin
  perform set_config('merch.stock_write', 'on', true);
  update public.merch_variants
     set stock_on_hand = case when p_start then p_delta else stock_on_hand + p_delta end
   where id = p_variant_id and (stock_on_hand is null) = p_start
  returning stock_on_hand into v_new;
  perform set_config('merch.stock_write', 'off', true);
  if v_new is null then
    raise exception 'merch_move_stock: % is % tracked', p_variant_id, case when p_start then 'already' else 'not' end;
  end if;
  insert into public.merch_stock_movements
    (variant_id, delta, reason, order_id, batch_id, manual_sale_id, return_id, actor, note, balance)
  values (p_variant_id, p_delta, p_reason, p_order_id, p_batch_id, p_manual_sale_id, p_return_id,
          auth.uid(), nullif(btrim(p_note), ''), v_new);
  return v_new;
end; $$;

-- A paid website order takes its stock. Returns NULL when done, or the SKU that
-- has run out (nothing taken). Shared by the Paystack and M-Pesa confirmations,
-- which used to carry a copy each.
create or replace function public.merch_take_order_stock(p_order_id uuid)
returns text
language plpgsql security definer
set search_path = public as $$
declare v_item record;
begin
  perform 1 from public.merch_variants
   where id in (select variant_id from public.merch_order_items where order_id = p_order_id)
   order by id for update;
  for v_item in
    select i.sku from public.merch_order_items i join public.merch_variants v on v.id = i.variant_id
     where i.order_id = p_order_id and v.stock_on_hand is not null and v.stock_on_hand < i.qty
     order by i.sku limit 1
  loop
    return v_item.sku;
  end loop;
  for v_item in
    select i.variant_id, i.qty from public.merch_order_items i
      join public.merch_variants v on v.id = i.variant_id
     where i.order_id = p_order_id and v.stock_on_hand is not null
     order by i.variant_id
  loop
    perform public.merch_move_stock(v_item.variant_id, -v_item.qty, 'sale', p_order_id => p_order_id);
  end loop;
  return null;
end; $$;

-- ---------------------------------------------------------------------------
-- Website payment confirmation, now sharing merch_take_order_stock. Behaviour is
-- unchanged from 20260929120000 / 20261008090000.
-- ---------------------------------------------------------------------------
create or replace function public.merch_confirm_payment(p_reference text, p_amount_kes numeric)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_order public.merch_orders%rowtype;
  v_out   text;
begin
  select * into v_order from public.merch_orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('result', 'already', 'order_id', v_order.id);
  end if;
  if v_order.payment_status not in ('pending', 'failed') then
    return jsonb_build_object('result', 'ignored', 'status', v_order.payment_status);
  end if;
  if v_order.total_kes is distinct from p_amount_kes then
    update public.merch_orders set payment_status = 'flagged', flag_reason = 'amount_mismatch'
     where id = v_order.id;
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  end if;

  v_out := public.merch_take_order_stock(v_order.id);
  if v_out is not null then
    update public.merch_orders set payment_status = 'flagged', flag_reason = 'stock_exhausted:' || v_out
     where id = v_order.id;
    return jsonb_build_object('result', 'stock_exhausted', 'order_id', v_order.id, 'sku', v_out);
  end if;

  update public.merch_orders set payment_status = 'paid', paid_at = now(), flag_reason = null
   where id = v_order.id;
  return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id,
    'order_number', v_order.order_number, 'access_token', v_order.access_token, 'email', v_order.email);
end; $$;

create or replace function public.confirm_payhero_merch_payment(p_reference text, p_amount_kes numeric, p_receipt text)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_pay   public.payhero_payments%rowtype;
  v_order public.merch_orders%rowtype;
  v_sku   text;
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
    v_sku := public.merch_take_order_stock(v_order.id);
    if v_sku is not null then
      update public.merch_orders set payment_status = 'flagged', flag_reason = 'stock_exhausted:' || v_sku
       where id = v_order.id;
      v_out := jsonb_build_object('result', 'stock_exhausted', 'order_id', v_order.id, 'sku', v_sku);
    else
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

-- The old single-size adjuster (dashboard before this migration). It may still
-- adjust a tracked size, but tracking now starts only with a confirmed opening count.
create or replace function public.merch_adjust_stock(
  p_variant_id uuid, p_delta integer, p_reason public.merch_stock_reason, p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_var public.merch_variants%rowtype;
  v_new int;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_reason not in ('restock', 'adjustment', 'damaged', 'issue') then
    return jsonb_build_object('result', 'use_inventory');
  end if;
  if p_delta is null or p_delta = 0 then return jsonb_build_object('result', 'invalid'); end if;
  select * into v_var from public.merch_variants where id = p_variant_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_var.stock_on_hand is null then
    return jsonb_build_object('result', 'untracked', 'hint', 'confirm an opening count to start tracking');
  end if;
  if v_var.stock_on_hand + p_delta < 0 then
    return jsonb_build_object('result', 'insufficient', 'on_hand', v_var.stock_on_hand);
  end if;
  v_new := public.merch_move_stock(p_variant_id, p_delta, p_reason, p_note => p_note);
  return jsonb_build_object('result', 'adjusted', 'on_hand', v_new);
end; $$;

-- ---------------------------------------------------------------------------
-- Stock batches: opening counts, stock-takes, deliveries, removals
-- ---------------------------------------------------------------------------
-- p_kind  'opening' | 'count' | 'receive' | 'issue'
-- p_lines [{variant_id, counted?, expected?, qty?, unit_cost_kes?}]
--           opening: counted               count: counted + expected (what the admin saw)
--           receive: qty (+ unit_cost_kes)  issue: qty
-- p_meta  {supplier?, reference?, issue_reason? (issue), note?}
-- p_draft opening only: save the counts for checking; merch_stock_confirm applies them.
-- A stock-take line whose expected no longer matches (a sale landed meanwhile) is
-- set aside as a conflict for a recount; the other lines still apply.
create or replace function public.merch_stock_apply(
  p_kind text, p_lines jsonb, p_meta jsonb default '{}'::jsonb, p_draft boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_meta   jsonb := coalesce(p_meta, '{}'::jsonb);
  v_issue  text := nullif(btrim(coalesce(p_meta->>'issue_reason', '')), '');
  v_note   text := nullif(btrim(coalesce(p_meta->>'note', '')), '');
  v_req    jsonb;
  v_plan   jsonb;
  v_bad    jsonb;
  v_batch  public.merch_stock_batches%rowtype;
  v_line   record;
  v_reason public.merch_stock_reason;
  v_applied int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_kind is null or p_kind not in ('opening', 'count', 'receive', 'issue') then
    return jsonb_build_object('result', 'bad_kind');
  end if;
  if coalesce(p_draft, false) and p_kind <> 'opening' then
    return jsonb_build_object('result', 'draft_opening_only');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 1000 then
    return jsonb_build_object('result', 'bad_lines');
  end if;
  if p_kind = 'issue' and (v_issue is null or v_issue not in ('damaged', 'giveaway', 'sample', 'staff_use', 'lost', 'other')) then
    return jsonb_build_object('result', 'issue_reason_required');
  end if;
  if p_kind = 'issue' and v_issue = 'other' and v_note is null then
    return jsonb_build_object('result', 'note_required');
  end if;
  if length(coalesce(v_meta->>'supplier', '')) > 120 or length(coalesce(v_meta->>'reference', '')) > 80
     or length(coalesce(v_note, '')) > 500 then
    return jsonb_build_object('result', 'too_long');
  end if;

  begin
    select jsonb_agg(to_jsonb(r)) into v_req
      from jsonb_to_recordset(p_lines) r(variant_id uuid, counted int, expected int, qty int, unit_cost_kes numeric);
  exception when others then
    return jsonb_build_object('result', 'bad_lines');
  end;
  if exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid) group by r.variant_id having count(*) > 1)
     or exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid) where r.variant_id is null) then
    return jsonb_build_object('result', 'bad_lines', 'detail', 'each size once');
  end if;
  if exists (
       select 1 from jsonb_to_recordset(v_req) r(variant_id uuid, counted int, expected int, qty int, unit_cost_kes numeric)
        where case when p_kind in ('opening', 'count') then r.counted is null or r.counted not between 0 and 100000
                   else r.qty is null or r.qty not between 1 and 100000 end
           or (p_kind = 'count' and r.expected is null)
           or (r.unit_cost_kes is not null and (p_kind <> 'receive' or r.unit_cost_kes < 0 or r.unit_cost_kes > 10000000))) then
    return jsonb_build_object('result', 'bad_lines');
  end if;
  if exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid)
              where not exists (select 1 from public.merch_variants v where v.id = r.variant_id)) then
    return jsonb_build_object('result', 'unknown_variant');
  end if;

  perform 1 from public.merch_variants
   where id in (select r.variant_id from jsonb_to_recordset(v_req) r(variant_id uuid))
   order by id for update;

  -- Opening counts start tracking; everything else needs a tracked size.
  select jsonb_agg(v.sku order by v.sku) into v_bad
    from jsonb_to_recordset(v_req) r(variant_id uuid) join public.merch_variants v on v.id = r.variant_id
   where (p_kind = 'opening') = (v.stock_on_hand is not null);
  if v_bad is not null then
    return jsonb_build_object('result', case when p_kind = 'opening' then 'already_tracked' else 'untracked' end, 'skus', v_bad);
  end if;

  select jsonb_agg(jsonb_build_object(
           'variant_id', v.id, 'sku', v.sku, 'on_hand', v.stock_on_hand,
           'counted', r.counted, 'expected', r.expected, 'qty', r.qty, 'unit_cost_kes', r.unit_cost_kes,
           'outcome', case
             when coalesce(p_draft, false) then 'draft'
             when p_kind = 'count' and r.expected is distinct from v.stock_on_hand then 'conflict'
             when p_kind = 'count' and r.counted = v.stock_on_hand then 'unchanged'
             else 'applied' end,
           'delta', case p_kind when 'opening' then r.counted when 'count' then r.counted - v.stock_on_hand
                                when 'receive' then r.qty else -r.qty end
         ) order by v.id)
    into v_plan
    from jsonb_to_recordset(v_req) r(variant_id uuid, counted int, expected int, qty int, unit_cost_kes numeric)
    join public.merch_variants v on v.id = r.variant_id;

  if p_kind = 'issue' then
    select jsonb_agg(jsonb_build_object('sku', x.sku, 'on_hand', x.on_hand) order by x.sku) into v_bad
      from jsonb_to_recordset(v_plan) x(sku text, on_hand int, qty int)
     where x.on_hand < x.qty;
    if v_bad is not null then return jsonb_build_object('result', 'insufficient', 'lines', v_bad); end if;
  end if;

  if not coalesce(p_draft, false) and not exists (
       select 1 from jsonb_to_recordset(v_plan) x(outcome text) where x.outcome = 'applied') then
    return jsonb_build_object('result', 'nothing_to_apply',
      'conflicts', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', x.variant_id, 'sku', x.sku, 'expected', x.expected, 'on_hand', x.on_hand)), '[]'::jsonb)
                      from jsonb_to_recordset(v_plan) x(variant_id uuid, sku text, expected int, on_hand int, outcome text) where x.outcome = 'conflict'),
      'unchanged', (select count(*) from jsonb_to_recordset(v_plan) x(outcome text) where x.outcome = 'unchanged'));
  end if;

  insert into public.merch_stock_batches
    (batch_number, kind, status, supplier, reference, issue_reason, note, created_by, confirmed_by, confirmed_at)
  values (public.merch_gen_number('SB', 'public.merch_stock_batches', 'batch_number'), p_kind,
          case when coalesce(p_draft, false) then 'draft' else 'confirmed' end,
          nullif(btrim(coalesce(v_meta->>'supplier', '')), ''), nullif(btrim(coalesce(v_meta->>'reference', '')), ''),
          case when p_kind = 'issue' then v_issue end, v_note, auth.uid(),
          case when not coalesce(p_draft, false) then auth.uid() end,
          case when not coalesce(p_draft, false) then now() end)
  returning * into v_batch;

  v_reason := case p_kind when 'opening' then 'opening' when 'count' then 'adjustment' when 'receive' then 'restock'
                          else case when v_issue = 'damaged' then 'damaged' else 'issue' end end::public.merch_stock_reason;
  for v_line in
    select * from jsonb_to_recordset(v_plan)
      x(variant_id uuid, sku text, on_hand int, counted int, expected int, qty int, unit_cost_kes numeric, outcome text, delta int)
  loop
    insert into public.merch_stock_batch_lines (batch_id, variant_id, counted, qty, expected_on_hand, unit_cost_kes, outcome, delta)
    values (v_batch.id, v_line.variant_id, v_line.counted, v_line.qty,
            case when p_kind = 'count' then v_line.expected else v_line.on_hand end,
            v_line.unit_cost_kes, v_line.outcome, case when v_line.outcome = 'applied' then v_line.delta end);
    if v_line.outcome = 'applied' then
      perform public.merch_move_stock(v_line.variant_id, v_line.delta, v_reason, p_batch_id => v_batch.id,
                                      p_note => v_note, p_start => p_kind = 'opening');
      v_applied := v_applied + 1;
    end if;
  end loop;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_stock_' || p_kind || case when coalesce(p_draft, false) then '_draft' else '' end, v_batch.id,
          jsonb_build_object('batch_number', v_batch.batch_number, 'lines', jsonb_array_length(v_plan), 'applied', v_applied));

  return jsonb_build_object(
    'result', case when coalesce(p_draft, false) then 'draft_saved' else 'applied' end,
    'batch_id', v_batch.id, 'batch_number', v_batch.batch_number, 'applied', v_applied,
    'unchanged', (select count(*) from jsonb_to_recordset(v_plan) x(outcome text) where x.outcome = 'unchanged'),
    'conflicts', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', x.variant_id, 'sku', x.sku, 'expected', x.expected, 'on_hand', x.on_hand)), '[]'::jsonb)
                    from jsonb_to_recordset(v_plan) x(variant_id uuid, sku text, expected int, on_hand int, outcome text) where x.outcome = 'conflict'));
end; $$;

-- Confirm a draft opening count: the admin has checked it. Every size in it must
-- still be untracked (or nothing is applied).
create or replace function public.merch_stock_confirm(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_batch public.merch_stock_batches%rowtype;
  v_line  record;
  v_bad   jsonb;
  v_n     int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  select * into v_batch from public.merch_stock_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_batch.status <> 'draft' then return jsonb_build_object('result', 'not_draft', 'status', v_batch.status); end if;

  perform 1 from public.merch_variants
   where id in (select variant_id from public.merch_stock_batch_lines where batch_id = p_batch_id)
   order by id for update;
  select jsonb_agg(v.sku order by v.sku) into v_bad
    from public.merch_stock_batch_lines l join public.merch_variants v on v.id = l.variant_id
   where l.batch_id = p_batch_id and v.stock_on_hand is not null;
  if v_bad is not null then return jsonb_build_object('result', 'already_tracked', 'skus', v_bad); end if;

  perform set_config('merch.ledger_write', 'on', true);
  update public.merch_stock_batches set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_batch_id;
  update public.merch_stock_batch_lines set outcome = 'applied', delta = counted where batch_id = p_batch_id;
  perform set_config('merch.ledger_write', 'off', true);
  for v_line in select variant_id, counted from public.merch_stock_batch_lines where batch_id = p_batch_id order by variant_id loop
    perform public.merch_move_stock(v_line.variant_id, v_line.counted, 'opening', p_batch_id => p_batch_id,
                                    p_note => v_batch.note, p_start => true);
    v_n := v_n + 1;
  end loop;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_stock_opening_confirm', p_batch_id,
          jsonb_build_object('batch_number', v_batch.batch_number, 'sizes', v_n));
  return jsonb_build_object('result', 'confirmed', 'batch_number', v_batch.batch_number, 'sizes', v_n);
end; $$;

create or replace function public.merch_stock_discard(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare v_batch public.merch_stock_batches%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  select * into v_batch from public.merch_stock_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_batch.status <> 'draft' then return jsonb_build_object('result', 'not_draft', 'status', v_batch.status); end if;
  perform set_config('merch.ledger_write', 'on', true);
  update public.merch_stock_batches set status = 'discarded' where id = p_batch_id;
  perform set_config('merch.ledger_write', 'off', true);
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_stock_opening_discard', p_batch_id, jsonb_build_object('batch_number', v_batch.batch_number));
  return jsonb_build_object('result', 'discarded');
end; $$;

-- Undo a delivery, removal or stock-take entered by mistake: a new 'reversal' batch
-- with the opposite movements. Opening counts are corrected with a stock-take instead.
create or replace function public.merch_stock_reverse(p_batch_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_batch public.merch_stock_batches%rowtype;
  v_rev   public.merch_stock_batches%rowtype;
  v_line  record;
  v_bad   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 500 then return jsonb_build_object('result', 'reason_required'); end if;
  select * into v_batch from public.merch_stock_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_batch.status <> 'confirmed' or v_batch.kind not in ('count', 'receive', 'issue') then
    return jsonb_build_object('result', 'not_reversible', 'kind', v_batch.kind, 'status', v_batch.status);
  end if;
  if exists (select 1 from public.merch_stock_batches where reverses_batch_id = p_batch_id) then
    return jsonb_build_object('result', 'already_reversed');
  end if;

  perform 1 from public.merch_variants
   where id in (select variant_id from public.merch_stock_movements where batch_id = p_batch_id)
   order by id for update;
  select jsonb_agg(jsonb_build_object('sku', v.sku, 'on_hand', v.stock_on_hand) order by v.sku) into v_bad
    from public.merch_stock_movements m join public.merch_variants v on v.id = m.variant_id
   where m.batch_id = p_batch_id and (v.stock_on_hand is null or v.stock_on_hand - m.delta < 0);
  if v_bad is not null then return jsonb_build_object('result', 'insufficient', 'lines', v_bad); end if;

  insert into public.merch_stock_batches (batch_number, kind, status, note, reverses_batch_id, created_by, confirmed_by, confirmed_at)
  values (public.merch_gen_number('SB', 'public.merch_stock_batches', 'batch_number'), 'reversal', 'confirmed',
          btrim(p_reason), p_batch_id, auth.uid(), auth.uid(), now())
  returning * into v_rev;
  for v_line in select variant_id, delta from public.merch_stock_movements where batch_id = p_batch_id order by variant_id loop
    insert into public.merch_stock_batch_lines (batch_id, variant_id, outcome, delta)
    values (v_rev.id, v_line.variant_id, 'applied', -v_line.delta);
    perform public.merch_move_stock(v_line.variant_id, -v_line.delta, 'reversal', p_batch_id => v_rev.id, p_note => p_reason);
  end loop;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_stock_reverse', v_rev.id,
          jsonb_build_object('batch_number', v_rev.batch_number, 'reverses', v_batch.batch_number, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'reversed', 'batch_id', v_rev.id, 'batch_number', v_rev.batch_number);
end; $$;

-- ---------------------------------------------------------------------------
-- Manual sales
-- ---------------------------------------------------------------------------
-- Internal: void a sale (stock that the sale took goes back). Caller checks admin
-- and has locked the sale row.
create or replace function public.merch_void_sale_internal(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_item record;
begin
  perform 1 from public.merch_variants
   where id in (select variant_id from public.merch_manual_sale_items where sale_id = p_sale_id)
   order by id for update;
  for v_item in
    select variant_id, qty from public.merch_manual_sale_items
     where sale_id = p_sale_id and stock_tracked order by variant_id
  loop
    perform public.merch_move_stock(v_item.variant_id, v_item.qty, 'manual_sale_void',
                                    p_manual_sale_id => p_sale_id, p_note => p_reason);
  end loop;
  perform set_config('merch.ledger_write', 'on', true);
  update public.merch_manual_sales
     set status = 'voided', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = p_sale_id;
  perform set_config('merch.ledger_write', 'off', true);
end; $$;

-- p_sale: {
--   sold_at?            when it was sold (default now; up to 90 days back)
--   payment_method      cash | mpesa | card | other
--   mpesa_code?         required for mpesa (10 letters/digits, unique)
--   payment_ref?, buyer_name?, location?, event_id?, note?
--   lines               [{variant_id, qty, unit_price_kes}]
--   replaces_sale_id?   correcting an earlier sale: it is voided first, atomically
--   void_reason?        required with replaces_sale_id
-- }
create or replace function public.merch_record_manual_sale(p_sale jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_method  text := lower(btrim(coalesce(p_sale->>'payment_method', '')));
  v_code    text := nullif(upper(regexp_replace(coalesce(p_sale->>'mpesa_code', ''), '\s', '', 'g')), '');
  v_sold_at timestamptz;
  v_event   uuid;
  v_old     public.merch_manual_sales%rowtype;
  v_req     jsonb;
  v_bad     jsonb;
  v_sale    public.merch_manual_sales%rowtype;
  v_line    record;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_sale is null or jsonb_typeof(p_sale) <> 'object' then return jsonb_build_object('result', 'bad_request'); end if;
  if v_method not in ('cash', 'mpesa', 'card', 'other') then return jsonb_build_object('result', 'bad_payment_method'); end if;
  if v_method = 'mpesa' and (v_code is null or v_code !~ '^[A-Z0-9]{10}$') then
    return jsonb_build_object('result', 'mpesa_code_required');
  end if;
  if v_method <> 'mpesa' then v_code := null; end if;
  if length(coalesce(p_sale->>'payment_ref', '')) > 80 or length(coalesce(p_sale->>'buyer_name', '')) > 120
     or length(coalesce(p_sale->>'location', '')) > 120 or length(coalesce(p_sale->>'note', '')) > 500 then
    return jsonb_build_object('result', 'too_long');
  end if;
  begin
    v_sold_at := coalesce(nullif(p_sale->>'sold_at', '')::timestamptz, now());
    v_event := nullif(p_sale->>'event_id', '')::uuid;
  exception when others then
    return jsonb_build_object('result', 'bad_request');
  end;
  if v_sold_at > now() + interval '5 minutes' or v_sold_at < now() - interval '90 days' then
    return jsonb_build_object('result', 'bad_sold_at');
  end if;
  if v_event is not null and not exists (select 1 from public.events where id = v_event) then
    return jsonb_build_object('result', 'unknown_event');
  end if;

  begin
    select jsonb_agg(to_jsonb(r)) into v_req
      from jsonb_to_recordset(p_sale->'lines') r(variant_id uuid, qty int, unit_price_kes numeric);
  exception when others then
    return jsonb_build_object('result', 'bad_lines');
  end;
  if v_req is null or jsonb_array_length(v_req) = 0 or jsonb_array_length(v_req) > 50
     or exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid, qty int, unit_price_kes numeric)
                 where r.variant_id is null or r.qty is null or r.qty not between 1 and 100
                    or r.unit_price_kes is null or r.unit_price_kes <= 0 or r.unit_price_kes > 1000000
                    or r.unit_price_kes <> round(r.unit_price_kes, 2))
     or exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid) group by r.variant_id having count(*) > 1) then
    return jsonb_build_object('result', 'bad_lines');
  end if;
  if exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid)
              where not exists (select 1 from public.merch_variants v where v.id = r.variant_id)) then
    return jsonb_build_object('result', 'unknown_variant');
  end if;

  -- A correction voids the sale it replaces first, so its stock is free again.
  if p_sale ? 'replaces_sale_id' and nullif(p_sale->>'replaces_sale_id', '') is not null then
    begin
      select * into v_old from public.merch_manual_sales where id = (p_sale->>'replaces_sale_id')::uuid for update;
    exception when others then
      return jsonb_build_object('result', 'bad_request');
    end;
    if v_old.id is null then return jsonb_build_object('result', 'not_found'); end if;
    if v_old.status <> 'recorded' then return jsonb_build_object('result', 'already_voided'); end if;
    if exists (select 1 from public.merch_returns where manual_sale_id = v_old.id) then
      return jsonb_build_object('result', 'has_returns');
    end if;
    if coalesce(btrim(p_sale->>'void_reason'), '') = '' then return jsonb_build_object('result', 'void_reason_required'); end if;
    perform public.merch_void_sale_internal(v_old.id, p_sale->>'void_reason');
  end if;

  if v_code is not null and exists (select 1 from public.merch_manual_sales where mpesa_code = v_code and status = 'recorded') then
    raise exception using errcode = 'P0001', message = 'mpesa_code_used';
  end if;

  perform 1 from public.merch_variants
   where id in (select r.variant_id from jsonb_to_recordset(v_req) r(variant_id uuid))
   order by id for update;
  -- The stand can't sell what a web buyer is paying for: on hand minus held.
  select jsonb_agg(jsonb_build_object('sku', v.sku, 'available', greatest(0, v.stock_on_hand - public.merch_held_qty(v.id))) order by v.sku)
    into v_bad
    from jsonb_to_recordset(v_req) r(variant_id uuid, qty int) join public.merch_variants v on v.id = r.variant_id
   where v.stock_on_hand is not null and v.stock_on_hand - public.merch_held_qty(v.id) < r.qty;
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'insufficient', detail = v_bad::text;
  end if;

  insert into public.merch_manual_sales
    (sale_number, sold_at, payment_method, mpesa_code, payment_ref, buyer_name, location, event_id, note,
     subtotal_kes, replaces_sale_id, created_by)
  values (public.merch_gen_number('MM', 'public.merch_manual_sales', 'sale_number'), v_sold_at, v_method, v_code,
          nullif(btrim(coalesce(p_sale->>'payment_ref', '')), ''), nullif(btrim(coalesce(p_sale->>'buyer_name', '')), ''),
          nullif(btrim(coalesce(p_sale->>'location', '')), ''), v_event, nullif(btrim(coalesce(p_sale->>'note', '')), ''),
          (select sum(r.qty * r.unit_price_kes) from jsonb_to_recordset(v_req) r(qty int, unit_price_kes numeric)),
          v_old.id, auth.uid())
  returning * into v_sale;

  for v_line in
    select r.variant_id, r.qty, r.unit_price_kes, v.sku, v.size, v.stock_on_hand is not null as tracked, p.name, p.color
      from jsonb_to_recordset(v_req) r(variant_id uuid, qty int, unit_price_kes numeric)
      join public.merch_variants v on v.id = r.variant_id
      join public.merch_products p on p.id = v.product_id
     order by r.variant_id
  loop
    insert into public.merch_manual_sale_items
      (sale_id, variant_id, product_name, color, size, sku, qty, unit_price_kes, stock_tracked)
    values (v_sale.id, v_line.variant_id, v_line.name, v_line.color, v_line.size, v_line.sku, v_line.qty,
            v_line.unit_price_kes, v_line.tracked);
    if v_line.tracked then
      perform public.merch_move_stock(v_line.variant_id, -v_line.qty, 'manual_sale', p_manual_sale_id => v_sale.id);
    end if;
  end loop;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), case when v_old.id is null then 'merch_manual_sale' else 'merch_manual_sale_correct' end, v_sale.id,
          jsonb_build_object('sale_number', v_sale.sale_number, 'total_kes', v_sale.subtotal_kes,
                             'payment_method', v_method, 'replaces', v_old.sale_number));
  return jsonb_build_object('result', 'recorded', 'sale_id', v_sale.id, 'sale_number', v_sale.sale_number,
                            'total_kes', v_sale.subtotal_kes, 'voided', v_old.sale_number);
exception
  -- Refusals found after the correction's void: raise so the void rolls back too.
  when sqlstate 'P0001' then
    if sqlerrm = 'insufficient' then
      declare v_detail text;
      begin
        get stacked diagnostics v_detail = pg_exception_detail;
        return jsonb_build_object('result', 'insufficient', 'lines', v_detail::jsonb);
      end;
    elsif sqlerrm = 'mpesa_code_used' then
      return jsonb_build_object('result', 'mpesa_code_used');
    end if;
    raise;
  when unique_violation then
    return jsonb_build_object('result', 'mpesa_code_used');
end; $$;

create or replace function public.merch_void_manual_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare v_sale public.merch_manual_sales%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 500 then return jsonb_build_object('result', 'reason_required'); end if;
  select * into v_sale from public.merch_manual_sales where id = p_sale_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_sale.status <> 'recorded' then return jsonb_build_object('result', 'already_voided'); end if;
  if exists (select 1 from public.merch_returns where manual_sale_id = p_sale_id) then
    return jsonb_build_object('result', 'has_returns');
  end if;
  perform public.merch_void_sale_internal(p_sale_id, p_reason);
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_manual_sale_void', p_sale_id,
          jsonb_build_object('sale_number', v_sale.sale_number, 'total_kes', v_sale.subtotal_kes, 'reason', btrim(p_reason)));
  return jsonb_build_object('result', 'voided', 'sale_number', v_sale.sale_number);
end; $$;

-- ---------------------------------------------------------------------------
-- Returns, refunds and exchanges
-- ---------------------------------------------------------------------------
-- p: {
--   source: 'web' | 'manual', order_id (web) | sale_id (manual),
--   reason, refund_method?, refund_ref?, delivery_refund_kes? (web),
--   lines:    [{item_id, qty, refund_kes, restock}]   item_id = merch_order_items / merch_manual_sale_items id
--   exchange: [{variant_id, qty}]                      replacements handed over
--   extra_paid_kes?, extra_method?, extra_ref?         a top-up paid on an exchange
-- }
-- Internal; merch_record_return and merch_refund_order check the caller.
create or replace function public.merch_apply_return(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_source   text := p->>'source';
  v_reason   text := btrim(coalesce(p->>'reason', ''));
  v_order    public.merch_orders%rowtype;
  v_sale     public.merch_manual_sales%rowtype;
  v_lines    jsonb;
  v_exch     jsonb;
  v_del      numeric;
  v_extra    numeric;
  v_rmethod  text := nullif(lower(btrim(coalesce(p->>'refund_method', ''))), '');
  v_xmethod  text := nullif(lower(btrim(coalesce(p->>'extra_method', ''))), '');
  v_total    numeric;
  v_sale_total numeric;
  v_refunded numeric;
  v_bad      jsonb;
  v_ret      public.merch_returns%rowtype;
  v_line     record;
  v_restocked int := 0;
  v_exchanged int := 0;
begin
  if v_reason = '' or length(v_reason) > 500 then return jsonb_build_object('result', 'reason_required'); end if;
  if v_source is null or v_source not in ('web', 'manual') then return jsonb_build_object('result', 'bad_source'); end if;
  if length(coalesce(p->>'refund_ref', '')) > 80 or length(coalesce(p->>'extra_ref', '')) > 80 then
    return jsonb_build_object('result', 'too_long');
  end if;

  begin
    if v_source = 'web' then
      select * into v_order from public.merch_orders where id = (p->>'order_id')::uuid for update;
    else
      select * into v_sale from public.merch_manual_sales where id = (p->>'sale_id')::uuid for update;
    end if;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_lines
      from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb)) r(item_id uuid, qty int, refund_kes numeric, restock boolean);
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_exch
      from jsonb_to_recordset(coalesce(p->'exchange', '[]'::jsonb)) r(variant_id uuid, qty int);
    v_del := coalesce(nullif(p->>'delivery_refund_kes', '')::numeric, 0);
    v_extra := coalesce(nullif(p->>'extra_paid_kes', '')::numeric, 0);
  exception when others then
    return jsonb_build_object('result', 'bad_lines');
  end;

  if v_source = 'web' then
    if v_order.id is null then return jsonb_build_object('result', 'not_found'); end if;
    if v_order.payment_status <> 'paid' then
      return jsonb_build_object('result', 'not_returnable', 'status', v_order.payment_status);
    end if;
    v_sale_total := v_order.total_kes; v_refunded := v_order.refunded_kes;
  else
    if v_sale.id is null then return jsonb_build_object('result', 'not_found'); end if;
    if v_sale.status <> 'recorded' then return jsonb_build_object('result', 'not_returnable', 'status', v_sale.status); end if;
    if v_del <> 0 then return jsonb_build_object('result', 'bad_lines', 'detail', 'no delivery on a manual sale'); end if;
    v_sale_total := v_sale.subtotal_kes; v_refunded := v_sale.refunded_kes;
  end if;

  if jsonb_array_length(v_lines) > 50 or jsonb_array_length(v_exch) > 20
     or (jsonb_array_length(v_lines) = 0 and jsonb_array_length(v_exch) = 0 and v_del = 0)
     or v_del < 0 or v_del <> round(v_del, 2) or v_extra < 0 or v_extra <> round(v_extra, 2)
     or exists (select 1 from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, refund_kes numeric)
                 where r.item_id is null or coalesce(r.qty, -1) not between 0 and 100
                    or coalesce(r.refund_kes, -1) < 0 or r.refund_kes <> round(r.refund_kes, 2)
                    or (r.qty = 0 and r.refund_kes = 0))
     or exists (select 1 from jsonb_to_recordset(v_lines) r(item_id uuid) group by r.item_id having count(*) > 1)
     or exists (select 1 from jsonb_to_recordset(v_exch) r(variant_id uuid, qty int)
                 where r.variant_id is null or coalesce(r.qty, 0) not between 1 and 100
                    or not exists (select 1 from public.merch_variants v where v.id = r.variant_id))
     or exists (select 1 from jsonb_to_recordset(v_exch) r(variant_id uuid) group by r.variant_id having count(*) > 1) then
    return jsonb_build_object('result', 'bad_lines');
  end if;

  -- Each line must be an item of this sale, within what is left to return/refund.
  with item as (
    select i.id, i.variant_id, i.qty, i.line_total_kes from public.merch_order_items i
     where v_source = 'web' and i.order_id = v_order.id
    union all
    select i.id, i.variant_id, i.qty, i.line_total_kes from public.merch_manual_sale_items i
     where v_source = 'manual' and i.sale_id = v_sale.id
  ), done as (
    select coalesce(l.order_item_id, l.manual_sale_item_id) as item_id, sum(l.qty) as qty, sum(l.refund_kes) as refund
      from public.merch_return_lines l where l.direction = 'in'
       and coalesce(l.order_item_id, l.manual_sale_item_id) in (select id from item)
     group by 1
  )
  select jsonb_agg(jsonb_build_object('item_id', r.item_id,
           'qty_left', coalesce(item.qty - coalesce(done.qty, 0), 0),
           'refund_left', coalesce(item.line_total_kes - coalesce(done.refund, 0), 0)))
    into v_bad
    from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, refund_kes numeric)
    left join item on item.id = r.item_id
    left join done on done.item_id = r.item_id
   where item.id is null or r.qty > item.qty - coalesce(done.qty, 0)
      or r.refund_kes > item.line_total_kes - coalesce(done.refund, 0);
  if v_bad is not null then return jsonb_build_object('result', 'exceeds_sold', 'lines', v_bad); end if;

  if v_source = 'web' and v_del > v_order.delivery_fee_kes - coalesce(
       (select sum(delivery_refund_kes) from public.merch_returns where merch_order_id = v_order.id), 0) then
    return jsonb_build_object('result', 'exceeds_delivery');
  end if;
  v_total := v_del + coalesce((select sum(r.refund_kes) from jsonb_to_recordset(v_lines) r(refund_kes numeric)), 0);
  if v_refunded + v_total > v_sale_total then
    return jsonb_build_object('result', 'exceeds_total', 'refundable', v_sale_total - v_refunded);
  end if;
  if v_total > 0 and (v_rmethod is null or v_rmethod not in ('paystack', 'mpesa', 'cash', 'card', 'other')) then
    return jsonb_build_object('result', 'refund_method_required');
  end if;
  if v_extra > 0 and (v_xmethod is null or v_xmethod not in ('cash', 'mpesa', 'card', 'other')) then
    return jsonb_build_object('result', 'extra_method_required');
  end if;

  -- Lock every size this touches, then check exchange stock: on hand minus web
  -- holds, plus whatever this same return puts back on the shelf.
  perform 1 from public.merch_variants
   where id in (select r.variant_id from jsonb_to_recordset(v_exch) r(variant_id uuid)
                union
                select i.variant_id from jsonb_to_recordset(v_lines) r(item_id uuid)
                  join public.merch_order_items i on i.id = r.item_id
                union
                select i.variant_id from jsonb_to_recordset(v_lines) r(item_id uuid)
                  join public.merch_manual_sale_items i on i.id = r.item_id)
   order by id for update;
  select jsonb_agg(jsonb_build_object('sku', v.sku, 'available', greatest(0, v.stock_on_hand - public.merch_held_qty(v.id))) order by v.sku)
    into v_bad
    from jsonb_to_recordset(v_exch) x(variant_id uuid, qty int)
    join public.merch_variants v on v.id = x.variant_id
   where v.stock_on_hand is not null
     and v.stock_on_hand - public.merch_held_qty(v.id) + coalesce((
           select sum(r.qty) from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, restock boolean)
             left join public.merch_order_items oi on oi.id = r.item_id
             left join public.merch_manual_sale_items si on si.id = r.item_id
            where coalesce(r.restock, false) and coalesce(oi.variant_id, si.variant_id) = v.id), 0) < x.qty;
  if v_bad is not null then return jsonb_build_object('result', 'insufficient', 'lines', v_bad); end if;

  insert into public.merch_returns
    (return_number, source, merch_order_id, manual_sale_id, reason, refund_kes, delivery_refund_kes,
     refund_method, refund_ref, extra_paid_kes, extra_method, extra_ref, created_by)
  values (public.merch_gen_number('MR', 'public.merch_returns', 'return_number'), v_source, v_order.id, v_sale.id,
          v_reason, v_total, v_del, case when v_total > 0 then v_rmethod end,
          nullif(btrim(coalesce(p->>'refund_ref', '')), ''), v_extra,
          case when v_extra > 0 then v_xmethod end, nullif(btrim(coalesce(p->>'extra_ref', '')), ''), auth.uid())
  returning * into v_ret;

  for v_line in
    select r.item_id, r.qty, r.refund_kes, coalesce(r.restock, false) as restock,
           coalesce(oi.variant_id, si.variant_id) as variant_id,
           coalesce(oi.product_name, si.product_name) as product_name, coalesce(oi.color, si.color) as color,
           coalesce(oi.size, si.size) as size, coalesce(oi.sku, si.sku) as sku, v.stock_on_hand is not null as tracked,
           oi.id as order_item_id, si.id as sale_item_id
      from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, refund_kes numeric, restock boolean)
      left join public.merch_order_items oi on v_source = 'web' and oi.id = r.item_id
      left join public.merch_manual_sale_items si on v_source = 'manual' and si.id = r.item_id
      join public.merch_variants v on v.id = coalesce(oi.variant_id, si.variant_id)
     order by 6
  loop
    -- Goods go back on the shelf only when they came back, the admin says they can
    -- be sold again, and the size is tracked (an untracked size has no count to add to).
    insert into public.merch_return_lines
      (return_id, direction, order_item_id, manual_sale_item_id, variant_id, product_name, color, size, sku,
       qty, refund_kes, stock_moved)
    values (v_ret.id, 'in', v_line.order_item_id, v_line.sale_item_id, v_line.variant_id, v_line.product_name,
            v_line.color, v_line.size, v_line.sku, v_line.qty, v_line.refund_kes,
            v_line.restock and v_line.qty > 0 and v_line.tracked);
    if v_line.restock and v_line.qty > 0 and v_line.tracked then
      perform public.merch_move_stock(v_line.variant_id, v_line.qty, 'return', p_return_id => v_ret.id, p_note => v_reason,
                                      p_order_id => case when v_source = 'web' then v_order.id end,
                                      p_manual_sale_id => case when v_source = 'manual' then v_sale.id end);
      v_restocked := v_restocked + v_line.qty;
    end if;
  end loop;

  for v_line in
    select x.variant_id, x.qty, v.sku, v.size, v.stock_on_hand is not null as tracked, pr.name, pr.color
      from jsonb_to_recordset(v_exch) x(variant_id uuid, qty int)
      join public.merch_variants v on v.id = x.variant_id
      join public.merch_products pr on pr.id = v.product_id
     order by x.variant_id
  loop
    insert into public.merch_return_lines
      (return_id, direction, variant_id, product_name, color, size, sku, qty, stock_moved)
    values (v_ret.id, 'out', v_line.variant_id, v_line.name, v_line.color, v_line.size, v_line.sku, v_line.qty, v_line.tracked);
    if v_line.tracked then
      perform public.merch_move_stock(v_line.variant_id, -v_line.qty, 'exchange_out', p_return_id => v_ret.id, p_note => v_reason,
                                      p_order_id => case when v_source = 'web' then v_order.id end,
                                      p_manual_sale_id => case when v_source = 'manual' then v_sale.id end);
    end if;
    v_exchanged := v_exchanged + v_line.qty;
  end loop;

  if v_source = 'web' then
    update public.merch_orders
       set refunded_kes = refunded_kes + v_total,
           payment_status = case when refunded_kes + v_total >= total_kes then 'refunded' else payment_status end,
           refunded_at = case when refunded_kes + v_total >= total_kes then now() else refunded_at end,
           refund_reason = case when refunded_kes + v_total >= total_kes then v_reason else refund_reason end,
           refund_ref = case when refunded_kes + v_total >= total_kes then v_ret.refund_ref else refund_ref end,
           refunded_by = case when refunded_kes + v_total >= total_kes then auth.uid() else refunded_by end,
           fulfilment_status = case when refunded_kes + v_total >= total_kes
                                     and fulfilment_status in ('unfulfilled', 'packed', 'ready_for_pickup')
                                    then 'cancelled' else fulfilment_status end
     where id = v_order.id;
  elsif v_total > 0 then
    perform set_config('merch.ledger_write', 'on', true);
    update public.merch_manual_sales set refunded_kes = refunded_kes + v_total where id = v_sale.id;
    perform set_config('merch.ledger_write', 'off', true);
  end if;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_return', v_ret.id, jsonb_build_object(
    'return_number', v_ret.return_number, 'source', v_source,
    'sale', coalesce(v_order.order_number, v_sale.sale_number), 'refund_kes', v_total,
    'restocked_units', v_restocked, 'exchanged_units', v_exchanged, 'reason', v_reason));
  return jsonb_build_object('result', 'recorded', 'return_id', v_ret.id, 'return_number', v_ret.return_number,
                            'refund_kes', v_total, 'restocked_units', v_restocked, 'exchanged_units', v_exchanged);
end; $$;

create or replace function public.merch_record_return(p_return jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_return is null or jsonb_typeof(p_return) <> 'object' then return jsonb_build_object('result', 'bad_request'); end if;
  return public.merch_apply_return(p_return);
end; $$;

-- The dashboard's "refund the whole order", kept with its signature and result
-- shape, now recorded as a return so reports and stock see it like any other.
-- A flagged order never took stock or counted as a sale: it is only marked refunded.
create or replace function public.merch_refund_order(
  p_order_id uuid, p_reason text, p_restock boolean default false, p_refund_ref text default null
) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_order public.merch_orders%rowtype;
  v_lines jsonb;
  v_out   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('result', 'reason_required'); end if;
  select * into v_order from public.merch_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if v_order.payment_status = 'flagged' then
    update public.merch_orders
       set payment_status = 'refunded', refund_reason = p_reason, refund_ref = p_refund_ref,
           refunded_by = auth.uid(), refunded_at = now(),
           fulfilment_status = case when fulfilment_status in ('unfulfilled', 'packed', 'ready_for_pickup')
                                    then 'cancelled' else fulfilment_status end
     where id = p_order_id;
    insert into public.admin_audit (actor, action, subject_id, detail)
    values (auth.uid(), 'merch_refund_order', p_order_id, jsonb_build_object(
      'reason', p_reason, 'refund_ref', p_refund_ref, 'previous_status', 'flagged',
      'total_kes', v_order.total_kes, 'restocked_units', 0));
    return jsonb_build_object('result', 'refunded', 'restocked_units', 0);
  end if;
  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('result', 'ignored', 'status', v_order.payment_status);
  end if;

  -- Everything not yet returned or refunded, line by line.
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id, 'qty', i.qty - coalesce(d.qty, 0),
           'refund_kes', i.line_total_kes - coalesce(d.refund, 0), 'restock', coalesce(p_restock, false))), '[]'::jsonb)
    into v_lines
    from public.merch_order_items i
    left join (select order_item_id, sum(qty) qty, sum(refund_kes) refund from public.merch_return_lines
                where direction = 'in' and order_item_id is not null group by 1) d on d.order_item_id = i.id
   where i.order_id = p_order_id and (i.qty - coalesce(d.qty, 0) > 0 or i.line_total_kes - coalesce(d.refund, 0) > 0);

  v_out := public.merch_apply_return(jsonb_build_object(
    'source', 'web', 'order_id', p_order_id, 'reason', p_reason, 'lines', v_lines,
    'delivery_refund_kes', v_order.delivery_fee_kes - coalesce(
      (select sum(delivery_refund_kes) from public.merch_returns where merch_order_id = p_order_id), 0),
    'refund_method', case when v_order.paystack_reference is null then 'mpesa' else 'paystack' end,
    'refund_ref', p_refund_ref));
  if v_out->>'result' <> 'recorded' then return v_out; end if;
  return jsonb_build_object('result', 'refunded', 'restocked_units', (v_out->>'restocked_units')::int,
                            'return_number', v_out->>'return_number');
end; $$;

-- ---------------------------------------------------------------------------
-- Reporting: one list of sales lines from every source, and its summary
-- ---------------------------------------------------------------------------
-- kind: sale (+qty, +amount) · return (−qty back, −refund) · exchange_out (+qty, 0)
--       delivery (web delivery fee) · delivery_refund · refund (whole-order refund
--       recorded before returns existed) · exchange_topup (money paid on an exchange)
-- stock_tracked: did this line move stock (false = sold before its size was tracked).
-- Voided manual sales are left out; flagged/failed web orders never sold anything.
create or replace function public.merch_sales_lines(
  p_from timestamptz default null, p_to timestamptz default null,
  p_source text default null, p_product_id uuid default null
) returns table (
  kind text, source text, ref text, occurred_at timestamptz, product_id uuid, variant_id uuid,
  product_name text, color text, size text, sku text, qty integer, amount_kes numeric,
  payment_method text, stock_tracked boolean
)
language plpgsql stable security definer
set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'merch_sales_lines: admins only' using errcode = '42501';
  end if;
  return query
  with web as (
    select o.id, o.order_number, o.paid_at, o.refunded_at, o.delivery_fee_kes, o.total_kes,
           case when o.paystack_reference is null then 'mpesa' else 'paystack' end as method
      from public.merch_orders o where o.paid_at is not null
  ), lines as (
    select 'sale'::text as kind, 'web'::text as source, w.order_number as ref, w.paid_at as occurred_at,
           v.product_id, i.variant_id, i.product_name, i.color, i.size, i.sku, i.qty,
           i.line_total_kes::numeric as amount_kes, w.method as payment_method,
           exists (select 1 from public.merch_stock_movements m
                    where m.order_id = w.id and m.variant_id = i.variant_id and m.reason = 'sale') as stock_tracked
      from web w join public.merch_order_items i on i.order_id = w.id
      join public.merch_variants v on v.id = i.variant_id
    union all
    select 'delivery', 'web', w.order_number, w.paid_at, null::uuid, null::uuid, 'Delivery', null::text, null::text,
           null::text, 0, w.delivery_fee_kes::numeric, w.method, null::boolean
      from web w where w.delivery_fee_kes > 0
    union all
    select 'refund', 'web', w.order_number, w.refunded_at, null::uuid, null::uuid, 'Refund (whole order)', null::text,
           null::text, null::text, 0, -w.total_kes::numeric, w.method, null::boolean
      from web w
     where w.refunded_at is not null
       and not exists (select 1 from public.merch_returns r where r.merch_order_id = w.id)
    union all
    select 'sale', 'manual', s.sale_number, s.sold_at, v.product_id, i.variant_id, i.product_name, i.color, i.size,
           i.sku, i.qty, i.line_total_kes::numeric, s.payment_method, i.stock_tracked
      from public.merch_manual_sales s join public.merch_manual_sale_items i on i.sale_id = s.id
      join public.merch_variants v on v.id = i.variant_id
     where s.status = 'recorded'
    union all
    select 'return', r.source, r.return_number, r.created_at, v.product_id, l.variant_id, l.product_name, l.color,
           l.size, l.sku, -l.qty, -l.refund_kes::numeric, r.refund_method, l.stock_moved
      from public.merch_returns r join public.merch_return_lines l on l.return_id = r.id and l.direction = 'in'
      join public.merch_variants v on v.id = l.variant_id
    union all
    select 'delivery_refund', 'web', r.return_number, r.created_at, null::uuid, null::uuid, 'Delivery refund',
           null::text, null::text, null::text, 0, -r.delivery_refund_kes::numeric, r.refund_method, null::boolean
      from public.merch_returns r where r.delivery_refund_kes > 0
    union all
    select 'exchange_out', r.source, r.return_number, r.created_at, v.product_id, l.variant_id, l.product_name,
           l.color, l.size, l.sku, l.qty, 0::numeric, null::text, l.stock_moved
      from public.merch_returns r join public.merch_return_lines l on l.return_id = r.id and l.direction = 'out'
      join public.merch_variants v on v.id = l.variant_id
    union all
    select 'exchange_topup', r.source, r.return_number, r.created_at, null::uuid, null::uuid, 'Exchange top-up',
           null::text, null::text, null::text, 0, r.extra_paid_kes::numeric, r.extra_method, null::boolean
      from public.merch_returns r where r.extra_paid_kes > 0
  )
  select l.kind, l.source, l.ref, l.occurred_at, l.product_id, l.variant_id, l.product_name, l.color, l.size, l.sku,
         l.qty, l.amount_kes, l.payment_method, l.stock_tracked
    from lines l
   where (p_from is null or l.occurred_at >= p_from) and (p_to is null or l.occurred_at < p_to)
     and (p_source is null or l.source = p_source)
     and (p_product_id is null or l.product_id = p_product_id)
   order by l.occurred_at, l.ref, l.sku nulls first;
end; $$;

-- Totals, a per-day series (Africa/Nairobi days) and per-product performance for
-- the Sales page and its charts. net = sales + delivery + top-ups − refunds.
create or replace function public.merch_report(
  p_from timestamptz, p_to timestamptz, p_source text default null, p_product_id uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_source is not null and p_source not in ('web', 'manual') then return jsonb_build_object('result', 'bad_source'); end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    return jsonb_build_object('result', 'bad_range');
  end if;
  with l as (select * from public.merch_sales_lines(p_from, p_to, p_source, p_product_id))
  select jsonb_build_object(
    'result', 'ok',
    'totals', (select jsonb_build_object(
        'units_sold',      coalesce(sum(qty) filter (where kind = 'sale'), 0),
        'units_returned',  coalesce(-sum(qty) filter (where kind = 'return'), 0),
        'units_exchanged', coalesce(sum(qty) filter (where kind = 'exchange_out'), 0),
        'gross_kes',       coalesce(sum(amount_kes) filter (where kind = 'sale'), 0),
        'delivery_kes',    coalesce(sum(amount_kes) filter (where kind = 'delivery'), 0),
        'refunds_kes',     coalesce(-sum(amount_kes) filter (where kind in ('return', 'refund', 'delivery_refund')), 0),
        'topups_kes',      coalesce(sum(amount_kes) filter (where kind = 'exchange_topup'), 0),
        'net_kes',         coalesce(sum(amount_kes), 0),
        'web_orders',      count(distinct ref) filter (where kind = 'sale' and source = 'web'),
        'manual_sales',    count(distinct ref) filter (where kind = 'sale' and source = 'manual'),
        'untracked_units', coalesce(sum(qty) filter (where kind = 'sale' and not stock_tracked), 0)) from l),
    'by_day', (select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb) from (
        select (occurred_at at time zone 'Africa/Nairobi')::date as day,
               coalesce(sum(amount_kes) filter (where source = 'web'), 0) as web_kes,
               coalesce(sum(amount_kes) filter (where source = 'manual'), 0) as manual_kes,
               coalesce(sum(qty) filter (where kind in ('sale', 'return', 'exchange_out')), 0) as units
          from l group by 1) d),
    'by_product', (select coalesce(jsonb_agg(x order by x.units_sold desc, x.net_kes desc), '[]'::jsonb) from (
        select product_id, max(product_name) as name, max(color) as color,
               coalesce(sum(qty) filter (where kind in ('sale', 'exchange_out')), 0) as units_sold,
               coalesce(-sum(qty) filter (where kind = 'return'), 0) as units_returned,
               coalesce(sum(amount_kes), 0) as net_kes
          from l where product_id is not null group by product_id) x),
    'by_source', (select coalesce(jsonb_agg(x order by x.source), '[]'::jsonb) from (
        select source, coalesce(sum(amount_kes), 0) as net_kes,
               coalesce(sum(qty) filter (where kind = 'sale'), 0) as units_sold
          from l group by source) x),
    'by_method', (select coalesce(jsonb_agg(x order by x.net_kes desc), '[]'::jsonb) from (
        select coalesce(payment_method, 'unknown') as method, coalesce(sum(amount_kes), 0) as net_kes
          from l group by 1) x)
  ) into v;
  return v;
end; $$;

-- The cached stock_on_hand must equal the sum of its movements. Returns the sizes
-- where it doesn't (none, normally).
create or replace function public.merch_stock_check()
returns table (variant_id uuid, sku text, on_hand integer, ledger integer)
language plpgsql stable security definer
set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'merch_stock_check: admins only' using errcode = '42501';
  end if;
  return query
  select v.id, v.sku, v.stock_on_hand, coalesce(sum(m.delta), 0)::int
    from public.merch_variants v left join public.merch_stock_movements m on m.variant_id = v.id
   group by v.id, v.sku, v.stock_on_hand
  having (v.stock_on_hand is null and count(m.id) > 0)
      or (v.stock_on_hand is not null and v.stock_on_hand <> coalesce(sum(m.delta), 0));
end; $$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants — revoke from PUBLIC, anon and authenticated explicitly, every time.
-- ---------------------------------------------------------------------------
revoke all on function public.merch_guard_append_only() from public, anon, authenticated;
revoke all on function public.merch_gen_number(text, regclass, text) from public, anon, authenticated;
revoke all on function public.merch_move_stock(uuid, integer, public.merch_stock_reason, uuid, uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.merch_take_order_stock(uuid) from public, anon, authenticated;
revoke all on function public.merch_confirm_payment(text, numeric) from public, anon, authenticated;
revoke all on function public.confirm_payhero_merch_payment(text, numeric, text) from public, anon, authenticated;
revoke all on function public.merch_adjust_stock(uuid, integer, public.merch_stock_reason, text) from public, anon, authenticated;
revoke all on function public.merch_stock_apply(text, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.merch_stock_confirm(uuid) from public, anon, authenticated;
revoke all on function public.merch_stock_discard(uuid) from public, anon, authenticated;
revoke all on function public.merch_stock_reverse(uuid, text) from public, anon, authenticated;
revoke all on function public.merch_void_sale_internal(uuid, text) from public, anon, authenticated;
revoke all on function public.merch_record_manual_sale(jsonb) from public, anon, authenticated;
revoke all on function public.merch_void_manual_sale(uuid, text) from public, anon, authenticated;
revoke all on function public.merch_apply_return(jsonb) from public, anon, authenticated;
revoke all on function public.merch_record_return(jsonb) from public, anon, authenticated;
revoke all on function public.merch_refund_order(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.merch_sales_lines(timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.merch_report(timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.merch_stock_check() from public, anon, authenticated;

-- Payment path: Edge Functions with the service role only (as before).
grant execute on function public.merch_confirm_payment(text, numeric) to service_role;
grant execute on function public.confirm_payhero_merch_payment(text, numeric, text) to service_role;
-- Signed-in admins; each function checks is_admin() itself.
grant execute on function public.merch_adjust_stock(uuid, integer, public.merch_stock_reason, text) to authenticated;
grant execute on function public.merch_stock_apply(text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.merch_stock_confirm(uuid) to authenticated;
grant execute on function public.merch_stock_discard(uuid) to authenticated;
grant execute on function public.merch_stock_reverse(uuid, text) to authenticated;
grant execute on function public.merch_record_manual_sale(jsonb) to authenticated;
grant execute on function public.merch_void_manual_sale(uuid, text) to authenticated;
grant execute on function public.merch_record_return(jsonb) to authenticated;
grant execute on function public.merch_refund_order(uuid, text, boolean, text) to authenticated;
grant execute on function public.merch_sales_lines(timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.merch_report(timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.merch_stock_check() to authenticated;
-- merch_gen_number, merch_move_stock, merch_take_order_stock, merch_void_sale_internal
-- and merch_apply_return are internal: granted to nobody.
