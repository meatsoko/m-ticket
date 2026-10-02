-- NyamaFest Main starts at 6:00 AM and runs overnight (organiser, 2026-10-02):
-- Saturday 17 October 06:00 to Sunday 18 October 06:00, Africa/Nairobi.
-- Supersedes the 5 PM start in 20260928130000_nyamafest_event_hours.sql; the
-- end (6 AM the next day) is unchanged. Doors open at the start time.
--
-- Everything else reads these columns: the event page and homepage card show
-- "6:00 am – 6:00 am next day", passes and emails print the start, and the
-- online watch page goes live at starts_at.
update public.events
set starts_at = (
      date_trunc('day', starts_at at time zone 'Africa/Nairobi') + interval '6 hours'
    ) at time zone 'Africa/Nairobi',
    ends_at = (
      date_trunc('day', starts_at at time zone 'Africa/Nairobi') + interval '1 day 6 hours'
    ) at time zone 'Africa/Nairobi',
    doors_open_at = (
      date_trunc('day', starts_at at time zone 'Africa/Nairobi') + interval '6 hours'
    ) at time zone 'Africa/Nairobi'
where slug = 'nyamafest-main';
