# Remaining work

Status captured **2026-09-27**. This is the working list of tasks that remain before
Paystack checkout is ready for a real transaction and the ticketing system is ready for
routine event operations. A fuller source and configuration audit is in progress; this
document will be updated with its findings and with a feature review of Ticketyetu.

## Payment setup and checkout verification

- [ ] Add `PAYSTACK_SECRET_KEY` as a Supabase Edge Function secret. The linked project
  currently has no such secret, so Paystack initialization returns a configuration
  error. Use the test key for sandbox checkout first; store the live key only when the
  account and merchant are ready for real payments.
- [ ] Configure Paystack's webhook URL as
  `https://tyirenanflcmwfywurvk.supabase.co/functions/v1/paystack-webhook` and verify
  Paystack delivers `charge.success` events.
- [ ] Complete a low-value end-to-end Paystack test for a ticket and a NyamaFest preorder:
  confirm the hosted checkout return, server-side verification, one-time order
  confirmation, ticket/reservation email, and admin status.
- [ ] Test cancelled, pending, repeated, wrong-amount, and delayed webhook/return cases.
- [ ] Confirm whether Paystack accepts the intended merchant account's KES transactions
  and the channels enabled for that account.

## Event and launch operations

- [ ] Create named staff accounts for each gate device and remove the demo admin account
  after confirming a real admin login.
- [ ] Complete a real phone camera scan and a manual guest-list admission before the
  next event; confirm duplicate scans and offline sync behave as expected.
- [ ] Review and remove the test reservation/pass documented in `REMAINING_GAPS.md` if
  it is still present.
- [ ] Add the event poster, final event copy, contact number, and organizer notification
  email; confirm the capacity and event dates with the organizer.
- [ ] Decide whether M-Pesa remains an active payment option and finish Safaricom
  production provisioning only if it will be offered.

## Audit and documentation work in progress

- [ ] Audit the implementation, database migrations, security boundaries, and deployment
  configuration; replace stale claims in the existing launch notes.
- [ ] Create official technical documentation for setup, architecture, data model,
  payment flows, security, deployment, and operations.
- [ ] Review Ticketyetu and add product improvements that fit this system to this list.

## Product improvements to assess

These are candidates, not committed roadmap items. Confirm value, scope, and operational
ownership before implementation.

- [ ] Add purchaser self-service ticket/reservation recovery, cancellation, and refund
  status with carefully scoped identity checks.
- [ ] Add a payment reconciliation view for unmatched, duplicate, flagged, refunded, and
  delayed Paystack/M-Pesa transactions.
- [ ] Add organizer notifications for paid preorders, failed payments, and refunds; make
  unavailable notification channels explicit in the interface.
- [ ] Improve shared-device and family booking handling so a repeated reservation cannot
  silently replace another guest's details.
- [ ] Add event discovery/search filters and clearer event availability, location, access,
  and refund information where organizers provide the data.
- [ ] Add automated checks for payment callbacks, webhook signatures, ticket issuance,
  capacity limits, authorization, scanning, and offline synchronization.

