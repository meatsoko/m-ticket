-- Warn when one email is about to hold two reservations for the same event.
--
-- create_reservation() keys identity on PHONE: it matches (event_id, phone) and
-- updates that row in place, so submitting the form twice from one handset gives
-- one pass rather than two. Email has no equivalent rule, so the same address
-- with a different number produces two reservations, two passes, and two party
-- sizes counted against capacity.
--
-- This deliberately does NOT add `unique (event_id, lower(email))`:
--
--   * families legitimately share one inbox — two guests, two phones, one
--     address — and a unique index turns that into a hard error mid-booking
--   * reservation-lookup already returns an ARRAY per address for that reason
--   * email is stored case-preserved, so such an index needs a normalisation
--     pass over live data first
--   * the migration itself would fail if duplicates already exist
--
-- So this is a lookup the caller may act on, not a constraint. The write path is
-- untouched: create_reservation() is not modified by this migration.

create or replace function public.email_has_other_reservation(
  p_event_id uuid,
  p_email    text,
  p_phone    text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
              'found', true,
              'reservation_number', r.reservation_number,
              'party_size', r.party_size)
       from public.reservations r
      where r.event_id = p_event_id
        and r.phone is distinct from p_phone
        and r.status <> 'cancelled'
        and lower(btrim(r.email)) = lower(btrim(p_email))
      order by r.created_at
      limit 1),
    jsonb_build_object('found', false));
$$;

comment on function public.email_has_other_reservation(uuid, text, text) is
  'Does this event already hold a reservation for this email under a DIFFERENT '
  'phone? Returns the reservation number and party size only — never the '
  'access_token, which is a bearer credential: this must not become a way to '
  'fetch someone else''s pass by guessing their address.';

-- Lock it to the service role. Left callable by anon over PostgREST this is an
-- email-enumeration oracle: "does this address hold a booking" for any address
-- anyone cares to try. The reserve Edge Function calls it with the service key,
-- behind that function's existing per-phone and per-IP throttles.
revoke execute on function public.email_has_other_reservation(uuid, text, text) from public;
revoke execute on function public.email_has_other_reservation(uuid, text, text) from anon;
revoke execute on function public.email_has_other_reservation(uuid, text, text) from authenticated;
grant  execute on function public.email_has_other_reservation(uuid, text, text) to service_role;
