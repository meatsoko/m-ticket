-- The /events hero: the next open event as a layered poster (after the
-- "Odyssey" festival reference the user chose on 2026-10-06). Three layers —
-- a giant faded word at the back, a cut-out subject in the middle, the event
-- name in red script across the front — with the facts (date, venue, free
-- entry, table prices) pulled from the event itself, so nothing on it is
-- invented and the hero changes on its own when the next event changes.
--
-- New optional event fields, editable in Event settings:
--   hero_word      — the faded word behind the subject (e.g. "NYAMA"); short
--                    so it fits one line at phone width. Null = the first
--                    word of the event name.
--   hero_headline  — the big line under the date (e.g. "Let's feast, network
--                    & celebrate", the organiser's own poster wording). Null =
--                    the tagline.
--   hero_image_url — a transparent PNG cut-out (person or food) that stands in
--                    the middle. Null = the event poster, cropped to its top
--                    so a poster's own fine print (dates, hours) never shows
--                    in the hero; NyamaFest's poster still says "from 5 PM".
--
-- Public read comes with the events table (live events are public); writes
-- are the existing admin-only policy. No functions, so nothing to revoke.
alter table public.events add column if not exists hero_word text check (hero_word is null or length(hero_word) <= 16);
alter table public.events add column if not exists hero_headline text check (hero_headline is null or length(hero_headline) <= 70);
alter table public.events add column if not exists hero_image_url text;

update public.events
set hero_word     = 'NYAMA',
    hero_headline = 'Let''s feast, network & celebrate'
where slug = 'nyamafest-main';
