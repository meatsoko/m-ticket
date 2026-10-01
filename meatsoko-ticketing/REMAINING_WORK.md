# Remaining work

**Reviewed: 2026-09-27.** This is the current prioritized work list for production readiness and product improvements. The project audit and Ticketyetu public-site review are recorded in [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md), section 12.

## P0 — resolve before accepting real ticket payments

- [ ] **Close the ticket QR exposure in `order-status`.** The public endpoint accepts an M-Pesa `checkoutRequestId` and returns QR tokens for a paid order. Do not return bearer tokens from checkout-ID polling; use an unguessable, scoped order access token or require buyer verification, and keep polling responses to payment status. Review existing `order-status` callers before changing its contract.
- [ ] **Configure Paystack.** Add the correct sandbox `PAYSTACK_SECRET_KEY` to Supabase function secrets; configure the Paystack webhook URL at `https://tyirenanflcmwfywurvk.supabase.co/functions/v1/paystack-webhook`; verify webhook delivery and signature verification. The live project had no Paystack key at review time, so a transaction cannot initialize yet.
- [ ] **Run controlled end-to-end payment checks** for a ticket and a preorder: hosted checkout, verification, webhook retry, idempotent issuance, email, admin status, and cancellation/pending/wrong-amount/delayed cases. Do this only after the key and merchant KES settings are ready.
- [ ] **Confirm payment-provider production settings.** Check the merchant's KES currency and available Paystack channels. Decide if M-Pesa is enabled; if so, complete the Safaricom production provisioning in `DARAJA_PRODUCTION.md`.

## P1 — event and gate operations

- [ ] Create named staff accounts per gate device, validate the real admin login, then remove the demo admin account and credentials.
- [ ] Before the event, run a supervised camera scan, manual guest-list admission, duplicate scan, offline scan, and queued sync on the actual gate devices.
- [ ] Verify the current NyamaFest data: correct event date/capacity, poster and copy, event contact, organizer notification email, preorder items/prices, and the existence or removal of the documented test reservation.
- [ ] Set up and validate a real notification provider for WhatsApp if that option remains visible; currently a `WHATSAPP_WEBHOOK_URL` and provider integration are not configured. Prefer a verified email destination until WhatsApp delivery is implemented.
- [ ] Reconcile `supabase/schema.sql` with ordered migrations. The schema snapshot is not an accurate fresh-project bootstrap for current reservation/preorder and Paystack behavior; use migrations as the deployment source of truth until reconciled.
- [ ] Replace or clearly archive stale state in `LAUNCH_CHECKLIST.md`, `REMAINING_GAPS.md`, and `DARAJA_PRODUCTION.md`; some describe payments as disabled/M-Pesa-only and omit reservation and Paystack functions.
- [ ] Fix the scanner cache metadata: `sync-tokens` can filter by `event_id`, but the scanner currently makes an unfiltered request and stores the cache under the literal event id `live`. Return/store the actual event scope and require the scanner to select it.

## P2 — resilience, support, and product improvements

These are recommendations from a review of Ticketyetu's public pages, not claims about private platform behavior. See source links and scope in the technical documentation.

- [ ] Provide a buyer help and payment-recovery path for “charged but no ticket”, including transaction reference, order status, and escalation details; make `/lookup` recovery available from confirmation and event pages.
- [ ] Add an operations reconciliation screen for pending, failed, flagged, refunded, duplicated, and delayed Paystack/M-Pesa payments, with auditable manual resolution.
- [ ] Publish event refund/cancellation policy and provide a traceable refund-request/status flow; preserve payment, actor, reason, and gateway references in the audit log.
- [ ] Add organizer-managed event FAQs, venue directions/map, lineup, gallery, and contact details, with a polished event detail page that clearly communicates date, location, availability, inclusions, and restrictions.
- [ ] Improve event discovery with city/date/category filters, featured and trending events, and related events; test these against the current events volume and actual user needs.
- [ ] Assess assigned seating and table/seat maps, including inventory locking and payment-time seat expiry, for events that need reserved seating. Current inventory is ticket/preorder types and bundles, not seat assignment.
- [ ] Assess organizer self-service onboarding, dashboard, sales reporting, and scoped staff management. Current administration is platform-managed, not a self-service organizer portal.
- [ ] Improve family/group purchase management and controlled attendee-detail changes; keep transfer history and authorization/audit evidence.
- [ ] Add optional buyer newsletter/event updates with separate, explicit consent.
- [ ] Add automated checks for payment provider verification and webhook signatures, duplicate callbacks, inventory/capacity races, role boundaries, ticket recovery, scanner behavior, offline queue reconciliation, and refunds.

## Completed at this review

- [x] Initial remaining-work list pushed in commit `62c448d`.
- [x] Audited the application routes, Edge Functions, payment code, migration inventory, scanner/offline paths, and live database policies.
- [x] Created the official technical reference in `TECHNICAL_DOCUMENTATION.md`.
- [x] Reviewed Ticketyetu public discovery, event-detail, contact/help, terms, and privacy pages and captured feature opportunities above.
- [x] Enabled payments for NyamaFest, confirmed active preorder inventory, applied the Paystack migration, and deployed the related Edge Functions (see technical documentation for exact boundary and remaining configuration).
