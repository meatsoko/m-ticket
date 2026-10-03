# HANDOFF — resuming on another machine

Practical setup only (updated **2026-10-03**). Rules and layout are in `CLAUDE.md`; the
current state of features, events and open items is in `meatsoko-ticketing/CLAUDE.md`.
**Nothing here contains a secret.** Variables are named; values never are.

---

## 1. Clone

```bash
git clone https://github.com/meatsoko/m-ticket.git
cd m-ticket/meatsoko-ticketing      # the app is in this subdirectory
npm install
```

`main` is the production branch — pushing deploys.

## 2. Software

| Tool | Version last used | Notes |
|---|---|---|
| Node / npm | 26.9 / 11.19 | `package.json` needs `>=18.17` |
| Supabase CLI | **2.118** | `brew install supabase/tap/supabase`. Has `supabase db query --linked`; has **no** `functions logs` (dashboard only) |
| Docker | Desktop, running | for the integration harness and `deno check` via `denoland/deno:2.6.3` |
| Deno | 2.6.3 (optional) | only if you want `deno check` without Docker |
| gh | any | optional |

## 3. Environment — names only

### `meatsoko-ticketing/.env` and `.env.local` (gitignored; template `.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL        NEXT_PUBLIC_SUPABASE_ANON_KEY   NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_MERCH_PAYMENTS      NEXT_PUBLIC_PAYSTACK_POPUP      NEXT_PUBLIC_DARAJA_ENABLED
SUPABASE_DB_PASSWORD (only for scripts/db.sh)
```

`NEXT_PUBLIC_APP_URL` must be `https://event.meatsokogroup.com` in production — it is baked
into QR and share links. Locally, leave the three feature flags unset unless testing them.

### Vercel project variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, plus the
feature flags above as set for production.

### Supabase Edge Function secrets — live on the project, nothing to copy

`supabase secrets list` shows names and digests. Set as of 2026-10-03:

```
APP_URL  PAYSTACK_SECRET_KEY  RESEND_API_KEY  TICKET_EMAIL_FROM  MERCH_NOTIFY_EMAIL
DARAJA_ENV  DARAJA_CONSUMER_KEY  DARAJA_CONSUMER_SECRET  DARAJA_SHORTCODE  DARAJA_PASSKEY
DARAJA_CALLBACK_URL  (+ the SUPABASE_* ones Supabase manages)
```

Optional, unset: `VENDOR_FEE_KES` (overrides the 3,500 tent fee), `MERCH_FX_URL`,
`WHATSAPP_WEBHOOK_URL`/`_TOKEN`.

## 4. Copy across by hand (gitignored)

| File | Needed? |
|---|---|
| `meatsoko-ticketing/.env`, `.env.local` | **Yes** (or rebuild from `.env.example` + dashboards) |
| `meatsoko-ticketing/assets/*.mp4` | Only to re-edit videos (originals of `public/videos/*`) |
| `CLAUDE.local.md` | Your own machine notes, if any |
| `.claude/settings.local.json` | No — per-machine permissions |

## 5. Accounts

| | |
|---|---|
| GitHub | push access to `meatsoko/m-ticket` |
| Supabase | `supabase login`, then `supabase link --project-ref tyirenanflcmwfywurvk` (asks for the DB password; type it at the prompt, never into a file) |
| Vercel | project `m-ticket-azure`, team `meatsoko254`; Root Directory `meatsoko-ticketing`, Framework Preset **Next.js** |
| Paystack | shared with the WooCommerce store — its webhook stays pointed there |
| Resend | domain `event.meatsokogroup.com` verified |
| App staff | created by hand per `meatsoko-ticketing/ADMIN_ACCESS.md`; no sign-up page |

## 6. Supabase project

| | |
|---|---|
| Project ref / region | `tyirenanflcmwfywurvk` / `aws-1-eu-west-1` |
| Migrations | 34, through `20261002150000_maic_summit_poster_rename` |
| Edge Functions (23) | `daraja-callback investor-register lookup merch-checkout merch-fx-refresh merch-order online-access online-register order-status paystack-reconcile paystack-verify paystack-webhook platter-addon redeem reservation-by-token reservation-lookup reservation-status reserve stk-push sync-tokens ticket-by-token upgrade-reservation vendor-apply` |
| `verify_jwt` | per function in `supabase/config.toml` — don't change it to make something work |

## 7. Data you'll meet

- Events: `nyamafest-main` (live, 17 Oct), `meatsoko-token-summit` (live, Coming soon,
  5 Dec), `nyamafest` and `nyamafest-launch` (closed).
- `NF-23X5MW` — disposable test reservation, approved for deletion (ask first).
- The database holds **real guest bookings, payments and registrations**. There is no
  seed data; for experiments use the integration harness, never the live project.

## 8. First commands

```bash
cd m-ticket/meatsoko-ticketing
npm install
cp .env.example .env               # then fill in from your own copy
supabase login && supabase link --project-ref tyirenanflcmwfywurvk

npm run lint
npx tsc --noEmit -p .
supabase migration list --linked   # local and remote should match (34)
./tests/harness/run.sh             # expect: ok: 319   FAIL: 0
npm run dev                        # http://localhost:3000
```

Then read `CLAUDE.md` → `meatsoko-ticketing/CLAUDE.md`.
