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
│   ├── schema.sql            # ⭐ tables, enums, RLS, RPCs confirm_payment + refund_order
│   └── functions/            # Deno edge functions (deploy: supabase functions deploy <name>)
│       ├── _shared/
│       │   ├── cors.ts       # CORS + json() helper
│       │   ├── supabase.ts   # service-role client + phone normalization
│       │   └── daraja.ts     # Daraja oauth + STK initiation (env-driven sandbox/prod)
│       ├── stk-push/         # FR-P1/P2 + FR-G1: pending order → STK (web + gate channels)
│       ├── daraja-callback/  # FR-P4: idempotent → confirm_payment RPC; failures → failed
│       ├── order-status/     # FR-P3: buyer/gate polling
│       ├── lookup/           # FR-L: active tickets by phone (no auth history leak)
│       ├── ticket-by-token/  # FR-T1: public ticket view (unguessable token)
│       ├── sync-tokens/      # FR-S4: staff JWT → full active-token list for offline cache
│       └── redeem/           # FR-S2/S3/S5: single + bulk redemption, 23505 = already redeemed
│
├── public/
│   ├── manifest.json         # PWA install (gate staff "install to home screen")
│   ├── sw.js                 # app-shell cache (network-first pages, cache-first assets)
│   └── icons/NOTE.txt        # add icon-192.png + icon-512.png before event day
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

After deploy, set `DARAJA_CALLBACK_URL=https://YOUR_PROJECT.supabase.co/functions/v1/daraja-callback`
and `NEXT_PUBLIC_APP_URL=https://your-vercel-domain` (used inside QR/wa.me links), redeploy secrets.

## 4. One-time setup tasks

1. **Admin user**: Supabase Dashboard → Authentication → add user (email/password).
   Then in SQL editor: `insert into admin_users (user_id, role) values ('<auth-uuid>', 'admin');`
   Gate staff: same, with `role = 'staff'`.
2. **Event**: /admin → create draft → add ticket types → **Go live**.
3. **Icons**: drop real PNGs into `public/icons/` (192/512) so staff can install the scanner
   to their home screen.
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
