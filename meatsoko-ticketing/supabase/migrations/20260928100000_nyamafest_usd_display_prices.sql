-- Align the active NyamaFest package charge amounts with the USD prices shown
-- to guests ($15/$20, $35/$40 and $50/$55), using the CBK indicative rate of
-- KSh 129.67 per USD on 2026-09-28.
-- Rounded to the nearest whole shilling. Payment and order records stay in KES.
-- Existing order_items retain their original price snapshots.
update public.preorder_items pi set
  price_kes = prices.early_kes,
  compare_at_price_kes = prices.regular_kes
from public.events e
join (values
  ('Basic Family Platter',    1945::numeric, 2593::numeric),
  ('Moderate Family Platter', 4538::numeric, 5187::numeric),
  ('Big Family Platter',      6484::numeric, 7132::numeric)
) as prices(item_name, early_kes, regular_kes) on true
where pi.event_id = e.id
  and e.slug = 'nyamafest-main'
  and pi.name = prices.item_name;
