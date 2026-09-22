# Getting M-Pesa working for real

## Why STK "isn't working"

It is working — against Safaricom's **sandbox**. The code path is fine; I confirmed it
returns a real `CheckoutRequestID` in about 3 seconds.

The problem is what sandbox *is*:

```
DARAJA_ENV      = sandbox
DARAJA_SHORTCODE = 174379          ← Safaricom's shared test paybill
```

**Sandbox only ever prompts Safaricom's own test number, `254708374149`.** Send a push to a
real customer's phone and nothing arrives — no error, no prompt, no money. That is expected
behaviour, not a bug.

Nothing in the application needs to change. You need five values from Safaricom and one
config change.

---

## ⛔ Current blocker: "The shortcode does not support the API product selected"

This is where provisioning is stuck right now. It is **not** a code or credentials
problem — Safaricom is saying the shortcode you submitted is not enabled for the API
product you picked.

Almost always one of three things:

| Cause | Fix |
|---|---|
| The shortcode is a **Buy Goods till**, but you selected **Lipa Na M-Pesa Online / M-Pesa Express**, which is a **Paybill** product | Either register a Paybill, or ask Safaricom to enable M-Pesa Express on the till and use `CustomerBuyGoodsOnline` |
| It is a Paybill, but **M-Pesa Express was never activated** on it | Ask your Safaricom account manager to enable *"Lipa Na M-Pesa Online / M-Pesa Express"* on shortcode `<number>`. This is a switch on their side |
| The shortcode belongs to a different organisation than the Daraja account | The shortcode and the Daraja account must match. Apply from the account that owns it |

**What to ask for, in their words:**

> "Please enable the **Lipa Na M-Pesa Online (M-Pesa Express / STK Push)** API product on
> shortcode `<number>`, and issue the **Lipa Na M-Pesa Online passkey** for it."

Say *M-Pesa Express* — that is the name the provisioning team uses internally, and asking
for "STK push" sometimes gets routed to the wrong desk.

Until that is resolved, **launch without payments** — see the next section. Nothing else is
blocked by it.

---

## Launching before M-Pesa is ready

There is a per-event switch for exactly this. In the admin panel, under **Event settings →
Payments**, untick **"Preorders can be paid for"**.

With it off:

- guests reserve normally and get a number, a QR and a confirmation
- the platters are still **shown**, with their prices, tagged **Coming soon** and not
  selectable — so guests know what is coming
- no order is created and **no STK push is attempted**, so nothing can get stuck in
  `pending_payment` waiting on a payment that cannot happen
- the server refuses a preorder even if someone crafts the request by hand

Both NyamaFest events are currently in this state.

When the shortcode is provisioned: set the production secrets, tick the box again, and
preorders go live. **No migration, no redeploy, no code change.**

---

## What you need to collect

| Value | Where it comes from | Looks like |
|---|---|---|
| `DARAJA_SHORTCODE` | Your real paybill or till | `123456` |
| **Shortcode type** | Paybill **or** till — ask whoever registered it | decides one setting below |
| `DARAJA_CONSUMER_KEY` | Production app on the Daraja portal | ~48 chars |
| `DARAJA_CONSUMER_SECRET` | Same app | ~64 chars |
| `DARAJA_PASSKEY` | Issued **with the shortcode**, after Go Live | 64 hex chars |

> The consumer key/secret are **different** from your sandbox pair. Carrying the sandbox
> ones over is the single most common cutover mistake.

---

## Step by step

### 1. You need a real shortcode first

A paybill or till registered to the business, via Safaricom Business or your bank. If
MeatSoko already takes M-Pesa for anything, **you already have this** — find out which
number it is and whether it is a paybill or a till.

Daraja cannot issue production credentials for a shortcode that does not exist.

### 2. Create a Daraja account

<https://developer.safaricom.co.ke> → sign up → verify the email.

### 3. Create a production app

**My Apps → Add a new App**

- Name it something recognisable (`MeatSoko Ticketing`)
- Tick **Lipa Na M-Pesa Sandbox** *and* **M-Pesa Sandbox** for now

This gives you a sandbox key pair immediately. Production keys come after Go Live.

### 4. Apply for Go Live — start this first

**Go Live** in the top menu. This is the step with a human on the other end and a lead time
measured in **days**, so begin it before anything else on your launch list.

You will be asked for:

- The shortcode from step 1
- Organisation name and contact details
- Your **callback URL** — give exactly this:
  ```
  https://tyirenanflcmwfywurvk.supabase.co/functions/v1/daraja-callback
  ```
  It stays on Supabase, **not** your website domain. The Edge Function is what receives it.
  It is already deployed, public and HTTPS.
- Usually a test transaction from sandbox, which already works

Safaricom then verifies the shortcode belongs to you.

### 5. Collect the production credentials

On approval you get, in the portal or by email:

- Production **consumer key** and **consumer secret** (My Apps → your app → production)
- The **Lipa Na M-Pesa Online passkey** for your shortcode

The passkey is the one people most often cannot find. It is tied to the *shortcode*, not
the app. If it is not in the portal, ask your Safaricom account manager for the *"Lipa Na
M-Pesa Online passkey"* by name.

---

## Applying them

```bash
cd meatsoko-ticketing

supabase secrets set \
  DARAJA_ENV=production \
  DARAJA_SHORTCODE="$(printf %s '123456')" \
  DARAJA_CONSUMER_KEY="$(printf %s 'xxx')" \
  DARAJA_CONSUMER_SECRET="$(printf %s 'xxx')" \
  DARAJA_PASSKEY="$(printf %s 'xxx')" \
  DARAJA_TRANSACTION_TYPE=CustomerPayBillOnline
```

### Two ways this goes wrong

**Till vs paybill.** A **till number needs `CustomerBuyGoodsOnline`**. Leave it as
`CustomerPayBillOnline` on a till and *every* push is rejected. Confirm which you have.

**Trailing whitespace.** This cost two days once already. A newline on `DARAJA_PASSKEY`
produces a misleading *"Wrong credentials"*; a newline on `DARAJA_CALLBACK_URL` makes
Safaricom's WAF swallow the request and never reply — the app appears to hang with no
error at all. The `printf %s` above prevents it. Verify afterwards:

```bash
supabase secrets list
```

The code now trims and warns, so this can no longer break you — but set them cleanly.

### Then redeploy the functions that read them

```bash
for fn in stk-push reserve daraja-callback; do supabase functions deploy $fn; done
```

---

## Verifying it worked

Do this with **one real shilling** on a real phone, before you tell anyone the site is open.

1. Set a preorder item to **KSh 1** in the admin panel
2. Reserve on the public page with **your own** number and email
3. The M-Pesa prompt should arrive within ~5 seconds
4. Enter your PIN
5. The page flips to confirmed on its own; the email arrives with the QR attached
6. Check the admin reservations panel — the order reads `paid` with a real receipt
7. Scan the QR at `/scan` — it admits and shows what was ordered
8. Put the item's real price back

If the prompt never arrives, the response body now tells you where it stopped —
`{"error":"stk_failed","stage":"daraja_stk","detail":"..."}` carries Safaricom's own
message.

### What the common errors mean

| Daraja says | Meaning |
|---|---|
| `Wrong credentials` | Passkey wrong, or whitespace on it, or sandbox passkey against a production shortcode |
| `Invalid Access Token` | Consumer key/secret wrong, or still the sandbox pair |
| `Bad Request - Invalid TransactionType` | Till/paybill mismatch — see above |
| `Unable to lock subscriber` | That number has an unresolved prompt. Wait a minute |
| *no response at all* | Whitespace in `DARAJA_CALLBACK_URL` |
| `The shortcode does not support the API product selected` | M-Pesa Express not enabled on that shortcode — see the top of this document |

---

## Also needed at cutover

| Variable | Where | Why |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Vercel | Baked into **every QR code and WhatsApp link**. Still `http://localhost:3000` — get this wrong and passes you have already issued point nowhere |
| `APP_URL` | Supabase secret | Same value. Edge Functions cannot read `NEXT_PUBLIC_*`, and this builds the link inside the confirmation email |
| `RESEND_API_KEY` | Supabase secret | **Email is now mandatory for guests** — without this key no confirmation is sent at all |
| `TICKET_EMAIL_FROM` | Supabase secret | Must be a domain verified with Resend, or mail silently bounces |

That third one matters more than it used to: guests are now required to give an email
precisely so they receive their pass. If Resend is not configured, they are asked for an
address and then get nothing.

---

## Timeline

| | |
|---|---|
| Shortcode already exists | Go Live approval is the long pole — **days**, not minutes |
| No shortcode yet | Add 1–2 weeks to register one first |
| Credentials in hand | Applying them and verifying: **under an hour** |

Start step 4 today. Everything else can be done while you wait.
