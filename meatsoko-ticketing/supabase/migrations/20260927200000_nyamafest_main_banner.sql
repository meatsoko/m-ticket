-- Set the supplied NyamaFest Main poster as the event page background.
update public.events
set banner_url = '/images/events/nyamafest-main-poster.webp'
where slug = 'nyamafest-main';
