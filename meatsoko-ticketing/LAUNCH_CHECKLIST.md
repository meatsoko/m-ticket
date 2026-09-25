  # Launch checklist

**NyamaFest is 3 days out — Sunday 27 September, doors 08:00.** Re-verified
**2026-09-24** against the live site, the deployed Edge Functions, and a clean
production build.

## Readiness: live and taking reservations — one item left

The site is deployed at **https://event.meatsokogroup.com**, mail is sending, and real
guests are reserving. Three of the four original blockers are closed:

| | Status |
|---|---|
| Deployment | ✅ Live on Vercel (project `m-ticket-azure`), custom domain serving |
| Mail provider | ✅ Resend sending; passes arrive with the QR attached |
| Public URL | ✅ `event.meatsokogroup.com` — see the caveat below |
| Guest recovery | ✅ `/lookup` takes an email or a phone |
| Scanning a reservation QR | ✅ Fixed today — **it was broken until 2026-09-24**, see below. Untested on a real phone |
| Scrolling on a phone | ✅ Fixed today |
| Sign out | ✅ In the app bar on every signed-in screen |
| Staff accounts | ⚠️ **The one open item.** Demo admin only; real per-device accounts still to create |
| Event data | ⚠️ 27 Sep live, capacity 500, payments off — correct. See *Content still needed* |
| Code | ✅ Lint and build clean, today |

**Do the staff accounts now.** Follow `ADMIN_ACCESS.md`: one account per device, not one
shared login, then delete the demo account. Nobody can work the gate until this is done,
and it is the only thing between here and being ready.

> **Confirm `NEXT_PUBLIC_APP_URL` is `https://event.meatsokogroup.com` in Vercel**, and
> that the `APP_URL` Supabase secret matches. A QR bakes in whatever that says at the
> moment it is generated. If any pass was issued while it still pointed at the
> `.vercel.app` URL, those QRs keep pointing there — they resolve, so nothing looks
> broken, but they are not the address you are giving guests.

> **On "the database is empty":** that was true on 2026-09-22 and is now stale — the
> event is live and taking real reservations. When you check counts, use
> `./scripts/db.sh "select count(*) from reservations;"`. Querying with the anon key
> returns 0 whatever is in the tables, because `reservations` and `orders` are both
> staff-read-only under RLS. That zero is not evidence.

---

## Done since the last revision

- **Resend live.** `RESEND_API_KEY` and `TICKET_EMAIL_FROM` are Supabase *function*
  secrets, not Vercel env vars — the sending code runs in Edge Functions and never
  executes on Vercel. The sender is on the verified `event.meatsokogroup.com`.
- **Deployed.** The Vercel project needed Root Directory `meatsoko-ticketing` *and*
  Framework Preset **Next.js**; with the preset left at "Other" the build succeeds and
  Vercel publishes `public/` as static files, so every route 404s while the build log
  looks perfect.
- **Guest recovery works.** `/lookup` used to ask for the M-Pesa number, which for a
  free-reservation event can only answer "no unused tickets" — while the confirmation
  screen advertised it as the way back to a lost pass. It now takes an email or a phone
  and searches reservations as well as tickets.
- **Staff door list.** A *Guest list* tab inside `/scan`: search, filter, one-tap admit,
  through the same path a scan uses. Scanning is still the way in.
- **Desk check-in fixed.** It had never worked — it passed the reservation number to
  `admit_pass`, which only ever matches the 32-hex `access_token`. It now also records
  which account admitted the guest.
- **The scanner could not read a reservation QR at all.** It stripped the *ticket* URL
  prefix `/t/` from whatever it scanned, but a reservation pass encodes `/r/<token>`. The
  whole URL then failed the 32-hex test and every scan returned **"Invalid code"**. This
  event is reservations-only, so no guest could have been admitted by scanning. It now
  extracts the token wherever it appears, which also survives a `?utm=` picked up from a
  link shared through WhatsApp.
- **Nothing scrolled on a phone.** `.app-body` is the scroller, but a flex child only
  overflows when its parent is height-bounded, and `.app` had `min-height` with no
  `height` — so it grew with its content and `overflow: hidden` clipped the rest. The
  560px rule sets an explicit height, which is why desktop mode appeared to fix it. Not a
  new bug; it went unnoticed because every page tested so far fits on one screen.
- **Sign out.** In the app bar on every signed-in screen. A gate phone is a shared device
  by design, and a shift handover with no way to sign out defeats the per-device accounts
  that make `scanned_by` meaningful.

---

## Blocking launch

### 1. No real staff accounts

The only account is a **demo admin** — credentials in `ADMIN_LOGIN.local.md`, excluded
from git on purpose. Nobody can open the scanner, the guest list or Gate Mode without an
account, so this is the last thing standing between here and gates open.

Create one **per device**, not one shared login. The redemption log records `scanned_by`,
and a shared credential makes that field worthless — which matters more now that staff can
admit a guest from the guest list by hand, the one admission with no scan to corroborate
who waved them through. Steps and ready-to-paste SQL are in `ADMIN_ACCESS.md`.

Delete the demo account once your own admin works.

---

## Closed blockers, kept for the record

| Was | How it was closed |
|---|---|
| **Guests receive nothing** | `RESEND_API_KEY` and `TICKET_EMAIL_FROM` set as **Supabase function secrets** (not Vercel env vars — the sending code runs in Edge Functions), sender on the verified `event.meatsokogroup.com` |
| **Every QR points at `localhost`** | Deployed and `NEXT_PUBLIC_APP_URL` set to the real domain. Re-confirm it and the matching `APP_URL` secret — the CLI only shows a digest, never the value |
| **Not deployed** | Vercel project `m-ticket-azure`: Root Directory `meatsoko-ticketing` **and** Framework Preset `Next.js`. With the preset on "Other" the build succeeds and Vercel publishes `public/` as static files, so every route 404s while the log looks perfect |

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
| **Notify destination** | Both unset, so new reservations land only in the dashboard. Use **`notify_email`** — `notify_whatsapp` looks live in Event settings but cannot deliver: it needs a `WHATSAPP_WEBHOOK_URL` that is not configured and has no provider behind it, so a filled-in field silently does nothing |
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

### NyamaFest Launch is inconsistent, and unreachable from the admin UI
The third event — closed, dated 2026-09-06 — still has `payments_enabled = true` and
`capacity = null`, unlike the two live events. Harmless as it stands: it is closed, its
date has passed, and `reservation_mode = 'off'`, so nothing can transact against it.

It cannot be fixed from **Event settings**: `EventSettings.tsx` renders the payments
checkbox and the capacity field only for reservation modes, and this event is Ticketed.
The update is written and committed but **not applied** —
`./scripts/db.sh < scripts/fix-nyamafest-launch.sql` sets payments off and capacity 500
once `SUPABASE_DB_PASSWORD` is in `.env.local`.

### `admit_pass` / `resolve_pass` may be callable by anyone — **verify before Sunday**
Neither `supabase/schema.sql` nor any migration contains a `REVOKE EXECUTE`, and only
`availability` and `expected_attendance` have explicit grants. Postgres defaults `EXECUTE`
to `PUBLIC`, so these `security definer` functions may be reachable by `anon` over
PostgREST RPC. `admit_pass` does no `is_staff()` check of its own — it relies entirely on
`redeem` calling `requireStaff()`.

If that is so, a guest looking at their own `/r/<token>` URL could burn their own pass.
Check it:

```bash
./scripts/db.sh "\df+ admit_pass"
```

A real fix is its own migration (`revoke execute … from anon, authenticated`) and should
not be rushed in alongside anything else.

### A test reservation is admissible
`NF-23X5MW` on phone `0700000000` is `confirmed` and will scan in like any real guest. The
number is trivially guessable through `/lookup`, and its `access_token` has been pasted
into a chat transcript — either route hands someone a working pass.

Delete it before gates open, whichever is quicker: **Table Editor → `reservations`**, or

```bash
./scripts/db.sh < scripts/delete-test-reservation.sql
```

The script prints the row first and guards the delete on the phone as well as the number,
so if that number has since been reused by a real booking it removes nothing rather than
the wrong guest. **Still present as of this revision.**

### One guest can hold two reservations under one email
`create_reservation` treats **phone** as the identity key — it matches on
`(event_id, phone)` and *updates that row in place* rather than inserting a second, backed
by `unique (event_id, phone)`, with the capacity check subtracting the existing party size
first. So a guest who submits the form twice gets one pass, not two.

Email has no such rule. **Same email + a different phone = two reservations, two passes,
two party sizes against the 500.**

A unique index on `(event_id, lower(email))` is the obvious fix and is the wrong first
move: families legitimately share one address (two guests, two phones, one inbox), so it
converts a normal booking into a hard error at the worst moment; `/lookup` already returns
an *array* per address because sharing is expected; email is stored case-preserved so any
such rule needs a normalisation pass over live data first; and the migration itself fails
if duplicates already exist. Extending the upsert to email would be worse — see the next
paragraph for why.

**The risk points both ways.** `unique (event_id, phone)` means a *shared handset silently
overwrites a booking*: reserve for yourself, then reserve for a friend from the same
phone, and the friend's details replace yours — same number, one pass, the first guest
quietly gone. Party size is the intended answer, but nothing tells the guest that. Any new
rule on email must not recreate this with a different column.

Measure before building anything:

```sql
select lower(btrim(email)) as email, count(*) as bookings, sum(party_size) as people,
       string_agg(reservation_number || ' (' || phone || ')', ', ' order by created_at)
  from public.reservations
 where event_id = (select id from events where slug = 'nyamafest')
   and email is not null
 group by 1 having count(*) > 1 order by 2 desc;
```

**Post-event fix, when there is time:** warn rather than block. If the email already has a
booking under a different phone, return a distinct result carrying the existing
reservation number and let the guest choose *open my existing pass* or *this is a separate
booking*. Respects the family case, cannot destroy data, needs no unique index.

### Reading Edge Function logs
There is **no `supabase functions logs` subcommand** in this CLI (2.67.1) — `functions`
offers only `deploy`, `download`, `list`, `new` and `serve`. Logs are dashboard-only:

**https://supabase.com/dashboard/project/tyirenanflcmwfywurvk/functions** → pick the
function → *Logs*.

That is where to look when a reservation fails, when a pass does not arrive (`reserve`
logs the send result and its reason), or when the duplicate-email check misbehaves
(`reserve` logs `dup check failed` if the RPC errors, because that check fails open).

Worth knowing from `FOLDER_GUIDE.md`: a CORS problem looks like a **successful boot
followed by EarlyDrop with no application logs** — the isolate answered the `OPTIONS` and
exited, and the `POST` never ran. `curl` will work perfectly in that state, because curl
does not preflight.

### Dev-server cache
If the local dev server starts behaving strangely (`Cannot find module
./vendor-chunks/@supabase.js`), `rm -rf .next` and restart. It renders an error page that
makes every UI check fail for unrelated reasons.

---

## Verified working

Re-confirmed **today (2026-09-24)**: `npm run lint` and `npm run build` clean across all
13 routes; `deno check` clean on the changed Edge Function; `https://event.meatsokogroup.com/`
returns 200 with `x-matched-path: /`; the deployed stylesheet carries the height bound that
fixes phone scrolling; and `reservation-lookup` answers correctly when probed with a
malformed address, an unknown address, a mixed-case address containing an underscore, and
a phone.

The scanner's token extraction was checked against every shape a pass can arrive in — an
emailed reservation QR, one shared with a `?utm=` on it, a ticket QR, a hand-typed token,
stray whitespace, uppercase — all accepted; an unrelated QR and a reservation number still
refused, the latter deliberately.

**Not machine-verified — do these by hand, on a real phone, before Sunday.** Everything
below is shipped and has never been through a real session. The scanner fix especially:
until 2026-09-24 the gate would have rejected every guest, and that path has still not been
run against a real QR by a human.

1. Sign in as a **non-admin staff** account
2. **Scan a real reservation QR from an email** — must admit and show the guest's name
3. Scan it again — must say *already admitted* with the first scan's time, not admit twice
4. Check a guest in from the *Guest list* tab, and press it twice as well
5. Scroll the guest list and the poster page — **on a real phone, not desktop mode**, since
   the bug only appears below 560px and desktop mode is exactly what hides it
6. Run `/lookup` with a real guest's email
7. Sign out, and confirm it lands on `/login` with no way back without signing in

Mail confirmed **2026-09-24**: Resend is sending and passes arrive with the QR attached.

Confirmed **2026-09-22** end-to-end against the live project and in a real headless
browser at 390×844, and not re-run since:

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

Three days to the gate. The site is live and taking reservations, so what is left is
gate readiness rather than launch.

1. **Create the admin and staff accounts, one per device** *(the last blocker)* —
   `ADMIN_ACCESS.md` has the steps and the SQL. Nobody can work the gate until this is done
2. **Sign in as staff and walk the gate flow** — scan a real QR, then admit someone from
   the Guest list tab, then press it again and confirm it refuses. This is the check that
   proves mail, domain, QR, scanner and list all agree
3. Delete the demo account, and the `NF-23X5MW` test reservation
   (`./scripts/db.sh < scripts/delete-test-reservation.sql`, or the Table Editor)
4. Confirm `NEXT_PUBLIC_APP_URL` and the `APP_URL` secret are both the real domain
5. Verify the `admit_pass` execute grant (see *Known issues*) — a real fix is its own
   migration, so decide now rather than on the day
6. Add the poster, real copy, and a contact number
7. **On the day:** tap *Sync cache* on every gate phone before doors open
8. **Ask Safaricom to enable M-Pesa Express** — does not block this event, but it only
   gets slower by waiting
9. When M-Pesa clears: set the secrets, tick the payments box, test with one shilling

Tidy-up, any time: apply `scripts/fix-nyamafest-launch.sql`.
