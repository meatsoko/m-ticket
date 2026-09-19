# MeatSoko Ticketing Platform — Software Requirements Specification

| | |
|---|---|
| **Version** | 1.0 (Approved for build) |
| **Date** | 2026-09-19 |
| **Author** | Tech Lead (requirements session with Founder/Dev) |
| **Status** | Baseline — changes after this point go through change control (a conversation) |

---

## 1. Introduction

### 1.1 Purpose
This SRS defines the requirements for a standalone web-based event ticketing platform built for MeatSoko's own events. It is the first module of a longer-term **Event Commerce** strategy (tickets → food pre-orders → booths/sponsorships) but deliberately scoped to a degraded, launchable v1.

### 1.2 Scope
**In scope (v1):**
- Public event pages with ticket selection and M-Pesa STK push checkout
- QR ticket generation and delivery (web page + wa.me prefilled WhatsApp message + optional email)
- Phone-number ticket lookup (buyer self-serve and gate fallback)
- PWA scanner for gate staff: online validation, offline cache, queued sync
- Gate Mode: walk-up STK sales at the gate with immediate admission
- Admin: event/ticket-type CRUD, sales dashboard, manual refund

**Explicitly out of scope (v1):**
- External organizers / self-serve event creation
- Named tickets, ticket transfers between buyers
- Seating maps, early-bird pricing tiers, promo codes
- Food entitlement scanning at stations (food remains plain commerce orders)
- Flutter app integration
- NestJS service layer (deferred until Event Commerce grows)
- Any integration with WordPress or the cPanel Laravel backend

### 1.3 Definitions
| Term | Meaning |
|---|---|
| STK push | M-Pesa Daraja "Lipa Na M-Pesa Online" payment prompt |
| Entitlement | What a ticket grants (v1: admission only, per ticket type) |
| Redemption | A recorded scan event that consumes an entitlement |
| Gate Mode | Scanner sub-mode for selling tickets to walk-ups at the gate |
| Outbox | Local on-device queue of offline scans awaiting sync |

### 1.4 System Context
```
Buyer ──web──▶ [Next.js PWA] ──▶ [Supabase: Postgres + Edge Functions + RLS]
                                   │
                                   ├──▶ M-Pesa Daraja (STK push + callback)  ← reused credentials
                                   ├──▶ wa.me (prefilled WhatsApp message — no API)
                                   └──▶ Email link (optional)
Gate staff / Admin ──web/PWA──▶ same system (authenticated roles)
```
The platform has **zero runtime dependency** on the existing cPanel/Laravel/WordPress infrastructure. The only shared asset is Daraja API credentials.

---

## 2. Overall Description

### 2.1 Product Perspective
Standalone greenfield system on the new stack: **Next.js + Supabase (Postgres, Auth, Edge Functions) + Vercel**. Designed so that event format (festival vs conference+expo) is data, not code.

### 2.2 Users and Roles
| Role | Auth | Capabilities |
|---|---|---|
| Public buyer | None (phone number only) | View event, buy tickets, view own tickets via phone lookup |
| Gate staff | Supabase account (email) | Scan tickets, redeem, Gate Mode sales, phone lookup |
| Admin | Supabase account (elevated role) | Everything gate staff can do, plus event/ticket CRUD, refunds, sales export |

### 2.3 Constraints
- Solo developer, ~2 weeks to Event 1 (600 attendees, festival format, single venue, single gate)
- Internet at venue rated 50/50 → scanner must degrade gracefully offline; gate staff fall back to mobile data
- Payments: M-Pesa STK push only; no card, no cash in the system (cash walk-ups are handled outside the system — see 2.4)
- Target environment: staff use their own Android phones (Chrome); buyers use any smartphone browser

### 2.4 Assumptions and Dependencies
- **A1:** Daraja production credentials (shortcode, consumer key/secret, passkey) are reused from the existing integration. The STK client is **reimplemented** in an Edge Function; the callback URL for this system points to the new endpoint. Both systems can share the shortcode concurrently because each STK request carries its own callback URL.
- **A2:** The Daraja callback endpoint must be publicly reachable HTTPS (Vercel custom domain). Sandbox testing precedes production cutover.
- **A3:** WhatsApp delivery = `wa.me` prefilled-message link containing the ticket URL. No WhatsApp Business API.
- **A4:** Family bundle ticket = **one QR code**; the whole party enters together. Acceptable at single-gate scale; revisit for Event 2 (2,000 attendees).
- **A5:** Cash walk-up buyers are admitted outside the system (staff discretion/manual list). The system handles STK-paying walk-ups only.
- **A6:** No attendee data-consent tick in v1 (noted; must be revisited before scaling — Kenya Data Protection Act).

---

## 3. Data Model (logical)

```
events
  id uuid pk
  name text
  format text                 -- 'festival' | 'conference_expo' (enum)
  description text
  venue text
  starts_at timestamptz
  ends_at timestamptz
  banner_url text
  status text                 -- 'draft' | 'live' | 'closed' (enum)
  created_at timestamptz

ticket_types
  id uuid pk
  event_id uuid fk → events
  name text                   -- 'Regular' | 'VIP' | 'Family'
  price_kes numeric(10,2)
  quantity_cap int            -- null = unlimited
  bundle_qty int default 1    -- Family = 4 (one QR, 4 admissions)
  position int                -- display order
  is_active bool

orders
  id uuid pk
  event_id uuid fk
  buyer_phone text            -- normalized 2547XXXXXXXX
  buyer_email text null
  channel text                -- 'web' | 'gate' (enum)
  amount_kes numeric(10,2)
  status text                 -- 'pending' | 'paid' | 'failed' | 'refunded' (enum)
  mpesa_checkout_request_id text unique   -- Daraja correlation id
  mpesa_receipt text null
  created_at timestamptz
  paid_at timestamptz null
  -- constraint: exactly one paid order per checkout_request_id (idempotency)

tickets
  id uuid pk
  order_id uuid fk → orders
  ticket_type_id uuid fk
  qr_token text unique        -- 128-bit random, URL-safe, non-sequential
  status text                 -- 'active' | 'redeemed' | 'refunded' (enum)
  redeemed_at timestamptz null
  created_at timestamptz

redemptions                  -- append-only scan log
  id uuid pk
  ticket_id uuid fk
  redemption_type text        -- 'entry' (v1 always 'entry')
  station text                -- device/staff label, e.g. 'gate-1-phone-of-jane'
  scanned_by uuid fk → auth.users
  scanned_at timestamptz
  synced bool default true    -- false while sitting in offline outbox
  -- unique constraint: (ticket_id, redemption_type)  ← duplicate protection,
  --    enforced server-side; offline sync relies on this on insert

admin_users                  -- role mapping over Supabase auth
  user_id uuid pk → auth.users
  role text                   -- 'staff' | 'admin' (enum)
```

**Rules enforced in DB (not app logic):**
- R1: A ticket can only exist for a `paid` order (enforced by creation flow in Edge Function).
- R2: Redeeming an already-redeemed/refunded ticket is rejected by the unique constraint on `redemptions` + ticket status check.
- R3: Ticket sales cap: `count(tickets where type=X and status != 'refunded') <= quantity_cap` checked transactionally at payment confirmation.

---

## 4. Functional Requirements

### 4.1 Event & Catalog (FR-E)
- **FR-E1** The system shall display a public event page for any event with `status='live'`, showing name, format-specific layout basics, description, venue, date/time, banner, and available ticket types with price, bundle size, and remaining availability (cap minus sold; "Sold out" when cap reached).
- **FR-E2** The system shall support multiple ticket types per event, each with independent price, cap, and bundle quantity (default 1).
- **FR-E3** Events and ticket types shall be manageable through the admin UI; changes to a `live` event's prices/caps take effect immediately for new purchases.

### 4.2 Checkout & Payment (FR-P)
- **FR-P1** A buyer shall select ticket types and quantities, then enter their M-Pesa phone number (and optionally email), and initiate payment.
- **FR-P2** On initiation the system shall create an `orders` row in `pending` state with a unique Daraja `checkout_request_id`, then trigger the STK push to the buyer's phone.
- **FR-P3** The buyer shall see a pending-payment state with a countdown (default 90s) and the system shall poll order status; on `paid` the system shall show the confirmation page with ticket QR(s) and delivery options.
- **FR-P4** The Daraja callback handler shall be **idempotent**: duplicate callbacks for the same `checkout_request_id` shall result in a single state transition (unique constraint; handler catches conflict and returns success).
- **FR-P5** On confirmed payment the system shall, transactionally: mark order `paid`, store the M-Pesa receipt number, create the ticket(s), enforce ticket-type caps (reject and flag if exceeded), and generate QR token(s).
- **FR-P6** If the STK push fails, times out, or is cancelled by the user, the order shall transition to `failed` and the buyer shall be offered a retry (new STK push reusing the same order row with a new checkout_request_id).
- **FR-P7** The booking price shall be all-in (payment fees absorbed into ticket price); no fee line item is shown.

### 4.3 Ticketing & Delivery (FR-T)
- **FR-T1** Each admission ticket shall carry a unique, non-guessable QR token (128-bit random). QR encodes a URL: `https://<domain>/t/<qr_token>`.
- **FR-T2** The confirmation page shall display all QRs for the order and provide: (a) a **wa.me prefilled-message link** the buyer taps to forward tickets via WhatsApp (message contains the ticket URL), and (b) an optional email containing the same link if an email was provided.
- **FR-T3** The system shall provide a public **phone lookup** page: enter the purchase phone number → receive a one-time view of that order's active tickets (see FR-L). No account creation required.

### 4.4 Scanner (FR-S)
- **FR-S1** Authenticated staff shall open the scanner, which requests camera permission and scans QR codes (or accepts manual token entry as fallback).
- **FR-S2** Online scan flow: look up token → render one of: ✅ Valid — admit (and record redemption) / ❌ Already redeemed (show first redemption time) / ❌ Refunded / ❌ Unknown or invalid token.
- **FR-S3** On first valid scan, the system shall record an `entry` redemption transactionally and mark the ticket `redeemed`.
- **FR-S4** The scanner shall support an **offline mode**: on a successful online load, it caches the full list of valid tokens and current redemption state for the event (service worker + IndexedDB). Offline scans validate against the cache and write redemptions to a local outbox.
- **FR-S5** The outbox shall sync automatically when connectivity returns; server-side unique constraint (R2) guarantees that a ticket redeemed offline cannot be double-redeemed, even if another scan of the same code occurs first.
- **FR-S6** The scanner UI shall show a prominent online/offline indicator and unsynced-count badge.
- **FR-S7** Scan results shall be rendered large and color-coded (green/red full-screen flash), suitable for use in daylight at a gate by a single operator.

### 4.5 Gate Mode — Walk-up Sales (FR-G)
- **FR-G1** Staff shall be able to switch the scanner into Gate Mode: select ticket type and quantity, enter the walk-up buyer's phone number, and initiate an STK push.
- **FR-G2** On payment confirmation, Gate Mode shall create the order + ticket(s) directly in `redeemed` state (buyer is at the gate), record an `entry` redemption, and display "Admitted" with the sale summary.
- **FR-G3** Gate Mode sales shall be recorded with `channel='gate'` for reporting.
- **FR-G4** While a Gate Mode payment is pending, the staff device shall remain usable for scanning prebooked tickets (per FR-S) — pending sales do not block the gate.

### 4.6 Lookup (FR-L)
- **FR-L1** The public lookup page shall accept a phone number and return that phone's **active, unredeemed** tickets for the live event (token links + QR display), without requiring authentication.
- **FR-L2** Lookup responses shall not expose redeemed/refunded historical tickets (privacy: no attendance history to arbitrary phone-number holders).
- **FR-L3** Staff scanner shall include the same lookup by phone as a fallback for buyers who cannot produce their QR (staff verifies identity in person).

### 4.7 Admin (FR-A)
- **FR-A1** Admin shall create/edit events (all fields in §3) and ticket types, and transition event status (draft → live → closed). A `closed` event disables purchase and scanning.
- **FR-A2** Admin dashboard shall show, per event: tickets sold by type, revenue (KES), web vs gate split, check-in count, and pending-failed payment counts, refreshed in near-real-time.
- **FR-A3** Admin shall manually refund an order: sets order `refunded`, tickets `refunded`, and records the action (actor + timestamp + reason). Actual M-Pesa reversal is performed outside the system; the admin records the reversal reference.
- **FR-A4** Admin shall export attendee/ticket data as CSV (tickets, buyer phone, type, status, redemption time). Export is mandatory before event day as the paper fallback.

---

## 5. Key Flows

### 5.1 Purchase (happy path)
1. Buyer selects tickets → enters phone → STK initiated (order `pending`).
2. Buyer enters M-Pesa PIN on phone.
3. Daraja callback → handler validates, transitions order → `paid` (idempotent, FR-P4).
4. Edge Function (or DB trigger) creates tickets + QR tokens transactionally (FR-P5).
5. Buyer (polling or on reload) sees confirmation with QRs, wa.me link, email option.

### 5.2 Gate admission (prebooked)
1. Staff scans QR → online: server validates and records redemption (R2) → green flash.
2. If offline: cache check → green flash, redemption queued in outbox (FR-S4/S5).
3. Repeat scan (same or another device): red "Already redeemed" with first-scan timestamp.

### 5.3 Walk-up sale
1. Staff: Gate Mode → type + buyer phone → STK push.
2. Buyer enters PIN; callback confirms → order + ticket created already `redeemed` → "Admitted."

### 5.4 Failure modes (must all be handled + tested, Days 11–12 drills)
| Failure | Expected behavior |
|---|---|
| Duplicate Daraja callback | Single transition; second call acknowledged, no dup tickets |
| STK timeout/cancel | Order `failed`; retry offered; no tickets exist |
| Callback arrives before UI polls | UI reads final state on next poll; no inconsistency |
| Offline scan of refunded ticket | Cache staleness window accepted (documented); sync reconciles; staff sees note |
| Ticket cap exceeded at confirmation | Payment confirmed but no ticket → flagged order; admin resolves manually (alert on dashboard) |

---

## 6. Non-Functional Requirements

- **NFR-1 Availability:** No dependency on cPanel/Laravel/WordPress. If all legacy infrastructure is down, ticketing functions fully.
- **NFR-2 Performance:** scan→result < 2s online; STK initiation < 5s; event page < 3s on 3G.
- **NFR-3 Capacity:** support 2,000 attendees and ~1,500 prebooked orders without architectural change; Event 2 may add a second gate device with no schema change (station label distinguishes devices).
- **NFR-4 Security:** QR tokens are 128-bit random, unguessable, non-sequential; scanner/admin require authenticated Supabase sessions; RLS denies public access to `redemptions`, orders, and admin tables; all admin mutations logged.
- **NFR-5 Privacy:** lookup exposes only active tickets for the entered phone; no public enumeration of tokens (rate-limit lookup by phone).
- **NFR-6 Durability/backup:** Supabase PITR on; CSV export of tickets taken before each event day (operational requirement FR-A4).
- **NFR-7 Deployability:** Vercel + Supabase; preview deployments per branch; production on a dedicated subdomain (e.g., `tickets.meatsoko...`).

---

## 7. Acceptance Criteria (summary)

1. A buyer can complete purchase end-to-end on a 3G Android phone in < 3 minutes, receiving QR + wa.me link.
2. Staff can scan, admit, and see duplicate-scan rejection using two different phones against one ticket.
3. With the device in airplane mode after a synced load: a valid ticket admits (queued), a duplicate gets rejected from cache, and both redemptions appear server-side after reconnect with no duplicates.
4. Gate Mode completes a walk-up sale and the buyer is admitted, sale recorded as `gate`.
5. Duplicate Daraja callback (simulated) produces exactly one paid order and one ticket set.
6. Admin can create an event, set ticket types/caps, see sales update live, refund an order, and export CSV.
7. Phone lookup returns only that phone's active tickets.
8. With legacy infrastructure (cPanel/WordPress) entirely unreachable, all of the above still pass.

---

## 8. Risks & Mitigations

| Risk | Level | Mitigation |
|---|---|---|
| Daraja production credential/access delay | **High** | Verify access Day 1; sandbox fallback for development |
| STK latency at gate (walk-up queue) | Medium | FR-G4 non-blocking design; staff admit prebooked while pending; pre-event load test of callback path |
| Offline cache staleness (refund during outage) | Low (single gate) | Accepted window; sync reconciliation; paper CSV as last resort |
| Solo-dev bandwidth overrun | High | Strict deferral list (§1.2); Day 14 buffer; degraded launch accepted by stakeholder |
| Supabase/Vercel outage on event day | Low | CSV export fallback (FR-A4); gate proceeds on paper list + mobile data |

---

## 9. Build Traceability (2-week plan)

| Days | FRs delivered |
|---|---|
| 1–2 | Daraja access verified; schema (§3); STK push + callback path (FR-P2, P4) |
| 3–5 | FR-E1–E3, FR-P1–P7, FR-T1–T2 (event page, checkout, confirmation, delivery) |
| 6–8 | FR-S1–S7, FR-L1–L3 (scanner PWA, offline, lookup) |
| 9–10 | FR-G1–G4, FR-A1–A4 (gate mode, admin) |
| 11–12 | §5.4 failure drills; load test callback; security pass (RLS audit) |
| 13 | Production deploy, staff training, venue dry-run with real phones |
| 14 | Buffer / defect fixes only |

---

## 10. Deferred Requirements (post-Event-1 backlog, not in this baseline)
Named tickets & transfers · early-bird tiers/promo codes · food entitlement scanning at stations · vendor dashboards · multi-gate offline conflict handling · Flutter in-app tickets · external organizer accounts · seating maps · NestJS extraction · consent tick + DPA review · cash walk-up recording
