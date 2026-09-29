-- Merchandise store: catalogue, stock, delivery, exchange rate and orders.
--
-- WHY SEPARATE FROM public.orders
-- Merchandise does not share the ticketing order tables. orders.event_id is NOT
-- NULL, and confirm_paystack_payment() matches ANY order by its Paystack
-- reference and then issues tickets or confirms a reservation — a merch order in
-- that table would be marked paid by the ticketing path and its stock would never
-- move. Reusing it would mean changing live ticketing functions. Nothing in this
-- migration touches an existing table or function.
--
-- The one shared surface is Paystack itself: one account, one webhook URL. Ticket
-- and reservation references start "MT"; merchandise references start "MS", and
-- the webhook routes on that prefix (Edge Function change, not in this file).
--
-- SHAPE
--   merch_groups    one row per category ........ Hoodies, Polos, Partnerships
--   merch_products  one row per colourway ....... /shop/<slug>; carries the price
--   merch_variants  one row per size ............ carries the stock
-- Price lives on the colourway because that is how prices were given (a red
-- hoodie costs more than a green one). Stock lives on the size because that is
-- what physically runs out. `style_key` groups colourways into swatches; it is a
-- plain key, not a table, because nothing else hangs off it.
--
-- MONEY
-- Catalogue prices are USD (as supplied by the organiser). Customers are charged
-- in KES through Paystack at the prevailing market rate, recorded in
-- merch_fx_rates by a refresher (an Edge Function or an admin) — this file does
-- not seed a rate, and checkout refuses to open on a missing or stale one rather
-- than charge at a guessed number. Each order snapshots the rate it used, and
-- every line is converted and rounded to whole shillings individually, so the
-- lines always add up to the total a customer sees and Paystack charges.
--
-- STOCK
-- A NULL stock_on_hand means "not tracked" (made to order, no limit) — the state
-- every size starts in, because no counts have been supplied. Tracking starts the
-- first time an admin records a restock. Once tracked:
--   available = stock_on_hand − quantities on pending orders younger than the
--               hold window (30 min)
-- The pending order IS the hold: an abandoned checkout expires on its own, no
-- sweeper job. stock_on_hand changes only inside the functions below, each of
-- which writes a merch_stock_movements row in the same transaction, so every
-- number has a reason and an actor. CHECK (stock_on_hand >= 0) is the last line:
-- a payment that lands after its hold expired, on stock someone else has since
-- bought, is FLAGGED (money taken, refund needed) rather than overselling.
--
-- SECURITY — see CLAUDE.md §5 and 20260924140000_lock_admit_pass.sql
-- Every function below has EXECUTE revoked from PUBLIC, anon and authenticated
-- explicitly (Supabase also grants the latter two by default privileges, not only
-- through PUBLIC), then granted only to the roles that need it. Order and stock
-- writes happen only through these functions; no table has an INSERT/UPDATE
-- policy for anyone but admins, and orders have no public SELECT at all —
-- customers read their own order through an Edge Function keyed on access_token.
--
-- Additive only. The existing application does not read these tables yet.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type merch_payment_status as enum ('pending', 'paid', 'failed', 'refunded', 'flagged');
create type merch_fulfilment_status as enum (
  'unfulfilled', 'packed', 'ready_for_pickup', 'dispatched', 'delivered', 'collected', 'cancelled'
);
create type merch_stock_reason as enum ('restock', 'sale', 'return', 'adjustment', 'damaged');

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.merch_groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null,
  eyebrow     text,
  description text,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.merch_products (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.merch_groups(id),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  style_key   text not null,             -- colourways sharing a key are swatches of each other
  name        text not null,
  color       text not null,
  swatch      text not null default '#cccccc',   -- CSS background (colour or gradient)
  image_path  text not null,
  summary     text,
  details     text[] not null default '{}',
  partner     text,                      -- e.g. 'Brian Munyolo Boxing'
  price_usd   numeric(10,2) check (price_usd is null or price_usd > 0),  -- NULL = "price coming soon"
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index merch_products_group_idx on public.merch_products (group_id, position);
create index merch_products_style_idx on public.merch_products (style_key);

create table public.merch_variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.merch_products(id) on delete cascade,
  size               text not null,
  sku                text not null unique,
  price_override_usd numeric(10,2) check (price_override_usd is null or price_override_usd > 0),
  stock_on_hand      integer check (stock_on_hand is null or stock_on_hand >= 0),  -- NULL = not tracked
  low_stock_at       integer check (low_stock_at is null or low_stock_at >= 0),
  position           integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (product_id, size)
);

create table public.merch_stock_movements (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.merch_variants(id),
  delta      integer not null check (delta <> 0),
  reason     merch_stock_reason not null,
  order_id   uuid,                                   -- FK added below, after merch_orders
  actor      uuid references auth.users(id),         -- NULL = system (payment confirmation)
  note       text,
  balance    integer not null,                       -- stock_on_hand after this movement
  created_at timestamptz not null default now()
);
create index merch_stock_movements_variant_idx on public.merch_stock_movements (variant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Delivery and exchange rate
-- ---------------------------------------------------------------------------
create table public.merch_delivery_options (
  code          text primary key check (code ~ '^[a-z_]+$'),
  label         text not null,
  blurb         text,
  fee_usd       numeric(10,2) check (fee_usd is null or fee_usd >= 0),  -- NULL = not set; ignored when needs_zone
  needs_zone    boolean not null default false,   -- fee comes from merch_delivery_zones
  needs_address boolean not null default false,
  needs_town    boolean not null default false,
  position      integer not null default 0,
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now()
);

create table public.merch_delivery_zones (
  id          uuid primary key default gen_random_uuid(),
  option_code text not null references public.merch_delivery_options(code),
  name        text not null,
  fee_usd     numeric(10,2) check (fee_usd is null or fee_usd >= 0),     -- NULL = not set
  position    integer not null default 0,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  unique (option_code, name)
);

create table public.merch_fx_rates (
  id         uuid primary key default gen_random_uuid(),
  base       text not null default 'USD' check (base = 'USD'),
  quote      text not null default 'KES' check (quote = 'KES'),
  rate       numeric(12,4) not null check (rate > 0),  -- KES per 1 USD
  source     text not null,
  as_of      timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index merch_fx_rates_latest_idx on public.merch_fx_rates (as_of desc);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.merch_orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text not null unique,                         -- MS-XXXXXX, for support calls
  access_token       text not null unique check (access_token ~ '^[a-f0-9]{32}$'),  -- set by merch_create_order
  paystack_reference text unique,
  first_name         text not null check (length(btrim(first_name)) between 1 and 80),
  last_name          text not null check (length(btrim(last_name)) between 1 and 80),
  phone              text not null check (phone ~ '^254[0-9]{9}$'),
  email              text not null check (public.looks_like_email(email)),
  delivery_code      text not null references public.merch_delivery_options(code),
  delivery_zone_id   uuid references public.merch_delivery_zones(id),
  delivery_address   text,
  delivery_town      text,
  delivery_sacco     text,
  notes              text check (notes is null or length(notes) <= 1000),
  fx_rate            numeric(12,4) not null check (fx_rate > 0),
  fx_as_of           timestamptz not null,
  subtotal_usd       numeric(10,2) not null check (subtotal_usd >= 0),
  delivery_fee_usd   numeric(10,2) not null check (delivery_fee_usd >= 0),
  total_usd          numeric(10,2) not null check (total_usd >= 0),
  subtotal_kes       numeric(12,2) not null check (subtotal_kes >= 0),
  delivery_fee_kes   numeric(12,2) not null check (delivery_fee_kes >= 0),
  total_kes          numeric(12,2) not null check (total_kes > 0),
  currency           text not null default 'KES' check (currency = 'KES'),
  payment_status     merch_payment_status not null default 'pending',
  fulfilment_status  merch_fulfilment_status not null default 'unfulfilled',
  flag_reason        text,
  refund_reason      text,
  refund_ref         text,
  refunded_by        uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  dispatched_at      timestamptz,
  completed_at       timestamptz,
  refunded_at        timestamptz,
  updated_at         timestamptz not null default now(),
  check (total_kes = subtotal_kes + delivery_fee_kes),
  check (total_usd = subtotal_usd + delivery_fee_usd)
);
create index merch_orders_pending_idx on public.merch_orders (created_at) where payment_status = 'pending';
create index merch_orders_email_idx on public.merch_orders (lower(email));

alter table public.merch_stock_movements
  add constraint merch_stock_movements_order_fk foreign key (order_id) references public.merch_orders(id);

create table public.merch_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.merch_orders(id) on delete cascade,
  variant_id      uuid not null references public.merch_variants(id),
  -- Snapshots: products get renamed and repriced; an order must keep saying what was bought.
  product_name    text not null,
  color           text not null,
  size            text not null,
  sku             text not null,
  qty             integer not null check (qty between 1 and 10),
  unit_price_usd  numeric(10,2) not null check (unit_price_usd > 0),
  unit_price_kes  numeric(12,2) not null check (unit_price_kes > 0),
  line_total_kes  numeric(12,2) generated always as (unit_price_kes * qty) stored,
  unique (order_id, variant_id)
);
create index merch_order_items_variant_idx on public.merch_order_items (variant_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.merch_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;

create trigger merch_groups_touch   before update on public.merch_groups   for each row execute function public.merch_touch_updated_at();
create trigger merch_products_touch before update on public.merch_products for each row execute function public.merch_touch_updated_at();
create trigger merch_variants_touch before update on public.merch_variants for each row execute function public.merch_touch_updated_at();
create trigger merch_delivery_options_touch before update on public.merch_delivery_options for each row execute function public.merch_touch_updated_at();
create trigger merch_delivery_zones_touch   before update on public.merch_delivery_zones   for each row execute function public.merch_touch_updated_at();
create trigger merch_orders_touch   before update on public.merch_orders   for each row execute function public.merch_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.merch_groups           enable row level security;
alter table public.merch_products         enable row level security;
alter table public.merch_variants         enable row level security;
alter table public.merch_stock_movements  enable row level security;
alter table public.merch_delivery_options enable row level security;
alter table public.merch_delivery_zones   enable row level security;
alter table public.merch_fx_rates         enable row level security;
alter table public.merch_orders           enable row level security;
alter table public.merch_order_items      enable row level security;

-- Storefront reads: active catalogue only.
create policy "public read active merch groups" on public.merch_groups
  for select using (is_active);
create policy "public read active merch products" on public.merch_products
  for select using (is_active and exists (
    select 1 from public.merch_groups g where g.id = group_id and g.is_active));
create policy "public read active merch variants" on public.merch_variants
  for select using (is_active and exists (
    select 1 from public.merch_products p join public.merch_groups g on g.id = p.group_id
     where p.id = product_id and p.is_active and g.is_active));
create policy "public read active delivery options" on public.merch_delivery_options
  for select using (is_active);
create policy "public read active delivery zones" on public.merch_delivery_zones
  for select using (is_active);
-- The rate is public information and the storefront shows a KES estimate from it.
create policy "public read fx rates" on public.merch_fx_rates
  for select using (true);

-- Admins edit the catalogue and delivery settings directly (Table Editor or an admin
-- screen). Stock and prices-in-orders never change this way — stock_on_hand is also
-- guarded below so a direct edit cannot bypass the movement ledger.
create policy "admin read all merch groups"   on public.merch_groups   for select using (public.is_admin());
create policy "admin read all merch products" on public.merch_products for select using (public.is_admin());
create policy "admin read all merch variants" on public.merch_variants for select using (public.is_admin());
create policy "admin write merch groups"   on public.merch_groups   for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write merch products" on public.merch_products for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write merch variants" on public.merch_variants for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write delivery options" on public.merch_delivery_options for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write delivery zones"   on public.merch_delivery_zones   for all using (public.is_admin()) with check (public.is_admin());

-- Staff (gate and admin) can see orders and stock history; nobody writes them directly.
create policy "staff read merch orders"      on public.merch_orders          for select using (public.is_staff());
create policy "staff read merch order items" on public.merch_order_items     for select using (public.is_staff());
create policy "staff read stock movements"   on public.merch_stock_movements for select using (public.is_staff());

-- An admin editing a variant row (price override, low-stock threshold, is_active)
-- must not be able to change stock_on_hand that way: it would skip the ledger.
-- merch_adjust_stock / merch_confirm_payment / merch_refund_order set this flag.
create or replace function public.merch_guard_stock()
returns trigger language plpgsql set search_path = public as $$
begin
  if (case when tg_op = 'INSERT' then new.stock_on_hand is not null
           else new.stock_on_hand is distinct from old.stock_on_hand end)
     and coalesce(current_setting('merch.stock_write', true), '') <> 'on' then
    raise exception 'stock_on_hand changes only through merch_adjust_stock()'
      using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger merch_variants_guard_stock before insert or update on public.merch_variants
  for each row execute function public.merch_guard_stock();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- One place for the hold window: availability and order creation must agree.
create or replace function public.merch_hold_window()
returns interval language sql immutable set search_path = public as $$ select interval '30 minutes' $$;

-- A rate older than this closes checkout until it is refreshed.
create or replace function public.merch_fx_max_age()
returns interval language sql immutable set search_path = public as $$ select interval '36 hours' $$;

create or replace function public.merch_gen_order_number()
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text;
begin
  loop
    v_code := 'MS-';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.merch_orders where order_number = v_code);
  end loop;
  return v_code;
end; $$;

-- Quantity currently held by in-flight checkouts for one variant.
create or replace function public.merch_held_qty(p_variant_id uuid)
returns integer language sql stable security definer
set search_path = public as $$
  select coalesce(sum(i.qty), 0)::int
    from public.merch_order_items i
    join public.merch_orders o on o.id = i.order_id
   where i.variant_id = p_variant_id
     and o.payment_status = 'pending'
     and o.created_at > now() - public.merch_hold_window();
$$;

-- ---------------------------------------------------------------------------
-- Public reads
-- ---------------------------------------------------------------------------
-- Per-size availability for the storefront. `available` is NULL for untracked
-- sizes (no limit). Pass product slugs to narrow it; NULL returns everything active.
create or replace function public.merch_availability(p_slugs text[] default null)
returns table (
  product_slug text, variant_id uuid, size text, tracked boolean,
  on_hand integer, held integer, available integer, low_stock boolean
)
language sql stable security definer
set search_path = public as $$
  select p.slug, v.id, v.size, v.stock_on_hand is not null,
         v.stock_on_hand, h.held,
         case when v.stock_on_hand is null then null
              else greatest(0, v.stock_on_hand - h.held) end,
         v.stock_on_hand is not null and v.low_stock_at is not null
           and greatest(0, v.stock_on_hand - h.held) <= v.low_stock_at
    from public.merch_variants v
    join public.merch_products p on p.id = v.product_id
    join public.merch_groups g on g.id = p.group_id
    cross join lateral (select public.merch_held_qty(v.id) as held) h
   where v.is_active and p.is_active and g.is_active
     and (p_slugs is null or p.slug = any(p_slugs))
   order by p.position, v.position;
$$;

-- The rate checkout will use right now, or no row if none is fresh enough.
create or replace function public.merch_current_fx()
returns table (rate numeric, as_of timestamptz, source text)
language sql stable security definer
set search_path = public as $$
  select r.rate, r.as_of, r.source
    from public.merch_fx_rates r
   where r.as_of > now() - public.merch_fx_max_age()
   order by r.as_of desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Exchange rate refresh — service role (scheduled refresher) or an admin
-- ---------------------------------------------------------------------------
create or replace function public.merch_record_fx_rate(
  p_rate numeric, p_source text, p_as_of timestamptz default now()
) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_prev numeric;
begin
  if not v_is_service and not public.is_admin() then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if p_rate is null or p_rate <= 0 or coalesce(btrim(p_source), '') = '' then
    return jsonb_build_object('result', 'invalid');
  end if;
  -- A bad feed must not silently reprice the store. A jump of more than 25% on the
  -- previous rate is refused from the automated refresher; an admin can override.
  select rate into v_prev from public.merch_fx_rates order by as_of desc limit 1;
  if v_prev is not null and abs(p_rate / v_prev - 1) > 0.25 and not public.is_admin() then
    return jsonb_build_object('result', 'implausible_rate', 'previous', v_prev, 'offered', p_rate);
  end if;
  insert into public.merch_fx_rates (rate, source, as_of, created_by)
  values (p_rate, btrim(p_source), coalesce(p_as_of, now()), auth.uid());
  return jsonb_build_object('result', 'recorded', 'rate', p_rate);
end; $$;

-- ---------------------------------------------------------------------------
-- Checkout — service role only (the Edge Function throttles and validates first)
-- ---------------------------------------------------------------------------
-- p_customer: {first_name, last_name, phone (2547XXXXXXXX), email, notes?}
-- p_delivery: {code, zone_id?, address?, town?, sacco?}
-- p_lines:    [{variant_id, qty}, ...]
-- Prices, fees and the rate all come from the database; nothing in the request is trusted.
create or replace function public.merch_create_order(
  p_customer jsonb, p_delivery jsonb, p_lines jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_req     jsonb;   -- [{variant_id, qty}] with duplicates summed; read via jsonb_to_recordset
  v_opt     public.merch_delivery_options%rowtype;
  v_zone    public.merch_delivery_zones%rowtype;
  v_fee_usd numeric(10,2);
  v_fee_kes numeric(12,2);
  v_rate    numeric; v_as_of timestamptz;
  v_line    record;
  v_order   public.merch_orders%rowtype;
  v_sub_usd numeric(10,2);
  v_sub_kes numeric(12,2);
begin
  -- Lines: 1–20 distinct variants, qty 1–10 each (duplicates are summed first).
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('result', 'empty');
  end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('variant_id', variant_id, 'qty', qty)), '[]'::jsonb)
      into v_req
      from (select (l->>'variant_id')::uuid as variant_id, sum((l->>'qty')::int) as qty
              from jsonb_array_elements(p_lines) l group by 1) s;
  exception when others then
    return jsonb_build_object('result', 'bad_lines');   -- malformed uuid or qty
  end;
  if jsonb_array_length(v_req) > 20 or exists (
       select 1 from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
        where r.variant_id is null or r.qty is null or r.qty < 1 or r.qty > 10) then
    return jsonb_build_object('result', 'bad_lines');
  end if;

  -- Delivery.
  select * into v_opt from public.merch_delivery_options
   where code = p_delivery->>'code' and is_active;
  if not found then return jsonb_build_object('result', 'bad_delivery'); end if;
  if v_opt.needs_zone then
    begin
      select * into v_zone from public.merch_delivery_zones
       where id = nullif(p_delivery->>'zone_id', '')::uuid and option_code = v_opt.code and is_active;
    exception when others then
      return jsonb_build_object('result', 'zone_required');
    end;
    if v_zone.id is null then return jsonb_build_object('result', 'zone_required'); end if;
    v_fee_usd := v_zone.fee_usd;
  else
    v_fee_usd := v_opt.fee_usd;
  end if;
  if v_fee_usd is null then return jsonb_build_object('result', 'delivery_fee_unset', 'delivery', v_opt.code); end if;
  if v_opt.needs_address and length(btrim(coalesce(p_delivery->>'address', ''))) < 3 then
    return jsonb_build_object('result', 'address_required');
  end if;
  if v_opt.needs_town and length(btrim(coalesce(p_delivery->>'town', ''))) < 2 then
    return jsonb_build_object('result', 'town_required');
  end if;

  -- Rate.
  select c.rate, c.as_of into v_rate, v_as_of from public.merch_current_fx() c;
  if v_rate is null then return jsonb_build_object('result', 'fx_unavailable'); end if;

  -- Lock the variants in a fixed order (no deadlocks between concurrent checkouts),
  -- so the hold check below sees every other checkout's committed pending order.
  perform 1 from public.merch_variants
   where id in (select r.variant_id from jsonb_to_recordset(v_req) r(variant_id uuid, qty int))
   order by id for update;

  for v_line in
    select r.qty, v.id as variant_id, v.sku, v.stock_on_hand,
           (v.is_active and p.is_active and g.is_active) as active,
           coalesce(v.price_override_usd, p.price_usd) as price_usd
      from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
      left join public.merch_variants v on v.id = r.variant_id
      left join public.merch_products p on p.id = v.product_id
      left join public.merch_groups g on g.id = p.group_id
  loop
    if v_line.sku is null or not v_line.active then
      return jsonb_build_object('result', 'unavailable_item');
    end if;
    if v_line.price_usd is null then
      return jsonb_build_object('result', 'unpriced', 'sku', v_line.sku);
    end if;
    if v_line.stock_on_hand is not null
       and v_line.stock_on_hand - public.merch_held_qty(v_line.variant_id) < v_line.qty then
      return jsonb_build_object('result', 'sold_out', 'sku', v_line.sku,
        'available', greatest(0, v_line.stock_on_hand - public.merch_held_qty(v_line.variant_id)));
    end if;
  end loop;

  -- Each unit is converted and rounded to whole shillings on its own, and the same
  -- expression prices the order lines below, so lines always sum to the total.
  select sum(coalesce(v.price_override_usd, p.price_usd) * r.qty),
         sum(round(coalesce(v.price_override_usd, p.price_usd) * v_rate) * r.qty)
    into v_sub_usd, v_sub_kes
    from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
    join public.merch_variants v on v.id = r.variant_id
    join public.merch_products p on p.id = v.product_id;
  v_fee_kes := round(v_fee_usd * v_rate);

  insert into public.merch_orders (
    order_number, access_token, paystack_reference,
    first_name, last_name, phone, email, notes,
    delivery_code, delivery_zone_id, delivery_address, delivery_town, delivery_sacco,
    fx_rate, fx_as_of, subtotal_usd, delivery_fee_usd, total_usd,
    subtotal_kes, delivery_fee_kes, total_kes
  ) values (
    public.merch_gen_order_number(), encode(gen_random_bytes(16), 'hex'),
    'MS' || encode(gen_random_bytes(16), 'hex'),
    btrim(p_customer->>'first_name'), btrim(p_customer->>'last_name'),
    p_customer->>'phone', btrim(p_customer->>'email'), nullif(btrim(p_customer->>'notes'), ''),
    v_opt.code, v_zone.id, nullif(btrim(p_delivery->>'address'), ''),
    nullif(btrim(p_delivery->>'town'), ''), nullif(btrim(p_delivery->>'sacco'), ''),
    v_rate, v_as_of, v_sub_usd, v_fee_usd, v_sub_usd + v_fee_usd,
    v_sub_kes, v_fee_kes, v_sub_kes + v_fee_kes
  ) returning * into v_order;

  insert into public.merch_order_items (order_id, variant_id, product_name, color, size, sku, qty, unit_price_usd, unit_price_kes)
  select v_order.id, v.id, p.name, p.color, v.size, v.sku, r.qty,
         coalesce(v.price_override_usd, p.price_usd),
         round(coalesce(v.price_override_usd, p.price_usd) * v_rate)
    from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
    join public.merch_variants v on v.id = r.variant_id
    join public.merch_products p on p.id = v.product_id;

  return jsonb_build_object(
    'result', 'created', 'order_id', v_order.id, 'order_number', v_order.order_number,
    'access_token', v_order.access_token, 'paystack_reference', v_order.paystack_reference,
    'total_kes', v_order.total_kes, 'total_usd', v_order.total_usd, 'fx_rate', v_order.fx_rate,
    'email', v_order.email, 'hold_expires_at', v_order.created_at + public.merch_hold_window()
  );
end; $$;

-- Payment confirmed by Paystack (webhook or verify, after the Edge Function has
-- checked reference, currency and amount with Paystack's API). Idempotent.
create or replace function public.merch_confirm_payment(p_reference text, p_amount_kes numeric)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_order public.merch_orders%rowtype;
  v_item  record;
  v_new   int;
begin
  select * into v_order from public.merch_orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('result', 'already', 'order_id', v_order.id);
  end if;
  if v_order.payment_status not in ('pending', 'failed') then
    -- 'failed' is accepted: a buyer can abandon, be marked failed, then complete the
    -- same Paystack session. Refunded/flagged orders are never flipped back.
    return jsonb_build_object('result', 'ignored', 'status', v_order.payment_status);
  end if;
  if v_order.total_kes is distinct from p_amount_kes then
    update public.merch_orders set payment_status = 'flagged', flag_reason = 'amount_mismatch'
     where id = v_order.id;
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  end if;

  perform 1 from public.merch_variants
   where id in (select variant_id from public.merch_order_items where order_id = v_order.id)
   order by id for update;

  -- Stock is taken from what is physically on hand. If this payment arrived after its
  -- hold lapsed and the last units went to someone else, flag it: money was taken and
  -- the customer is owed a refund, which is better than selling stock that isn't there.
  for v_item in
    select i.variant_id, i.qty, i.sku, v.stock_on_hand
      from public.merch_order_items i join public.merch_variants v on v.id = i.variant_id
     where i.order_id = v_order.id
  loop
    if v_item.stock_on_hand is not null and v_item.stock_on_hand < v_item.qty then
      update public.merch_orders set payment_status = 'flagged', flag_reason = 'stock_exhausted:' || v_item.sku
       where id = v_order.id;
      return jsonb_build_object('result', 'stock_exhausted', 'order_id', v_order.id, 'sku', v_item.sku);
    end if;
  end loop;

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

  update public.merch_orders set payment_status = 'paid', paid_at = now(), flag_reason = null
   where id = v_order.id;

  return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id,
    'order_number', v_order.order_number, 'access_token', v_order.access_token, 'email', v_order.email);
end; $$;

-- Paystack says the transaction failed or was abandoned: release the hold now
-- rather than waiting out the window.
create or replace function public.merch_fail_order(p_reference text)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare v_id uuid;
begin
  update public.merch_orders set payment_status = 'failed'
   where paystack_reference = p_reference and payment_status = 'pending'
  returning id into v_id;
  return jsonb_build_object('result', case when v_id is null then 'ignored' else 'failed' end);
end; $$;

-- ---------------------------------------------------------------------------
-- Staff and admin operations (called with the user's JWT; checked inside)
-- ---------------------------------------------------------------------------
-- The only way stock changes outside a sale or a refund. Recording a restock on an
-- untracked size starts tracking it.
create or replace function public.merch_adjust_stock(
  p_variant_id uuid, p_delta integer, p_reason merch_stock_reason, p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_var public.merch_variants%rowtype;
  v_new int;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_reason = 'sale' then return jsonb_build_object('result', 'use_checkout'); end if;
  if p_delta is null or p_delta = 0 then return jsonb_build_object('result', 'invalid'); end if;

  select * into v_var from public.merch_variants where id = p_variant_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_var.stock_on_hand is null and (p_reason <> 'restock' or p_delta < 0) then
    return jsonb_build_object('result', 'untracked', 'hint', 'record a restock to start tracking');
  end if;
  v_new := coalesce(v_var.stock_on_hand, 0) + p_delta;
  if v_new < 0 then
    return jsonb_build_object('result', 'insufficient', 'on_hand', v_var.stock_on_hand);
  end if;

  perform set_config('merch.stock_write', 'on', true);
  update public.merch_variants set stock_on_hand = v_new where id = p_variant_id;
  perform set_config('merch.stock_write', 'off', true);
  insert into public.merch_stock_movements (variant_id, delta, reason, actor, note, balance)
  values (p_variant_id, p_delta, p_reason, auth.uid(), nullif(btrim(p_note), ''), v_new);

  return jsonb_build_object('result', 'adjusted', 'on_hand', v_new);
end; $$;

create or replace function public.merch_set_fulfilment(p_order_id uuid, p_status merch_fulfilment_status)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare v_order public.merch_orders%rowtype;
begin
  if not public.is_staff() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_status = 'cancelled' then return jsonb_build_object('result', 'use_refund'); end if;
  select * into v_order from public.merch_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('result', 'not_paid', 'status', v_order.payment_status);
  end if;
  update public.merch_orders
     set fulfilment_status = p_status,
         dispatched_at = case when p_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
         completed_at  = case when p_status in ('delivered', 'collected') then coalesce(completed_at, now()) else completed_at end
   where id = p_order_id;
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_set_fulfilment', p_order_id,
          jsonb_build_object('from', v_order.fulfilment_status, 'to', p_status));
  return jsonb_build_object('result', 'updated', 'fulfilment_status', p_status);
end; $$;

-- Records a refund made in the Paystack dashboard. Stock goes back only when the
-- admin says the goods are resaleable (p_restock) and only if a sale was booked.
create or replace function public.merch_refund_order(
  p_order_id uuid, p_reason text, p_restock boolean default false, p_refund_ref text default null
) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_order public.merch_orders%rowtype;
  v_item  record;
  v_new   int;
  v_restocked int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('result', 'reason_required'); end if;
  select * into v_order from public.merch_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_order.payment_status not in ('paid', 'flagged') then
    return jsonb_build_object('result', 'ignored', 'status', v_order.payment_status);
  end if;

  -- Only a 'paid' order ever decremented stock; a flagged one did not.
  if p_restock and v_order.payment_status = 'paid' then
    perform 1 from public.merch_variants
     where id in (select variant_id from public.merch_order_items where order_id = p_order_id)
     order by id for update;
    perform set_config('merch.stock_write', 'on', true);
    for v_item in
      select i.variant_id, i.qty from public.merch_order_items i
        join public.merch_variants v on v.id = i.variant_id
       where i.order_id = p_order_id and v.stock_on_hand is not null
    loop
      update public.merch_variants set stock_on_hand = stock_on_hand + v_item.qty
       where id = v_item.variant_id returning stock_on_hand into v_new;
      insert into public.merch_stock_movements (variant_id, delta, reason, order_id, actor, note, balance)
      values (v_item.variant_id, v_item.qty, 'return', p_order_id, auth.uid(), p_reason, v_new);
      v_restocked := v_restocked + v_item.qty;
    end loop;
    perform set_config('merch.stock_write', 'off', true);
  end if;

  update public.merch_orders
     set payment_status = 'refunded', refund_reason = p_reason, refund_ref = p_refund_ref,
         refunded_by = auth.uid(), refunded_at = now(),
         fulfilment_status = case when fulfilment_status in ('unfulfilled', 'packed', 'ready_for_pickup')
                                  then 'cancelled' else fulfilment_status end
   where id = p_order_id;
  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_refund_order', p_order_id, jsonb_build_object(
    'reason', p_reason, 'refund_ref', p_refund_ref, 'previous_status', v_order.payment_status,
    'total_kes', v_order.total_kes, 'restocked_units', v_restocked));
  return jsonb_build_object('result', 'refunded', 'restocked_units', v_restocked);
end; $$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants — revoke from PUBLIC, anon and authenticated explicitly, every time.
-- ---------------------------------------------------------------------------
revoke all on function public.merch_touch_updated_at() from public, anon, authenticated;
revoke all on function public.merch_hold_window() from public, anon, authenticated;
revoke all on function public.merch_fx_max_age() from public, anon, authenticated;
revoke all on function public.merch_guard_stock() from public, anon, authenticated;
revoke all on function public.merch_gen_order_number() from public, anon, authenticated;
revoke all on function public.merch_held_qty(uuid) from public, anon, authenticated;
revoke all on function public.merch_availability(text[]) from public, anon, authenticated;
revoke all on function public.merch_current_fx() from public, anon, authenticated;
revoke all on function public.merch_record_fx_rate(numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.merch_create_order(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.merch_confirm_payment(text, numeric) from public, anon, authenticated;
revoke all on function public.merch_fail_order(text) from public, anon, authenticated;
revoke all on function public.merch_adjust_stock(uuid, integer, merch_stock_reason, text) from public, anon, authenticated;
revoke all on function public.merch_set_fulfilment(uuid, merch_fulfilment_status) from public, anon, authenticated;
revoke all on function public.merch_refund_order(uuid, text, boolean, text) from public, anon, authenticated;

-- Storefront reads (like availability / expected_attendance for events).
grant execute on function public.merch_availability(text[]) to anon, authenticated, service_role;
grant execute on function public.merch_current_fx() to anon, authenticated, service_role;
-- Payment path: Edge Functions with the service role only.
grant execute on function public.merch_create_order(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.merch_confirm_payment(text, numeric) to service_role;
grant execute on function public.merch_fail_order(text) to service_role;
grant execute on function public.merch_held_qty(uuid) to service_role;
grant execute on function public.merch_gen_order_number() to service_role;
-- Signed-in staff/admin; each function checks is_staff()/is_admin() itself.
grant execute on function public.merch_record_fx_rate(numeric, text, timestamptz) to authenticated, service_role;
grant execute on function public.merch_adjust_stock(uuid, integer, merch_stock_reason, text) to authenticated;
grant execute on function public.merch_set_fulfilment(uuid, merch_fulfilment_status) to authenticated;
grant execute on function public.merch_refund_order(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: the catalogue as it stands in src/lib/merchandise.ts (2026-09-29).
-- Prices are the organiser's USD figures; NULL = "coming soon". Every size starts
-- untracked (stock_on_hand NULL) — no stock counts have been supplied yet.
-- Delivery fees for standard and matatu are NULL until confirmed; checkout
-- refuses those options until they are set. No exchange rate is seeded.
-- ---------------------------------------------------------------------------
insert into public.merch_groups (slug, name, eyebrow, description, position) values
  ('hoodies',      'Hoodies',               'NYAMAFEST MERCHANDISE', 'Easy layers for cool evenings and long gatherings.', 1),
  ('polos',        'Polos',                 'NYAMAFEST MERCHANDISE', 'A classic fit with a little MeatSoko character.', 2),
  ('t-shirts',     'T-shirts',              'NYAMAFEST MERCHANDISE', 'Everyday tees made for wherever the day takes you.', 3),
  ('headwear',     'Headwear',              'NYAMAFEST MERCHANDISE', 'Caps and beanies to top off your gathering look.', 4),
  ('workwear',     'Overalls & dust coats', 'MEATSOKO WORKWEAR',     'Hard-wearing pieces for the people behind the grill and the counter.', 5),
  ('partnerships', 'Partnerships',          'MEATSOKO PARTNERS',     'Collaborations with the people and brands we gather with.', 6);

with spec (grp, slug, style_key, name, color, swatch, image, price, partner, pos, summary, details) as (values
  ('hoodies','green-hoodie','nyamafest-hoodie','NyamaFest Hoodie','Green','#1f6b3a','/images/merchandise/green-hoodie-nyamafest.png',90.00,null,1,
    'A pullover hoodie for cool evenings and long gatherings, finished with the NyamaFest chest patch.',
    array['NyamaFest patch on the chest','MeatSoko Ecosystem badge on the left sleeve','Drawstring hood and front kangaroo pocket','Ribbed cuffs and hem']),
  ('hoodies','white-hoodie','nyamafest-hoodie','NyamaFest Hoodie','White','#f4f2ee','/images/merchandise/white-hoodie-nyamafest-small.png',95.00,null,2,
    'A pullover hoodie for cool evenings and long gatherings, finished with the NyamaFest chest patch.',
    array['NyamaFest patch on the chest','MeatSoko Ecosystem badge on the left sleeve','Drawstring hood and front kangaroo pocket','Ribbed cuffs and hem']),
  ('hoodies','red-hoodie','nyamafest-hoodie','NyamaFest Hoodie','Red','#c62a33','/images/merchandise/red-hoodie-nyamafest.png',95.00,null,3,
    'A pullover hoodie for cool evenings and long gatherings, finished with the NyamaFest chest patch.',
    array['NyamaFest patch on the chest','MeatSoko Ecosystem badge on the left sleeve','Drawstring hood and front kangaroo pocket','Ribbed cuffs and hem']),
  ('polos','red-polo','nyamafest-polo','NyamaFest Polo','Red','#c62a33','/images/merchandise/red-polo-nyamafest.png',19.00,null,1,
    'A classic polo with tipped collar and sleeves, and the NyamaFest 2026 print across the back.',
    array['NyamaFest patch on the chest','“nyamafest 2026” print across the back','Contrast tipping on the collar and sleeves','Sleeve patch']),
  ('polos','white-polo','nyamafest-polo','NyamaFest Polo','White','#f4f2ee','/images/merchandise/white-polo-nyamafest.png',19.00,null,2,
    'A classic polo with tipped collar and sleeves, and the NyamaFest 2026 print across the back.',
    array['NyamaFest patch on the chest','“nyamafest 2026” print across the back','Contrast tipping on the collar and sleeves','Sleeve patch']),
  ('polos','green-polo','nyamafest-polo','NyamaFest Polo','Green','#1f6b3a','/images/merchandise/green-polo-nyamafest-side.png',19.00,null,3,
    'A classic polo with tipped collar and sleeves, and the NyamaFest 2026 print across the back.',
    array['NyamaFest patch on the chest','“nyamafest 2026” print across the back','Contrast tipping on the collar and sleeves','Sleeve patch']),
  ('t-shirts','white-t-shirt','nyamafest-t-shirt','NyamaFest T-shirt','White','#f4f2ee','/images/merchandise/white-tee-nyamafest.png',17.00,null,1,
    'An everyday crew-neck tee with the NyamaFest patch up front and the 2026 print on the back.',
    array['NyamaFest patch on the chest','“nyamafest 2026” print across the back','Sleeve patch','Crew neck, short sleeves']),
  ('t-shirts','green-t-shirt','nyamafest-t-shirt','NyamaFest T-shirt','Green','#1f6b3a','/images/merchandise/green-tee-nyamafest.png',17.00,null,2,
    'An everyday crew-neck tee with the NyamaFest patch up front and the 2026 print on the back.',
    array['NyamaFest patch on the chest','“nyamafest 2026” print across the back','Sleeve patch','Crew neck, short sleeves']),
  ('t-shirts','red-t-shirt','nyamafest-t-shirt','NyamaFest T-shirt','Red','#c62a33','/images/merchandise/red-tee-nyamafest.png',17.00,null,3,
    'An everyday crew-neck tee with the NyamaFest patch up front and the 2026 print on the back.',
    array['NyamaFest patch on the chest','“nyamafest 2026” print across the back','Sleeve patch','Crew neck, short sleeves']),
  ('headwear','white-cap','nyamafest-cap','NyamaFest Cap','White','#f4f2ee','/images/merchandise/white-cap-nyamafest.png',null,null,1,
    'A structured cap with a curved brim and the NyamaFest patch front and centre.',
    array['NyamaFest patch on the front panel','Curved brim','One size']),
  ('headwear','green-beanie','nyamafest-beanie','NyamaFest Beanie','Green','#1f6b3a','/images/merchandise/green-beanie-nyamafest.png',null,null,2,
    'A rib-knit cuffed beanie with the NyamaFest patch on the turn-up.',
    array['NyamaFest patch on the cuff','Rib knit with a fold-over cuff','One size']),
  ('headwear','red-cap','nyamafest-cap','NyamaFest Cap','Red','#c62a33','/images/merchandise/red-cap-nyamafest.png',null,null,3,
    'A structured cap with a curved brim and the NyamaFest patch front and centre.',
    array['NyamaFest patch on the front panel','Curved brim','One size']),
  ('headwear','green-cap','nyamafest-cap','NyamaFest Cap','Green','#1f6b3a','/images/merchandise/green-cap-nyamafest.png',null,null,4,
    'A structured cap with a curved brim and the NyamaFest patch front and centre.',
    array['NyamaFest patch on the front panel','Curved brim','One size']),
  ('headwear','red-beanie','nyamafest-beanie','NyamaFest Beanie','Red','#c62a33','/images/merchandise/red-beanie-nyamafest.png',null,null,5,
    'A rib-knit cuffed beanie with the NyamaFest patch on the turn-up.',
    array['NyamaFest patch on the cuff','Rib knit with a fold-over cuff','One size']),
  ('headwear','white-beanie','nyamafest-beanie','NyamaFest Beanie','White','#f4f2ee','/images/merchandise/white-beanie-nyamafest.png',null,null,6,
    'A rib-knit cuffed beanie with the NyamaFest patch on the turn-up.',
    array['NyamaFest patch on the cuff','Rib knit with a fold-over cuff','One size']),
  ('workwear','meatsoko-dust-coat','meatsoko-dust-coat','MeatSoko Dust Coat','White','#f4f2ee','/images/merchandise/meatsoko-dust-coat-white.jpg',18.00,null,1,
    'A full-length white dust coat with the MeatSoko Ecosystem patch on the chest and the full print across the back.',
    array['MeatSoko Ecosystem patch on the chest pocket','“Convenient · Reliable · Sustainable” print across the back','Notched lapel collar and button front','Two lower patch pockets']),
  ('workwear','meatsoko-overall','meatsoko-overall','MeatSoko Overall','Khaki','#a39276','/images/merchandise/meatsoko-overall-khaki.jpg',null,null,2,
    'A one-piece khaki overall with the MeatSoko Ecosystem patch up front and a large print across the back.',
    array['MeatSoko Ecosystem patch on the chest','Large MeatSoko Ecosystem print across the back','Collar with a full-length front opening','Long sleeves and a belted waist']),
  ('partnerships','bmb-hoodie-black','bmb-hoodie','BMB × MeatSoko Hoodie','Black','#161616','/images/merchandise/bmb-hoodie-black.jpg',90.00,'Brian Munyolo Boxing',1,
    'A partnership hoodie with Brian Munyolo Boxing: the BMB mark up front and the MeatSoko Ecosystem print across the back.',
    array['BMB — Brian Munyolo Boxing print on the chest','MeatSoko Ecosystem print across the back','Drawstring hood and front kangaroo pocket','Ribbed cuffs and hem']),
  ('partnerships','bmb-hoodie-kenya-edition','bmb-hoodie','BMB × MeatSoko Hoodie','Black · Kenya edition',
    'linear-gradient(135deg, #161616 0 58%, #b8141d 58% 70%, #fff 70% 74%, #1f6b3a 74%)','/images/merchandise/bmb-hoodie-black-kenya.jpg',90.00,'Brian Munyolo Boxing',2,
    'A partnership hoodie with Brian Munyolo Boxing: the BMB mark up front and the MeatSoko Ecosystem print across the back.',
    array['BMB — Brian Munyolo Boxing print on the chest','Kenya flag on the right sleeve, “fuel your soul” down the left','MeatSoko Ecosystem print across the back','Drawstring hood and front kangaroo pocket']),
  ('partnerships','bmb-hoodie-blue','bmb-hoodie','BMB × MeatSoko Hoodie','Blue','#1d4fd1','/images/merchandise/bmb-hoodie-blue.jpg',90.00,'Brian Munyolo Boxing',3,
    'A partnership hoodie with Brian Munyolo Boxing: the BMB mark up front and the MeatSoko Ecosystem print across the back.',
    array['BMB — Brian Munyolo Boxing print on the chest','MeatSoko Ecosystem print across the back','Drawstring hood and front kangaroo pocket','Ribbed cuffs and hem']),
  ('partnerships','fuel-your-soul-water-bottle','fuel-your-soul-bottle','Fuel Your Soul Water Bottle','Navy','#1c2433','/images/merchandise/fuel-your-soul-bottle-wide.jpg',23.00,null,4,
    'A slim matte water bottle from the “fuel your soul” partnership, with the CAMP · 60 days mark and the MeatSoko Ecosystem logo.',
    array['Matte finish with a screw-top lid','CAMP · 60 days mark','MeatSoko Ecosystem logo and “fuel your soul” script','One size']),
  ('partnerships','bmb-t-shirt-blue','bmb-t-shirt','BMB × MeatSoko T-shirt','Blue','#1d4fd1','/images/merchandise/bmb-tee-blue.jpg',null,'Brian Munyolo Boxing',5,
    'A partnership tee with Brian Munyolo Boxing: the BMB mark up front and the MeatSoko Ecosystem print on the back.',
    array['BMB — Brian Munyolo Boxing print on the chest','MeatSoko Ecosystem print across the back','Crew neck, short sleeves'])
)
insert into public.merch_products (group_id, slug, style_key, name, color, swatch, image_path, price_usd, partner, position, summary, details)
select g.id, s.slug, s.style_key, s.name, s.color, s.swatch, s.image, s.price::numeric, s.partner, s.pos, s.summary, s.details
  from spec s join public.merch_groups g on g.slug = s.grp;

-- Sizes: apparel S–2XL; headwear and the bottle one size. SKU = slug + size.
insert into public.merch_variants (product_id, size, sku, position)
select p.id, sz.size, upper(p.slug) || '-' || replace(upper(sz.size), ' ', ''), sz.pos
  from public.merch_products p
  cross join lateral (
    select * from (values ('S',1),('M',2),('L',3),('XL',4),('2XL',5)) a(size, pos)
     where p.style_key not in ('nyamafest-cap', 'nyamafest-beanie', 'fuel-your-soul-bottle')
    union all
    select 'One size', 1
     where p.style_key in ('nyamafest-cap', 'nyamafest-beanie', 'fuel-your-soul-bottle')
  ) sz;

insert into public.merch_delivery_options (code, label, blurb, fee_usd, needs_zone, needs_address, needs_town, position) values
  ('event',    'Collect at NyamaFest', 'Pick up your order at the merchandise stand on event day, 17 October.', 0,    false, false, false, 1),
  ('pickup',   'Pickup in Nairobi',    'Collect from our Nairobi pickup point. We’ll text you when it’s ready.', 0,   false, false, false, 2),
  ('standard', 'Standard delivery',    'Delivered to your door. The fee depends on your area.',                 null, true,  true,  false, 3),
  ('matatu',   'Matatu / Sacco',       'Outside Nairobi: we send it to your chosen Sacco office for collection.', null, false, false, true,  4);

insert into public.merch_delivery_zones (option_code, name, position) values
  ('standard', 'Nairobi CBD', 1),
  ('standard', 'Greater Nairobi', 2),
  ('standard', 'Major towns', 3),
  ('standard', 'Rest of Kenya', 4);
