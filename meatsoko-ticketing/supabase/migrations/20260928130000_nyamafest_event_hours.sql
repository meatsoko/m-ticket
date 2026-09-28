-- NyamaFest runs from 5 PM through dawn (6 AM the following local day).
update public.events
set starts_at = (
      date_trunc('day', starts_at at time zone 'Africa/Nairobi') + interval '17 hours'
    ) at time zone 'Africa/Nairobi',
    ends_at = (
      date_trunc('day', starts_at at time zone 'Africa/Nairobi') + interval '1 day 6 hours'
    ) at time zone 'Africa/Nairobi'
where slug = 'nyamafest-main';
