-- Announce the MEATSOKO Token Launch & Fintech Summit (MAIC, 5 December 2026,
-- Nairobi) in the /events line-up as "Coming soon" (organiser, 2026-10-02).
--
-- No registration on this site yet, and no time announced:
--   * reservations_open_at = starts_at, so it is "Coming soon" until the day.
--     create_reservation() refuses bookings before that; the event page shows
--     "Registration details coming soon" and hides vendor sign-up; the
--     homepage's featured-event card skips it.
--   * reservation_mode 'off', no ticket types, payments off: nothing to buy.
--   * starts 00:00 and ends 23:59 Nairobi: pages read that as "Time to be
--     announced" (nairobiTimeRange). Set the real hours in Event settings later.
--
-- When registration opens here, set reservations_open_at (and the booking
-- setup) in the dashboard; until then this is a listing only.
insert into public.events (
  name, slug, format, tagline, description, venue,
  starts_at, ends_at, banner_url, status,
  reservation_mode, payments_enabled, reservations_open_at
)
select
  'MEATSOKO Token Launch & Fintech Summit',
  'meatsoko-token-summit',
  'conference_expo',
  'Decentralizing the livestock supply chain · Hosted by MAIC with Meatsoko Networking Playground',
  'Real-World Asset Tokenization | Smart Contract Settlements | DeFi Micro-Finance for Pastoralists | Blockchain Traceability',
  'Nairobi, Kenya',
  timestamp '2026-12-05 00:00' at time zone 'Africa/Nairobi',
  timestamp '2026-12-05 23:59' at time zone 'Africa/Nairobi',
  '/images/events/maic-token-summit-poster.jpg',
  'live',
  'off',
  false,
  timestamp '2026-12-05 00:00' at time zone 'Africa/Nairobi'
where not exists (select 1 from public.events where slug = 'meatsoko-token-summit');
