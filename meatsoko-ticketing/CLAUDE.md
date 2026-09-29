# MeatSoko project handoff

Last updated: 2026-09-29  
Current branch: `main` (production — every push deploys)  
Merch storefront and platter flow merged via PRs #5–#7 (`e7f31c4`, 2026-09-28)

## Product direction

MeatSoko is becoming a merchandise-first site. The storefront is the main experience; the existing event and ticketing system remains an events module. Preserve the ticket purchase, reservation, payment, QR pass, and gate-scanning flows while changing storefront or event presentation.

The user wants the storefront to use a warm cream, black, and red visual system. Desktop event pages use a wider editorial layout; keep the established mobile ticketing experience intact.

## Stack and commands

- Next.js 14.2, React 18, TypeScript, App Router.
- Supabase for events, tickets, reservations, payments, and staff operations.
- `npm run dev` starts the local app.
- `npm run lint` runs Next lint.
- `npm run build` creates a production build.
- Supabase migrations are in `supabase/migrations/`; schema reference is `supabase/schema.sql`.

## Main routes

- `/` — merchandise-led storefront homepage.
- `/shop` — merchandise collections and product cards.
- `/cart` and `/checkout` — current merchandise flow scaffolding.
- `/events` — event listing; open events link into `/e/[slug]`.
- `/e/[slug]` — event detail and existing ticket or reservation checkout.
- `/t/[token]`, `/r/[token]`, `/lookup` — issued pass and reservation experiences.
- `/admin/events/[id]` — event management, ticket types, preorder items, reservation packages.
- `/gate` and `/scan` — event entry and scanning tools.

## Current merchandise work

- Catalog is front-end-only in `src/lib/merchandise.ts`; it currently has 15 items in Hoodies, Polos, T-shirts, and Headwear (caps and beanies).
- Product images are served from `public/images/merchandise/`. The originals are in `assets/`.
- Each product has one image, a style name, and a color. Prices are intentionally absent; do not invent or display prices until the user supplies them.
- Product order is deliberately varied so color variants do not line up in repetitive columns.
- `src/components/MerchandiseCard.tsx` provides the zoom-on-hover image and checkout link. On touch/mobile, the Checkout action stays visible.
- `/checkout?product=<image-filename>` resolves and displays the selected product. This is only a selection/checkout entry point: the merchandise cart, product options, price, inventory, delivery, and payment flow are not implemented yet.
- Homepage hero image is the green hoodie, blended into the cream background to give it a floating look. Campaign image is `public/images/campaign/nyamafest-poster.jpeg`.
- The upcoming-event card on `/` queries the nearest live event that has not ended and links directly to `/e/[slug]`. It falls back to `/events` if no matching event is found.

## Event and payment behavior to preserve

- Existing event ticket purchases remain backed by the existing ticket checkout flow. Reservation events use `ReservationForm` and reservation package data.
- `src/components/EarlyBirdCountdown.tsx` shows the early-bird timer in the event hero, replacing the generic Festival label. The countdown is no longer in the package picker.
- For NyamaFest family platters, `src/lib/family-package-pricing.ts` maps the user-specified USD presentation prices: Basic `$15 / $20`, Moderate `$35 / $40`, Big Family `$50 / $55`. It is a fixed display mapping, not runtime foreign-exchange conversion. Savings are shown as the USD difference (for example, “Save $5”).
- Actual reservations and payment amounts remain KSh from the stored `preorder_items` prices. Order/payment records remain normalized in KSh.
- `20260928100000_nyamafest_usd_display_prices.sql` contains the chosen KSh package values. `20260928130000_nyamafest_event_hours.sql` sets the `nyamafest-main` event to 5:00 PM through 6:00 AM the next day in `Africa/Nairobi`; the event page presents this as “5:00 PM till dawn.”
- Check whether migrations have been applied in the target Supabase project before attempting to apply or replay them. Do not modify live Supabase data or apply migrations without the user's authorization.

## Useful files

- Storefront structure and styling: `src/app/page.tsx`, `src/app/shop/page.tsx`, `src/app/globals.css`, `src/components/StoreChrome.tsx`.
- Product catalogue and cards: `src/lib/merchandise.ts`, `src/components/MerchandiseCard.tsx`.
- Event details and layout: `src/app/e/[slug]/page.tsx`, `src/app/events/page.tsx`, `src/components/AppShell.tsx`.
- Ticket checkout: `src/components/EventCheckout.tsx`.
- Reservation and platter checkout: `src/components/ReservationForm.tsx`.
- Admin and Supabase context: `TECHNICAL_DOCUMENTATION.md`, `FOLDER_GUIDE.md`, `ADMIN_ACCESS.md`, `INTAKE.md`, `REMAINING_GAPS.md`, `REMAINING_WORK.md`, and `LAUNCH_CHECKLIST.md`.

## Working guidance

- Keep merchandise catalog data separate from event-specific preorder items. Merchandise needs its own product, variant, inventory, cart, and checkout design when the user is ready to finalize those details.
- Keep mobile layouts intentionally compact and verify changes at both mobile and desktop widths.
- Avoid changing ticketing and reservation business logic as part of storefront work unless the user specifically asks.
- Preserve existing Supabase order snapshots and transaction values when updating presentation.
- Never put Supabase secrets or payment credentials in source control.
- Check the repository status before editing and stage only files relevant to the requested work; this repository can contain user-supplied image assets.
