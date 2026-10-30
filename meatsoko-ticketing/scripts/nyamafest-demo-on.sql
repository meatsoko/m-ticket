-- NyamaFest Main demo: open the event again with the tables at KSh 1.
--
-- For a live demo of the booking flow (branch demo/nyamafest-kes1, run on
-- localhost). NOT a migration on purpose: `supabase db push` must never apply
-- it. Run by hand, with the user's go-ahead:
--   supabase db query --linked -f scripts/nyamafest-demo-on.sql
-- and undo after the demo with scripts/nyamafest-demo-off.sql.
--
-- Localhost reads the live database, so while this is on the public site shows
-- NyamaFest Main as upcoming (Sat 14 Nov 2026, 6 AM) and anyone can buy a table
-- for KSh 1 (real M-Pesa). Existing bookings are untouched.
--
-- Refuses to run unless the event and the three family platters still hold the
-- values recorded on 2026-10-30 (the ones demo-off restores).

do $$
declare
  v_event uuid;
  v_n     int;
begin
  select id into v_event from public.events
   where slug = 'nyamafest-main'
     and starts_at = '2026-10-17 03:00:00+00' and ends_at = '2026-10-18 03:00:00+00'
     and doors_open_at = '2026-10-17 03:00:00+00';
  if v_event is null then raise exception 'nyamafest-main is not in its recorded state; demo already on?'; end if;

  select count(*) into v_n from public.preorder_items
   where event_id = v_event and is_active and early_bird_ends_at = '2026-10-07 15:19:03.91689+00'
     and (name, price_kes, compare_at_price_kes) in
         (('Basic Family Platter', 1945, 2593), ('Moderate Family Platter', 4538, 5187), ('Big Family Platter', 6484, 7132));
  if v_n <> 3 then raise exception 'family platters not in their recorded state (% of 3)', v_n; end if;

  update public.events
     set starts_at = '2026-11-14 03:00:00+00', ends_at = '2026-11-15 03:00:00+00', doors_open_at = '2026-11-14 03:00:00+00'
   where id = v_event;

  -- KSh 1 flat: no early bird, no compare-at (the charged price is price_kes).
  update public.preorder_items
     set price_kes = 1, compare_at_price_kes = null, early_bird_ends_at = null
   where event_id = v_event and is_active
     and name in ('Basic Family Platter', 'Moderate Family Platter', 'Big Family Platter');
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception 'expected 3 platters, updated %', v_n; end if;
end $$;
