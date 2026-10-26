-- Merchandise is priced in Kenyan shillings from 2026-10-26.
--
-- Until now each piece had a USD price (price_usd), converted to KES at the
-- day's rate when an order was placed. The organiser set new KSh prices on
-- 2026-10-26 and wants the shop to show KSh, with the old price crossed out and
-- "X% off" where a piece got cheaper:
--   hoodies 4,500 (every hoodie, partnerships included — the user's call), polos
--   2,200, Executive polo 2,500 (still sold out), T-shirts 1,700 (BMB tee too),
--   caps 1,000, beanies 800, dust coat 1,200, overall 2,500, the bottle 3,000
--   (its USD price converted; it wasn't on the list). Delivery fees rounded to 50.
--
-- price_kes is now what the buyer pays: no FX conversion. compare_at_kes is the
-- old price (price_usd x 129.8479, the rate on 2026-10-24, rounded to 50) and is
-- set only where the new price is lower; the site shows the badge from 5 % off.
-- price_usd stays for history and is no longer read for new orders; the order's
-- *_usd columns are still filled (KSh / rate) so old reports keep working.
-- merch_variants.price_override_usd is unused (no rows set) and stays unused.

alter table public.merch_products
  add column if not exists price_kes      integer,
  add column if not exists compare_at_kes integer;
alter table public.merch_products
  add constraint merch_products_price_kes_check check (price_kes is null or price_kes > 0),
  add constraint merch_products_compare_at_check
    check (compare_at_kes is null or (price_kes is not null and compare_at_kes > price_kes));

alter table public.merch_delivery_options add column if not exists fee_kes integer
  check (fee_kes is null or fee_kes >= 0);
alter table public.merch_delivery_zones   add column if not exists fee_kes integer
  check (fee_kes is null or fee_kes >= 0);

do $$
declare
  v_row record;
  v_n   int;
begin
  for v_row in select * from (values
    ('white-hoodie', 4500, 12350), ('red-hoodie', 4500, 12350), ('green-hoodie', 4500, 11700),
    ('bmb-hoodie-black', 4500, 11700), ('bmb-hoodie-black-kenya-edition', 4500, 11700),
    ('bmb-hoodie-blue', 4500, 11700), ('buja-hoodie-green', 4500, 10150),
    ('hustle-game-21-hoodie-model', 4500, null), ('hustle-game-21-hoodie-views', 4500, null),
    ('red-polo', 2200, 2450), ('white-polo', 2200, 2450), ('green-polo', 2200, 2450),
    ('executive-polo', 2500, 2550),
    ('white-t-shirt', 1700, 2200), ('green-t-shirt', 1700, 2200), ('red-t-shirt', 1700, 2200),
    ('bmb-t-shirt-blue', 1700, 1950),
    ('white-cap', 1000, 1550), ('red-cap', 1000, 1550), ('green-cap', 1000, 1550),
    ('green-beanie', 800, 1550), ('red-beanie', 800, 1550), ('white-beanie', 800, 1550),
    ('meatsoko-dust-coat', 1200, 2350), ('meatsoko-overall', 2500, 2850),
    ('fuel-your-soul-water-bottle', 3000, null),
    ('bmb-cap', 1000, null), ('meatsoko-cap', 1000, null)
  ) t(slug, price, was) loop
    update public.merch_products set price_kes = v_row.price, compare_at_kes = v_row.was
     where slug = v_row.slug;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'price: product % not found', v_row.slug; end if;
  end loop;

  if exists (select 1 from public.merch_products where price_usd is not null and price_kes is null) then
    raise exception 'a priced product has no KSh price';
  end if;

  update public.merch_delivery_options set fee_kes = case code
      when 'event' then 0 when 'pickup' then 0 when 'matatu' then 400 end
   where code in ('event', 'pickup', 'matatu');
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception 'delivery options: % rows', v_n; end if;

  update public.merch_delivery_zones set fee_kes = case name
      when 'Nairobi CBD' then 250 when 'Greater Nairobi' then 400
      when 'Major towns' then 650 when 'Rest of Kenya' then 900 end
   where name in ('Nairobi CBD', 'Greater Nairobi', 'Major towns', 'Rest of Kenya');
  get diagnostics v_n = row_count;
  if v_n <> 4 then raise exception 'delivery zones: % rows', v_n; end if;
end $$;

-- Checkout charges the KSh prices. Same checks and order as before; only the
-- money changed: lines and fees are exact KSh, the USD columns are KSh / rate.
create or replace function public.merch_create_order(
  p_customer jsonb, p_delivery jsonb, p_lines jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_req     jsonb;
  v_opt     public.merch_delivery_options%rowtype;
  v_zone    public.merch_delivery_zones%rowtype;
  v_fee_kes numeric(12,2);
  v_rate    numeric; v_as_of timestamptz;
  v_line    record;
  v_order   public.merch_orders%rowtype;
  v_sub_kes numeric(12,2);
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('result', 'empty');
  end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('variant_id', variant_id, 'qty', qty)), '[]'::jsonb)
      into v_req
      from (select (l->>'variant_id')::uuid as variant_id, sum((l->>'qty')::int) as qty
              from jsonb_array_elements(p_lines) l group by 1) s;
  exception when others then
    return jsonb_build_object('result', 'bad_lines');
  end;
  if jsonb_array_length(v_req) > 20 or exists (
       select 1 from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
        where r.variant_id is null or r.qty is null or r.qty < 1 or r.qty > 10) then
    return jsonb_build_object('result', 'bad_lines');
  end if;

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
    v_fee_kes := v_zone.fee_kes;
  else
    v_fee_kes := v_opt.fee_kes;
  end if;
  if v_fee_kes is null then return jsonb_build_object('result', 'delivery_fee_unset', 'delivery', v_opt.code); end if;
  if v_opt.needs_address and length(btrim(coalesce(p_delivery->>'address', ''))) < 3 then
    return jsonb_build_object('result', 'address_required');
  end if;
  if v_opt.needs_town and length(btrim(coalesce(p_delivery->>'town', ''))) < 2 then
    return jsonb_build_object('result', 'town_required');
  end if;

  -- Only for the USD record columns now.
  select c.rate, c.as_of into v_rate, v_as_of from public.merch_current_fx() c;
  if v_rate is null then return jsonb_build_object('result', 'fx_unavailable'); end if;

  perform 1 from public.merch_variants
   where id in (select r.variant_id from jsonb_to_recordset(v_req) r(variant_id uuid, qty int))
   order by id for update;

  for v_line in
    select r.qty, v.id as variant_id, v.sku, v.stock_on_hand,
           (v.is_active and p.is_active and g.is_active) as active, p.sold_out, p.price_kes
      from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
      left join public.merch_variants v on v.id = r.variant_id
      left join public.merch_products p on p.id = v.product_id
      left join public.merch_groups g on g.id = p.group_id
  loop
    if v_line.sku is null or not v_line.active then
      return jsonb_build_object('result', 'unavailable_item');
    end if;
    if v_line.sold_out then
      return jsonb_build_object('result', 'sold_out', 'sku', v_line.sku, 'available', 0);
    end if;
    if v_line.price_kes is null then
      return jsonb_build_object('result', 'unpriced', 'sku', v_line.sku);
    end if;
    if v_line.stock_on_hand is not null
       and v_line.stock_on_hand - public.merch_held_qty(v_line.variant_id) < v_line.qty then
      return jsonb_build_object('result', 'sold_out', 'sku', v_line.sku,
        'available', greatest(0, v_line.stock_on_hand - public.merch_held_qty(v_line.variant_id)));
    end if;
  end loop;

  select sum(p.price_kes * r.qty) into v_sub_kes
    from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
    join public.merch_variants v on v.id = r.variant_id
    join public.merch_products p on p.id = v.product_id;

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
    v_rate, v_as_of, round(v_sub_kes / v_rate, 2), round(v_fee_kes / v_rate, 2),
    round(v_sub_kes / v_rate, 2) + round(v_fee_kes / v_rate, 2),
    v_sub_kes, v_fee_kes, v_sub_kes + v_fee_kes
  ) returning * into v_order;

  insert into public.merch_order_items (order_id, variant_id, product_name, color, size, sku, qty, unit_price_usd, unit_price_kes)
  select v_order.id, v.id, p.name, p.color, v.size, v.sku, r.qty,
         round(p.price_kes / v_rate, 2), p.price_kes
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

revoke all on function public.merch_create_order(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.merch_create_order(jsonb, jsonb, jsonb) to service_role;
