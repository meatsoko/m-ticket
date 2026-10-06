# MeatSoko — project context

Last updated: **2026-10-03**. Read with the repo-root `CLAUDE.md` (layout, safety rules,
what not to do) and `../HANDOFF.md` (setting up a new machine).

`main` is production: every push deploys `https://event.meatsokogroup.com` (Vercel).
Edge Functions and migrations deploy separately (see "Deploying"). Work on a branch,
build and test, then merge to `main` only when the user says to push.

## What the site is

A merchandise-first store plus an events module, for the MeatSoko Ecosystem brand.

| Area | Routes | Notes |
|---|---|---|
| Store | `/`, `/shop`, `/shop/[slug]`, `/cart`, `/checkout`, `/checkout/complete`, `/order/[token]`, `/returns` | Catalogue in `src/lib/merchandise.ts` (USD prices; `null` = "Price coming soon", not buyable). Paystack checkout is gated by `NEXT_PUBLIC_MERCH_PAYMENTS=on` in Vercel |
| Events | `/events` (line-up), `/e/[slug]`, `/ticket-terms` | Line-up = Up next (ticket card) · Coming soon (poster) · Past |
| Passes | `/r/[token]` (reservation), `/t/[token]` (paid ticket), `/lookup` (emails passes, never shows tokens) | Tokens are bearer credentials |
| Post-payment | `/upgrade/complete`, `/platters/complete`, `/vendor/complete` | Verify with Paystack on return |
| Online | `/watch/[code]` | Private YouTube watch page per registration |
| Investors | `/investors` | Landing page + registration form (dialog) |
| Event Orders | `/orders`, `/orders/new`, `/orders/[id]` (staff phones); `/r/[token]/order` (customer orders from their pass), `/receipt/[token]` (customer tracking + receipt) | See "Event Orders" |
| Staff | `/login`, `/reset-password`, `/dashboard/*`, `/scan`, `/gate` | No sign-up page, by design |
| Legacy | `/admin`, `/admin/events/[id]` | Redirect to the dashboard |

Stack: Next.js 14.2 (App Router) · React 18 · TypeScript · Supabase (Postgres + RLS, Deno
Edge Functions) · Paystack · Resend · Vercel (+ Vercel Analytics).

## Live events (2026-10-03)

- **NyamaFest Main** (`nyamafest-main`): **Sat 17 Oct 2026, 6:00 am → Sun 18 Oct 6:00 am**
  (Africa/Nairobi), Thika Greens Golf **Resort** (per the concept note), capacity 500; shown as
  "From 6:00 AM till late", dress code all white, hosted by MEATsoko Group (`events.time_note`,
  `dress_code`, `host`, migration `20261006120000`). Migration `20261002090000` set
  the hours (it was 5 pm; emails sent before 2026-10-02 say 5 pm).
  - **General Admission is free**; tables (Basic / Moderate / Big Family, each with a family
    platter) are paid upgrades of the same pass. `GetTicketsPanel` is two screens: choose
    (GA and Attend online side by side, tables below) → your details.
  - **Attend online**: free registration → private watch link (`online-register`,
    `online-access`). The YouTube stream ID is set in Event settings — **not set yet**.
  - **Platter add-ons** for in-person passes (`platter-addon`), up to 5 of each.
  - **Vendors**: "Become a vendor" in the event hero; KSh 3,500 tent fee via Paystack
    (`vendor-apply`; `VENDOR_FEE_KES` secret overrides it — keep it unset).
  - Early-bird platter prices end 2026-10-07; USD display prices are a fixed mapping in
    `src/lib/family-package-pricing.ts`; charges are KSh from `preorder_items`.
- **MEATSOKO Token Launch & Fintech Summit** (`meatsoko-token-summit`, MAIC): Sat 5 Dec
  2026, Nairobi — **Coming soon**, no registration, no time. `reservations_open_at =
  starts_at` keeps bookings closed; the event page hides booking and vendor sign-up; the
  homepage skips it; 00:00–23:59 displays as "Time to be announced". Poster:
  `/images/events/maic-token-summit-poster-2.jpg` (cropped).
- `nyamafest` (27 Sep) and `nyamafest-launch` (6 Sep) are closed.

## Investors (`/investors`)

- Investors' visit: **Friday 16 October 2026, Thika Greens Golf Resort**, time confirmed by
  email. Constants in `src/lib/investors.ts` and `supabase/functions/_shared/investor.ts`
  (keep in step).
- Landing (`InvestorsLanding.tsx`): dark-emerald hero with drifting glass bubbles (inspired
  by `assets/dealroom.mp4`; the user chose to keep only the bubbles), Wendy's video
  (event organiser, 53 s, filmed at Thika Greens — `public/videos/investors-wendy.mp4`,
  re-encoded to 5 MB; tap-to-play with sound, never autoplays), Why MeatSoko (no invented
  figures), The visit. Every register button opens `InvestorForm` in a dialog.
- Form: title (Mr/Mrs/Ms/Dr/Prof/Hon), name, occupation, email, 1–10 guest names — **all
  required**. `investor-register` never overwrites an existing registration for an email
  (re-sends the confirmation instead). Dashboard: Events & tickets → Investors.

## Event page Program + Concept tabs (branch `feat/events-v2-celebrations`, 2026-10-06 — not merged or deployed)

Migration `20261006100000_event_program_concept.sql`: `event_programs` (running order,
drafts until published) and `event_concepts` (one per event: core proposition, overview,
pillars, who it's for, objectives, vision), public read / admin write. NyamaFest Main's
concept is seeded from the organiser's concept note. Edited on the dashboard event page
("Event page content"); shown as Program / Concept tabs on `/e/[slug]` only when there is
content. The concept also has a measure of success and ways to take part. Site copy (event
details, Investors page) follows the organiser's **Nyama Fest Concept Note** (2026-10-05) —
`20261006120000_nyamafest_concept_details.sql` sets venue, tagline, time note, dress code,
host and the "what's inside" list. The Celebrations sketch from the same branch is parked in `drafts/` (not built)
until the organiser sends real packages, prices and payment rules.

## Event Orders (LIVE since 2026-10-03)

Staff take on-site orders on their phones; management tracks money and staff in
Dashboard → Events & tickets → Event orders. Migration `20261003100000_event_orders.sql`
(read its header first), Edge Function `event-order-receipt`.

- **Separate from `orders`** on purpose (that table is one ticket/reservation payment).
  `event_menu_items` (per-event on-site menu, admin-edited) · `event_orders` (cached
  totals + `order_status` open/fulfilled/cancelled/refunded and `payment_status`
  unpaid/partially_paid/paid/partially_refunded/refunded; number `<reservation_prefix>-0001`
  per event) · `event_order_items` (name + price snapshots) · `event_order_payments`
  (**append-only**: payment / refund / correction rows; triggers refuse UPDATE/DELETE).
- Writes only via SECURITY DEFINER functions that take the actor from `auth.uid()`:
  staff — `create_event_order`, `record_event_order_payment`, `fulfil_event_order` (only
  when fully paid; admin may override, audited); admin — `cancel_event_order`,
  `reverse_event_order_payment` (refund or correction). `staff_directory()` for names;
  `get_event_order_receipt(token)` service-role only. Everything logs to `admin_audit`.
- Payments are **recorded** by staff (cash, M-Pesa with its code — unique, card, other);
  no new payment provider. Paystack links, inventory, offline and kitchen flows are later.
- Accountability: `created_by` on the order, `recorded_by` on each payment (Mary can
  collect on John's order). Staff report = orders, value, payments, collected (less
  corrections), outstanding on their orders.
- **Customer ordering (same branch):** from their pass (`/r/<access_token>/order`; "Place an
  order" card on the pass and the booking confirmation). The pass is the identity — name and
  phone come from the booking, max 3 open orders per pass. Customers pick a staff member who is
  **Available** (`event_staff`: each staff member sets a first name and Available / Busy /
  Offline on `/orders`); the order is `requested` from them and must be accepted within 5
  minutes (released lazily — no scheduler) or it goes back to the customer to pick someone
  else or cancel. Staff can hold several orders; `/orders` tracks them by stage
  (`event_order_stage()`: incoming → pending → paid → closed, plus needs_staff / cancelled).
  No payments or hand-over before acceptance. Customer actions only via the `customer-order`
  Edge Function (service role, rate-limited); staff-taken orders are assigned to and
  accepted by the taker.
- `public/sw.js` v3: cache-first only for `/_next/static`, icons and the manifest. v2 cached
  every same-origin GET — including `?_rsc=` page data — so `router.refresh()` served stale
  screens on any phone that had opened the scanner.
- To go live: `supabase db push --linked`, `supabase functions deploy event-order-receipt
  customer-order`, merge to `main`, then an admin adds the menu in the dashboard and staff set
  themselves Available on `/orders`.

## Dashboard (`/dashboard`, store theme)

Overview · Orders · Inventory · Events & tickets (Create event, Tickets — activity, passes,
payments & refunds via `refund_event_order` — Event orders, Vendors, Investors) · Gate scanner (phones
only). Admin accounts (2026-10-03): `meatsoko247@gmail.com` (the user's), a demo admin
(`dem…@meatsokogroup.com`, **to delete**) and an `apn…@gmail.com` admin the user hasn't
identified. Staff password reset: "Forgot password?" on `/login` → `/reset-password`;
needs `https://event.meatsokogroup.com/reset-password` in Supabase Auth redirect URLs and
custom SMTP — confirm with the user that both are set.

## Design rules

- **Theme split — don't unify.** Mobile ticketing (event page on phones, `/r`, `/t`,
  scanner, gate, lookup, watch) keeps the brown "ember & char" theme with dark mode. The
  store, `/dashboard`, `/login`, `/investors` use the store theme (cream `#f6f3ed`, ink
  `#171717`, red `#d32f3b`). Store tokens come from the `.storefront` / `.dash` wrappers,
  never `:root`. The desktop event page (`.app.wide-event-shell`, ≥900px) forces light
  tokens. (User, 2026-09-30: "keep the brown theme in mobile ticketing".)
- Brand: `public/images/brand/meatsoko-logo-mark.png` (bars, headers/footer) and
  `meatsoko-logo.png` (with tagline, login). No "M" mark any more.
- Never invent prices, figures or claims. Unpriced merch stays "Price coming soon".
- Verify every UI change at desktop and 390px widths.

## Payments, email, money

- Paystack for everything (tickets `MT…`, merch `MS…`, vendors `MV…`). The account is
  shared with the WooCommerce store, which owns the only webhook — **don't move it**.
  Confirmation = buyer's return (`paystack-verify`, `merch-order`) + `paystack-reconcile`
  every 5 min (pg_cron). InlineJS popup when `NEXT_PUBLIC_PAYSTACK_POPUP=on`, else redirect.
- Daraja/M-Pesa STK is hidden unless `NEXT_PUBLIC_DARAJA_ENABLED=on` (Safaricom hasn't
  enabled M-Pesa Express).
- All email goes through `supabase/functions/_shared/resend.ts`. Money is stored in KSh;
  merch is priced in USD and charged in KES at `merch_fx_rates`.

## Deploying (in this order when a change spans them)

1. Migrations: `supabase migration list --linked`, then `supabase db push --linked` (forward
   only; every new SECURITY DEFINER function revokes EXECUTE from PUBLIC).
2. Edge Functions: `supabase functions deploy <name>` (each changed one, plus any that
   import a changed `_shared/` file).
3. Frontend: merge to `main` and push (Vercel, ~80 s). Then check the live page with curl.

Live data changes go in a migration (with a comment saying why), applied only with the
user's say-so. Use `supabase db query --linked "<sql>"` for read-only checks.

## Checking work

- `npm run lint`, `npx tsc --noEmit -p .`, and `npm run build` **in a temporary git
  worktree** (so the user's dev server isn't disturbed): `git worktree add --detach <dir>
  HEAD`, symlink `node_modules`, copy `.env`/`.env.local`, build, remove.
- Edge Functions: `deno check <fn>/index.ts` (or `docker run --rm -v
  $PWD/supabase/functions:/f -w /f denoland/deno:2.6.3 deno check <fn>/index.ts`).
- **Integration harness: `./tests/harness/run.sh`** (Docker) — fresh Postgres from
  `schema.sql` + migrations, real Edge Functions; expect `ok: 329 FAIL: 0`. Add checks
  for every new function or permission. See `tests/harness/README.md`.
- **No browser testing of site features** (user, 2026-10-06): don't click through pages in
  Chrome or a local dev server to verify them — use the checks above, then tell the user
  exactly what to test and where. The browser is for research only.

## Open items (2026-10-03)

- Delete test reservation `NF-23X5MW` (`0700000000`, still `confirmed`) — approved,
  `scripts/delete-test-reservation.sql`, needs the user's go-ahead to run.
- Delete the demo admin; identify the `apn…` admin.
- Set the YouTube stream ID for online attendance.
- `NEXT_PUBLIC_MERCH_PAYMENTS=on` + one small real merch purchase, if not done.
- Price (and add to the merch database) the Hustle Game 21 hoodie.
- Older docs (`LAUNCH_CHECKLIST.md`, `REMAINING_GAPS.md`, `REMAINING_WORK.md`) still
  describe the 27 Sep launch — rewrite or archive.
- `assets/*.mp4` are local originals, not committed.

## Useful files

| | |
|---|---|
| Store | `src/app/page.tsx`, `src/app/shop/`, `src/components/StoreChrome.tsx`, `src/components/store/`, `src/lib/merchandise.ts` |
| Event page & booking | `src/app/e/[slug]/page.tsx`, `src/components/GetTicketsPanel.tsx`, `TableUpgrade.tsx`, `PlatterAddons.tsx`, `VendorSignup.tsx`, `ReservationForm.tsx`, `EventCheckout.tsx` |
| Line-up | `src/app/events/page.tsx`, `src/components/EventTicket.tsx`, `src/lib/ticket-event.ts`, `src/lib/event-time.ts` (`nairobiTimeRange`) |
| Investors | `src/components/InvestorsLanding.tsx`, `InvestorForm.tsx`, `src/components/dashboard/InvestorsBoard.tsx` |
| Event Orders | `src/components/orders/*`, `src/lib/event-orders.ts`, `src/components/dashboard/EventOrdersBoard.tsx`, `supabase/migrations/20261003100000_event_orders.sql` |
| Dashboard | `src/app/dashboard/`, `src/components/dashboard/` |
| Styles | `src/app/globals.css` (one file; sections are commented) |
| Server | `supabase/functions/*`, `supabase/functions/_shared/*`, `supabase/migrations/*` |
| Docs | `TECHNICAL_DOCUMENTATION.md` (§13 traps: CORS/EarlyDrop, Edge auth), `ADMIN_ACCESS.md`, `INTAKE.md`, `DARAJA_PRODUCTION.md` |
