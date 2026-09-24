# Remaining gaps

As of **2026-09-24**, three days before NyamaFest. The site is live and taking
reservations; `LAUNCH_CHECKLIST.md` is the readiness view. This is the list of things
that are known-wrong, unverified, or deliberately deferred.

---

## 1. Anyone with a pass token can burn it — **confirmed today, live now**

`admit_pass` and `resolve_pass` are callable by `anon` over PostgREST. Probed against the
live project with nothing but the public anon key:

```
POST /rest/v1/rpc/admit_pass  {"p_token":"000…0","p_station":"probe"}
  -> HTTP 200  {"result": "not_found"}
```

**HTTP 200 means it ran.** With a *real* token it would not say `not_found` — it would
admit the pass, write the `redemptions` row, and set the reservation to `checked_in`,
with whatever `p_station` string the caller chose.

Why this matters more than it looks: pass tokens are **designed to be shared**. They are
emailed, and the "Share via WhatsApp" button exists to forward them. Anyone in a group
chat where a pass was posted can burn it. The guest then arrives and the scanner says
*already admitted*, with a time and station nobody recognises — and there is no override
in the UI.

Cause: no migration ever revoked `EXECUTE`, and Postgres grants it to `PUBLIC` by default.
`admit_pass` does no `is_staff()` check of its own; it relies entirely on the `redeem`
Edge Function calling `requireStaff()`. That is a real boundary only if nothing else can
reach the function.

**The fix is small and safe.** `redeem/index.ts:29` is the only caller and it uses the
service-role client, so nothing legitimate breaks:

```sql
revoke execute on function public.admit_pass(text, text, uuid, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.resolve_pass(text) from public, anon, authenticated;
grant  execute on function public.admit_pass(text, text, uuid, timestamptz, integer) to service_role;
grant  execute on function public.resolve_pass(text) to service_role;
```

(Confirm the exact argument signatures with `\df admit_pass` before writing the migration.)

Note this only became fixable without collateral damage because desk check-in was moved
off the direct RPC and onto `redeem`. Had it stayed a client-side `supabase.rpc("admit_pass")`,
revoking would have broken the door list.

**Do this before Sunday.**

## 2. `order-status` returns ticket QR tokens

Open since the first audit. Daraja's `CheckoutRequestID` is derivable from a phone number
and a timestamp (~600 guesses), and `order-status` returns `qr_token` for a paid order to
anyone who supplies one.

Low risk *today* only because there are no tickets — payments are off, so `confirm_payment`
has never run and `public.tickets` is empty. It becomes real the moment a ticketed event
runs. Fix: key the lookup on `orderId`, which is already returned and is an unguessable
UUID, and never return tokens for a checkout-id query.

---

## 3. Nothing shipped this week has been used by a human

Everything below is machine-checked — lint, build, `deno check`, live HTTP probes — and
has **never been through a real session on a real phone**:

| Shipped | Never exercised |
|---|---|
| Scanner reading a reservation QR | **The gate.** Until 2026-09-24 it rejected every reservation QR as "Invalid code" |
| Staff *Guest list* tab + admit by hand | The whole door-list fallback |
| `/lookup` recovery by email | Guest self-service |
| Sign out | Shift handover |
| Duplicate-email warning | Deployed today, untested |
| Phone scrolling | Only visible below 560px — desktop mode hides it |

**The scanner one is the gate.** It has still not been pointed at a real emailed QR by a
person. Do that first.

---

## 4. Staff accounts — the last launch blocker

Demo admin only. One account **per device** per `ADMIN_ACCESS.md`, then delete the demo
account. Nobody can work the gate until this is done.

## 5. Live data that should not be there

- **`NF-23X5MW`** on phone `0700000000` — `confirmed`, will scan in. The number is
  guessable through `/lookup` and its `access_token` has been pasted into a chat.
  `./scripts/db.sh < scripts/delete-test-reservation.sql`, or the Table Editor.
- **The demo admin account**, once a real admin works.

## 6. NyamaFest Launch event is inconsistent

Closed, dated 2026-09-06, still `payments_enabled = true` with `capacity = null`. Harmless
— it is closed and `reservation_mode = 'off'` — but unreachable from Event settings, which
renders those fields only for reservation modes. `scripts/fix-nyamafest-launch.sql` is
written and **not applied**.

---

## 7. Duplicate bookings: one side fixed, one side open

**Fixed today:** the same email under a *different* phone now warns the guest and offers
their existing reservation.

**Still open, and arguably more likely here:** `unique (event_id, phone)` means a *shared
handset silently overwrites a booking*. Reserve for yourself, then for a friend from the
same phone, and the friend's details replace yours — same reservation number, one pass,
the first guest quietly gone, no warning. Party size is the intended answer but nothing
says so.

Also: `email` is stored case-preserved (`nullif(btrim(p_email),'')`). The new check
normalises with `lower()`, so it is correct, but any future unique index needs a
normalisation pass over live data first.

## 8. `notify_whatsapp` cannot deliver

The field is editable in Event settings and looks functional. It needs a
`WHATSAPP_WEBHOOK_URL` that is not configured, is not in `.env.example`, and has no
provider behind it — a filled-in field silently does nothing, returning
`whatsapp:not_configured`. Use `notify_email`, which works.

Separately, the organiser notification fires only in the free-reservation branch of
`reserve` — a paid preorder notifies nobody.

## 9. No tests

`package.json` has `dev`, `build`, `start`, `lint`. There is no test suite, no CI, and no
automated check that any user-facing flow works. Every verification in this project has
been a human or a curl. That is the honest reason section 3 exists.

---

## Content still missing

Poster image (`banner_url` is null, the page falls back to a gradient), real event copy
(still the placeholder chips), `contact_phone` (the pass page shows nobody to call), and
`notify_email`.

## Parked deliberately

M-Pesa — Safaricom has not enabled M-Pesa Express on the shortcode. Both NyamaFest events
have `payments_enabled = false`; reservations work, platters show as *Coming soon*, and no
STK push is attempted. See `DARAJA_PRODUCTION.md`.
