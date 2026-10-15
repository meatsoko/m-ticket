# M-Pesa Express (STK Push) with Safaricom Daraja: integration guide

This is a reusable guide for taking M-Pesa payments with Safaricom Daraja. It is distilled
from the MeatSoko Events system, which takes live payments this way (since 2026-10-08).
It is written so you can copy it into another project. The examples are TypeScript using
`fetch`; they run on Deno (Supabase Edge Functions), Node 18+, Bun or Cloudflare Workers.

**Source files in this repository:**
- `supabase/functions/_shared/daraja-express.ts`: the client.
- `_shared/payhero.ts` → `verifyMpesa()`: verification and confirmation.
- `stk-result/index.ts`: the callback.
- `payhero-reconcile/index.ts`: the reconciler.
- `vendor-pay/index.ts`: a complete payment endpoint.
- Migrations `20261008090000`, `20261008120000` and `20261014150000`: the ledger.

---

## 1. The one rule

> **Never mark a payment as paid because a callback or a browser says so.
> Mark it paid only when Safaricom's own STK Push Query says ResultCode 0.**

Safaricom's STK callback is **not signed**. Anyone who learns your callback URL and a
`CheckoutRequestID` can post a fake "success". The browser can't be trusted either. So:

- The **callback** is only a *nudge*: "go and check this payment now".
- The **STK Push Query** is the *only* thing that confirms or fails a payment.
- A **timeout is not a failure**. "Still processing" means ask again later.
- A **reconciler** (cron) re-asks about payments nobody has settled, so a lost callback
  or a closed browser tab never loses money.

Everything else in this guide follows from that rule.

---

## 2. Concepts you must get right

| Term | Meaning | Common mistake |
|---|---|---|
| **Shortcode** (`BusinessShortCode`) | The number that *signs* the request. For a **paybill** it's the paybill number. For a **Buy Goods till** it's the **store / head-office number**, *not* the till number | Using the till number as the shortcode, which gives "Wrong credentials" |
| **Till number** (`PartyB` for Buy Goods) | Where the money lands on a till | — |
| **Passkey** | The M-Pesa Express key for that **shortcode**, issued by Safaricom at Go Live. It belongs to the shortcode, not the app | Using the sandbox passkey in production |
| **Consumer key / secret** | Your Daraja **app's** credentials, used for OAuth | Carrying the sandbox pair over to production |
| **TransactionType** | `CustomerPayBillOnline` (paybill) or `CustomerBuyGoodsOnline` (till) | Mismatch, which gives "Invalid TransactionType" or rejections |
| **AccountReference** | Shown to the payer and on the statement. **Max 12 characters** | Longer values get cut off or rejected |
| **TransactionDesc** | Short description. **Max 13 characters** | — |
| **CheckoutRequestID** | Safaricom's id for one prompt. You query by it and the callback carries it | — |

**Whose paybill is it?** You can only get a passkey for a shortcode **your organisation
owns**. A bank's collection paybill (for example Equity `247247` with *your account number*
as the account) belongs to the bank. Safaricom will not give you its passkey, so Daraja
cannot prompt into it. Your options are: register your own paybill or till (it can still
settle into your bank account), use the bank's own API, or use an aggregator such as
PayHero with a "bank" channel.

**Sandbox only prompts Safaricom's test number** (`254708374149`) on the shared test
shortcode `174379`. A sandbox push to a real phone silently does nothing. Sandbox success
does **not** show that you're ready for production.

---

## 3. Getting production credentials

1. Have a paybill or Buy Goods till registered to your business (through Safaricom or your bank).
2. Create an account at <https://developer.safaricom.co.ke>, then create an app.
3. Go to **Go Live** → choose **M-Pesa Express** → enter the shortcode (the store number for a
   till). The shortcode's *business administrator* on the M-Pesa org portal approves with
   an OTP. If a bank issued the till, the bank may hold that role.
4. You receive the **production consumer key/secret** (often for a new app) and the
   **Lipa Na M-Pesa Online passkey** by email.
5. If the portal says *"The shortcode does not support the API product selected"*, ask
   Safaricom, in these words: *"Please enable the Lipa Na M-Pesa Online (M-Pesa Express)
   API product on shortcode `<n>` and issue the passkey."*

Go Live takes **days**, not minutes. Start it first.

---

## 4. Configuration

| Variable | Example | Notes |
|---|---|---|
| `DARAJA_ENV` | `production` \| `sandbox` | Picks `https://api.safaricom.co.ke` or `https://sandbox.safaricom.co.ke` |
| `DARAJA_CONSUMER_KEY` / `DARAJA_CONSUMER_SECRET` | | Server-side only |
| `DARAJA_SHORTCODE` | `123456` | Paybill number, or the till's **store number** |
| `DARAJA_PASSKEY` | 64 hex characters | For that shortcode |
| `DARAJA_TILL_NUMBER` | `654321` | Buy Goods only; defaults to the shortcode |
| `DARAJA_TRANSACTION_TYPE` | `CustomerBuyGoodsOnline` | or `CustomerPayBillOnline` |
| `DARAJA_PAYMENTS` | `on` | **Kill switch, fails closed**: anything but `on` means no new prompts (verification of old ones keeps running) |
| `PUBLIC_BASE_URL` | `https://api.example.com` | Used to build the callback URL |

**Two traps that each cost days in this project:**
- **Whitespace.** A trailing newline on the passkey gives *"Wrong credentials"*. A newline
  on the callback URL makes Safaricom's firewall drop the request, so the call hangs with
  no error at all. **Trim every secret** when you read it, and set secrets with
  `printf %s '…'` or a dashboard, not `echo`.
- **The word "mpesa" in the callback URL.** Safaricom rejects callback URLs that contain
  `mpesa` (this project hit it; Safaricom's guidance also warns against words such as `safaricom`). Name the route something neutral, such as `/stk-result`.

---

## 5. Data model: a payment ledger

Keep **one row per prompt** (per attempt), separate from your orders. A retry is a *new*
row. The order holds business state; the ledger holds what M-Pesa did.

```sql
create table payments (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,            -- yours, e.g. 'PH' || 32 hex; 128-bit, unguessable
  order_id             uuid not null references orders(id),
  phone                text not null check (phone ~ '^254[17][0-9]{8}$'),
  amount_kes           numeric(12,2) not null check (amount_kes >= 1),   -- what YOU asked Safaricom to charge
  status               text not null default 'queued' check (status in ('queued','success','failed')),
  outcome              text,          -- what confirmation did: confirmed / already / amount_mismatch / paid_after_failed …
  checkout_request_id  text unique,   -- Safaricom's id, set after the push is accepted
  merchant_request_id  text,
  mpesa_receipt        text,          -- label only, from the callback AFTER verification
  result_desc          text,
  created_at           timestamptz not null default now(),
  confirmed_at         timestamptz
);
create index on payments (created_at) where status = 'queued';
```

**Rules that keep money safe:**
- `checkout_request_id` is **unique**, so the callback finds exactly one payment.
- Confirmation happens inside **one database transaction with row locks**
  (`select … for update` on the payment and the order). Checks: payment still `queued`?
  Order still pending? **Amount equals what we asked for?** Then mark paid. A second call
  returns `already`. This makes duplicate callbacks, polls and reconciles harmless.
- **Money is never dropped.** If the order was cancelled or failed, or the amount differs,
  mark it `flagged` (with `paid_at` set) for a human to refund or apply. Never silently
  ignore a payment that Safaricom confirms.
- A **failed** prompt releases what the order was holding. If a newer prompt for the same
  order is still open, the order stays pending for that one.
- Lock down the database: only your server (service role) can write these tables or call
  the confirm/fail functions. In Postgres, `revoke execute … from public` on every
  `security definer` function. Postgres grants `EXECUTE` to `PUBLIC` by default.

---

## 6. The client (copy this)

```ts
// daraja.ts — Safaricom Daraja M-Pesa Express: OAuth, STK push, STK Push Query.
const BASE: Record<string, string> = {
  production: "https://api.safaricom.co.ke",
  sandbox: "https://sandbox.safaricom.co.ke",
};
const env = (n: string) => (process.env[n] ?? "").trim();          // Deno: Deno.env.get(n)
const base = () => BASE[env("DARAJA_ENV") || "production"];

export const darajaOpen = () => env("DARAJA_PAYMENTS").toLowerCase() === "on";

export function darajaConfigured(): { ok: true } | { ok: false; missing: string[] } {
  const missing = ["DARAJA_CONSUMER_KEY", "DARAJA_CONSUMER_SECRET", "DARAJA_PASSKEY", "DARAJA_SHORTCODE", "PUBLIC_BASE_URL"]
    .filter((n) => !env(n));
  if (!base()) missing.push("DARAJA_ENV (production|sandbox)");
  return missing.length ? { ok: false, missing } : { ok: true };   // log names, never values
}

// Tokens live ~1 h. Cache per process until a minute before expiry.
let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const res = await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${env("DARAJA_CONSUMER_KEY")}:${env("DARAJA_CONSUMER_SECRET")}`)}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new Error(`daraja_oauth_failed:${res.status}`);
  token = { value: body.access_token, until: Date.now() + (Number(body.expires_in ?? 3599) - 60) * 1000 };
  return token.value;
}

/** yyyyMMddHHmmss in Africa/Nairobi time, whatever the server's timezone. */
function timestamp(): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour === "24" ? "00" : p.hour}${p.minute}${p.second}`;
}
const password = (ts: string) => btoa(`${env("DARAJA_SHORTCODE")}${env("DARAJA_PASSKEY")}${ts}`);

/** Neutral path: Safaricom rejects callback URLs containing "mpesa". */
export const callbackUrl = () => `${env("PUBLIC_BASE_URL").replace(/\/+$/, "")}/stk-result`;

export async function stkPush(o: { amountKes: number; phone: string; accountRef: string; description: string }):
  Promise<{ ok: true; checkoutRequestId: string; merchantRequestId: string | null } | { ok: false; detail: string }> {
  try {
    const type = env("DARAJA_TRANSACTION_TYPE") || "CustomerBuyGoodsOnline";
    const shortcode = env("DARAJA_SHORTCODE");
    const partyB = type === "CustomerBuyGoodsOnline" ? env("DARAJA_TILL_NUMBER") || shortcode : shortcode;
    const ts = timestamp();
    const res = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        BusinessShortCode: shortcode, Password: password(ts), Timestamp: ts, TransactionType: type,
        Amount: Math.round(o.amountKes),               // whole shillings
        PartyA: o.phone, PartyB: partyB, PhoneNumber: o.phone,  // 2547XXXXXXXX / 2541XXXXXXXX
        CallBackURL: callbackUrl(),
        AccountReference: o.accountRef.replace(/[^A-Za-z0-9]/g, "").slice(0, 12),
        TransactionDesc: o.description.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 13),
      }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || String(body?.ResponseCode) !== "0" || !body?.CheckoutRequestID) {
      return { ok: false, detail: String(body?.errorMessage ?? body?.ResponseDescription ?? `HTTP ${res.status}`).slice(0, 200) };
    }
    return { ok: true, checkoutRequestId: body.CheckoutRequestID, merchantRequestId: body.MerchantRequestID ?? null };
  } catch (e) {
    return { ok: false, detail: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/**
 * Result codes that mean the payment definitely did NOT happen. Everything else that
 * isn't 0 is PENDING — above all 4999 "The transaction is still under processing",
 * which the query returns while the payer is still typing the PIN. (Treating every
 * non-zero code as failure marked a real, paid test as failed in this project.)
 */
const FAILED_CODES = new Set([
  "1",    // insufficient funds
  "1001", // subscriber busy / unable to lock (another prompt open)
  "1019", // transaction expired
  "1025", // error sending the push
  "1032", // cancelled by the user
  "1037", // no response from the phone (timeout / unreachable)
  "2001", // wrong PIN
  "9999", // error sending the push
]);

/** Safaricom's verdict on one prompt. Throws when it can't say (throttled, misconfigured): decide nothing then. */
export async function queryStk(checkoutRequestId: string):
  Promise<{ state: "success" | "failed" | "pending"; code: string | null; desc: string | null }> {
  const ts = timestamp();
  const res = await fetch(`${base()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ BusinessShortCode: env("DARAJA_SHORTCODE"), Password: password(ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  const body: any = await res.json().catch(() => null);
  if (body?.ResultCode !== undefined && body?.ResultCode !== null && String(body?.ResponseCode ?? "0") === "0") {
    const code = String(body.ResultCode);
    return { state: code === "0" ? "success" : FAILED_CODES.has(code) ? "failed" : "pending", code, desc: body.ResultDesc ?? null };
  }
  // While the prompt is open the query often answers HTTP 500 with errorCode 500.001.1001.
  if (String(body?.errorCode ?? "") === "500.001.1001" || /being processed/i.test(String(body?.errorMessage ?? ""))) {
    return { state: "pending", code: null, desc: body?.errorMessage ?? null };
  }
  throw new Error(`daraja_query_unavailable:${res.status}:${String(body?.errorCode ?? body?.errorMessage ?? "").slice(0, 80)}`);
}
```

**Phone numbers.** Accept `07XX…`, `01XX…` (Safaricom 0110/0111 and Airtel 0100–0102 are
normal mobiles), `+254…` and `254…`. Store them as `254` plus 9 digits:

```ts
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^0[17]\d{8}$/.test(d)) return "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) return "254" + d;
  return null;
}
```

---

## 7. Verification: the only code that confirms money

```ts
const GIVE_UP_MS = 30 * 60 * 1000;   // a prompt still "pending" after 30 min is dead

export async function verifyPayment(db: Db, reference: string) {
  const row = await db.payments.byReference(reference);
  if (!row) throw new Error("unknown_reference");
  if (row.status !== "queued") return { status: row.status, result: row.outcome };   // already decided
  if (!row.checkout_request_id) return { status: "queued" };                           // push not accepted yet

  const q = await queryStk(row.checkout_request_id);          // may throw → caller logs, decides nothing
  const expired = q.state === "pending" && Date.now() - Date.parse(row.created_at) > GIVE_UP_MS;

  if (q.state === "pending" && !expired) return { status: "queued" };
  if (q.state === "failed" || expired) {
    await db.rpc("fail_payment", { reference, reason: expired ? `expired: ${q.desc ?? q.code}` : q.desc ?? q.code });
    return { status: "failed" };
  }
  // SUCCESS. The query returns no amount or receipt: confirm at the amount WE asked for.
  const r = await db.rpc("confirm_payment", { reference, amount_kes: row.amount_kes, receipt: row.mpesa_receipt });
  if (r.result === "confirmed") await afterConfirmed(r);   // emails etc. — only on the FIRST confirmation
  return { status: "success", result: r.result };
}
```

`confirm_payment` (SQL, one transaction):

```sql
-- sketch; see confirm_payhero_sale_payment / confirm_payhero_event_payment in this repo
select * into pay from payments where reference = p_reference for update;
if pay.status = 'success' then return 'already'; end if;
select * into ord from orders where id = pay.order_id for update;
if ord.status = 'paid'               then outcome := 'already';
elsif ord.amount_kes <> p_amount     then update orders set status='flagged', paid_at=now() ...; outcome := 'amount_mismatch';
elsif ord.status <> 'pending'        then update orders set status='flagged', paid_at=now() ...; outcome := 'paid_after_' || ord.status;
else                                      update orders set status='paid', paid_at=now(), mpesa_receipt=p_receipt ...; outcome := 'confirmed';
end if;
update payments set status='success', outcome=outcome, confirmed_at=now() where id = pay.id;
```

---

## 8. Endpoints

### 8.1 Start a payment (`POST /pay`, public)

1. Validate input. **Compute the amount on the server** from your own data, never from the
   request. Normalise the phone number.
2. Check the kill switch and configuration: `darajaOpen()` and `darajaConfigured()`.
   Otherwise return `503`.
3. Rate-limit by IP and by phone. Keep the counters in the database, because serverless
   instances don't share memory.
4. **Idempotency.** The client sends a UUID it saved *before* calling. The same key
   returns the same attempt and **never** sends a second prompt. Also refuse a new prompt
   from the same phone for the same thing while one is still pending (a few minutes), or
   people pay twice.
5. Create the order (pending), insert the `payments` row (`queued`), then `stkPush()`.
6. Push refused: run `fail_payment` and return `502` with Safaricom's `detail`. Push
   accepted: store `checkout_request_id`, and return the reference plus a **status token**
   to the client (128-bit random, its key for polling).

### 8.2 Callback (`POST /stk-result`, public, unauthenticated)

```ts
export async function stkResult(req: Request) {
  const body: any = await req.json().catch(() => null);
  const cb = body?.Body?.stkCallback;
  const id = String(cb?.CheckoutRequestID ?? "");
  if (!id || id.length > 80) return accept();
  if (!(await rateLimit("stk-result:global", 300, 60))) return accept();   // each callback costs a query

  const row = await db.payments.byCheckoutId(id);
  if (!row) return accept();
  const items: any[] = cb?.CallbackMetadata?.Item ?? [];
  const receipt = String(items.find((i) => i?.Name === "MpesaReceiptNumber")?.Value ?? "");
  try {
    const out = await verifyPayment(db, row.reference);          // asks Safaricom
    // Store the callback's receipt ONLY after Safaricom confirmed, and never over an existing one,
    // so a forged callback can't even label a payment.
    if (out.status === "success" && Number(cb?.ResultCode) === 0 && /^[A-Z0-9]{8,12}$/.test(receipt)) {
      await db.payments.setReceiptIfEmpty(row.reference, receipt);
    }
  } catch (e) { console.error("stk-result check failed", row.reference.slice(0, 10), String(e).slice(0, 160)); }
  return accept();
}
// Always answer ResultCode 0, or Safaricom retries. Problems go to the logs; the reconciler catches the rest.
const accept = () => Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
```

### 8.3 Status (`POST /pay/status`, public, by status token)

- Look up by the **status token** (not by order number, which can be guessed).
- If the payment is still `queued` and older than about 8 seconds, call `verifyPayment`.
  **Throttle the query**: at most one per payment every 6 s, because Safaricom rate-limits
  STK Push Query.
- Return only what the payer needs: status, amount, reference, and the receipt once paid.
  No phone numbers or other people's data.

### 8.4 Reconciler (cron, every 2 minutes)

```ts
// payments still queued, between 1 minute and 3 hours old, oldest first, at most 25 a run
for (const { reference } of await db.payments.queued({ minAgeMs: 60_000, maxAgeMs: 3 * 3600_000, limit: 25 })) {
  try { await verifyPayment(db, reference); } catch (e) { /* log and continue */ }
}
```

On Supabase this is `pg_cron` plus `pg_net` posting to the function. Elsewhere, any
scheduler works. Give it a global rate limit so it can't be used to hammer Safaricom.

---

## 9. The client page (waiting for the PIN)

- **Save the attempt before sending** (localStorage: idempotency key, amount, phone, then
  the status token). After a refresh or a dropped connection, *resume* that attempt; don't
  start a new one.
- Poll the status endpoint every 3 s, slowing to 10 s. After about 3 minutes stop and show
  *"We haven't had an answer yet. Don't pay again. Check your M-Pesa messages, then tap
  Check again."*
- Only show success when the **server** says `success`. Failure messages come from the
  result code: cancelled, insufficient funds, timed out.
- If the response to *start* never arrived, offer **"Check again"** with the same key. It
  can't send a second prompt.
- Never ask for the M-Pesa PIN on your page. Say so on the page.

---

## 10. Errors you'll meet

| Daraja says | Meaning / fix |
|---|---|
| `Wrong credentials` | Passkey wrong, has whitespace, belongs to a different shortcode, or is the sandbox one; or a till's *till* number was used instead of its *store* number |
| `Invalid Access Token` (404.001.03) | Consumer key/secret wrong or still the sandbox pair; or a token from one app used on another |
| `Bad Request - Invalid TransactionType` | Paybill/till mismatch |
| `Bad Request - Invalid PhoneNumber` | Not `2547…`/`2541…`, or a sandbox push to a real number |
| `Unable to lock subscriber` (1001) | That phone has a prompt still open. Wait a minute |
| `The transaction is being processed` (500.001.1001) | Pending. Ask again later |
| `ResultCode 4999` | Still processing. Pending, **not** failed |
| `The shortcode does not support the API product selected` | M-Pesa Express not enabled on that shortcode (see §3) |
| No response at all | Whitespace in the callback URL, or "mpesa" in its path |

---

## 11. Testing without money

- **Fake Daraja in your tests.** Intercept `fetch` for `sandbox.safaricom.co.ke` and
  answer `/oauth/v1/generate`, `/mpesa/stkpush/v1/processrequest` (record the body, return
  a `CheckoutRequestID`) and `/mpesa/stkpushquery/v1/query` (answer from a map you control:
  pending → `500.001.1001`, processing → `ResultCode 4999`, success → `0`, cancelled →
  `1032`). Check the password: `base64(shortcode + passkey + Timestamp)`.
- **Must-have checks** (all in this repo's `tests/harness/test.ts`, sections 22–23):
  - A forged success callback changes nothing while the query says pending.
  - Success via query; repeat callback, poll and reconcile post nothing more.
  - 1032 fails; 4999 and unknown codes stay pending; 30 minutes pending expires it.
  - Late success after failure is flagged, not applied; a different amount is flagged.
  - Idempotent start; retry after failure; STK refused gives 502 and a released order.
  - The kill switch is off by default; anonymous users can't call the confirm functions.
- **Live check:** after Go Live, run **one KSh 1** payment on a real phone, end to end,
  before you open payments to anyone.

---

## 12. Security checklist

- [ ] Credentials only on the server; no `NEXT_PUBLIC_`/client exposure; trimmed on read.
- [ ] Callback, client and redirect are never trusted; STK Push Query is the only confirmation.
- [ ] Amount comes from the server; confirmation re-checks it against what was requested.
- [ ] Ledger with a unique `checkout_request_id`; confirmation under row locks; idempotent.
- [ ] Late or mismatched money is flagged, never dropped or silently applied.
- [ ] Rate limits on start, status, callback and reconcile (Safaricom throttles the query).
- [ ] Status looked up by an unguessable token; responses carry no other people's data.
- [ ] Kill switch that fails closed; verification keeps running while it's off.
- [ ] Logs carry short reference prefixes and result codes, never secrets, full phone numbers or PINs.
- [ ] Reconciler scheduled; it is the safety net for every lost callback.
- [ ] Reconcile against the paybill/till **statement** after the fact (match by receipt).
- [ ] Refunds and payouts: Reversal and B2C are separate Daraja products needing an
      initiator and security credential. Without them, record manual refunds and payouts
      with their references, and label them "not verified by Safaricom".
