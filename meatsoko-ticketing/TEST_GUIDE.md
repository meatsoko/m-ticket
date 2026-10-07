# Test guide — October 2026 changes

Site: https://event.meatsokogroup.com · Dashboard: https://event.meatsokogroup.com/dashboard

Test each section on a **phone** and on a **desktop**. Tick the box when the result matches;
note anything that doesn't (what you did, what you saw, device + browser).

## 0. Before you start

- [ ] The two pending database migrations are applied (`20261006100000_event_program_concept`,
      `20261006120000_nyamafest_concept_details`). **Sections 3–5 show nothing until they are.**
- [ ] `investor-register` is redeployed (so investor emails say "Thika Greens Golf Resort").
- [ ] You have three ways in: signed out (a visitor), a **staff** account, an **admin** account.
- [ ] On a phone that has used the gate scanner before, close and reopen the browser once
      (it picks up the updated offline helper).

## 1. Shop — top bar and phone navigation

| # | Do | Expect |
|---|----|--------|
| 1.1 | Open `/` on desktop and phone | No black "MEATSOKO · GOOD THINGS FOR GOOD GATHERINGS" bar above the menu |
| 1.2 | Phone: scroll any shop page to the bottom | No Home / Shop / Events / Bag bar fixed at the bottom; the footer is fully visible |
| 1.3 | Phone: tap ☰ | Menu shows Shop all merchandise, Partnerships, Collections, Events and tickets, Investors, Your bag — each link works |
| 1.4 | Homepage hero | Fills the screen below the header with no gap where the black bar was |

## 2. Event and ticket pages — visitor vs staff

| # | Do | Expect |
|---|----|--------|
| 2.1 | Signed out, phone: open `/events`, `/e/nyamafest-main`, a pass `/r/…` | **No bottom bar** |
| 2.2 | Same pages | Header shows a **My tickets** button (opens Find my pass); the MEATsoko logo opens the shop |
| 2.3 | Sign in as **staff** on a phone, open `/scan` | Bottom bar shows Event · Scan · Gate · Orders, plus the Staff badge and sign-out |
| 2.4 | Staff: tap each bottom tab | Each opens the right screen |

## 3. NyamaFest event page (needs the migrations)

| # | Do | Expect |
|---|----|--------|
| 3.1 | Open `/e/nyamafest-main` | Under the title: "Building the Next Generation of Kenya's Red-Meat Economy" and "Hosted by **MEATsoko Group**" |
| 3.2 | Hero pills and the details box | Venue **Thika Greens Golf Resort**; time **From 6:00 AM till late** |
| 3.3 | Details box (When / Where / Entry) | A **Dress code: All white** line |
| 3.4 | Overview "what's inside" chips | Nyama Choma & Live Grills · Technology & Innovation Showcases · Knowledge Exchange · Investment Matchmaking · Policy Dialogue · Deal-making |
| 3.5 | Tabs | **Concept** tab present; **Program** tab absent (no published items yet) |
| 3.6 | Concept tab | Core proposition, overview, six pillars (Celebrate … Deal-make), who it brings together, 10 objectives, vision, how success is measured, ways to take part |
| 3.7 | Phone in dark mode (if your phone uses it) | Concept text is readable |
| 3.8 | Homepage hero ticket card and `/events` "Up next" card | Time reads "From 6:00 AM till late" |

## 4. Dashboard — event details, Program and Concept (admin)

Dashboard → Events & tickets → **Manage events** → NyamaFest Main.

| # | Do | Expect |
|---|----|--------|
| 4.1 | Event settings | New fields: Hosted by, Time as shown, Dress code — filled with the values above |
| 4.2 | Change Dress code to "All white (no jeans)", save, reload the event page | New wording shows; change it back |
| 4.3 | Scroll to **Event page content → Program → Add item**: time "06:00", title "Gates open", leave Published unticked, save | Item listed as **Draft**; event page still has no Program tab |
| 4.4 | Click **Draft** to publish | Event page now shows a **Program** tab with the item |
| 4.5 | Add a second item; use ↑ ↓ | Order changes on the event page too |
| 4.6 | Delete… → Delete | Item removed |
| 4.7 | Concept: edit a pillar or objective, Save concept | "Saved" message; the event page updates |
| 4.8 | Sign in as **staff** and try `/dashboard` | Staff are sent to the scanner — they can't edit any of this |

## 5. Investors page

| # | Do | Expect |
|---|----|--------|
| 5.1 | Open `/investors` | Headline "Where the red-meat economy meets the next generation."; intro names MEATsoko Group and **Thika Greens Golf Resort** |
| 5.2 | "Why invest" | "Built for deals, not just a day out" + four cards: whole value chain · where investment is needed · matchmaking then deals · commitments followed up (3, 6, 12 months) |
| 5.3 | Wendy's video | Plays with sound when tapped; "Register your attendance" at the end |
| 5.4 | Register (use your own email + 1 guest) | Confirmation screen + email; email says Friday 16 October 2026 · **Thika Greens Golf Resort** |
| 5.5 | Dashboard → Investors | Your registration is listed; cancel it afterwards |

## 6. Event Orders (live since 3 October — not yet tried)

Setup (admin): Dashboard → Event orders → **Menu** → add 2–3 items with prices.

| # | Do | Expect |
|---|----|--------|
| 6.1 | Staff phone → **Orders** → set your name, tap **Available** | Status turns green |
| 6.2 | **+ New order**: customer, 2 items, part payment by cash | Receipt screen: order number, balance due |
| 6.3 | Second staff account: find the order, **Add payment** for the rest by M-Pesa (needs a code) | Paid; the payment shows under the second person's name |
| 6.4 | **Mark handed over** | Closed; can't take more payments |
| 6.5 | Visitor: open your own pass `/r/…` → **Place an order** → items → pick the available staff member → send | Tracking page "Sent to …, waiting" |
| 6.6 | Staff phone: Incoming → **Accept** | Customer page moves to "Accepted" within ~15 s |
| 6.7 | Record payment, hand over | Customer page: Paid → Handed over |
| 6.8 | Place another; staff **Decline** | Customer page offers other available staff or Cancel |
| 6.9 | Place another and wait 5 minutes without accepting | Released back to the customer |
| 6.10 | Dashboard → Event orders | Totals, staff on duty, staff report, Payments tab and search all match what you did |
| 6.11 | Clean up | Cancel or refund the test orders (Orders tab → open an order → Refund…/Cancel order…) |

## 7. Other recent changes

| # | Do | Expect |
|---|----|--------|
| 7.1 | `/events` | Up next = NyamaFest ticket card; Coming soon = summit poster (starts at "December 5th", no "Event poster" banner); both the same height on desktop |
| 7.2 | `/login` → Forgot password? | Reset email arrives (needs the Supabase redirect URL + SMTP set); link opens the new-password page |

## 8. /events hero (needs migration `20261007090000_event_hero` and this branch deployed)

| # | Do | Expect |
|---|----|--------|
| 8.1 | Desktop: open `/events` | A dark hero running the full window width (no side margins, flush under the header): faded **NYAMA** at the back, the poster (top part only — no "5 PM" line) tilted in the middle, **NyamaFest** written in red script across it |
| 8.2 | Same | Stickers #FreeEntry, #AllWhite, #ThikaGreens; a red turning **Get tickets** badge top right |
| 8.3 | Same | Left card: days to go + "From 6:00 AM till late"; centre: "Sat 17 Oct \| Thika Greens Golf Resort" and **LET'S FEAST, NETWORK & CELEBRATE**; right dark card "Don't miss out · Free entry · tables from $15" (or $20 after the early bird ends 7 Oct) |
| 8.4 | Click the badge and the right card | Both open `/e/nyamafest-main`; booking there is unchanged |
| 8.5 | Phone (390px) | Word, poster and script on top; date pill and headline under them; countdown and Get tickets cards side by side; no sideways scrolling |
| 8.6 | Scroll down slowly (Chrome/Safari 26) | The faded word sinks and fades; with "reduce motion" on, nothing moves |
| 8.7a | Desktop, any window width | The whole page runs edge to edge — header, hero and sections — with no grey margins at the sides and no sideways scroll |
| 8.7 | Below the hero: **Featured events** | Black band, "FEATURED EVENTS" heading, square photo cards: NyamaFest Main (red "Free entry"), the Summit ("Coming soon"), the two September NyamaFests ("Past event", with stand-in food photos). Each shows "Sat, 17 Oct • Thika Greens Golf Resort" and the name |
| 8.7b | Desktop: the ‹ › arrows; phone: swipe | Cards slide one at a time and snap; arrows grey out at either end |
| 8.7c | "View all" / "Show less" | Rail becomes a grid and back |
| 8.7d | Click NyamaFest Main or the Summit; try a past card | First two open their event pages; past cards do nothing |
| 8.7e | Below it: **the concept** (cream band) | "THE CONCEPT · NYAMAFEST", the big statement with "where the traditional red-meat economy meets the next generation." highlighted in red, a short excerpt ending in **Read more…**, the six pillars numbered 01–06, "Read the full concept →" |
| 8.7f | Click Read more… | `/e/nyamafest-main/concept`: the full concept as an article (proposition, overview, pillars, who, objectives, vision, success, take part), Get tickets and Back to events at the end; brown theme on phones |
| 8.8 | Dashboard → NyamaFest Main → Event settings → **Events page hero** | Change the word or headline, save, reload `/events` — it updates. Paste a transparent PNG URL into the cut-out field — it replaces the poster |

## 9. Celebrations — occasion booking (database + function live; pages need the push)

| # | Do | Expect |
|---|----|--------|
| 9.1 | Shop menu / ☰ / footer; then the "Plan a celebration" band at the bottom of `/events` | **No** Celebrations link in the shop navigation; the band opens `/celebrations` |
| 9.2 | `/celebrations` on phone and desktop | Dark "YOUR DAY, *our grill.*" hero, how-it-works (01–03), the form |
| 9.3 | Submit empty; then a date tomorrow; then "At our place" with no area | Field errors in place; "at least 2 days' notice"; "Tell us the area" |
| 9.4 | Send a real request (your own phone + email; a date next month) | Lands on your private page: "Request sent…", Received → We're in touch → Confirmed steps, no prices |
| 9.5 | Your inbox | "Your … request — MeatSoko (CB-…)" with a **See your request** button to the same page |
| 9.6 | Team inbox (after setting `CELEBRATIONS_NOTIFY_EMAIL`) | "New … request" with name, phone, date, guests, where |
| 9.7 | Dashboard → Events & tickets → **Celebrations** (staff or admin) | The request under New; **Update** → "We're in touch", a reply, an internal note → Save |
| 9.8 | Refresh your private page | Step 2 lit; the reply shows under "From the MeatSoko team"; the internal note does **not** |
| 9.9 | Private page → Cancel this request → Yes | Shows Cancelled; the dashboard shows it under Cancelled |

## 10. Events module clean-up (branch `feat/event-page-cleanup`)

| # | Do | Expect |
|---|----|--------|
| 10.1 | `/events`, below Featured events | **Program**: "How the 2 days run" — Day 1 · Investor & stakeholder evening (8 items, 4:00 PM → late) and Day 2 · NyamaFest Day (8 items, 7:00 AM → 8:00 PM closing); side by side on desktop, stacked on phones; Get tickets button |
| 10.2 | Bottom of `/events` | Dark band: "Got your own occasion?" + Plan a celebration, and the **Become a vendor** card beside it (stacked on phones). The vendor button opens the form (shows "Payment coming soon" while Paystack is paused) |
| 10.3 | Any Get tickets link (hero badge, Don't miss out card, Featured card, Program button) | `/e/nyamafest-main` shows only: "Get tickets" bar with ← back to Events, the date · venue, the name, the time and dress code, and the ticket panel. No hero image, facts box, tabs, share buttons or countdown |
| 10.4 | Book a free ticket there (phone + desktop) | Works exactly as before |
| 10.5 | Dashboard → event → Event settings | Lineup and Table plan fields are gone; everything else saves as before |

## 11. PayHero — Pay with M-Pesa (branch `feat/payhero`)

Before testing: apply the two PayHero migrations, deploy `payhero-pay`, `payhero-callback`,
`payhero-status`, `payhero-reconcile`, set the Supabase secrets (`PAYHERO_API_USERNAME`,
`PAYHERO_API_PASSWORD`, `PAYHERO_CHANNEL_ID`, `PAYHERO_PAYMENTS=on`) and
`NEXT_PUBLIC_PAYHERO_PAYMENTS=on` in Vercel. Use small real amounts (e.g. a test platter).

| # | Do | Expect |
|---|----|--------|
| 11.1 | Your pass `/r/…` → Upgrade to a Table → pick one | A green **Pay KSh … with M-Pesa** block with your number (while Paystack is paused, it's the only option) |
| 11.2 | Pay → enter PIN on the phone | "Check your phone" → then **Your table is booked**; the pass shows the table; updated pass emailed |
| 11.3 | Start again and cancel the prompt on the phone | "The M-Pesa payment wasn't completed… Nothing was charged"; ticket unchanged |
| 11.4 | Pass → Add platters → pay with M-Pesa | Page reloads with the platters on the pass |
| 11.5 | `/e/nyamafest-main` → choose a table → fill details → **Pay with M-Pesa** | "Free ticket booked · NF-…" then the M-Pesa step; after paying you land on your pass with the table |
| 11.6 | `/events` → Become a vendor → fill the form → Pay with M-Pesa | "Your tent is secured — VEN-…"; vendor email arrives |
| 11.7 | Shop → bag → checkout → Pay with M-Pesa (in KSh) | Prompt shows the KSh amount; after paying you land on `/order/…` as paid; bag emptied; emails sent |
| 11.8 | Close the page while the prompt is open, then pay | Within ~2 minutes the reconcile job confirms it; the email still arrives |
| 11.9 | Dashboard → Tickets | The upgrade / platter orders show as paid (receipt numbers are stored in the database; they aren't shown on the dashboard yet) |

## Report back

For anything that fails: section number, device and browser, what you expected, what you
saw (a screenshot helps).
