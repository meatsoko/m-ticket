-- NyamaFest 2026 program, from the organiser's "NyamaFest_2026_Program_Schedule_REVISED.pdf"
-- (2026-10-06). Two days: Day 1 (Fri 16 Oct) investor & stakeholder evening,
-- Day 2 (Sat 17 Oct) family, food, entertainment & closing. Published, so the
-- event page's Program tab shows it. The day goes in category. Replaces any
-- earlier items for nyamafest-main (there were none on 2026-10-07).
delete from public.event_programs where event_id = (select id from public.events where slug = 'nyamafest-main');
insert into public.event_programs (event_id, position, time_label, title, category, description, is_published)
select e.id, v.pos, v.t, v.title, v.cat, v.descr, true
from public.events e
cross join (values
  (0,  'Fri 16 Oct · 4:00 – 5:00 PM',   'Arrival & Registration',            'Day 1 · Investor & stakeholder evening', 'Guest arrival, registration, introductions and settling in.'),
  (1,  'Fri 16 Oct · 5:00 – 5:20 PM',   'Official Welcome',                  'Day 1 · Investor & stakeholder evening', 'Opening remarks and introduction to the NyamaFest programme.'),
  (2,  'Fri 16 Oct · 5:20 – 6:00 PM',   'Agenda Briefing',                   'Day 1 · Investor & stakeholder evening', 'Overview of the key agendas, opportunities and meeting flow.'),
  (3,  'Fri 16 Oct · 6:00 – 7:00 PM',   'Meat Infrastructure & AI',          'Day 1 · Investor & stakeholder evening', 'Meetings around slaughterhouse/meat infrastructure and AI in livestock & meat.'),
  (4,  'Fri 16 Oct · 7:00 – 8:00 PM',   'Supply Chain & Investment',         'Day 1 · Investor & stakeholder evening', 'Discussions on livestock supply chain, tokenisation, ranching and investment.'),
  (5,  'Fri 16 Oct · 8:00 – 9:00 PM',   'Biogas, Energy & Logistics',        'Day 1 · Investor & stakeholder evening', 'Meetings on biogas/energy, logistics, distribution and related opportunities.'),
  (6,  'Fri 16 Oct · 9:00 – 10:00 PM',  'Media & Commercial Partnerships',   'Day 1 · Investor & stakeholder evening', 'Discussions on media, events, branding and strategic commercial partnerships.'),
  (7,  'Fri 16 Oct · 10:00 PM – Late',  'One-on-One Meetings & Networking',  'Day 1 · Investor & stakeholder evening', 'Private conversations, follow-ups, networking and relationship building.'),
  (8,  'Sat 17 Oct · 7:00 – 9:00 AM',   'Morning Arrival & Breakfast',       'Day 2 · NyamaFest Day', 'Guests arrive, breakfast and refreshments, family settling and early activities.'),
  (9,  'Sat 17 Oct · 9:00 – 10:00 AM',  'Official NyamaFest Opening',        'Day 2 · NyamaFest Day', 'Festival opening, welcome remarks and introduction to the day''s programme.'),
  (10, 'Sat 17 Oct · 10:00 AM – 12:00 PM', 'NyamaFest Food Experience',      'Day 2 · NyamaFest Day', 'Nyama, food experiences, family activities and community engagement.'),
  (11, 'Sat 17 Oct · 12:00 – 2:00 PM',  'Family & Kids Festival',            'Day 2 · NyamaFest Day', 'Children''s activities, games, entertainment and family experiences.'),
  (12, 'Sat 17 Oct · 2:00 – 4:00 PM',   'Music, Entertainment & Networking', 'Day 2 · NyamaFest Day', 'Live entertainment, music, food, socialising and partner engagement.'),
  (13, 'Sat 17 Oct · 4:00 – 6:00 PM',   'Main Festival Celebration',         'Day 2 · NyamaFest Day', 'Peak NyamaFest experience, food, entertainment and community celebration.'),
  (14, 'Sat 17 Oct · 6:00 – 7:00 PM',   'Transition to Closing',             'Day 2 · NyamaFest Day', 'Final festival activities, guest movement and preparation for closing.'),
  (15, 'Sat 17 Oct · 7:00 – 8:00 PM',   'Closing Ceremony',                  'Day 2 · NyamaFest Day', 'Closing remarks, appreciation, acknowledgements and final celebration.')
) as v(pos, t, title, cat, descr)
where e.slug = 'nyamafest-main';
