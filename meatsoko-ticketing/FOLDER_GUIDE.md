# MeatSoko Ticketing — Codebase & Build Guide

Generated against **SRS v1.0** (`MeatSoko_Ticketing_SRS_v1.0.md`). Every module maps to
numbered requirements (FR-E/P/T/S/G/L/A, NFR) — see the SRS for acceptance criteria.

## 1. Stack & how it maps to the SRS

| Layer | Tech | SRS basis |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript, PWA | NFR-7 |
| Backend | Supabase Postgres + Edge Functions (Deno) | §3, FR-P/S/G |
| Payments | M-Pesa Daraja STK push (reused credentials) | A1, FR-P |
| Ticket delivery | QR web page + wa.me prefilled link + phone lookup | FR-T2, FR-L |
| Offline | Service worker (shell) + IndexedDB (token cache + outbox) | FR-S4/S5 |

## 2. Folder tree

```
meatsoko-ticketing/
├── package.json              # deps: next14, supabase-js/ssr, qrcode, html5-qrcode
├── next.config.mjs
├── tsconfig.json             # paths: @/* -> ./src/*
├── .env.example              # ALL env vars documented — copy to .env / supabase secrets
├── .gitignore
├── FOLDER_GUIDE.md           # this file
│
├── supabase/
│   ├── config.toml           # edge function JWT settings (public fns: verify_jwt=false)
│   ├── schema.sql            # ⭐ full schema for a fresh project (tables, RLS, RPCs)
│   ├── migrations/           # incremental changes applied with `supabase db push`
│   └── functions/            # Deno edge functions (deploy: supabase functions deploy <name>)
│       ├── _shared/
│       │   ├── cors.ts       # CORS + json() helper
│       │   ├── supabase.ts   # service-role client, phone normalization, requireStaff(),
│       │   │                 #   rateLimit() — see the auth note below
│       │   ├── email.ts      # optional Resend ticket email (FR-T2b; no-op without a key)
│       │   └── daraja.ts     # Daraja oauth + STK initiation (trims secrets, timeouts)
│       ├── stk-push/         # FR-P1/P2/P6 + FR-G1: order → STK; throttled, cap-checked
│       ├── daraja-callback/  # FR-P4: idempotent → confirm_payment RPC; failures → failed
│       ├── order-status/     # FR-P3: buyer/gate polling
│       ├── lookup/           # FR-L: active tickets by phone (throttled, no history leak)
│       ├── ticket-by-token/  # FR-T1: public ticket view (unguessable token)
│       ├── sync-tokens/      # FR-S4: staff JWT → tokens + redemption state for offline cache
│       └── redeem/           # FR-S2/S3/S5: single + bulk redemption, 23505 = already redeemed
│
├── public/
│   ├── manifest.json         # PWA install (gate staff "install to home screen")
│   ├── sw.js                 # app-shell cache (network-first pages, cache-first assets)
│   └── icons/                # icon-192 / icon-512 / icon-maskable-512 (ticket + check)
│
└── src/
    ├── middleware.ts         # session refresh for /scan /gate /admin /login
    ├── lib/
    │   ├── types.ts
    │   ├── require-staff.ts  # server guards: requireStaff() / requireAdmin()
    │   ├── offline-db.ts     # IndexedDB: token cache + redemption outbox (no deps)
    │   └── supabase/
    │       ├── client.ts     # browser client
    │       ├── server.ts     # RSC/route-handler client
    │       └── middleware.ts # cookie session refresh
    ├── components/
    │   ├── EventCheckout.tsx # selection → STK → poll → QR + wa.me link   (FR-P, FR-T)
    │   ├── TicketView.tsx    # public /t/<token> page                      (FR-T1)
    │   ├── Scanner.tsx       # camera scan, offline cache, outbox sync     (FR-S, core file)
    │   ├── GateMode.tsx      # walk-up STK sale → auto-admit               (FR-G)
    │   ├── EventManager.tsx  # admin: event list + create draft            (FR-A1)
    │   ├── EventDashboard.tsx# admin: stats, go-live, CSV, types, refunds  (FR-A2/A3/A4)
    │   ├── QrImage.tsx       # qrcode → canvas
    │   └── ServiceWorkerRegister.tsx
    └── app/
        ├── layout.tsx / globals.css / page.tsx   # root, live-event list/redirect
        ├── e/[slug]/page.tsx                     # public event page         (FR-E1)
        ├── t/[token]/page.tsx                    # public ticket view
        ├── lookup/page.tsx                       # phone lookup              (FR-L)
        ├── login/page.tsx                        # staff email/password
        ├── scan/page.tsx                         # scanner (staff)           (FR-S)
        ├── gate/page.tsx                         # gate mode (staff)         (FR-G)
        └── admin/                                # admin (admin role only)   (FR-A)
            ├── layout.tsx
            ├── page.tsx
            └── events/[id]/page.tsx
```

## 3. Build & run (compile the files)

Prereqs: Node 18.17+, a Supabase project, Daraja credentials (SRS risk #1 — verify Day 1).

```bash
# 1. Install
cd meatsoko-ticketing
npm install

# 2. Configure env
cp .env.example .env          # fill NEXT_PUBLIC_* values
cp .env.example .env.supabase # same file, used for secrets in step 4

# 3. Database
supabase link --project-ref YOUR_PROJECT
supabase db push              # applies supabase/schema.sql
#   (or paste schema.sql into the Supabase SQL editor)

# 4. Edge function secrets (service role + Daraja — NEVER in .env.local for the browser)
supabase secrets set --env-file .env.supabase

# 5. Deploy functions
for fn in stk-push daraja-callback order-status lookup ticket-by-token sync-tokens redeem; do
  supabase functions deploy $fn
done

# 6. Run locally
npm run dev                   # http://localhost:3000

# 7. Production build
npm run build && npm start    # then deploy to Vercel (framework: Next.js, auto-detected)
```

After deploy, set `DARAJA_CALLBACK_URL=https://YOUR_PROJECT.supabase.co/functions/v1/daraja-callback`,
`NEXT_PUBLIC_APP_URL=https://your-vercel-domain` (QR/wa.me links) and `APP_URL` to the same
value as a Supabase secret (edge functions cannot read `NEXT_PUBLIC_*`), then redeploy secrets.

> **Secrets must not carry trailing whitespace.** A newline on `DARAJA_PASSKEY` yields a
> misleading "Wrong credentials"; a newline on `DARAJA_CALLBACK_URL` makes Safaricom's WAF
> swallow the STK request and never reply. `daraja.ts` now trims and warns, but set them
> cleanly anyway — `supabase secrets set KEY="$(printf %s "$VALUE")"`.

## 3a. Edge function auth — the one thing not to get wrong

`redeem` and `sync-tokens` need the caller's identity **and** service-role database
access. Do not do this:

```ts
// WRONG — PostgREST resolves the role from the JWT, not the service key, so RLS applies
createClient(url, SERVICE_ROLE_KEY, { global: { headers: { Authorization: userJwt } } })
```

`redemptions` intentionally has no INSERT policy (NFR-4), so the write above fails with
*"new row violates row-level security policy"* and **every gate scan is rejected**. Use
`requireStaff(req)` from `_shared/supabase.ts`: it verifies the token explicitly via
`auth.getUser(token)` and hands back a clean service-role client.

## 3b. CORS — the other thing not to get wrong

`supabase-js` sends `apikey` and `x-client-info` on **every** `functions.invoke()` call.
Any header missing from `Access-Control-Allow-Headers` makes the browser reject the
preflight and never send the real request. The symptom is deeply misleading:

- the browser shows only a generic failure (the `fetch` never completed);
- the function logs show a **successful boot followed by EarlyDrop with no application
  logs** — that is the isolate answering the `OPTIONS` and exiting. The `POST` never ran;
- nothing is written to the database and no rate-limit bucket moves;
- `curl` works perfectly, because curl does not preflight.

Keep `_shared/cors.ts` as the single source of allowed headers, and reply to `OPTIONS`
with `preflight()` from that module.

Relatedly, on the client: `functions.invoke()` sets `data: null` for any non-2xx response
and puts the `Response` on `error.context`. Reading only `data` throws away the server's
error code, collapsing throttles, sold-out types and Daraja rejections into one generic
message. Use `invokeFn()` from `src/lib/invoke.ts`, which always returns the parsed body.

## 3d. Operating it

- `ADMIN_ACCESS.md` — how to create the first admin and the gate staff, what each role
  can reach, what every admin screen is for, and how to revoke access. Start here: there
  are no accounts by default and no sign-up page, so nobody can open the scanner until
  someone follows it.
- `DARAJA_PRODUCTION.md` — why STK works in sandbox but never prompts a real phone, the
  five values to get from Safaricom, the "shortcode does not support the API product
  selected" blocker and exactly what to ask them to enable, and how to launch without
  payments in the meantime.
- `LAUNCH_CHECKLIST.md` — what is actually blocking launch right now, what is verified
  working, and the order to do things in. Start here on any given day.

## 3c. Before any of this — collect the inputs

`INTAKE.md` lists everything that must be decided, gathered or requested before the
system can sell a real ticket: event fields and their limits, ticket-type maths (caps
count *admissions*, not tickets), production Daraja credentials, staff accounts, brand
assets and the operational decisions the system assumes someone has made. It ends with a
blank template to send to the event owner.

Start with its section C — Safaricom's Go Live has a human approval step.

## 4. One-time setup tasks

1. **Admin user**: Supabase Dashboard → Authentication → add user (email/password).
   Then in SQL editor: `insert into admin_users (user_id, role) values ('<auth-uuid>', 'admin');`
   Gate staff: same, with `role = 'staff'`.
2. **Event**: /admin → create draft → add ticket types → **Go live**.
3. **Icons**: shipped in `public/icons/` (192, 512, maskable 512). Replace with brand art
   if you have it; the manifest already references all three.
4. **Event-day ritual (NFR-6, FR-A4)**: Export CSV from the dashboard, gate staff opens
   /scan on good connection and taps **Sync cache**. Paper CSV is the last-resort fallback.

## 5. SRS failure drills → how to test them (build days 11–12)

| SRS §5.4 failure | How to simulate |
|---|---|
| Duplicate Daraja callback | Re-send the same callback payload twice to daraja-callback (curl); expect one `confirmed`, one `already` |
| STK timeout/cancel | Cancel the prompt on the phone; order → `failed`, retry works |
| Offline scan | Load scanner, sync cache, enable airplane mode: admit a valid ticket (queues), rescan same code (rejected from cache), disable airplane mode → outbox syncs, rescan → `already_redeemed` with first timestamp |
| Cap exceeded | Set cap=1, buy 2 bundles in two orders; second payment → order `flagged`, dashboard shows it |

## 6. Known v1 simplifications (matches SRS deferral list)
- Single-gate offline safety relies on one device + DB unique constraint (R2). A **second gate
  device** needs no schema change (station labels differ), but staff must sync cache before
  splitting up — documented SRS risk.
- Family bundle = one QR (A4). Cash walk-ups handled outside the system (A5).
- `order_items` table was added to the SRS schema so one order can mix ticket types — no other
  deviation from the SRS.
