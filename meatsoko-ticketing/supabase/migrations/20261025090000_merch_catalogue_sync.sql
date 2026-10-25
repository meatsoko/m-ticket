-- Merchandise catalogue: the database becomes the single source of truth.
--
-- WHY
-- Until now the storefront drew its products from src/lib/merchandise.ts while
-- checkout (merch_create_order) and the dashboard Inventory read these tables. The
-- two had drifted. Compared on 2026-10-25 against the live project:
--   * hustle-game-21-hoodie-model, hustle-game-21-hoodie-views — on the site at
--     $20, missing here, so checkout refused them ('unavailable_item');
--   * executive-polo — on the site (shown sold out), missing here;
--   * the BMB Kenya edition is /shop/bmb-hoodie-black-kenya-edition on the site
--     but was seeded as bmb-hoodie-kenya-edition, so it could not be bought;
--   * the Buja hoodie sits after the two Hustle Game hoodies on the site;
--   * caps, beanies, the overall and the BMB tee were priced in the live table by
--     hand (no migration), so a fresh database had them unpriced.
-- Everything else (names, colours, swatches, images, copy, prices, sizes, delivery
-- options and zones) already matched field for field. After this migration the
-- site reads the catalogue from here; merchandise.ts keeps types and helpers only.
--
-- NEW COLUMNS (what the site showed that the table could not say)
--   style_name  display name of the piece shared by its colourways, e.g. "BMB
--               Hoodie" (style_key stays the machine key that groups swatches)
--   image_fit   'whole' = show the photo uncropped (wide front-and-back shots)
--   sold_out    shown in the shop but not buyable, whatever the stock count says
--               (the site's `outOfStock`); merch_create_order refuses it.
--
-- The rename keeps every variant id and SKU, so order lines (which snapshot name,
-- colour, size and SKU) and stock history are untouched. Idempotent throughout.

alter table public.merch_products
  add column if not exists style_name text,
  add column if not exists image_fit text not null default 'cover' check (image_fit in ('cover', 'whole')),
  add column if not exists sold_out boolean not null default false;

-- The Kenya edition's address on the site.
update public.merch_products set slug = 'bmb-hoodie-black-kenya-edition'
 where slug = 'bmb-hoodie-kenya-edition'
   and not exists (select 1 from public.merch_products where slug = 'bmb-hoodie-black-kenya-edition');

-- Prices the live table already carries (set by hand), so a fresh database matches.
update public.merch_products set price_usd = 12
 where slug in ('white-cap', 'red-cap', 'green-cap', 'white-beanie', 'red-beanie', 'green-beanie') and price_usd is null;
update public.merch_products set price_usd = 22 where slug = 'meatsoko-overall' and price_usd is null;
update public.merch_products set price_usd = 15 where slug = 'bmb-t-shirt-blue' and price_usd is null;

-- The missing pieces, exactly as the site lists them.
with spec (grp, slug, style_key, style_name, name, color, swatch, image, price, partner, pos, sold_out, summary, details) as (values
  ('polos', 'executive-polo', 'executive-polo', 'Executive Polo', 'MeatSoko Executive Polo', 'White · Executive', '#ccc',
    '/images/merchandise/executive.png', 19.50, null, 4, true,
    'A crisp white executive polo with the MeatSoko Ecosystem logo on the chest.',
    array['MeatSoko Ecosystem print on the chest', 'Ribbed collar and button placket', 'Short sleeves']),
  ('partnerships', 'hustle-game-21-hoodie-model', 'hustle-game-21-hoodie', 'Hustle Game 21 Hoodie', 'Hustle Game 21 Hoodie', 'Black · Model view', '#ccc',
    '/images/merchandise/hustle-game-21-model.jpg', 20.00, null, 6, false,
    'A black hoodie with the Hustle Game 21 script up front and the MeatSoko Ecosystem print across the back (Model view).',
    array['“Hustle Game 21” script on the chest with “They doubt the dream — right up until the jet hits the sky.”',
          'MeatSoko Ecosystem print across the back with “Convenient . Reliable . Sustainable”',
          'Drawstring hood and front kangaroo pocket', 'Ribbed cuffs and hem']),
  ('partnerships', 'hustle-game-21-hoodie-views', 'hustle-game-21-hoodie', 'Hustle Game 21 Hoodie', 'Hustle Game 21 Hoodie', 'Black · Ecosystem views', '#ccc',
    '/images/merchandise/hustle-game-21-views.jpg', 20.00, null, 7, false,
    'Front, side, and back views of the Hustle Game 21 hoodie showing the complete ecosystem branding.',
    array['Front view with Hustle Game 21 script', 'Side sleeve token detail',
          'Back view with MeatSoko Ecosystem red/green branding'])
)
insert into public.merch_products
  (group_id, slug, style_key, style_name, name, color, swatch, image_path, price_usd, partner, position, sold_out, summary, details)
select g.id, s.slug, s.style_key, s.style_name, s.name, s.color, s.swatch, s.image, s.price::numeric, s.partner, s.pos, s.sold_out, s.summary, s.details
  from spec s join public.merch_groups g on g.slug = s.grp
on conflict (slug) do nothing;

insert into public.merch_variants (product_id, size, sku, position)
select p.id, sz.size, upper(p.slug) || '-' || sz.size, sz.pos
  from public.merch_products p
 cross join (values ('S', 1), ('M', 2), ('L', 3), ('XL', 4), ('2XL', 5)) sz(size, pos)
 where p.slug in ('executive-polo', 'hustle-game-21-hoodie-model', 'hustle-game-21-hoodie-views')
on conflict (product_id, size) do nothing;

update public.merch_products set position = 8, image_fit = 'whole' where slug = 'buja-hoodie-green';

-- Display style names, as the site showed them.
update public.merch_products set style_name = v.style_name
  from (values
    ('nyamafest-hoodie', 'NyamaFest Hoodie'), ('nyamafest-polo', 'NyamaFest Polo'),
    ('nyamafest-t-shirt', 'NyamaFest T-shirt'), ('nyamafest-cap', 'NyamaFest Cap'),
    ('nyamafest-beanie', 'NyamaFest Beanie'), ('meatsoko-dust-coat', 'MeatSoko Dust Coat'),
    ('meatsoko-overall', 'MeatSoko Overall'), ('bmb-hoodie', 'BMB Hoodie'),
    ('bmb-t-shirt', 'BMB T-shirt'), ('fuel-your-soul-bottle', 'Fuel Your Soul Bottle'),
    ('buja-hoodie', 'Buja Hoodie'), ('executive-polo', 'Executive Polo'),
    ('hustle-game-21-hoodie', 'Hustle Game 21 Hoodie')
  ) v(style_key, style_name)
 where merch_products.style_key = v.style_key and merch_products.style_name is null;
update public.merch_products set style_name = name where style_name is null;
alter table public.merch_products alter column style_name set not null;

-- ---------------------------------------------------------------------------
-- Checkout refuses a sold-out piece. Identical to 20260929120000 apart from the
-- `sold_out` test in the line loop.
-- ---------------------------------------------------------------------------
create or replace function public.merch_create_order(
  p_customer jsonb, p_delivery jsonb, p_lines jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_req     jsonb;
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

  select c.rate, c.as_of into v_rate, v_as_of from public.merch_current_fx() c;
  if v_rate is null then return jsonb_build_object('result', 'fx_unavailable'); end if;

  perform 1 from public.merch_variants
   where id in (select r.variant_id from jsonb_to_recordset(v_req) r(variant_id uuid, qty int))
   order by id for update;

  for v_line in
    select r.qty, v.id as variant_id, v.sku, v.stock_on_hand,
           (v.is_active and p.is_active and g.is_active) as active, p.sold_out,
           coalesce(v.price_override_usd, p.price_usd) as price_usd
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
    if v_line.price_usd is null then
      return jsonb_build_object('result', 'unpriced', 'sku', v_line.sku);
    end if;
    if v_line.stock_on_hand is not null
       and v_line.stock_on_hand - public.merch_held_qty(v_line.variant_id) < v_line.qty then
      return jsonb_build_object('result', 'sold_out', 'sku', v_line.sku,
        'available', greatest(0, v_line.stock_on_hand - public.merch_held_qty(v_line.variant_id)));
    end if;
  end loop;

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

revoke all on function public.merch_create_order(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.merch_create_order(jsonb, jsonb, jsonb) to service_role;
