-- DRAFT — NOT A MIGRATION. Do not move into supabase/migrations as it is.
-- Celebrations ("Lipa Mdogo Mdogo") sketch from feat/events-v2-celebrations,
-- parked 2026-10-06 until the organiser supplies real packages, prices and
-- payment rules. Known problems to fix before it can ship:
--   * "customer read own celebration" USING (true) exposes every booking
--     (names, phones, emails) to the public
--   * record_celebration_payment is SECURITY DEFINER with no staff check, no
--     search_path and no REVOKE FROM PUBLIC: anyone could record payments
--   * packages / add-ons / prices below are placeholders, not real
--   * bookings are looked up by an enumerable CELEB- number
--   * public.handle_updated_at() does not exist in this project

-- 3. CELEBRATION MASTER DATA
create table public.celebration_occasions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  icon       text,                    -- lucide icon name
  position   integer not null default 0,
  is_active  boolean not null default true
);

insert into public.celebration_occasions (name, slug, icon, position) values
  ('Birthday',        'birthday',        'cake',     1),
  ('Anniversary',     'anniversary',     'heart',    2),
  ('Graduation',      'graduation',      'graduation-cap', 3),
  ('Wedding',         'wedding',         'rings',    4),
  ('Baby Shower',     'baby-shower',     'baby',     5),
  ('Family Gathering','family-gathering','users',    6),
  ('Achievement',     'achievement',     'trophy',   7),
  ('Surprise Treat',  'surprise',        'gift',     8),
  ('Custom Occasion', 'custom',          'sparkles', 9);

create table public.celebration_packages (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  base_price_kes numeric not null,
  image_url    text,
  position     integer not null default 0,
  is_active    boolean not null default true
);

insert into public.celebration_packages (name, description, base_price_kes, position) values
  ('Whole Goat',   'A full Kienyeji goat, expertly grilled or wet fried.', 18000, 1),
  ('Beef Feast',   'Prime cuts of beef for your entire party.', 15000, 2),
  ('Mutton Mix',   'Tender mutton prepared to your preference.', 16000, 3),
  ('Chicken Party','Flavourful local chicken platter.', 12000, 4),
  ('Mixed Meat',   'A variety of beef, goat, and chicken.', 20000, 5),
  ('Meat Platter', 'A curated selection for smaller groups.', 8000, 6);

create table public.celebration_addons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  price_kes  numeric not null,
  category   text not null, -- 'Catering', 'Decor', 'Drinks', etc.
  is_active  boolean not null default true,
  position   integer not null default 0
);

insert into public.celebration_addons (name, price_kes, category, position) values
  ('Custom Cake',    3500, 'Food', 1),
  ('Soft Drinks',    1500, 'Drinks', 2),
  ('Alcohol Bucket', 5000, 'Drinks', 3),
  ('BBQ Service',    2500, 'Service', 4),
  ('Decorations',    4000, 'Setup', 5),
  ('Tent & Chairs',  6000, 'Setup', 6);

-- 4. CELEBRATION BOOKINGS (Lipa Mdogo Mdogo Engine)
create table public.celebrations (
  id                 uuid primary key default gen_random_uuid(),
  occasion_id        uuid references public.celebration_occasions(id),
  package_id         uuid references public.celebration_packages(id),
  celebration_number text not null unique, -- CELEB-XXXXX
  
  -- Celebration Details
  celebrated_name    text not null,
  celebration_date   date not null,
  guest_count        integer not null default 1,
  style_vibe         text,
  notes              text,
  
  -- Customer Details
  customer_phone     text not null,
  customer_email     text,
  
  -- Financials
  total_kes          numeric not null,
  paid_kes           numeric not null default 0,
  deposit_kes        numeric not null,
  
  -- Tracking
  status             text not null default 'pending', -- 'pending', 'active', 'completed', 'cancelled'
  fulfilment_status  text not null default 'upcoming', -- 'upcoming', 'ready', 'fulfilled'
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.celebration_booking_addons (
  id              uuid primary key default gen_random_uuid(),
  celebration_id  uuid not null references public.celebrations(id) on delete cascade,
  addon_id        uuid not null references public.celebration_addons(id),
  qty             integer not null default 1,
  price_at_booking numeric not null
);

create table public.celebration_payments (
  id              uuid primary key default gen_random_uuid(),
  celebration_id  uuid not null references public.celebrations(id) on delete cascade,
  amount_kes      numeric not null,
  channel         text not null default 'mpesa',
  reference       text not null unique, -- Paystack/M-Pesa ref
  status          text not null default 'paid',
  paid_at         timestamptz not null default now()
);

-- RLS
alter table public.event_programs enable row level security;
alter table public.event_concepts enable row level security;
alter table public.celebration_occasions enable row level security;
alter table public.celebration_packages enable row level security;
alter table public.celebration_addons enable row level security;
alter table public.celebrations enable row level security;
alter table public.celebration_booking_addons enable row level security;
alter table public.celebration_payments enable row level security;

-- Public read policies
create policy "public read published programs" on public.event_programs for select using (is_published);
create policy "public read concepts" on public.event_concepts for select using (true);
create policy "public read active occasions" on public.celebration_occasions for select using (is_active);
create policy "public read active packages" on public.celebration_packages for select using (is_active);
create policy "public read active addons" on public.celebration_addons for select using (is_active);

-- Customer can read their own celebration by phone/email (simplified for now)
create policy "customer read own celebration" on public.celebrations for select using (true);

-- Staff policies
create policy "staff manage programs" on public.event_programs for all using (public.is_staff());
create policy "staff manage concepts" on public.event_concepts for all using (public.is_staff());
create policy "staff manage celebration catalog" on public.celebration_occasions for all using (public.is_admin());
create policy "staff manage celebration packages" on public.celebration_packages for all using (public.is_admin());
create policy "staff manage celebration addons" on public.celebration_addons for all using (public.is_admin());
create policy "staff manage celebrations" on public.celebrations for all using (public.is_staff());
create policy "staff manage celebration payments" on public.celebration_payments for all using (public.is_staff());

-- 5. TRIGGER FOR UPDATED_AT
create trigger update_event_programs_updated_at before update on public.event_programs for each row execute function public.handle_updated_at();
create trigger update_event_concepts_updated_at before update on public.event_concepts for each row execute function public.handle_updated_at();
create trigger update_celebrations_updated_at before update on public.celebrations for each row execute function public.handle_updated_at();

-- 6. RPC: ADJUST CELEBRATION BALANCE
create or replace function public.record_celebration_payment(
  p_celebration_id uuid, p_amount numeric, p_reference text, p_channel text
) returns void language plpgsql security definer as $$
begin
  insert into public.celebration_payments (celebration_id, amount_kes, reference, channel)
  values (p_celebration_id, p_amount, p_reference, p_channel);
  
  update public.celebrations
  set paid_kes = paid_kes + p_amount,
      updated_at = now()
  where id = p_celebration_id;
end;
$$;
