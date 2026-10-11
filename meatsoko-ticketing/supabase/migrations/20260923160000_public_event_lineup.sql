-- ============================================================
-- Let the public see the line-up, not just the event on sale.
--
-- The original policy exposed only `status = 'live'`, which is right for
-- purchase but wrong for a line-up page: a past event cannot be shown as
-- "Closed" and an announced one cannot be shown as "Coming soon" if neither is
-- readable. `draft` stays private — that is the staging state.
--
-- "Coming soon" is NOT a new status. An announced event is `live` with a
-- reservations_open_at in the future: publicly visible, not yet bookable.
-- create_reservation() already refuses those with 'not_open_yet', so the rule
-- is enforced server-side and the badge is just its UI.
-- ============================================================
drop policy if exists "public read live events" on public.events;

create policy "public read announced events" on public.events
  for select using (status in ('live', 'closed'));

-- Ticket types and preorder/reservation catalogues stay restricted to LIVE
-- events: a closed event appears in the line-up but must not offer anything.
