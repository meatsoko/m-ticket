# CLAUDE.md — repository root

Updated **2026-10-03**. The detailed, current project handoff is
**`meatsoko-ticketing/CLAUDE.md`** (product direction, routes, merch, Paystack, the
booking rules, what is live). This file holds the repository layout and the rules that
apply to every change. `HANDOFF.md` covers setting up a new machine.

> The site is **live and taking real bookings and payments**: NyamaFest Main
> (`nyamafest-main`), 17 October 2026, Thika Greens Golf Resort, from 6 AM till late,
> capacity 500. `main` is production and every push deploys.

---

## 1. Repository layout

```
m-ticket/                          <- git root. NO package.json here.
├── CLAUDE.md                      <- this file
├── HANDOFF.md                     <- machine-to-machine setup
├── MeatSoko_Ticketing_SRS_v1.0.md <- the original requirements (code cites FR-/NFR- ids)
└── meatsoko-ticketing/            <- the application (run every command from here)
    ├── src/{app,components,lib}
    ├── supabase/{migrations,functions,config.toml}
    ├── scripts/
    └── *.md                       <- the live documentation
```

## 2. Production

| | |
|---|---|
| Live URL | `https://event.meatsokogroup.com` |
| Vercel project | `m-ticket-azure` (team `meatsoko254`), Root Directory `meatsoko-ticketing`, Framework Preset **Next.js** |
| Supabase project ref | `tyirenanflcmwfywurvk` |
| Payments | **Paystack** (tickets, table upgrades, platter add-ons, vendors, merch). Daraja/M-Pesa Express is hidden behind `NEXT_PUBLIC_DARAJA_ENABLED`; Safaricom has not enabled it |
| Mail | Resend, from the verified `event.meatsokogroup.com` |

The Paystack account is shared with the WooCommerce store, which keeps its webhook.
Payments are confirmed on the buyer's return and by `paystack-reconcile` (pg_cron, every
5 min). Do not move the webhook.

## 3. Two kinds of pass

| | Ticket | Reservation |
|---|---|---|
| Table | `public.tickets` | `public.reservations` |
| Created by | payment confirmation of a paid ticket order | `create_reservation()` (General Admission and tables) |
| Token column / pass URL | `qr_token` → `/t/<token>` | `access_token` → `/r/<token>` |

NyamaFest Main runs on **reservations**: free General Admission, with tables and platters
bought through Paystack as upgrades/add-ons of the same pass. Online attendees are a
third, separate table (`online_registrations`) with a private watch link and no QR.

Tokens are 32 hex characters and are **bearer credentials**: passes are emailed and shared
over WhatsApp, and whoever holds the token can show the QR. Lookups never return tokens;
they email the pass to the address on the booking.

## 4. Gate admission — one write path

`Scanner` / Guest list → Edge Function `redeem` (`requireStaff()`, then a **clean
service-role client**) → `public.admit_pass()` → append-only `redemptions` (unique per
subject — this is what makes the offline outbox safe to replay).

- `resolve_pass` matches only the 32-hex token. Reservation numbers (`NF-…`) are
  enumerable and are **not** admission credentials; never widen the scanner to accept them.
- Tap **Sync cache** on every gate phone before doors open.

## 5. Permission lock-down — must not be reverted

PostgreSQL grants `EXECUTE` on every new function to **`PUBLIC`**; revoking from `anon` and
`authenticated` alone does nothing. `admit_pass` was callable with the anon key until
`20260924140000_lock_admit_pass.sql`; `20260929160000_lock_down_open_functions.sql` did the
same for `resolve_pass`, `confirm_payment`, `create_reservation` and the other internal
functions. Both are applied and verified (anon gets `42501`).

- **Every new `SECURITY DEFINER` function must revoke `EXECUTE` from `PUBLIC` explicitly**
  and grant only what it needs (usually `service_role`).
- Revert a lock-down only on a real `42501` from a real signed-in staff action — never
  because a verification is pending.

## 6. Deployment

- Push to `main` deploys the frontend (Vercel). Branch first; push only when asked.
- Edge Functions deploy separately: `supabase functions deploy <name>`.
- Migrations deploy separately: `supabase db push`. Check what is applied first, and never
  change live data or apply migrations without the user's authorisation.
- `NEXT_PUBLIC_APP_URL` (Vercel) and the `APP_URL` Supabase secret must both be the real
  domain — a pass bakes in whatever they say when it is issued.

## 7. Tooling and conventions

- **SQL against production:** `supabase db query --linked "<sql>"` (Management API, no DB
  password). `scripts/db.sh` is the older `psql` route.
- **RLS will lie to you.** Bookings, orders and tickets are staff-read-only; an anon-key
  query returns zero rows whatever the tables hold. A zero from the anon key is not evidence.
- **Edge Function logs** are only in the dashboard
  (`…/project/tyirenanflcmwfywurvk/functions` → function → Logs); the CLI has no
  `functions logs`.
- **CORS / EarlyDrop:** a header missing from `_shared/cors.ts` makes the browser drop the
  preflight; the logs show a boot then `EarlyDrop`, nothing runs, and `curl` still works.
  Details in `meatsoko-ticketing/TECHNICAL_DOCUMENTATION.md` §13.
- **Migrations:** `YYYYMMDDHHMMSS_snake_case.sql`, forward-only, with prose comments
  explaining the reasoning. Business logic lives in `SECURITY DEFINER` functions;
  concurrency uses advisory locks and unique constraints. `supabase/schema.sql` is the
  base layer a *fresh* database starts from (then every migration); never apply it to the
  live project.
- **Verification:** `npm run lint`, `npm run build`, `deno check` for Edge Functions (not
  covered by `next build`), and the integration harness
  `meatsoko-ticketing/tests/harness/run.sh` (Docker; real Postgres + PostgREST + the real
  Edge Functions, Paystack/Resend faked; 419 checks). Then live probes. State the honest
  scope of what a check proved.

## 8. Do not

- Weaken authentication: no `verify_jwt = false` on a protected function, no bypassing
  `requireStaff()`, no relaxing RLS to make something work.
- Create accounts or credentials so an automated check can pass. If a check needs a staff
  session, hand it to a human.
- Grant `PUBLIC`, `anon` or `authenticated` execute on `admit_pass`, or touch unrelated RPC
  permissions (`availability` and `expected_attendance` are deliberately public).
- Put secrets in commits, docs or commit messages — no keys, passwords or `access_token`
  values. Name variables, never values.
- Delete production data to tidy up. The test reservation `NF-23X5MW` (`0700000000`, still
  `confirmed` as of 2026-10-03) is the one row approved for deletion
  (`scripts/delete-test-reservation.sql`).
- Commit `.claude/settings.local.json` or `.DS_Store` (both in the root `.gitignore`).

## 9. Keeping Claude's context in sync across machines

Claude Code's auto-memory lives in `~/.claude/projects/…/memory/` on each machine and is
**not** synced. Anything a future session needs must be in the repo:

- **Durable facts and rules → these `CLAUDE.md` files** (this one for rules and layout,
  `meatsoko-ticketing/CLAUDE.md` for the current state of features, events and open items).
  Update them at the end of any session that changes what's live; keep dates absolute.
- **Machine-specific notes → `CLAUDE.local.md`** next to either `CLAUDE.md` (gitignored;
  Claude Code loads it automatically) — paths, local ports, personal preferences.
- **Setup → `HANDOFF.md`**: tools, env var *names*, accounts, first commands.
- **Tests → `meatsoko-ticketing/tests/harness/`**, so checks survive the machine.
- Secrets never go in any of these. Copy `.env` / `.env.local` across by hand (password
  manager), or recreate them from `.env.example` and the dashboards.
