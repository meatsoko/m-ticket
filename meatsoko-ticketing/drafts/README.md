# Drafts (not part of the app)

Parked work, kept for reference. Nothing here is built, linted or deployed.

- `celebrations.sql`, `celebrations/` — the "Celebrations / Lipa Mdogo Mdogo" sketch from
  `feat/events-v2-celebrations`, parked 2026-10-06 until the organiser supplies real
  packages, prices and payment rules. See the header of `celebrations.sql` for the security
  problems that must be fixed first (public read of all bookings, an unprotected payment
  function, enumerable booking numbers). The UI's booking button was a placeholder.

- **2026-10-07:** superseded by the real occasion booking (`/celebrations`, migration
  `20261007120000_celebration_requests.sql`, Edge Function `celebration-request`) —
  request and quote, no prices. Keep this sketch only as a reference for phase 2
  (packages, deposits, instalments).
