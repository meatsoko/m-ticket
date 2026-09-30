-- Store content from the go-live checklist: delivery fees, and pickup becomes
-- "Collect at a MeatSoko franchise".
--
-- Fees are USD like every store price; merch_create_order converts to KES at the
-- current rate. They are the organiser's figures, approximating Kenyan courier
-- rates (2026-09-30):
--   Standard delivery, per area:  Nairobi CBD $2 · Greater Nairobi $3 ·
--                                 Major towns $5 · Rest of Kenya $7
--   Matatu / Sacco:               $3 to the Sacco office; the customer pays any
--                                 onward fare to the Sacco on collection.
-- Change them here or directly in merch_delivery_zones / merch_delivery_options,
-- and keep src/lib/merchandise.ts (DELIVERY_OPTIONS / DELIVERY_ZONES) in step:
-- the site displays those, while checkout charges what this table says.
--
-- Pickup: MeatSoko has several franchises, so there is no single pickup point.
-- The customer may name their nearest franchise or area (stored in
-- delivery_town, optional); staff confirm the location by call or WhatsApp.

update public.merch_delivery_options
   set label = 'Collect at a MeatSoko franchise',
       blurb = 'Free. Collect from your nearest MeatSoko franchise — we’ll call or WhatsApp you when your order is ready and confirm where.',
       fee_usd = 0
 where code = 'pickup';

update public.merch_delivery_options set fee_usd = 3 where code = 'matatu';

update public.merch_delivery_zones z
   set fee_usd = f.fee
  from (values ('Nairobi CBD', 2), ('Greater Nairobi', 3), ('Major towns', 5), ('Rest of Kenya', 7)) as f(name, fee)
 where z.option_code = 'standard' and z.name = f.name;
