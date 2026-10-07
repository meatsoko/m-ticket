-- Vendors: no limit on registrations per phone number (2026-10-07, the user's
-- request — the same person can take several tents, and a number that has
-- already paid can register again). Drops the "one live registration per phone
-- per event" index from 20260930180000. Payments are unaffected: each
-- registration is paid and confirmed on its own, and a second payment for an
-- already-paid registration is still flagged for a refund.
drop index if exists public.vendor_applications_one_per_phone;
create index if not exists vendor_applications_phone_idx on public.vendor_applications (event_id, phone);
