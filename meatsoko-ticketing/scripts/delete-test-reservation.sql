-- Remove the test reservation NF-23X5MW before the gates open.
--
-- It is `confirmed`, so it will scan in like any real guest. Its phone
-- (0700000000) is trivially guessable through /lookup, and its access_token has
-- been pasted into a chat transcript — either route hands someone a working pass.
--
--   ./scripts/db.sh < scripts/delete-test-reservation.sql
--
-- The phone guard is deliberate: if that reservation number has somehow been
-- reused by a real booking, this deletes nothing rather than the wrong guest.
--
-- redemptions.reservation_id is ON DELETE CASCADE, so any scan rows go with it.
-- The row has no order (it is a free reservation), so nothing is orphaned.

select reservation_number, guest_name, phone, email, status, checked_in_at
  from public.reservations
 where reservation_number = 'NF-23X5MW';

delete from public.reservations
 where reservation_number = 'NF-23X5MW'
   and phone like '%700000000'
returning reservation_number, guest_name, phone, status;
