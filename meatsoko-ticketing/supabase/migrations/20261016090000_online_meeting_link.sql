-- Online attendance via Google Meet (2026-10-16, the user's request): alongside or
-- instead of the YouTube stream, an event can carry a Google Meet link.
--   * events.meeting_url — set in Event settings; only a Google Meet link
--     (https://meet.google.com/abc-defg-hij) is accepted.
--   * The private watch page (/watch/<code>, online-access) shows "Join on Google
--     Meet" from the event's start time, like the stream.
--   * online-announce (admins only) emails each active online registrant their
--     watch link and the Meet link; online_registrations.meeting_emailed_at records
--     who has had it, so pressing the button again only reaches newcomers unless
--     "send again" is chosen.
-- No functions here; events keep their existing admin-only write policy.
alter table public.events add column if not exists meeting_url text;
alter table public.events drop constraint if exists events_meeting_url_check;
alter table public.events add constraint events_meeting_url_check
  check (meeting_url is null or meeting_url ~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$');
alter table public.online_registrations add column if not exists meeting_emailed_at timestamptz;
