# Launch checklist

Where NyamaFest actually stands, last verified **2026-09-22** against the live Supabase
project. Payments are deliberately parked — everything below is the path to launching
without them.

---

## Blocking launch

### 1. Guests are asked for an email and receive nothing

`RESEND_API_KEY` and `TICKET_EMAIL_FROM` are **not set**. Email is now mandatory at
checkout precisely so guests get their pass — with no mail provider configured they hand
over an address and get silence.

The confirmation screen is honest about it (it only claims "we've emailed it" when the send
actually succeeded, and otherwise says "screenshot this"), so nothing lies to the guest.
But a reservation with no durable copy is the main way someone turns up at a gate with
nothing to show.

```bash
supabase secrets set \
  RESEND_API_KEY="$(printf %s 're_xxx')" \
  TICKET_EMAIL_FROM="$(printf %s 'tickets@yourdomain.co.ke')"
supabase functions deploy reserve
supabase functions deploy daraja-callback
```

The from-domain must be **verified with Resend** first, or mail silently bounces.
Free tier covers 3,000 emails/month, which is well beyond this event.

### 2. Every QR points at `localhost`

`NEXT_PUBLIC_APP_URL` is still `http://localhost:3000`. That string is baked into every
QR code and WhatsApp link at the moment it is generated — get it wrong and passes you
have already issued point nowhere.

Set it in **Vercel** and as a **Supabase secret** (`APP_URL`), to the same value. Edge
Functions cannot read `NEXT_PUBLIC_*`, which is why there are two.

### 3. Nobody can sign in

`admin_users` is empty, so the scanner, Gate Mode and the admin dashboard are unreachable.
See `ADMIN_ACCESS.md` — about five minutes, but nothing works until it is done.

### 4. Not deployed

The app has never been deployed. Build is green; it needs a Vercel project pointed at this
repo, the three `NEXT_PUBLIC_*` variables, and a domain. HTTPS is required — the scanner's
camera will not start without a secure context.

---

## Parked: M-Pesa

Safaricom rejected the shortcode with **"The shortcode does not support the API product
selected"** — M-Pesa Express is not enabled on it. That is a provisioning switch on their
side. See `DARAJA_PRODUCTION.md` for exactly what to ask for.

**This does not block launch.** Both NyamaFest events have
`payments_enabled = false`, so:

- reservations work normally and issue a pass
- platters are shown with prices, tagged **Coming soon**, not selectable
- no order is created and no STK push is attempted — nothing can get stuck
- the server refuses a preorder even if the request is crafted by hand

When the shortcode is provisioned: set the production secrets, tick **Event settings →
Payments → Preorders can be paid for**. No migration, no redeploy.

---

## Content still needed

| | |
|---|---|
| **Poster image** | The landing page falls back to a gradient. Landscape, no text baked in (the title overlays it), under ~200 KB. Set as the event's `banner_url` |
| **Real copy** | Description is `Nyama Choma \| Live Grills \| Music \| Brand Village` — placeholder chips |
| **Contact number** | `contact_phone` is empty, so the pass page shows no one to call |
| **Notify destination** | `notify_email` / `notify_whatsapp` unset, so new reservations land only in the dashboard |
| **Capacity** | 27 Sep is set to 500, 14 Oct to 2,000. Confirm both against the venue |

---

## Known issues, not blocking

### `order-status` leaks ticket QR tokens
Flagged during the first audit and still open. Daraja's `CheckoutRequestID` is derivable
from a phone number and a timestamp (~600 guesses), and `order-status` returns `qr_token`
for a paid order to anyone who supplies one.

**Low risk today** — there are no ticketed events and no tickets in the database. It
becomes real the moment you run a ticketed event again. The fix is to key the lookup on
`orderId` (already returned, already an unguessable UUID) and never return tokens for a
checkout-id query. Reservations are unaffected: `reservation-status` keys on the 128-bit
`access_token`.

### One stuck reservation
`NF-6P5AWZ` ("amina", `254759403402`, created 07:56) is `pending_payment` for KSh 800 with
**no email**. It predates both the mandatory-email rule and the payments switch, so it can
never be paid and its guest can never be emailed. It still counts toward expected
attendance.

Either confirm it by hand or delete it — your call, which is why it has been left alone.

### Dev-server cache
If the local dev server starts behaving strangely (`Cannot find module
./vendor-chunks/@supabase.js`), `rm -rf .next` and restart. It renders an error page that
makes every UI check fail for unrelated reasons.

---

## Verified working

Confirmed end-to-end against the live project and in a real headless browser at 390×844:

- poster → line-up → reserve; only the open event is clickable
- three events render with the right state: **Closed / Open / Coming soon**
- reservation types drive the party — Single fixes 1, Family fixes 4, Group starts at its
  minimum of 2 and counts up; server rejects out-of-range parties
- email is mandatory and enforced at client, Edge Function and database
- a full submission issues a number, renders the QR, and the pass page shows guest, venue
  and arrival time
- capacity cannot be overbooked — 10 concurrent parties into 14 remaining places admitted
  exactly 4
- duplicate scan rejected with the first scan's time and station
- offline cache carries both tickets and reservations with paid state
- `npm run lint` and `npm run build` clean

---

## Order to do things

1. **Ask Safaricom to enable M-Pesa Express** — days of lead time, start it now
2. Set up Resend, set the two secrets *(blocker 1)*
3. Deploy to Vercel, set the domain and both app-URL variables *(blockers 2 and 4)*
4. Create the admin and staff accounts *(blocker 3)*
5. Add the poster and real copy
6. Reserve once yourself, end to end, and scan your own QR at the gate
7. Open reservations
8. When M-Pesa clears: set the secrets, tick the payments box, test with one shilling
