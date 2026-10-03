-- Event Orders: staff take on-site orders on their phones at an event, record
-- payments (including part payments) and fulfil them; management sees orders,
-- money collected, balances and per-staff accountability in the dashboard.
--
-- Why new tables instead of public.orders: an `orders` row is one ticket or
-- reservation payment — one Paystack reference, status pending -> paid, and its
-- confirmation issues tickets / confirms bookings and feeds ticket revenue,
-- reconciliation and refunds. Part payments by several collectors and an
-- append-only payment history do not fit it, and mixing them in would distort
-- ticket revenue. Events, staff (admin_users), is_staff()/is_admin(), the audit
-- log (admin_audit) and KSh are reused as they are.
--
-- Decisions (organiser, 2026-10-03):
--   * Products come from a separate on-site menu (event_menu_items), not the
--     online preorder_items (which carry early-bird, cap and table rules).
--   * Payments are RECORDED by staff (cash, M-Pesa with its code, card machine
--     with its reference, other). No new payment provider; status 'confirmed'.
--   * Staff fulfil only fully paid orders; an admin may fulfil with a balance
--     (audited).
--   * Every existing staff account can take orders; only admins cancel, refund
--     or correct payments and edit the menu.
--
-- Model:
--   event_orders         one row per order; totals and statuses are CACHED here
--                        and recomputed (under a row lock) by the functions below
--   event_order_items    price + name SNAPSHOTS: a later menu change never alters
--                        an old receipt
--   event_order_payments APPEND-ONLY. kind = payment | refund | correction.
--                        Refunds/corrections are new rows pointing at the payment
--                        they reverse; nothing is ever updated or deleted
--                        (no grants, and triggers refuse it even for postgres).
--
-- Money: net collected = payments - corrections - refunds.
--        balance = total - (payments - corrections)   (refunds are money handed
--        back for a cancelled/returned order; they don't make the customer owe
--        more), and 0 once the order is cancelled or refunded.
--
-- Staff accountability: created_by on the order, recorded_by on EACH payment, so
-- a payment Mary collects on John's order is Mary's collection on John's order.
-- Identity always comes from auth.uid() inside the functions, never from input.
--
-- Access: staff read everything (to find and follow up any order at the event);
-- nobody writes these tables directly. The public receipt is read by its random
-- receipt_token through get_event_order_receipt(), service_role only (the
-- event-order-receipt Edge Function).

-- ---------------------------------------------------------------- menu
create table if not exists public.event_menu_items (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 80),
  description text check (description is null or length(description) <= 200),
  price_kes   numeric(10,2) not null check (price_kes > 0),
  is_active   boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists event_menu_items_event_idx on public.event_menu_items (event_id, position);

alter table public.event_menu_items enable row level security;
revoke all on table public.event_menu_items from anon, authenticated;
grant select, insert, update on table public.event_menu_items to authenticated;
drop policy if exists event_menu_items_staff_read on public.event_menu_items;
create policy event_menu_items_staff_read on public.event_menu_items
  for select to authenticated using (public.is_staff());
drop policy if exists event_menu_items_admin_insert on public.event_menu_items;
create policy event_menu_items_admin_insert on public.event_menu_items
  for insert to authenticated with check (public.is_admin());
drop policy if exists event_menu_items_admin_update on public.event_menu_items;
create policy event_menu_items_admin_update on public.event_menu_items
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- No delete: retire an item with is_active = false (old orders keep their snapshot anyway).

-- ---------------------------------------------------------------- orders
create table if not exists public.event_orders (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id),
  seq              integer not null check (seq > 0),
  order_number     text not null,                      -- e.g. NFM-0042
  customer_name    text not null check (length(btrim(customer_name)) between 2 and 120),
  customer_phone   text not null check (customer_phone ~ '^254[17][0-9]{8}$'),
  customer_email   text check (customer_email is null or public.looks_like_email(customer_email)),
  note             text check (note is null or length(note) <= 300),
  total_kes        numeric(12,2) not null check (total_kes > 0),
  paid_kes         numeric(12,2) not null default 0,   -- sum of payments
  corrected_kes    numeric(12,2) not null default 0,   -- sum of corrections
  refunded_kes     numeric(12,2) not null default 0,   -- sum of refunds
  order_status     text not null default 'open'
                   check (order_status in ('open', 'fulfilled', 'cancelled', 'refunded')),
  payment_status   text not null default 'unpaid'
                   check (payment_status in ('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded')),
  created_by       uuid not null references auth.users(id),
  receipt_token    text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  fulfilled_by     uuid references auth.users(id),
  fulfilled_at     timestamptz,
  cancelled_by     uuid references auth.users(id),
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (event_id, seq),
  unique (event_id, order_number)
);
create index if not exists event_orders_event_idx on public.event_orders (event_id, created_at desc);
create index if not exists event_orders_phone_idx on public.event_orders (customer_phone);
create index if not exists event_orders_created_by_idx on public.event_orders (created_by);

create table if not exists public.event_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.event_orders(id),
  menu_item_id    uuid references public.event_menu_items(id),
  name            text not null,                         -- snapshot
  unit_price_kes  numeric(10,2) not null check (unit_price_kes > 0),  -- snapshot
  qty             integer not null check (qty between 1 and 99),
  line_total_kes  numeric(12,2) generated always as (unit_price_kes * qty) stored
);
create index if not exists event_order_items_order_idx on public.event_order_items (order_id);

create table if not exists public.event_order_payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.event_orders(id),
  kind                text not null default 'payment' check (kind in ('payment', 'refund', 'correction')),
  amount_kes          numeric(12,2) not null check (amount_kes > 0),
  method              text not null check (method in ('cash', 'mpesa', 'card', 'other')),
  reference           text check (reference is null or length(reference) between 3 and 40),
  status              text not null default 'confirmed' check (status in ('confirmed')),
  reverses_payment_id uuid references public.event_order_payments(id),
  note                text check (note is null or length(note) <= 300),
  recorded_by         uuid not null references auth.users(id),
  recorded_at         timestamptz not null default now(),
  -- A payment stands alone; a refund/correction always points at the payment it reverses.
  check ((kind = 'payment') = (reverses_payment_id is null)),
  -- An M-Pesa payment carries its transaction code.
  check (kind <> 'payment' or method <> 'mpesa' or reference is not null)
);
create index if not exists event_order_payments_order_idx on public.event_order_payments (order_id, recorded_at);
create index if not exists event_order_payments_recorded_by_idx on public.event_order_payments (recorded_by);
-- The same M-Pesa code can't be recorded as two payments (double entry / reuse).
create unique index if not exists event_order_payments_mpesa_ref
  on public.event_order_payments (upper(reference)) where kind = 'payment' and method = 'mpesa';

-- Items and payments are history: never updated or deleted, by anyone.
create or replace function public.event_orders_history_is_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only: record a refund or correction instead', tg_table_name
    using errcode = '42501';
end; $$;
revoke execute on function public.event_orders_history_is_immutable() from public;
drop trigger if exists event_order_payments_immutable on public.event_order_payments;
create trigger event_order_payments_immutable before update or delete on public.event_order_payments
  for each row execute function public.event_orders_history_is_immutable();
drop trigger if exists event_order_items_immutable on public.event_order_items;
create trigger event_order_items_immutable before update or delete on public.event_order_items
  for each row execute function public.event_orders_history_is_immutable();

alter table public.event_orders enable row level security;
alter table public.event_order_items enable row level security;
alter table public.event_order_payments enable row level security;
revoke all on table public.event_orders, public.event_order_items, public.event_order_payments from anon, authenticated;
grant select on table public.event_orders, public.event_order_items, public.event_order_payments to authenticated;
drop policy if exists event_orders_staff_read on public.event_orders;
create policy event_orders_staff_read on public.event_orders for select to authenticated using (public.is_staff());
drop policy if exists event_order_items_staff_read on public.event_order_items;
create policy event_order_items_staff_read on public.event_order_items for select to authenticated using (public.is_staff());
drop policy if exists event_order_payments_staff_read on public.event_order_payments;
create policy event_order_payments_staff_read on public.event_order_payments for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------- helpers (internal)
-- 07XX / 01XX / 7XX / 2547XX / +254 1XX -> 2547XXXXXXXX; null when not a Kenyan mobile.
create or replace function public.event_orders_norm_phone(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when d ~ '^254[17][0-9]{8}$' then d
    when d ~ '^0[17][0-9]{8}$'   then '254' || substr(d, 2)
    when d ~ '^[17][0-9]{8}$'    then '254' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;
revoke execute on function public.event_orders_norm_phone(text) from public;

-- Recompute the cached totals and payment status of a LOCKED order.
create or replace function public.event_orders_recalc(p_order_id uuid)
returns public.event_orders
language plpgsql security definer set search_path = public as $$
declare v public.event_orders%rowtype; v_paid numeric; v_corr numeric; v_ref numeric; v_net numeric; v_status text;
begin
  select coalesce(sum(amount_kes) filter (where kind = 'payment'), 0),
         coalesce(sum(amount_kes) filter (where kind = 'correction'), 0),
         coalesce(sum(amount_kes) filter (where kind = 'refund'), 0)
    into v_paid, v_corr, v_ref
    from public.event_order_payments where order_id = p_order_id;
  select * into v from public.event_orders where id = p_order_id;
  v_net := v_paid - v_corr - v_ref;
  v_status := case
    when v_ref > 0 and v_net <= 0 then 'refunded'
    when v_ref > 0                then 'partially_refunded'
    when v_paid - v_corr <= 0     then 'unpaid'
    when v_paid - v_corr < v.total_kes then 'partially_paid'
    else 'paid' end;
  update public.event_orders
     set paid_kes = v_paid, corrected_kes = v_corr, refunded_kes = v_ref,
         payment_status = v_status, updated_at = now()
   where id = p_order_id
  returning * into v;
  return v;
end; $$;
revoke execute on function public.event_orders_recalc(uuid) from public, anon, authenticated;

create or replace function public.event_order_balance(o public.event_orders)
returns numeric language sql immutable set search_path = public as $$
  select case when o.order_status in ('cancelled', 'refunded') then 0
              else greatest(o.total_kes - (o.paid_kes - o.corrected_kes), 0) end
$$;
revoke execute on function public.event_order_balance(public.event_orders) from public;
grant execute on function public.event_order_balance(public.event_orders) to authenticated, service_role;

-- Shared by create (first payment) and record_event_order_payment.
create or replace function public.event_orders_add_payment(
  p_order public.event_orders, p_amount numeric, p_method text, p_reference text, p_note text, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ref text := nullif(upper(btrim(coalesce(p_reference, ''))), ''); v_id uuid;
begin
  if p_order.order_status <> 'open' then return jsonb_build_object('error', 'order_not_open'); end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then return jsonb_build_object('error', 'bad_amount'); end if;
  if p_amount > public.event_order_balance(p_order) then
    return jsonb_build_object('error', 'exceeds_balance', 'balance', public.event_order_balance(p_order));
  end if;
  if p_method not in ('cash', 'mpesa', 'card', 'other') then return jsonb_build_object('error', 'bad_method'); end if;
  if p_method = 'mpesa' and (v_ref is null or v_ref !~ '^[A-Z0-9]{8,12}$') then
    return jsonb_build_object('error', 'mpesa_code_required');
  end if;
  if v_ref is not null and length(v_ref) not between 3 and 40 then return jsonb_build_object('error', 'bad_reference'); end if;
  if p_method = 'mpesa' and exists (
       select 1 from public.event_order_payments where kind = 'payment' and method = 'mpesa' and upper(reference) = v_ref) then
    return jsonb_build_object('error', 'duplicate_reference');
  end if;
  insert into public.event_order_payments (order_id, kind, amount_kes, method, reference, note, recorded_by)
  values (p_order.id, 'payment', p_amount, p_method, v_ref, nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning id into v_id;
  perform public.event_orders_recalc(p_order.id);
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (p_actor, 'event_order_payment', p_order.id,
          jsonb_build_object('payment_id', v_id, 'order_number', p_order.order_number, 'amount_kes', p_amount, 'method', p_method, 'reference', v_ref));
  return jsonb_build_object('payment_id', v_id);
end; $$;
revoke execute on function public.event_orders_add_payment(public.event_orders, numeric, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- staff actions
-- p_items: [{"menu_item_id": uuid, "qty": int}, ...]
-- p_payment (optional): {"amount": num, "method": text, "reference": text}
create or replace function public.create_event_order(
  p_event_id uuid, p_customer_name text, p_customer_phone text, p_customer_email text,
  p_items jsonb, p_payment jsonb default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_event public.events%rowtype;
  v_phone text := public.event_orders_norm_phone(p_customer_phone);
  v_name text := btrim(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g'));
  v_email text := nullif(btrim(coalesce(p_customer_email, '')), '');
  v_lines jsonb; v_line record; v_total numeric := 0; v_seq integer; v_order public.event_orders%rowtype;
  v_pay jsonb; v_prefix text;
begin
  if v_actor is null or not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_event from public.events where id = p_event_id;
  if not found or v_event.status <> 'live' then return jsonb_build_object('error', 'event_not_live'); end if;
  if length(v_name) not between 2 and 120 then return jsonb_build_object('error', 'invalid_name'); end if;
  if v_phone is null then return jsonb_build_object('error', 'invalid_phone'); end if;
  if v_email is not null and not public.looks_like_email(v_email) then return jsonb_build_object('error', 'invalid_email'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'no_items');
  end if;

  -- Merge duplicate lines; prices and names come from the menu, never from the caller.
  select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price', m.price_kes, 'qty', x.qty, 'ok', m.is_active and m.event_id = p_event_id))
    into v_lines
    from (select (e->>'menu_item_id')::uuid as id, sum((e->>'qty')::int) as qty
            from jsonb_array_elements(p_items) e group by 1) x
    left join public.event_menu_items m on m.id = x.id;
  for v_line in select * from jsonb_to_recordset(v_lines) as t(id uuid, name text, price numeric, qty int, ok boolean) loop
    if v_line.ok is not true then return jsonb_build_object('error', 'unknown_item'); end if;
    if v_line.qty is null or v_line.qty not between 1 and 99 then return jsonb_build_object('error', 'bad_qty', 'item', v_line.name); end if;
    v_total := v_total + v_line.price * v_line.qty;
  end loop;
  if jsonb_array_length(v_lines) > 30 then return jsonb_build_object('error', 'too_many_lines'); end if;

  -- Sequential order number per event, allocated under a per-event lock.
  perform pg_advisory_xact_lock(hashtext('event_orders:' || p_event_id::text));
  select coalesce(max(seq), 0) + 1 into v_seq from public.event_orders where event_id = p_event_id;
  v_prefix := coalesce(nullif(v_event.reservation_prefix, ''), 'ORD');
  insert into public.event_orders (event_id, seq, order_number, customer_name, customer_phone, customer_email, note, total_kes, created_by)
  values (p_event_id, v_seq, v_prefix || '-' || lpad(v_seq::text, 4, '0'), v_name, v_phone, v_email,
          nullif(btrim(coalesce(p_note, '')), ''), v_total, v_actor)
  returning * into v_order;
  insert into public.event_order_items (order_id, menu_item_id, name, unit_price_kes, qty)
  select v_order.id, t.id, t.name, t.price, t.qty
    from jsonb_to_recordset(v_lines) as t(id uuid, name text, price numeric, qty int);
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, 'event_order_create', v_order.id,
          jsonb_build_object('order_number', v_order.order_number, 'event_id', p_event_id, 'total_kes', v_total));

  if p_payment is not null and jsonb_typeof(p_payment) = 'object' and coalesce((p_payment->>'amount')::numeric, 0) > 0 then
    v_pay := public.event_orders_add_payment(v_order, (p_payment->>'amount')::numeric, p_payment->>'method',
                                             p_payment->>'reference', null, v_actor);
    if v_pay ? 'error' then
      -- Nothing half-done: the whole order is rolled back with the bad payment.
      raise exception 'payment_rejected:%', v_pay->>'error' using errcode = 'P0001';
    end if;
  end if;

  select * into v_order from public.event_orders where id = v_order.id;
  return jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number, 'receipt_token', v_order.receipt_token,
    'total_kes', v_order.total_kes, 'payment_status', v_order.payment_status, 'balance_kes', public.event_order_balance(v_order));
end; $$;

create or replace function public.record_event_order_payment(
  p_order_id uuid, p_amount numeric, p_method text, p_reference text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_order public.event_orders%rowtype; v_res jsonb;
begin
  if v_actor is null or not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_order from public.event_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_res := public.event_orders_add_payment(v_order, p_amount, p_method, p_reference, p_note, v_actor);
  if v_res ? 'error' then return v_res; end if;
  select * into v_order from public.event_orders where id = p_order_id;
  return v_res || jsonb_build_object('payment_status', v_order.payment_status, 'balance_kes', public.event_order_balance(v_order));
end; $$;

create or replace function public.fulfil_event_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_order public.event_orders%rowtype; v_balance numeric;
begin
  if v_actor is null or not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_order from public.event_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_order.order_status <> 'open' then return jsonb_build_object('error', 'order_not_open', 'order_status', v_order.order_status); end if;
  v_balance := public.event_order_balance(v_order);
  -- Staff hand over only paid orders; an admin may release one with a balance (audited).
  if v_balance > 0 and not public.is_admin() then return jsonb_build_object('error', 'not_fully_paid', 'balance_kes', v_balance); end if;
  update public.event_orders set order_status = 'fulfilled', fulfilled_by = v_actor, fulfilled_at = now(), updated_at = now()
   where id = p_order_id;
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, case when v_balance > 0 then 'event_order_fulfil_with_balance' else 'event_order_fulfil' end, p_order_id,
          jsonb_build_object('order_number', v_order.order_number, 'balance_kes', v_balance));
  return jsonb_build_object('order_status', 'fulfilled', 'balance_kes', v_balance);
end; $$;

-- ---------------------------------------------------------------- admin actions
create or replace function public.cancel_event_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_order public.event_orders%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if v_reason is null then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_order from public.event_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_order.order_status <> 'open' then return jsonb_build_object('error', 'order_not_open', 'order_status', v_order.order_status); end if;
  -- Money still held must be handed back (refund) or struck off (correction) first.
  if v_order.paid_kes - v_order.corrected_kes - v_order.refunded_kes > 0 then
    return jsonb_build_object('error', 'refund_first', 'held_kes', v_order.paid_kes - v_order.corrected_kes - v_order.refunded_kes);
  end if;
  update public.event_orders set order_status = 'cancelled', cancelled_by = v_actor, cancelled_at = now(),
         cancel_reason = v_reason, updated_at = now() where id = p_order_id;
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, 'event_order_cancel', p_order_id, jsonb_build_object('order_number', v_order.order_number, 'reason', v_reason));
  return jsonb_build_object('order_status', 'cancelled');
end; $$;

-- Refund (money handed back) or correction (a payment recorded by mistake) of
-- part or all of ONE payment. A new row; the original is never touched.
create or replace function public.reverse_event_order_payment(p_payment_id uuid, p_kind text, p_amount numeric, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_pay public.event_order_payments%rowtype; v_order public.event_orders%rowtype;
  v_left numeric; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_id uuid;
begin
  if v_actor is null or not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_kind not in ('refund', 'correction') then return jsonb_build_object('error', 'bad_kind'); end if;
  if v_reason is null then return jsonb_build_object('error', 'reason_required'); end if;
  select * into v_pay from public.event_order_payments where id = p_payment_id;
  if not found or v_pay.kind <> 'payment' then return jsonb_build_object('error', 'not_found'); end if;
  select * into v_order from public.event_orders where id = v_pay.order_id for update;
  if v_order.order_status = 'cancelled' then return jsonb_build_object('error', 'order_cancelled'); end if;
  select v_pay.amount_kes - coalesce(sum(amount_kes), 0) into v_left
    from public.event_order_payments where reverses_payment_id = p_payment_id;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then return jsonb_build_object('error', 'bad_amount'); end if;
  if p_amount > v_left then return jsonb_build_object('error', 'exceeds_payment', 'remaining_kes', v_left); end if;
  insert into public.event_order_payments (order_id, kind, amount_kes, method, reference, reverses_payment_id, note, recorded_by)
  values (v_order.id, p_kind, p_amount, v_pay.method, v_pay.reference, p_payment_id, v_reason, v_actor)
  returning id into v_id;
  v_order := public.event_orders_recalc(v_order.id);
  -- Everything handed back: the order is refunded.
  if p_kind = 'refund' and v_order.paid_kes - v_order.corrected_kes - v_order.refunded_kes <= 0 then
    update public.event_orders set order_status = 'refunded', updated_at = now() where id = v_order.id;
  end if;
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, 'event_order_' || p_kind, v_order.id,
          jsonb_build_object('order_number', v_order.order_number, 'payment_id', p_payment_id, 'entry_id', v_id, 'amount_kes', p_amount, 'reason', v_reason));
  select * into v_order from public.event_orders where id = v_order.id;
  return jsonb_build_object('entry_id', v_id, 'payment_status', v_order.payment_status, 'order_status', v_order.order_status,
    'balance_kes', public.event_order_balance(v_order));
end; $$;

-- Staff emails for names on screens and reports (staff can see colleagues).
create or replace function public.staff_directory()
returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return query select a.user_id, u.email::text, a.role::text from public.admin_users a join auth.users u on u.id = a.user_id;
end; $$;

-- ---------------------------------------------------------------- public receipt
-- By receipt_token only (32 hex, unguessable); called by the event-order-receipt
-- Edge Function with the service role. The phone is masked; staff are not named.
create or replace function public.get_event_order_receipt(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.event_orders%rowtype; e public.events%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then return null; end if;
  select * into v from public.event_orders where receipt_token = p_token;
  if not found then return null; end if;
  select * into e from public.events where id = v.event_id;
  return jsonb_build_object(
    'event', jsonb_build_object('name', e.name, 'venue', e.venue, 'starts_at', e.starts_at),
    'order_number', v.order_number, 'customer_name', v.customer_name,
    'customer_phone', '0' || substr(v.customer_phone, 4, 3) || '***' || right(v.customer_phone, 3),
    'total_kes', v.total_kes, 'paid_kes', v.paid_kes - v.corrected_kes, 'refunded_kes', v.refunded_kes,
    'balance_kes', public.event_order_balance(v), 'payment_status', v.payment_status, 'order_status', v.order_status,
    'created_at', v.created_at, 'fulfilled_at', v.fulfilled_at,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'unit_price_kes', unit_price_kes, 'line_total_kes', line_total_kes) order by name), '[]')
                from public.event_order_items where order_id = v.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'amount_kes', amount_kes, 'method', method,
                   'reference', case when reference is null then null else '…' || right(reference, 4) end, 'at', recorded_at) order by recorded_at), '[]')
                from public.event_order_payments where order_id = v.id));
end; $$;

-- ---------------------------------------------------------------- grants
-- House rule: no PUBLIC execute on SECURITY DEFINER functions.
revoke execute on function public.create_event_order(uuid, text, text, text, jsonb, jsonb, text) from public, anon;
revoke execute on function public.record_event_order_payment(uuid, numeric, text, text, text) from public, anon;
revoke execute on function public.fulfil_event_order(uuid) from public, anon;
revoke execute on function public.cancel_event_order(uuid, text) from public, anon;
revoke execute on function public.reverse_event_order_payment(uuid, text, numeric, text) from public, anon;
revoke execute on function public.staff_directory() from public, anon;
revoke execute on function public.get_event_order_receipt(text) from public, anon, authenticated;
-- Signed-in callers; each function checks is_staff()/is_admin() itself.
grant execute on function public.create_event_order(uuid, text, text, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.record_event_order_payment(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.fulfil_event_order(uuid) to authenticated;
grant execute on function public.cancel_event_order(uuid, text) to authenticated;
grant execute on function public.reverse_event_order_payment(uuid, text, numeric, text) to authenticated;
grant execute on function public.staff_directory() to authenticated;
grant execute on function public.get_event_order_receipt(text) to service_role;
