-- NyamaFest Main details from the organiser's concept note (Nyama Fest Concept
-- Note, MEATsoko Group, 2026-10-05), "Event at a Glance":
--   Venue: Thika Greens Golf Resort · Time: from 6:00 AM till late ·
--   Dress code: all white · Host: MEATsoko Group
-- and the positioning line "Building the Next Generation of Kenya's Red-Meat
-- Economy". The "what's inside" list (events.description, shown as chips on
-- the event page) follows the note's methodology: celebration, showcasing,
-- knowledge exchange, investment matchmaking, policy dialogue, deal-making.
--
-- New optional event fields, editable in Event settings:
--   time_note  — replaces the computed hours on the event page and ticket card
--                (e.g. "From 6:00 AM till late"); starts_at/ends_at still drive
--                countdowns, booking windows and the watch page
--   dress_code — shown with the event facts
--   host       — "Hosted by …" under the event name
alter table public.events add column if not exists time_note text check (time_note is null or length(time_note) <= 60);
alter table public.events add column if not exists dress_code text check (dress_code is null or length(dress_code) <= 60);
alter table public.events add column if not exists host text check (host is null or length(host) <= 80);

update public.events
set venue       = 'Thika Greens Golf Resort',
    tagline     = 'Building the Next Generation of Kenya''s Red-Meat Economy',
    time_note   = 'From 6:00 AM till late',
    dress_code  = 'All white',
    host        = 'MEATsoko Group',
    description = 'Nyama Choma & Live Grills | Technology & Innovation Showcases | Knowledge Exchange | Investment Matchmaking | Policy Dialogue | Deal-making'
where slug = 'nyamafest-main';
