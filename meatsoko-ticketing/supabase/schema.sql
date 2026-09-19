-- ============================================================
-- MeatSoko Ticketing — database schema (SRS v1.0)
-- Apply with: supabase db push   (or paste into SQL editor)
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type event_format  as enum ('festival', 'conference_expo');
create type event_status  as enum ('draft', 'live', 'closed');
create type order_status  as enum ('pending', 'paid', 'failed', 'refunded', 'flagged');
create type ticket_status as enum ('active', 'redeemed', 'refunded');
create type user_role     as enum ('staff', 'admin');

-- ---------- Tables ----------
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  format      event_format not null default 'festival',
  description text default '',
  venue       text default '',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  banner_url  text,
  status      event_status not null default 'draft',
  created_at  timestamptz not null default now()
);

create table public.ticket_types (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null,
  price_kes   numeric(10,2) not null check (price_kes >= 0),
  quantity_cap integer check (quantity_cap is null or quantity_cap > 0),
  bundle_qty  integer not null default 1 check (bundle_qty > 0),
  position    integer not null default 0,
  is_active   boolean not null default true
);

-- orders.channel: 'web' | 'gate'  (gate = walk-up sale, FR-G)
create table public.orders (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references public.events(id),
  buyer_phone              text not null,             -- normalized 2547XXXXXXXX
  buyer_email              text,
  channel                  text not null default 'web',
  amount_kes               numeric(10,2) not null,
  status                   order_status not null default 'pending',
  mpesa_checkout_request_id text unique,
  mpesa_receipt            text,
  refund_reason            text,
  created_at               timestamptz not null default now(),
  paid_at                  timestamptz
);

-- Additive change vs SRS §3: line items so one order can mix ticket types (FR-P1).
create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types(id),
  qty            integer not null check (qty > 0 and qty <= 20),
  unit_price_kes numeric(10,2) not null
);

create table public.tickets (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types(id),
  qr_token       text unique not null,               -- 128-bit random, hex
  status         ticket_status not null default 'active',
  redeemed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create table public.redemptions (                    -- append-only scan log (R2)
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references public.tickets(id) on delete cascade,
  redemption_type text not null default 'entry',
  station         text not null default 'unknown',
  scanned_by      uuid references auth.users(id),
  scanned_at      timestamptz not null default now(),
  synced          boolean not null default true,
  unique (ticket_id, redemption_type)                -- duplicate protection
);

create table public.admin_users (                    -- role map over Supabase auth
  user_id uuid primary key references auth.users(id) on delete cascade,
  role    user_role not null
);

-- ---------- Role helpers ----------
create or replace function public.is_staff()
returns boolean language sql stable security definer
set search_path = public as
$$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public as
$$ select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'admin') $$;

-- ---------- RLS ----------
alter table public.events       enable row level security;
alter table public.ticket_types enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.tickets      enable row level security;
alter table public.redemptions  enable row level security;
alter table public.admin_users  enable row level security;

-- Public read of live events/catalog
create policy "public read live events" on public.events
  for select using (status = 'live');
create policy "public read active ticket types of live events" on public.ticket_types
  for select using (is_active and exists (
    select 1 from public.events e where e.id = event_id and e.status = 'live'));

-- Admin writes catalog
create policy "admin write events" on public.events
  for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write ticket types" on public.ticket_types
  for all using (public.is_admin()) with check (public.is_admin());

-- Orders/tickets/redemptions: NO public client access — edge functions (service role) only.
create policy "staff read orders"  on public.orders  for select using (public.is_staff());
create policy "staff read tickets" on public.tickets for select using (public.is_staff());
create policy "staff read redemptions" on public.redemptions for select using (public.is_staff());

-- Admin users: a user can read their own role row (used by middleware/layouts)
create policy "read own role" on public.admin_users
  for select using (auth.uid() = user_id);

-- ---------- Core RPC: idempotent payment confirmation (FR-P4, FR-P5) ----------
create or replace function public.confirm_payment(
  p_checkout_request_id text, p_receipt text, p_amount numeric
) returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_item  record;
  v_sold  int;
begin
  select * into v_order from public.orders
   where mpesa_checkout_request_id = p_checkout_request_id
   for update;

  if not found then
    return jsonb_build_object('result', 'unknown');
  end if;
  if v_order.status = 'paid' then
    return jsonb_build_object('result', 'already', 'order_id', v_order.id);
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('result', 'ignored', 'status', v_order.status);
  end if;
  if v_order.amount_kes is distinct from p_amount then
    update public.orders set status = 'flagged' where id = v_order.id;
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', v_order.id);
  end if;

  -- Enforce caps transactionally (R3)
  for v_item in
    select oi.ticket_type_id, oi.qty, tt.name, tt.quantity_cap, tt.bundle_qty
      from public.order_items oi
      join public.ticket_types tt on tt.id = oi.ticket_type_id
     where oi.order_id = v_order.id
  loop
    if v_item.quantity_cap is not null then
      select coalesce(sum(tt2.bundle_qty), 0) into v_sold
        from public.tickets t
        join public.ticket_types tt2 on tt2.id = t.ticket_type_id
       where t.ticket_type_id = v_item.ticket_type_id
         and t.status <> 'refunded';
      if v_sold + v_item.qty * v_item.bundle_qty > v_item.quantity_cap then
        update public.orders set status = 'flagged' where id = v_order.id;
        return jsonb_build_object('result', 'cap_exceeded', 'ticket_type', v_item.name);
      end if;
    end if;
  end loop;

  update public.orders
     set status = 'paid', mpesa_receipt = p_receipt, paid_at = now()
   where id = v_order.id;

  -- Create tickets; gate-channel orders are admitted immediately (FR-G2)
  for v_item in
    select oi.ticket_type_id, oi.qty
      from public.order_items oi where oi.order_id = v_order.id
  loop
    for i in 1..v_item.qty loop
      insert into public.tickets (order_id, ticket_type_id, qr_token, status, redeemed_at)
      values (v_order.id, v_item.ticket_type_id, encode(gen_random_bytes(16), 'hex'),
              case when v_order.channel = 'gate' then 'redeemed'::ticket_status
                   else 'active'::ticket_status end,
              case when v_order.channel = 'gate' then now() else null end);
    end loop;
  end loop;

  if v_order.channel = 'gate' then
    insert into public.redemptions (ticket_id, redemption_type, station, scanned_by)
    select t.id, 'entry', 'gate-sale', null
      from public.tickets t where t.order_id = v_order.id
    on conflict do nothing;
  end if;

  return jsonb_build_object('result', 'confirmed', 'order_id', v_order.id);
end; $$;

-- ---------- Refund (FR-A3): transactional, admin only ----------
create or replace function public.refund_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('result', 'forbidden');
  end if;
  update public.orders
     set status = 'refunded', refund_reason = p_reason
   where id = p_order_id and status = 'paid';
  update public.tickets set status = 'refunded'
   where order_id = p_order_id and status <> 'refunded';
  return jsonb_build_object('result', 'refunded');
end; $$;
