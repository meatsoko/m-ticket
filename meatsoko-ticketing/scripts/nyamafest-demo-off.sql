-- Undo scripts/nyamafest-demo-on.sql: NyamaFest Main back to 17 Oct 2026 and the
-- family platters back to their prices (early bird ended 2026-10-07, so the
-- charged price is the compare-at: 2,593 / 5,187 / 7,132).
--   supabase db query --linked -f scripts/nyamafest-demo-off.sql
-- Bookings and payments made during the demo stay as records (KSh 1 each).

do $$
declare
  v_event uuid;
  v_n     int;
begin
  select id into v_event from public.events
   where slug = 'nyamafest-main' and starts_at = '2026-11-14 03:00:00+00';
  if v_event is null then raise exception 'demo is not on (nyamafest-main is not dated 14 Nov)'; end if;

  update public.events
     set starts_at = '2026-10-17 03:00:00+00', ends_at = '2026-10-18 03:00:00+00', doors_open_at = '2026-10-17 03:00:00+00'
   where id = v_event;

  update public.preorder_items p
     set price_kes = v.price, compare_at_price_kes = v.was, early_bird_ends_at = '2026-10-07 15:19:03.91689+00'
    from (values ('Basic Family Platter', 1945, 2593), ('Moderate Family Platter', 4538, 5187),
                 ('Big Family Platter', 6484, 7132)) v(name, price, was)
   where p.event_id = v_event and p.is_active and p.name = v.name;
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception 'expected 3 platters, updated %', v_n; end if;
end $$;
