-- NyamaFest Launch: turn payments off, set capacity.
--
-- This event is reservation_mode = 'off' (Ticketed), so neither field is
-- reachable from Event settings — EventSettings.tsx renders both only when the
-- event is in a reservation mode. Hence SQL.
--
-- The event is already status = 'closed' and its date (2026-09-06) has passed,
-- so this is record-keeping, not a live change. Note that stk-push refuses any
-- event with payments_enabled = false (functions/stk-push/index.ts:105), so if
-- this event is ever reopened for ticket sales, this flag has to go back on.
--
--   ./scripts/db.sh < scripts/fix-nyamafest-launch.sql

update public.events
   set payments_enabled = false,
       capacity         = 500
 where slug = 'nyamafest-launch'
returning id, name, slug, status, reservation_mode, capacity, payments_enabled;
