# Intake — what the system needs from you

Everything that has to be **decided, gathered or requested** before MeatSoko Ticketing
can sell a real ticket. Constraints here are the ones actually enforced in the code and
the database, not guidelines — anything marked **hard limit** will be rejected at runtime.

Work top to bottom. Section C (Daraja) has a lead time measured in days because a human
at Safaricom has to approve it, so start that one first.

There is a blank fill-in template at the end you can copy and send back.

---

## A. Event details

One row in `events`. Set at creation in `/admin`; a few fields have no edit UI yet — see
the warning under the table.

| Field | Required | Example | Notes & limits |
|---|---|---|---|
| `name` | yes | `MeatSoko Expo 2026` | Appears in the page title, the QR page, and the M-Pesa prompt. See the M-Pesa truncation note below. |
| `slug` | auto | `meatsoko-expo-2026-m1x8k2` | The public URL is `/e/<slug>`. **Auto-generated** from the name plus a timestamp suffix, and **unique**. If you want a clean URL (`/e/expo2026`) for posters, say so — it currently needs a SQL edit. |
| `format` | yes | `conference_expo` | `festival` or `conference_expo`. **Hard limit** — these are the only two values. An expo shows the "What's inside" strip; a festival doesn't. |
| `venue` | yes | `Sarit Expo Centre, Westlands` | Free text, shown on the hero and in the ticket. Write it as you'd want it read on a phone at a junction — include the area, not just the building. |
| `starts_at` | yes | `2026-10-27 10:00` **EAT** | Entered as local time, stored UTC. Double-check after saving: the current live event reads `07:00Z`, which is **10:00 EAT**. |
| `ends_at` | yes | `2026-10-27 18:00` **EAT** | ⚠️ The create form currently copies `starts_at` into `ends_at`, so every new event has a zero-length window until corrected. Give both times explicitly. |
| `description` | yes | see below | Doubles as the zones list — see next row. |
| `banner_url` | recommended | `https://…/expo-hero.jpg` | See §F. Without it the hero falls back to a gradient. There is **no upload UI**; the URL is set directly. |
| `status` | — | `draft` → `live` → `closed` | Keep `draft` until everything else is done. `closed` disables both purchase and scanning. |

### The description field does two jobs

If the description **contains `|`**, it is split into the "What's inside" chips on the
event page. If it contains no `|`, it renders as a plain paragraph.

```
Butchery & Cuts | Grills & Smokehouse | Suppliers | Tastings | Talks
```
→ five chips.

```
A one-day trade expo for Kenya's meat industry.
```
→ one paragraph.

You cannot currently have both. Pick chips for an expo — they answer the question a trade
visitor actually has.

> **No edit UI yet.** Description, venue, dates and banner can be set at creation but not
> changed afterwards through the admin screens. Get them right first time, or expect a SQL
> edit. This is a known gap.

---

## B. Ticket types

One row per type in `ticket_types`. At least one is required. Order on the page follows
`position`.

| Field | Required | Example | Notes & limits |
|---|---|---|---|
| `name` | yes | `Trade Buyer` | Shown on the card, the QR page and the CSV export. |
| `price_kes` | yes | `1000` | **Hard limit:** must be ≥ 0 in the database, and the final order total must be **≥ KSh 1 and a whole number** — Daraja rejects fractions, and the amount is rounded before it is sent *and* before it is compared to the callback. **Use whole shillings.** Fees are absorbed into the price; no fee line is shown (FR-P7). |
| `quantity_cap` | optional | `500` | Blank = unlimited. **Hard limit:** must be > 0 if set. Counts **admissions, not orders** — see the bundle note. |
| `bundle_qty` | yes | `1`, or `4` for Family | **Hard limit:** must be > 0. One QR code admits this many people, together, once. A Family ticket with `bundle_qty = 4` consumes **4** of the cap. |
| `position` | yes | `0`, `1`, `2` | Display order, ascending. |
| `is_active` | yes | `true` | `false` hides it from sale. There's no UI to toggle this yet. |

**Per-order limit:** a buyer may take **1–20 of any one type** in a single order (hard
limit, enforced in the database and clamped in the function).

### Worked example for a meat expo

| position | name | price_kes | quantity_cap | bundle_qty | admissions if sold out |
|---|---|---|---|---|---|
| 0 | General Entry | 500 | 400 | 1 | 400 |
| 1 | Trade Buyer | 1500 | 150 | 1 | 150 |
| 2 | Family (4) | 1800 | 200 | 4 | 200 (= 50 tickets) |
| 3 | VIP Tasting | 3500 | 40 | 1 | 40 |

Note row 2: the cap is **200 admissions**, which is **50 Family tickets**. Setting
`quantity_cap = 200` with `bundle_qty = 4` does *not* mean 200 family tickets. Decide caps
in people, not in tickets.

**Total venue capacity is the sum of that last column** — 790 here. Make sure it matches
what the venue and your safety plan allow.

---

## C. Daraja production credentials — start this first

Requested from Safaricom on the developer portal. There is a human approval step, so lead
time is days, not minutes. This is the single highest-risk dependency in the SRS.

| Secret | Example / format | Notes |
|---|---|---|
| `DARAJA_ENV` | `production` | **Hard limit:** only `sandbox` or `production`. Anything else now fails loudly instead of silently. |
| `DARAJA_CONSUMER_KEY` | ~48 chars | From the **production** app. Different from your sandbox key — carrying the sandbox pair over is the most common cutover mistake. |
| `DARAJA_CONSUMER_SECRET` | ~64 chars | As above. |
| `DARAJA_SHORTCODE` | `123456` | Your real paybill or till. Replaces the sandbox `174379`. |
| `DARAJA_PASSKEY` | 64 hex chars | The Lipa Na M-Pesa Online passkey issued **with that shortcode**. |
| `DARAJA_TRANSACTION_TYPE` | `CustomerPayBillOnline` | ⚠️ **A till number needs `CustomerBuyGoodsOnline`.** Wrong value = every push rejected. Confirm which you have. |
| `DARAJA_CALLBACK_URL` | `https://<ref>.supabase.co/functions/v1/daraja-callback` | Stays on **Supabase**, not your web domain — the Edge Function is the receiver. Must be public HTTPS. |

### ⚠️ Send these without trailing whitespace

A newline on `DARAJA_PASSKEY` produces a misleading *"Wrong credentials"*. A newline on
`DARAJA_CALLBACK_URL` makes Safaricom's WAF swallow the STK request and never reply —
which presents as the app hanging forever with no error. This cost two days to find.

The code now trims and warns, so it can't break you again, but set them cleanly:

```bash
supabase secrets set DARAJA_PASSKEY="$(printf %s "$PASSKEY")"
supabase secrets list      # lengths must match your source exactly — no +1, no +2
```

If you're sending credentials by message, paste them **inside backticks** so trailing
spaces are visible, and never paste them into this file.

### What the buyer sees in the M-Pesa prompt

Two fields are derived automatically and **truncated hard**:

- **Account reference** — first 12 characters of the order id, uppercased.
- **Transaction description** — `"<event name> ticket"`, non-alphanumerics stripped,
  **cut to 13 characters**. `MeatSoko Expo 2026` becomes `MeatSoko Expo`.

If you want specific wording on the M-Pesa statement, tell me and I'll make it a field.

---

## D. Application & infrastructure

| Variable | Where it goes | Example |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | `eyJhbGciOi…` (anon key, **not** service role) |
| `NEXT_PUBLIC_APP_URL` | Vercel | `https://tickets.meatsoko.co.ke` |
| `APP_URL` | Supabase secret | Same value — Edge Functions cannot read `NEXT_PUBLIC_*` |
| `RESEND_API_KEY` | Supabase secret | Optional; blank = email off |
| `TICKET_EMAIL_FROM` | Supabase secret | Optional; domain must be verified with Resend |

**`NEXT_PUBLIC_APP_URL` is baked into every QR code and WhatsApp link.** Get it wrong and
tickets you have already sold point somewhere useless. It must be the final public domain,
never a `*.vercel.app` preview.

What I need from you: **the production domain** (e.g. `tickets.meatsoko.co.ke`) and
confirmation that DNS is pointed at Vercel. HTTPS is required — the scanner's camera will
not start without a secure context.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are
injected automatically. The prefix is reserved and the CLI refuses them — don't send these.

---

## E. Staff accounts

**There are currently zero accounts, so nobody can open the scanner, Gate Mode or admin.**

For each person, I need:

| Field | Example | Notes |
|---|---|---|
| Email | `jane@meatsoko.co.ke` | The login. Real addresses — password resets go here. |
| Role | `staff` or `admin` | `staff` = scan + gate sales. `admin` = that plus events, dashboard, refunds, CSV export. |
| Device / station | `gate-1-jane` | Labels the redemption log so you can tell who admitted whom. |

**One account per device, not one shared login.** The `scanned_by` and `station` fields in
the redemption log are only worth having if they identify a person. Plan to rotate
passwords after the event — in practice a shared credential ends up in a WhatsApp group.

Suggested minimum for a single-gate event: **2 staff** (one scanning, one on Gate Mode)
and **1 admin**.

---

## F. Brand assets

| Asset | Spec | Notes |
|---|---|---|
| Event banner | 1200×800 or wider, landscape, **under 200 KB** | Fills the hero behind a dark scrim, so **don't put text in the image** — it will be covered. Faces and grills near the top third work best; the bottom is overlaid by the title. |
| App icons | replace `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Currently a generated ticket mark. Optional — send a square logo and I'll regenerate. |
| Brand colours | hex values | Current palette is ember/char. Green is reserved for M-Pesa and the scanner's admit flash and shouldn't be reused as a brand colour. |

The weight budget matters: the event page must load in **under 3 seconds on 3G** (NFR-2),
and the banner is the single biggest risk to that. Send the largest clean original and it
will be compressed and served as AVIF/WebP.

---

## G. Operational decisions

These aren't config, but the system assumes an answer exists.

| Decision | Why it matters |
|---|---|
| **Who performs M-Pesa reversals?** | Refunds are recorded in the app, but the actual reversal happens in M-Pesa, outside the system (FR-A3). The admin records the reversal reference. Name a person before the day. |
| **Buyer support contact** | Nothing in the UI currently tells a buyer who to contact if a payment is taken but no ticket appears. Give me a phone number or WhatsApp line and I'll surface it on the failure and flagged states. |
| **Cash walk-ups** | Handled entirely outside the system by staff discretion (SRS A5). Confirm the gate team knows this and has a manual list. |
| **Who watches the dashboard on the day?** | Flagged orders mean money taken with no ticket issued. There's no alerting yet, so it needs a human with the page open. |
| **Ticket transfers / name changes** | Not supported in v1. Tickets are bearer tokens — whoever shows the QR gets in. Confirm this is acceptable for a trade expo, where a company may buy several and hand them out. |

---

## Buyer-facing formats (for your reference)

Phone numbers accepted at checkout — all normalise to `2547XXXXXXXX`:

```
0759403402          ✓
759403402           ✓
254759403402        ✓
+254 759 403 402    ✓
0759 403 402        ✓
07594034021         ✗ rejected (too long)
```

Rate limits a real buyer could hit: **5 payment attempts per phone per 10 minutes**, and
**8 ticket lookups per phone per 10 minutes**. Failed attempts that never reach M-Pesa
don't count against the limit.

---

## Fill-in template

Copy this, complete it, and send it back.

```
EVENT
  name:              
  format:            festival | conference_expo
  venue:             
  starts (EAT):      YYYY-MM-DD HH:MM
  ends   (EAT):      YYYY-MM-DD HH:MM
  zones (pipe-sep):  
  banner:            (attach file or URL)
  preferred slug:    (optional, for posters)

TICKET TYPES  (one block each, in display order)
  name:              
  price KES:         (whole shillings)
  cap (admissions):  (blank = unlimited)
  bundle_qty:        (1, or 4 for a family ticket)

DARAJA PRODUCTION
  shortcode:         
  shortcode type:    paybill | till
  consumer key:      `                                `
  consumer secret:   `                                `
  passkey:           `                                `

DOMAIN
  production domain: 
  DNS pointed at Vercel?   yes | no

STAFF
  email / role / station:
    1.                          staff | admin
    2.                          staff | admin
    3.                          staff | admin

OPERATIONS
  M-Pesa reversals owner:      
  buyer support number:        
  dashboard watcher on the day:
```

---

## Before you send

- [ ] Credentials sent through a channel you're comfortable with — **not** committed to this repo. `.env*` is git-ignored; keep it that way.
- [ ] Ticket caps add up to a total that matches venue capacity.
- [ ] Start and end times stated in **EAT**, not UTC.
- [ ] Shortcode type (paybill vs till) confirmed — it changes a required setting.
- [ ] Banner contains no text.
