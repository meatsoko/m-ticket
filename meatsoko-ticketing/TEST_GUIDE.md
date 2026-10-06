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

## Report back

For anything that fails: section number, device and browser, what you expected, what you
saw (a screenshot helps).
