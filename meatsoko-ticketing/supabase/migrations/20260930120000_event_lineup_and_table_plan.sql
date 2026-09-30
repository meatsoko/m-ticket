-- Two optional event fields for the event page's tabs (the ticket panel
-- redesign, 2026-09-30):
--   lineup          one act per line; shows a "Lineup" tab when set
--   table_plan_url  an image of the venue/table layout; shows a "Table plan" tab
-- Both are edited in the admin Event settings and read by the public event page
-- through the existing events policies. No new functions, no grants.
alter table public.events add column if not exists lineup text;
alter table public.events add column if not exists table_plan_url text;
