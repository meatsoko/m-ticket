-- Event Program and Concept tabs (Events v2, 2026-10-06).
--
-- Program: a running order for an event page (time label, title, host,
-- location, description). Items are drafts until published; only published
-- items are public.
-- Concept: one structured "about" per event — core proposition, overview,
-- pillars ({title, body}), who it is for, objectives, vision, the measure of
-- success, and the ways partners can take part. NyamaFest Main's
-- is filled from the organiser's concept note (Nyama Fest Concept Note,
-- MEATsoko Group, concept by Aaron Greene) at the end of this file.
--
-- Access: the public reads published program items and concepts (they are
-- page content). Only admins write, from the dashboard event page; staff and
-- the public cannot. No functions, so no EXECUTE grants to lock down.
-- (The Celebrations sketch that shared this branch is parked in
-- drafts/celebrations.sql; it is not part of this migration.)

create table if not exists public.event_programs (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  time_label   text not null check (length(btrim(time_label)) between 1 and 40),   -- "09:00", "Morning", "Day 1"
  title        text not null check (length(btrim(title)) between 2 and 140),
  description  text check (description is null or length(description) <= 1000),
  speaker_host text check (speaker_host is null or length(speaker_host) <= 140),
  category     text check (category is null or length(category) <= 40),          -- "Talk", "Workshop", "Main stage"
  location     text check (location is null or length(location) <= 100),
  position     integer not null default 0,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists event_programs_event_idx on public.event_programs (event_id, position);

create table if not exists public.event_concepts (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null unique references public.events(id) on delete cascade,
  core_proposition    text check (core_proposition is null or length(core_proposition) <= 300),
  overview            text check (overview is null or length(overview) <= 4000),
  pillars             jsonb not null default '[]' check (jsonb_typeof(pillars) = 'array'),             -- [{title, body}]
  target_participants jsonb not null default '[]' check (jsonb_typeof(target_participants) = 'array'), -- ["Farmers", ...]
  objectives          jsonb not null default '[]' check (jsonb_typeof(objectives) = 'array'),          -- ["...", ...]
  vision              text check (vision is null or length(vision) <= 2000),
  success_measure     text check (success_measure is null or length(success_measure) <= 600),           -- "how we'll judge it"
  take_part           jsonb not null default '[]' check (jsonb_typeof(take_part) = 'array'),           -- ways partners take part
  updated_at          timestamptz not null default now()
);

alter table public.event_programs enable row level security;
alter table public.event_concepts enable row level security;
revoke all on table public.event_programs, public.event_concepts from anon, authenticated;
grant select on table public.event_programs, public.event_concepts to anon, authenticated;
grant insert, update, delete on table public.event_programs, public.event_concepts to authenticated;

drop policy if exists event_programs_public_read on public.event_programs;
create policy event_programs_public_read on public.event_programs for select using (is_published or public.is_admin());
drop policy if exists event_programs_admin_insert on public.event_programs;
create policy event_programs_admin_insert on public.event_programs for insert to authenticated with check (public.is_admin());
drop policy if exists event_programs_admin_update on public.event_programs;
create policy event_programs_admin_update on public.event_programs for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists event_programs_admin_delete on public.event_programs;
create policy event_programs_admin_delete on public.event_programs for delete to authenticated using (public.is_admin());

drop policy if exists event_concepts_public_read on public.event_concepts;
create policy event_concepts_public_read on public.event_concepts for select using (true);
drop policy if exists event_concepts_admin_insert on public.event_concepts;
create policy event_concepts_admin_insert on public.event_concepts for insert to authenticated with check (public.is_admin());
drop policy if exists event_concepts_admin_update on public.event_concepts;
create policy event_concepts_admin_update on public.event_concepts for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists event_concepts_admin_delete on public.event_concepts;
create policy event_concepts_admin_delete on public.event_concepts for delete to authenticated using (public.is_admin());

-- NyamaFest Main's concept, from the organiser's concept note (2026-10-05).
insert into public.event_concepts (event_id, core_proposition, overview, pillars, target_participants, objectives, vision, success_measure, take_part)
select e.id,
  'Nyama Fest is where the traditional red-meat economy meets the next generation.',
  'Nyama Fest is a strategic initiative of MEATsoko Group to help shape the next generation of Kenya''s red-meat economy. It goes beyond a food festival: a value-chain ecosystem platform where celebration becomes the entry point for collaboration, networking, investment, innovation, policy dialogue, technology exchange, partnerships and deal-making. It builds on the knowledge, relationships and entrepreneurial foundations of earlier generations while tackling informality, fragmentation, limited financing, climate vulnerability, weak traceability and insufficient value addition.',
  '[{"title":"Celebrate","body":"Good food, culture, quality, hospitality and shared experience."},
    {"title":"Connect","body":"Bringing together actors who traditionally operate in fragmented parts of the value chain."},
    {"title":"Collaborate","body":"Creating partnerships around innovation, circularity, sustainability, technology and enterprise."},
    {"title":"Network","body":"Building relationships between businesses, professionals, communities, investors and institutions."},
    {"title":"Invest","body":"Connecting viable opportunities with finance, technology, expertise and markets."},
    {"title":"Deal-make","body":"Moving beyond conversation towards MoUs, partnerships, investment commitments, market linkages and joint initiatives."}]'::jsonb,
  '["Farmers and pastoralists","Traders","Abattoirs and processors","Retailers","Consumers","Informal workers","Youth enterprises","Technology companies","Financial institutions","Investors","Government","Researchers","Development partners","Regional and global partners"]'::jsonb,
  '["Strengthen connectivity across the red-meat value chain.",
    "Support the generational transition from predominantly informal systems towards more formal and technology-enabled enterprise.",
    "Promote circularity and resource efficiency.",
    "Advance climate-resilient business models.",
    "Promote a just transition towards cleaner and renewable energy.",
    "Position youth as entrepreneurs, investors, innovators and owners.",
    "Promote decent work and recognition of informal workers.",
    "Create investment and commercial partnership opportunities.",
    "Strengthen regional and global connectivity.",
    "Turn dialogue into practical commitments, partnerships and deals."]'::jsonb,
  'Culture meets enterprise. Experience meets technology. Informality meets formalisation. Waste meets value. Climate risk meets resilience. Energy transition meets opportunity. Youth meets investment. Kenya meets the region and the world. Nyama Fest should not only showcase what is possible — it should create the space where the people who can make it possible meet, collaborate, invest and sign the deals.',
  'The central measure of success is not how many people attend, but what relationships were created, what opportunities were unlocked, what investments were mobilised and what deals were signed. A Nyama Fest Action and Investment Tracker records every commitment made at the event — who committed to what, by when, with what resources — and follows up at 3, 6 and 12 months.',
  '["Showcase technologies, products or circular solutions.",
    "Take part in investment matchmaking and partnership conversations.",
    "Join policy and knowledge-exchange sessions.",
    "Explore MoUs, market linkages and joint programmes."]'::jsonb
from public.events e
where e.slug = 'nyamafest-main'
on conflict (event_id) do nothing;
