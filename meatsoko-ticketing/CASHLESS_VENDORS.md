# Cashless vendor payments

Written 2026-10-14. Branch `feat/cashless-vendors`, **not merged and not deployed**.
Attendees pay a vendor by scanning the vendor's booth QR and approving an M-Pesa prompt.
The money goes into **one MeatSoko collection till/paybill, separate from the ticket
till**. Each sale is recorded against its event and vendor, MeatSoko keeps a commission,
and vendors are paid out after the event.

| Phase | Scope | State |
|---|---|---|
| **A** (before NyamaFest, 17 Oct) | vendor accounts, booth QR, pay page, sales ledger + commission, vendor dashboard, admin Cashless section | Built and tested on the branch. Taking real money also needs the external setup below |
| **B** (after the event) | payout requests and approval, refunds, M-Pesa statement import and reconciliation, ledger adjustments, the remaining reports | Not built |

## 1. How it works

```
booth poster QR ──> /pay/<code> ──> vendor-pay (Edge, public)
                                      │ start_vendor_sale(): QR code -> event + vendor, rate snapshot
                                      │ payhero_payments row (kind 'sale', account 'sales')
                                      └─ darajaStkPush(account 'sales') ──> payer's phone
Safaricom ──> stk-result (unsigned: only a nudge) ─┐
pay page polling vendor-pay status ────────────────┼─> verifyMpesa(): STK Push Query on the sales till
payhero-reconcile (cron, 2 min) ───────────────────┘      └─ confirm_payhero_sale_payment()
                                                              ├─ vendor_sales.status = success, commission snapshot
                                                              └─ vendor_ledger_entries: +sale, -commission
```

- **Attribution comes only from the QR code.** The QR holds `https://event.meatsokogroup.com/pay/<16 base32 chars>`
  and nothing else: no amount, no vendor id, no credentials. Any `vendor_id`, `event_id`
  or `commission_bps` the browser sends is ignored (the harness checks this).
- **Only Safaricom confirms money.** The callback is unsigned and the pay page reports
  nothing on its own; a sale succeeds only when `verifyMpesa()` gets ResultCode 0 from STK
  Push Query. Pending (4999, unknown codes) stays pending; after 30 minutes without an
  answer the prompt is treated as dead.
- **Idempotency.** The pay page keeps `{idempotency key, amount, phone, status token}` in
  `localStorage` before it sends anything. Repeating a key returns the same attempt
  without a second prompt. A second payment from the same phone at the same booth is
  refused while one is pending (3 min). A retry after a failure is a new attempt with a new key.
- **Money arriving late or wrong is never credited automatically.** Paid after the attempt
  was marked failed, or a different amount, means status `flagged` with no ledger rows,
  shown as "Needs a look". Phase B adds the resolution tools; until then flagged money is
  visible but not owed.

## 2. Data (migration `20261014150000_cashless_vendor_sales.sql`)

| Table / view | What |
|---|---|
| `events.vendor_commission_bps` | event default commission, 500 = 5 % |
| `vendors` | business; `user_id` = its sign-in account; `payout_phone` set by admins only |
| `event_vendors` | participation: `pending → active / rejected`, `inactive`, `suspended`; `commission_bps` override; `policy_bps_accepted` |
| `vendor_qr_codes` | booth codes; one active per participation; never deleted |
| `vendor_sales` | one row per attempt: `VS-XXXXXXXX` reference, amount, **commission rate and amount snapshots**, receipt, `reconciliation_status`, `collection_fee_kes` |
| `payhero_payments` | existing M-Pesa ledger: new kind `sale`, `vendor_sale_id`, `account` (`main` / `sales`) |
| `vendor_ledger_entries` | **append-only** (triggers refuse UPDATE/DELETE): `sale`, `commission`, and in phase B `refund`, `commission_reversal`, `adjustment`, `payout` |
| `vendor_balances` (view) | per participation: gross, commission, refunds, adjustments, payable, paid out, outstanding, counts |

**Rounding and money rules**
- KSh, `numeric(12,2)`. M-Pesa amounts are whole shillings (KSh 1 – 150,000 per payment).
- `commission_kes = round(amount × bps / 10000, 2)`, half away from zero (Postgres
  `round(numeric)`). It is computed once, when the sale is confirmed, and stored on the sale.
- Net payable = gross − refunds − (commission − commission reversed) ± adjustments.
  Outstanding = net payable − payouts.
- Failed, pending and flagged attempts post nothing. M-Pesa collection charges are
  MeatSoko's expense: `collection_fee_kes` on the sale, **never** in the vendor ledger.
- A commission change (event or vendor) applies to new sales only. Each change is audited
  with a reason, and the booth stays closed until the vendor accepts the new rate.
- Check on the admin Overview: collected = vendors' net payable + commission + refunds − adjustments.

## 3. Who can do what

| | Anon (pay page) | Vendor (signed in) | Staff | Admin |
|---|---|---|---|---|
| See a booth's name/event by code | `vendor-pay info` | — | — | — |
| Start / check a payment | `vendor-pay start/status` (rate-limited) | — | — | — |
| Read vendors, participation, sales, ledger, balances | ✗ | **own only** (RLS + `vendor_dashboard()`) | ✗ | all |
| Payer's full phone | ✗ | ✗ (masked `0712***001`) | ✗ | `admin_vendor_sale_phone()` (audited) |
| Accept commission policy | — | own participation | ✗ | records paper acceptance with a note |
| Create vendors, approve, suspend, commission, QR | ✗ | ✗ | ✗ | ✓ (all audited in `admin_audit`) |
| Create a vendor sign-in | ✗ | ✗ | ✗ | `vendor-invite` |
| Confirm a sale | service role only (`verifyMpesa`) |||

Vendors are **never** in `admin_users`, so `is_staff()`, `requireStaff()` and the staff
pages stay closed to them. `link_vendor_user()` refuses an email that is a staff or admin login.
Every new function revokes `EXECUTE` from `PUBLIC` (repo CLAUDE.md §5).

## 4. API

**`vendor-pay`** (`verify_jwt = false`, POST JSON)

| Action | Request | Response |
|---|---|---|
| `info` | `{ code }` | `200 { vendor_name, event_name, venue, open, reason? }` · `404 unknown_code`. `reason`: `code_inactive`, `vendor_suspended`, `vendor_not_active`, `event_closed`, `event_not_started`, `payments_closed` |
| `start` | `{ code, amount (int KSh), phone, idempotency_key (UUID) }` | `200 { status_token, reference, status, amount_kes, vendor_name, event_name, mpesa_receipt, created_at, paid_at, failure }` · `409 { error }` (the reasons above plus `policy_not_accepted`, `pending_payment_exists`, `idempotency_conflict`) · `400 invalid_phone / invalid_amount / idempotency_key_required` · `429 rate_limited` · `502 stk_failed` (with the failed attempt) · `503 payments_closed` |
| `status` | `{ status_token }` | same body as `start`; asks Safaricom while pending (at most once every 6 s per sale) |

Rate limits: info 120 / 10 min per IP; start 30 per IP and 10 per phone / 10 min; status 240 / 10 min per IP.

**`vendor-invite`** (`verify_jwt = true`, admin JWT): `{ vendor_id }` → `{ result: linked | already, emailed }`,
`403` for staff, `409 { error: email_is_staff | user_is_other_vendor | … }`.

**Database RPCs** (called with the user's session): `admin_save_vendor`, `admin_set_vendor_status`,
`admin_assign_vendor_event`, `admin_set_event_vendor_status`, `admin_set_event_commission`,
`admin_set_vendor_commission`, `admin_issue_vendor_qr`, `admin_deactivate_vendor_qr`,
`admin_vendor_sale_phone`, `accept_vendor_policy`, `vendor_dashboard`. Each returns
`{ result … }` or `{ error: <code> }`; a caller without the right role gets `42501`.
Service-role only: `start_vendor_sale`, `confirm_payhero_sale_payment`, `expire_unsent_vendor_sale`,
`link_vendor_user`, `fail_payhero_payment` (now also fails sales).

## 5. Screens

- **`/pay/<code>`**: the brown mobile theme. Shows the vendor and event, takes an amount and an
  M-Pesa number, then waits (polls 3 s up to 10 s, gives up after 3 min with "Check again").
  It resumes after a refresh and never shows success without the server.
- **`/vendor/login` → `/vendor/dashboard`**: store theme. The commission policy is shown
  and must be accepted. Then: gross, commission, net payable, paid out and outstanding;
  sales by day; transactions filtered by status; the booth QR.
- **Dashboard → Events & tickets → Cashless** (`/dashboard/cashless?event=`):
  - **Vendors**: event commission; add a vendor (new, existing, or prefilled from a paid
    tent registration); approve, reject, pause or suspend; override the rate; record
    acceptance; invite; issue, regenerate or deactivate the QR; print the poster at `/dashboard/cashless/qr/<id>`.
  - **Transactions**: filter by status, vendor, date and reference/receipt; reveal a
    payer's phone (audited); export CSV.
  - **Overview**: collected, commission, owed to vendors, needs a look, a balance check,
    and sales by vendor.

## 6. Running an event (phase A)

1. In Cashless, choose the event and check its commission (5 % by default).
2. **Add each vendor**: from their paid tent registration or by hand. The sign-in email
   must be their own (not a staff login). They start as *Awaiting approval*.
3. **Approve**, then **Invite** (creates the account and emails the sign-in link).
4. The vendor signs in and **accepts the commission**. If they can't, record their
   paper acceptance with a note.
5. **Issue code → Print poster**, and put it on the booth.
6. Do a **KSh 1 test payment** at one booth and check it shows as Paid on the pay page,
   the vendor dashboard and Transactions.
7. During the event, watch *Needs a look* and *Pending*. Pending payments are checked
   with Safaricom automatically every 2 minutes.
8. Payments stop by themselves at the event's `ends_at`. To stop one booth earlier,
   pause it or deactivate its code; its history is kept.

## 7. Configuration

**Supabase secrets** (names only, never values in the repo):

| Secret | |
|---|---|
| `VENDOR_SALES=on` | opens booth payments (any other value = closed) |
| `DARAJA_SALES_SHORTCODE` | the sales till's **store number** (for a till) or the paybill number |
| `DARAJA_SALES_PASSKEY` | the M-Pesa Express passkey for that shortcode |
| `DARAJA_SALES_TILL_NUMBER` | the till that receives the money (Buy Goods); defaults to the shortcode |
| `DARAJA_SALES_TRANSACTION_TYPE` | `CustomerBuyGoodsOnline` (default) or `CustomerPayBillOnline` |
| `DARAJA_SALES_CONSUMER_KEY` / `_SECRET` | only if the till is on a different Daraja app; otherwise the main `DARAJA_CONSUMER_*` are used |
| `DARAJA_SALES_ENV` | only if different from `DARAJA_ENV` |

With `VENDOR_SALES` off or the sales shortcode/passkey missing, the pay page says
payments are closed. **It never falls back to the ticket till.**

**Callback URL**: `https://tyirenanflcmwfywurvk.supabase.co/functions/v1/stk-result` (the
existing one, sent with each prompt, no "mpesa" in the path).

**Supabase Auth** (dashboard, for vendor sign-in):
- Custom SMTP, e.g. Resend SMTP from `event.meatsokogroup.com`. The built-in mailer only
  sends to the project's team members.
- The **Magic Link** email template must show the code: `{{ .Token }}`.
- No redirect URL is needed for the code flow.

**Sandbox**: set `DARAJA_SALES_ENV=sandbox`, the sandbox shortcode `174379` with its
published passkey, and `DARAJA_SALES_TRANSACTION_TYPE=CustomerPayBillOnline`. Sandbox
success says nothing about production readiness.

## 8. Still needed from Safaricom / accounts

| Need | For | State |
|---|---|---|
| The separate till/paybill with **M-Pesa Express (STK Push) live on Daraja production**, its passkey, linked to MeatSoko's Daraja app | Phase A real payments | **Not provided yet.** Without it, booths can't take money |
| Supabase Auth custom SMTP + OTP template | vendor sign-in | not confirmed |
| Transaction Status API (initiator + security credential) | verifying payments by receipt | not available; phase B uses the statement instead |
| Reversal API | automated refunds | not available; refunds will be manual and recorded |
| B2C | automated payouts | not available; payouts will be manual, labelled "recorded manually — not verified by Safaricom" |
| M-Pesa org portal statement export for the sales till | phase B reconciliation | needed after the event |

## 9. Testing

- `./tests/harness/run.sh` → **ok: 502, FAIL: 0** (2026-10-14; 81 of them in section 23
  "cashless vendor sales"). Safaricom is faked, including the second till (700100/700200).
  Covered: vendor create, approve and reject; staff and anon refused; QR issue,
  regenerate and deactivate with history kept; vendor isolation (RLS and the dashboard
  RPC); a vendor can't change commission or issue codes; a staff login can't become a
  vendor login; success via query; forged callback ignored; invalid callback; duplicate
  callback / reconcile / poll post once; 1032 failed; 4999 pending; 30-minute expiry;
  idempotent replay and conflict; pending-per-phone guard; retry; amount mismatch and
  late payment flagged; commission snapshot across a rate change and 3 % = 9.99 rounding;
  payable maths; masked phone; ledger append-only even for the service role; event not
  started or over; inactive or suspended vendor; switches; never falling back to the
  ticket till; STK refused. All 421 earlier checks still pass.
- `deno check` on `vendor-pay`, `vendor-invite` and every function importing the changed
  `_shared/daraja-express.ts` / `payhero.ts`; `npm run lint`, `tsc`, `npm run build` clean.
- **Not tested here:** the pages in a browser (the user tests those), real Safaricom, and
  Supabase Auth OTP email delivery.

## 10. Deploying (only with the user's go-ahead)

1. `supabase migration list --linked`, then `supabase db push --linked` (adds the tables and
   replaces `fail_payhero_payment`, keeping its old rules).
2. `supabase functions deploy vendor-pay vendor-invite stk-result payhero-status payhero-reconcile payhero-callback payhero-pay stk-push reserve order-status reservation-status daraja-callback`
   (everything importing `_shared/daraja-express.ts` or `_shared/payhero.ts`).
3. Set the secrets in §7, `VENDOR_SALES` last.
4. Merge to `main` (Vercel deploys).
5. Onboard one vendor, then a KSh 1 live test (§6).
