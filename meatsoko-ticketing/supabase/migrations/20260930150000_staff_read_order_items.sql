-- Let signed-in staff read event order lines (what a booking preordered).
--
-- order_items has had RLS enabled since the start (schema.sql) but no policy at
-- all, so only the service role could read it: guests saw their platter on the
-- pass (via an Edge Function), but no staff screen could. The dashboard's
-- Tickets view needs it to show each booking's preorders.
--
-- Read-only, staff-only, and the same rule as the rows it belongs to:
-- orders ("staff read orders"), reservations and tickets are all
-- `using (public.is_staff())`. No write policy — order lines are only ever
-- written by SECURITY DEFINER functions (create_reservation,
-- start_reservation_upgrade), which RLS does not affect.
drop policy if exists "staff read order items" on public.order_items;
create policy "staff read order items" on public.order_items
  for select using (public.is_staff());
