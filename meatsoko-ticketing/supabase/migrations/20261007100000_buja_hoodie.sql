-- Buja × MeatSoko Hoodie (green), priced at USD 78.
--
-- The storefront reads the catalogue from src/lib/merchandise.ts, but checkout prices
-- every line from merch_products / merch_variants (merch_create_order). A product that
-- is only in the TypeScript catalogue shows a price yet fails at checkout with
-- 'unavailable_item', so the hoodie needs its rows here too. Slug, name, colour,
-- swatch, image and copy match the catalogue entry; SKUs follow the existing
-- <SLUG>-<SIZE> pattern. Stock is NULL (not tracked), like the other partnership
-- pieces. Idempotent: re-running it changes nothing that already exists.

insert into public.merch_products
  (group_id, slug, style_key, name, color, swatch, image_path, summary, details, partner, price_usd, position)
select g.id,
       'buja-hoodie-green',
       'buja-hoodie',
       'Buja × MeatSoko Hoodie',
       'Green',
       '#1f6b3a',
       '/images/merchandise/buja-hoodie-green.jpg',
       'A partnership hoodie with Buja: “BUJA since 1997” up front and the MeatSoko Ecosystem print across the back.',
       array[
         '“BUJA since 1997” print on the chest',
         'Kenya flag on the right sleeve, “To dare is to do” down the left',
         'MeatSoko Ecosystem print across the back with “Convenient · Reliable · Sustainable”',
         'Drawstring hood and front kangaroo pocket'
       ],
       'Buja',
       78.00,
       coalesce((select max(p.position) + 1 from public.merch_products p where p.group_id = g.id), 0)
from public.merch_groups g
where g.slug = 'partnerships'
on conflict (slug) do nothing;

insert into public.merch_variants (product_id, size, sku, position)
select p.id, s.size, 'BUJA-HOODIE-GREEN-' || s.size, s.position
from public.merch_products p
cross join (values ('S', 0), ('M', 1), ('L', 2), ('XL', 3), ('2XL', 4)) as s(size, position)
where p.slug = 'buja-hoodie-green'
on conflict (product_id, size) do nothing;
