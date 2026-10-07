-- Accept 01XX mobile numbers as well as 07XX (2026-10-07, the user's request):
-- Safaricom 0110/0111 and Airtel 0100–0102 are normal Kenyan mobiles, stored
-- like the others as 254 + 9 digits (2541XXXXXXXX). normalizePhone() on the
-- site and in the Edge Functions now accepts them; this widens the one table
-- that was pinned to 2547 (celebration requests). Event Orders already accepted
-- 01; vendors, merch orders and PayHero payments check ^254[0-9]{9}$ already.
alter table public.celebration_requests drop constraint if exists celebration_requests_phone_check;
alter table public.celebration_requests
  add constraint celebration_requests_phone_check check (phone ~ '^254[17][0-9]{8}$');
