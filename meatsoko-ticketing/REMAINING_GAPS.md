# Remaining gaps

As of **2026-09-24**, three days before NyamaFest. The site is live and taking
reservations; `LAUNCH_CHECKLIST.md` is the readiness view. This is the list of things
that are known-wrong, unverified, or deliberately deferred.

---

## 1. ~~Anyone with a pass token can burn it~~ — **FIXED 2026-09-24**

`admit_pass` was callable by anyone holding a pass token. Confirmed against the live
project with nothing but the public anon key, then fixed the same day.

**Migration:** `supabase/migrations/20260924140000_lock_admit_pass.sql`, applied
2026-09-24 (`supabase migration list` shows `20260924140000`). It revokes `EXECUTE` on
`public.admit_pass(text, text, uuid, timestamptz, integer)` from `public`, `anon` and
`authenticated`, and grants it to `service_role`. Function logic untouched; no other
permission changed.

Revoking from **`public`** is the load-bearing line. No `GRANT` or `REVOKE` for this
function existed anywhere in the migrations, so the only privilege was the Postgres
default — `EXECUTE` to `PUBLIC` — which `anon` and `authenticated` both inherited.
Revoking from those two alone would have been a no-op.

### Verification

| Check | Method | Result |
|---|---|---|
| Anonymous direct RPC rejected | `POST /rest/v1/rpc/admit_pass` with the anon key | ✅ **401 `42501 permission denied for function admit_pass`** — it returned **HTTP 200 `{"result":"not_found"}`** before the migration |
| Authenticated direct RPC rejected | — | ⚠️ **Inferred, not observed** — see below |
| Staff / service-role `redeem` path intact | `POST /functions/v1/redeem` with the anon key | ✅ **401 `{"error":"unauthorized"}`** — rejected by `requireStaff()`, not by a database permission error |

**On the `authenticated` check.** Producing a signed-in session needs a staff password, so
this was not tested directly. The inference is sound rather than hopeful: `authenticated`
held `EXECUTE` *only* through the `PUBLIC` default, the migration revoked that default, and
the anon probe flipping from 200 to 401 is direct evidence that the `PUBLIC` revoke took
effect — the same single mechanism both roles depended on. `authenticated` was also
revoked explicitly and never granted back.

Confirm it directly whenever convenient:

```sql
select proacl from pg_proc where proname = 'admit_pass';
```

Expect to see `service_role=X/postgres` and the owner, with no `anon`, `authenticated` or
bare `=X` (PUBLIC) entry.

**Still to prove by hand:** that a real staff scan still admits. The probe above shows
`redeem` rejecting an unauthenticated caller correctly, which is not the same as showing
the service-role path still reaches `admit_pass`. One scan with a signed-in account settles
it, and that scan is already on the pre-event list.

### Follow-up, deliberately not bundled

`resolve_pass` is still `PUBLIC`-callable and leaks pass details (holder name, party size)
to anyone with a token. Lower severity — a token holder is meant to see their own pass —
and out of scope for this change, which was explicitly `admit_pass` only. It deserves the
same revoke.

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
