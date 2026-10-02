-- The summit poster was cropped (no "EVENT POSTER" banner at the top, no
-- date/location/registration strip at the bottom). A new file name, so
-- browsers that cached the original under the old name load the new one.
update public.events
set banner_url = '/images/events/maic-token-summit-poster-2.jpg'
where slug = 'meatsoko-token-summit'
  and banner_url = '/images/events/maic-token-summit-poster.jpg';
