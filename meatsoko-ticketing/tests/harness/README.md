# Integration harness

`./tests/harness/run.sh` (from `meatsoko-ticketing/`, Docker running) builds a fresh
Postgres from this repo, puts PostgREST in front of it, and drives the **real Edge Function
files** under Deno: bookings, General Admission + table upgrades, platter add-ons, Paystack
confirmation and reconciliation, refunds, merchandise checkout and FX, vendors, online
attendance, investors, Event Orders, lookups, and the RLS/permission lock-downs. Only Paystack, the FX
feed and Resend are faked. **It never touches the live Supabase project.**

Expect `ok: 329   FAIL: 0` (2026-10-06). `KEEP_LOG=1` keeps the full output in
`last-run.log` (gitignored).

| File | What |
|---|---|
| `run.sh` | builds the database (`stubs.sql` → `supabase/schema.sql` → every migration except `*_cron.sql` → `test-helpers.sql`), starts the containers, runs `test.ts` |
| `stubs.sql` | stand-ins for what Supabase provides: API roles, `auth` schema, pgcrypto, default grants |
| `test-helpers.sql` | test-only `test_make_user()` for staff/admin checks |
| `test.ts` | the checks, in numbered sections; add new ones before the final summary |

When you add a migration or change an Edge Function, run it before deploying, and add
checks for the new behaviour — including that anon/staff can't do what they shouldn't.
