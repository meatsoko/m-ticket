-- The organiser's stock sheet of 2026-10-25, loaded into the inventory.
--
-- Agreed with the organiser on 2026-10-25 (the mapping table in the session):
--   * counts are per product, sizes unknown -> each counted product gets its hidden
--     "Mixed sizes" bucket (20261026090000); the website stays exactly as it is;
--   * the counts are what was on the shelf BEFORE the sales and the marketing
--     hoodies below, so those are recorded after the opening count;
--   * BMB and MeatSoko caps are not on the website: they become backend-only
--     products (inactive, unpriced) so they can be counted and sold at the stand;
--   * the KSh 10 red-beanie order MS-FEADKS (2026-09-29) was a test purchase;
--   * the two white hoodies sold for KSh 8,000 each; every payment was cash.
-- Not on the sheet, left untracked (unchanged): the white NyamaFest polo, beanies,
-- NyamaFest caps, the overall, BMB hoodies and tee, the bottle and the Buja hoodie.
-- "Normal polos @ 1,200" carried no count. The two red polos are counted as stock
-- with the sheet's note that they are rough.
--
-- Recorded as system entries (no signed-in actor), each with a note naming the
-- sheet, through the same ledger function every other change uses. Expected
-- result: white hoodie 6 - 2 sold - 4 marketing = 0; dust coat 15 - 2 sold = 13;
-- everything else as counted. Runs once: it refuses if any bucket already exists.

do $$
declare
  v_note   constant text := 'Organiser''s stock sheet, 2026-10-25';
  v_group  uuid;
  v_batch  uuid;
  v_sale   uuid;
  v_line   record;
  v_var    uuid;
begin
  if exists (select 1 from public.merch_variants where is_bucket) then
    raise exception 'stock sheet already loaded (a mixed-sizes bucket exists)';
  end if;

  -- Backend-only caps.
  select id into v_group from public.merch_groups where slug = 'headwear';
  insert into public.merch_products
    (group_id, slug, style_key, style_name, name, color, swatch, image_path, summary, price_usd, position, is_active)
  values
    (v_group, 'bmb-cap', 'bmb-cap', 'BMB Cap', 'BMB Cap', 'Assorted', '#cccccc', '/images/merchandise/white-cap-nyamafest.png',
     'Stand-only stock (not on the website).', null, 90, false),
    (v_group, 'meatsoko-cap', 'meatsoko-cap', 'MeatSoko Cap', 'MeatSoko Cap', 'Assorted', '#cccccc', '/images/merchandise/white-cap-nyamafest.png',
     'Stand-only stock (not on the website).', null, 91, false);
  insert into public.merch_variants (product_id, size, sku, position)
  select id, 'One size', upper(slug) || '-ONESIZE', 1 from public.merch_products where slug in ('bmb-cap', 'meatsoko-cap');

  -- Mixed-sizes buckets for the counted website pieces.
  insert into public.merch_variants (product_id, size, sku, position, is_active, is_bucket)
  select p.id, 'Mixed sizes', upper(p.slug) || '-MIXED', 99, false, true
    from public.merch_products p
   where p.slug in ('meatsoko-dust-coat', 'hustle-game-21-hoodie-model', 'red-polo', 'green-polo',
                    'white-hoodie', 'green-hoodie', 'red-hoodie', 'executive-polo',
                    'green-t-shirt', 'red-t-shirt', 'white-t-shirt');
  if (select count(*) from public.merch_variants where is_bucket) <> 11 then
    raise exception 'expected 11 buckets';
  end if;

  -- The second Hustle Game 21 listing is the same hoodie: its sales come off the first's count.
  update public.merch_products
     set stock_product_id = (select id from public.merch_products where slug = 'hustle-game-21-hoodie-model')
   where slug = 'hustle-game-21-hoodie-views';

  -- Opening count, confirmed.
  insert into public.merch_stock_batches (batch_number, kind, status, note, confirmed_at)
  values (public.merch_gen_number('SB', 'public.merch_stock_batches', 'batch_number'), 'opening', 'confirmed', v_note, now())
  returning id into v_batch;
  for v_line in
    select v.id, c.counted, c.note
      from (values
        ('MEATSOKO-DUST-COAT-MIXED', 15, null),
        ('HUSTLE-GAME-21-HOODIE-MODEL-MIXED', 1, null),
        ('RED-POLO-MIXED', 2, 'Rough'),
        ('GREEN-POLO-MIXED', 2, null),
        ('WHITE-HOODIE-MIXED', 6, null),
        ('GREEN-HOODIE-MIXED', 2, null),
        ('RED-HOODIE-MIXED', 3, null),
        ('EXECUTIVE-POLO-MIXED', 3, null),
        ('GREEN-T-SHIRT-MIXED', 2, null),
        ('RED-T-SHIRT-MIXED', 2, null),
        ('WHITE-T-SHIRT-MIXED', 3, null),
        ('BMB-CAP-ONESIZE', 3, null),
        ('MEATSOKO-CAP-ONESIZE', 4, null)
      ) c(sku, counted, note)
      join public.merch_variants v on v.sku = c.sku
     order by v.id
  loop
    insert into public.merch_stock_batch_lines (batch_id, variant_id, counted, outcome, delta)
    values (v_batch, v_line.id, v_line.counted, 'applied', v_line.counted);
    perform public.merch_move_stock(v_line.id, v_line.counted, 'opening', p_batch_id => v_batch,
                                    p_note => v_note || coalesce(' · ' || v_line.note, ''), p_start => true);
  end loop;
  if (select count(*) from public.merch_stock_batch_lines where batch_id = v_batch) <> 13 then
    raise exception 'expected 13 opening lines';
  end if;

  -- Sales on the sheet, cash.
  for v_line in
    select v.id, v.sku, v.size, p.name, p.color, s.qty, s.price
      from (values ('WHITE-HOODIE-MIXED', 2, 8000), ('MEATSOKO-DUST-COAT-MIXED', 2, 1500)) s(sku, qty, price)
      join public.merch_variants v on v.sku = s.sku
      join public.merch_products p on p.id = v.product_id
  loop
    insert into public.merch_manual_sales (sale_number, sold_at, payment_method, location, note, subtotal_kes)
    values (public.merch_gen_number('MM', 'public.merch_manual_sales', 'sale_number'), now(), 'cash',
            'Stock sheet', v_note, v_line.qty * v_line.price)
    returning id into v_sale;
    insert into public.merch_manual_sale_items (sale_id, variant_id, product_name, color, size, sku, qty, unit_price_kes, stock_tracked)
    values (v_sale, v_line.id, v_line.name, v_line.color, v_line.size, v_line.sku, v_line.qty, v_line.price, true);
    perform public.merch_move_stock(v_line.id, -v_line.qty, 'manual_sale', p_manual_sale_id => v_sale);
  end loop;

  -- Four white hoodies for marketing.
  select id into v_var from public.merch_variants where sku = 'WHITE-HOODIE-MIXED';
  insert into public.merch_stock_batches (batch_number, kind, status, issue_reason, note, confirmed_at)
  values (public.merch_gen_number('SB', 'public.merch_stock_batches', 'batch_number'), 'issue', 'confirmed', 'giveaway',
          'Marketing · ' || v_note, now())
  returning id into v_batch;
  insert into public.merch_stock_batch_lines (batch_id, variant_id, qty, outcome, delta)
  values (v_batch, v_var, 4, 'applied', -4);
  perform public.merch_move_stock(v_var, -4, 'issue', p_batch_id => v_batch, p_note => 'Marketing');

  -- The test purchase.
  update public.merch_orders set is_test = true where order_number = 'MS-FEADKS';

  insert into public.admin_audit (action, detail)
  values ('merch_stock_sheet_import', jsonb_build_object('sheet', '2026-10-25', 'opening_lines', 13, 'manual_sales', 2,
          'marketing_units', 4, 'test_order', 'MS-FEADKS'));

  if (select stock_on_hand from public.merch_variants where sku = 'WHITE-HOODIE-MIXED') <> 0
     or (select stock_on_hand from public.merch_variants where sku = 'MEATSOKO-DUST-COAT-MIXED') <> 13 then
    raise exception 'stock sheet balances do not add up';
  end if;
end $$;
