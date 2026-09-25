# CLAUDE.md — project handoff

Read this before touching anything. It reflects the repository as of **2026-09-25**.

> **The event is Sunday 27 September 2026, doors 08:00.** Everything below is about a
> system that is live, taking real bookings, and being used by real guests. Changes here
> are not theoretical.

---

## 1. What this is

**MeatSoko Ticketing** — a standalone event ticketing and door-admission platform, built
against `MeatSoko_Ticketing_SRS_v1.0.md` (repo root). It is preparing for **NyamaFest**:
a single-venue, single-gate festival, capacity **500**, at Zetu Zetu Place, Githurai 44.

Stack: **Next.js 14.2.15** (App Router, `src/`) on Vercel + **Supabase** (Postgres with
RLS, and Edge Functions written in Deno).

### Repository layout — read this before configuring anything

```
m-ticket/                          <- git root. NO package.json here.
├── CLAUDE.md                      <- this file
├── HANDOFF.md                     <- machine-to-machine setup
├── MeatSoko_Ticketing_SRS_v1.0.md <- the requirements the code maps to
├── FOLDER_GUIDE.md                <- STALE 143-line copy; prefer the one below
└── meatsoko-ticketing/            <- the actual application
    ├── package.json, next.config.mjs, tsconfig.json
    ├── src/{app,components,lib}
    ├── supabase/{migrations,functions,config.toml,schema.sql}
    ├── scripts/
    └── *.md                       <- the live documentation
```

**The app is in a subdirectory and the git root has no `package.json`.** This has broken
deployment twice — see §4.

---

## 2. Production state

| | |
|---|---|
| Live URL | `https://event.meatsokogroup.com` |
| Vercel project | `m-ticket-azure` (team `meatsoko254`) |
| Production branch | `main` — every push deploys |
| Supabase project ref | `tyirenanflcmwfywurvk` |
| Payments | **OFF** (`events.payments_enabled = false`) — Safaricom has not enabled M-Pesa Express on the shortcode |
| Mail | Resend, live, sending from the verified `event.meatsokogroup.com` |

Because payments are off, **NyamaFest runs entirely on free, email-based reservations**.

---

## 3. Architecture and the main flow

### Two kinds of pass — this is the single most important distinction

| | Ticket | Reservation |
|---|---|---|
| Table | `public.tickets` | `public.reservations` |
| Created by | `confirm_payment()` — **paid orders only** | `create_reservation()` — free RSVP |
| Token column | `qr_token` | `access_token` |
| Pass URL, and the QR payload | `/t/<token>` | `/r/<token>` |
| Statuses | `active` / `redeemed` / `refunded` | `pending_payment` / `confirmed` / `checked_in` / `cancelled` |
| Holder identity | none on the row — lives on `orders.buyer_phone` | `guest_name`, `phone`, `email` on the row |
| **Rows right now** | **zero** | every guest who has booked |

`public.tickets` is empty and **correctly so**. Every `insert into public.tickets` lives
inside `confirm_payment()`; no payment means no ticket, ever. If you are looking for
guests, query `public.reservations`.

Both tokens are 32 hex characters (128-bit). Both are **bearer credentials**: the pass
pages are deliberately auth-free because passes are emailed and forwarded over WhatsApp
(SRS A3 — `wa.me` links, no WhatsApp Business API). Whoever holds the token can show the
QR. That is the intended model, and it is why §5 matters so much.

### Reservation flow

1. Guest submits `ReservationForm` → Edge Function `reserve`
2. `reserve` validates, throttles (per-phone and per-IP), then calls the
   `create_reservation()` RPC, which does capacity, pricing and preorders under a
   `pg_advisory_xact_lock`
3. Pass emailed via Resend (`_shared/reservation-email.ts`) with the QR as a **PNG
   attachment** — deliberately not a `data:` URI, which Gmail strips
4. Guest recovery: `/lookup` accepts **an email or a phone** and searches reservations and
   tickets

`create_reservation()` keys identity on **phone**: it matches `(event_id, phone)` and
*updates that row in place*, so re-submitting from one handset amends rather than
duplicates. See §10 for the consequences.

### Scanning and where `redeem/index.ts` fits

This is the gate path. There is exactly one admission write in the system.

```
Scanner.tsx  (client, staff-only page /scan)
  handleToken(raw)
    -> extracts /[a-f0-9]{32}/i from the QR payload or the manual-entry box
    -> invokeFn(supabase, "redeem", { token, station })
         |
         v
supabase/functions/redeem/index.ts        <- the ONLY caller of admit_pass
  requireStaff(req)                        <- verifies the staff JWT
  serviceClient()                          <- a CLEAN service-role client
  db.rpc("admit_pass", { p_token, p_station, p_scanned_by, p_scanned_at, p_arrived })
         |
         v
public.admit_pass()   (SECURITY DEFINER)
  -> resolve_pass(token)  : which table does this token belong to?
  -> insert into redemptions (append-only; unique per (subject, redemption_type))
  -> tickets.status='redeemed' | reservations.status='checked_in'
```

Points that matter:

- **`redeem` uses a clean service-role client, not the caller's JWT.** Passing the caller's
  `Authorization` header made PostgREST apply RLS and every scan failed `42501`. See the
  comment in `supabase/functions/_shared/supabase.ts`.
- **Duplicate protection is a database constraint, not application logic** — a unique index
  per `(subject, redemption_type)`. That is what makes the offline outbox safe to replay.
- **`resolve_pass` only ever matches the 32-hex token.** A reservation *number* like
  `NF-23X5MW` is enumerable and is deliberately **not** an admission credential.
- **Offline:** `Scanner` caches tokens in IndexedDB via `sync-tokens`, validates locally,
  queues to an outbox, and replays on reconnect. *Tap **Sync cache** before doors open.*
- Staff also have a **Guest list** tab inside `/scan` (`ScanTabs.tsx` → `ReservationsPanel`)
  for admitting by hand when a QR cannot be scanned. It goes through `redeem` too, so the
  `scanned_by` audit is identical.

### Roles

`public.admin_users` (`user_id` PK, `role`) is the entire authorisation model. `is_staff()`
and `is_admin()` read it. Enforcement is threefold: `requireStaff()`/`requireAdmin()` on
pages, RLS on tables, and `requireStaff()` inside Edge Functions. `src/lib/rbac.ts` is
**presentation only** — it decides which tabs render, nothing more. There is no sign-up
page and there must never be one.

---

## 4. Deployment conventions

- **Push to `main` deploys the frontend.** There is no separate release step.
- **Vercel Root Directory must be `meatsoko-ticketing`** and **Framework Preset must be
  `Next.js`.** With the preset on "Other", Vercel runs the build, prints a perfect route
  table, then publishes `public/` as static files — so every route 404s while the log looks
  flawless. This cost two debugging sessions. The repo root having no `package.json` means
  Vercel's import-time detection sets "Other" by default and changing Root Directory
  afterwards does **not** re-run detection.
- **Edge Functions deploy separately and are not part of the Vercel build:**
  `supabase functions deploy <name>` (run from `meatsoko-ticketing/`).
- **Migrations deploy separately:** `supabase db push`.
- `NEXT_PUBLIC_APP_URL` (Vercel) and `APP_URL` (Supabase secret) must both be the real
  domain. Edge Functions cannot read `NEXT_PUBLIC_*`, which is why there are two. **A QR
  bakes in whatever they say at the moment it is generated** — a pass issued with the wrong
  value points at the wrong host permanently.

## 5. The `admit_pass` vulnerability — fixed, and **must not be reverted**

**Discovered 2026-09-24.** `public.admit_pass` was callable by **anyone**, over PostgREST,
with nothing but the public anon key:

```
POST /rest/v1/rpc/admit_pass  {"p_token":"000…0","p_station":"probe"}
  -> HTTP 200  {"result": "not_found"}
```

**HTTP 200 means it executed.** With a *real* token it would have admitted the pass,
written the `redemptions` row and set the reservation to `checked_in`, under any
`p_station` string the caller chose. Because pass tokens are designed to be shared —
emailed, and forwarded via the WhatsApp share button — anyone in a chat where a pass was
posted could burn it. The guest would then meet a scanner saying *already admitted* at a
time and station nobody recognises, and **there is no override in the UI**.

### The actual source of access: PostgreSQL's default `PUBLIC` grant

**No `GRANT` or `REVOKE` for this function existed anywhere in the migrations.** That was
the bug. PostgreSQL grants `EXECUTE` on a new function to **`PUBLIC`** by default, and
`anon` and `authenticated` both inherited it from there.

> **Revoking from `anon` and `authenticated` alone is a no-op.** It is also the fix almost
> everyone writes first. The privilege is held by `PUBLIC`; that is the grant that has to
> go.

`admit_pass` performs **no `is_staff()` check of its own**. It relies entirely on `redeem`
calling `requireStaff()` — which is a real boundary only while nothing else can reach the
function.

### The fix

`supabase/migrations/20260924140000_lock_admit_pass.sql`, applied 2026-09-24:

```sql
revoke execute on function public.admit_pass(text, text, uuid, timestamptz, integer) from public;
revoke execute on function public.admit_pass(text, text, uuid, timestamptz, integer) from anon;
revoke execute on function public.admit_pass(text, text, uuid, timestamptz, integer) from authenticated;
grant  execute on function public.admit_pass(text, text, uuid, timestamptz, integer) to service_role;
```

Function logic untouched. Nothing else altered. It is safe because `redeem/index.ts` is the
only caller and it uses the service role — and that is only true because desk check-in was
moved off a direct client-side `supabase.rpc("admit_pass")` onto `redeem` first. Had it
stayed, this revoke would have broken the door list.

### **Do not revert this migration merely because the staff scan has not been run**

The post-fix live staff redemption is still pending (§6). **A pending verification is not
evidence of breakage.** The reasoning that it is safe is specific: `redeem` holds an
explicit `service_role` grant, and it was the only caller before and after.

Revert **only** if a real signed-in staff scan returns a **database permission error**
(`42501`). Any other failure — `invalid`, `not_found`, a network error — is something else
and reverting will not fix it, while re-exposing a confirmed vulnerability two days before
a live event.

---

## 6. Verification status — what a machine proved, and what still needs a human

**There is no test suite.** `package.json` has `dev`, `build`, `start`, `lint` — no tests,
no CI. Every verification in this project has been a human or a `curl`. Treat any claim of
"verified" with that in mind.

**Machine-verified:** `npm run lint`, `npm run build` (13 routes), `deno check` on changed
Edge Functions, live HTTP probes, and `anon` receiving `401 42501` from `admit_pass` where
it previously received `200`.

**Never exercised by a person** — all shipped 2026-09-23/24/25:

| Shipped | Untested |
|---|---|
| Scanner reading a **reservation** QR | **The gate.** Until 2026-09-24 it rejected every reservation QR as "Invalid code" |
| Staff *Guest list* tab + admit by hand | The door-list fallback |
| `/lookup` recovery by email | Guest self-service |
| Sign out | Shift handover |
| Duplicate-email warning | Deployed 2026-09-24 |
| `admit_pass` revoke | **The post-fix staff redemption** |
| Phone scrolling fix | Only visible below 560px |

> **Why the earlier verification missed the QR bug, and will miss this too if repeated.**
> The 2026-09-22 pass ran "in a real headless browser" — which has **no camera**. The
> duplicate-scan check therefore went through the manual-entry box, which takes a bare
> 32-hex token and never touches the URL parsing that was broken. **Typing a token is not
> a substitute for a camera scan of an emailed QR.** They exercise different code.

**The one test that settles the most:** sign in, camera-scan `NF-23X5MW` (the disposable
test reservation, due for deletion anyway). Admitting proves the QR fix, `redeem` reaching
`admit_pass` through the service role, and the revoke not having broken the staff path — all
at once. Scanning it a second time should say *already admitted*, proving the `redemptions`
row persisted. Then delete it.

## 7. Current launch blockers

1. **Staff accounts.** Only a demo admin exists. One account **per device**, per
   `ADMIN_ACCESS.md`, then delete the demo account. *Nobody can work the gate until this is
   done.* The redemption log records `scanned_by`, and hand-admission from the Guest list
   has no scan to corroborate it, so shared credentials defeat the audit entirely.
2. **The camera scan in §6.**
3. **Delete `NF-23X5MW`** (`0700000000`) — `confirmed` and will scan in. Guessable number,
   and its token has been shared in a chat transcript.

## 8. The documentation, and what each file is for

| File | Purpose |
|---|---|
| `meatsoko-ticketing/LAUNCH_CHECKLIST.md` | **Readiness view.** What blocks launch, what is done, what is verified vs assumed, and the order to do things. Start here. |
| `meatsoko-ticketing/REMAINING_GAPS.md` | **The honest defect register.** Everything known-wrong, unverified or deliberately deferred — including the `admit_pass` fix and its outstanding verification. Read before concluding anything works. |
| `meatsoko-ticketing/FOLDER_GUIDE.md` | **Codebase map** (210 lines) — module-by-module against SRS requirement ids, plus hard-won traps. Authoritative. |
| `FOLDER_GUIDE.md` (repo root) | **Stale 143-line copy.** Prefer the one above. |
| `meatsoko-ticketing/ADMIN_ACCESS.md` | Creating admin/staff accounts, the role matrix, revoking access, and what each screen does. |
| `meatsoko-ticketing/INTAKE.md` | What the system needs from the organiser — decisions, content, hard limits enforced in code. |
| `meatsoko-ticketing/DARAJA_PRODUCTION.md` | M-Pesa/Daraja go-live, and the exact wording to use with Safaricom. |
| `MeatSoko_Ticketing_SRS_v1.0.md` | The requirements. Code comments cite its ids (FR-T2, FR-L3, NFR-5…). |

## 9. Tooling conventions

### Edge Function logs — **the CLI cannot show them**

This CLI (**2.67.1**) has **no `supabase functions logs` subcommand**. `functions` offers
only `deploy`, `download`, `list`, `new`, `serve`. Do not invent it.

Logs live in the dashboard:
`https://supabase.com/dashboard/project/tyirenanflcmwfywurvk/functions` → function → *Logs*.

Look there when a reservation fails, a pass does not arrive (`reserve` logs the send result
and its reason), or the duplicate-email check misbehaves (`reserve` logs `dup check failed`
— that check **fails open**, so a broken RPC is otherwise silent).

### The CORS / EarlyDrop diagnostic

`supabase-js` sends `apikey` and `x-client-info` on **every** `functions.invoke()`. Any
header missing from `Access-Control-Allow-Headers` makes the browser reject the preflight
and never send the real request. The symptom is deeply misleading:

- the browser shows only a generic failure — the `fetch` never completed;
- **the function logs show a successful boot followed by `EarlyDrop` with no application
  logs** — the isolate answered the `OPTIONS` and exited; the `POST` never ran;
- nothing is written to the database and no rate-limit bucket moves;
- **`curl` works perfectly, because curl does not preflight.**

Keep `supabase/functions/_shared/cors.ts` the single source of allowed headers and answer
`OPTIONS` with its `preflight()`.

### Scripts (`meatsoko-ticketing/scripts/`)

| Script | Use |
|---|---|
| `db.sh` | Run SQL against the linked project. **There is no `supabase db query` command** — this wraps `psql` against the pooler URL saved by `supabase link`. Connects as `postgres`, so it sees through RLS. Needs `SUPABASE_DB_PASSWORD` in `.env.local` (gitignored). `./scripts/db.sh "select count(*) from reservations;"` |
| `delete-test-reservation.sql` | Removes `NF-23X5MW`, guarded on the phone as well as the number. **Not yet applied.** |
| `fix-nyamafest-launch.sql` | Sets `payments_enabled=false`, `capacity=500` on the stale closed event. **Not yet applied.** |

> **RLS will lie to you.** `reservations`, `orders` and `tickets` are staff-read-only.
> Querying them with the anon key returns `0` rows whatever the tables hold. A zero from
> the anon key is **not evidence**. Use `scripts/db.sh`.

### Database and migration conventions

- Timestamped files in `supabase/migrations/`, `YYYYMMDDHHMMSS_snake_case.sql`. Ten exist.
- **Forward-only.** Apply with `supabase db push` (from `meatsoko-ticketing/`). There are no
  down-migrations and no `supabase db reset` against production.
- Migrations carry **prose comments explaining the reasoning**, not just the DDL. Match that
  style — several of them exist specifically to stop the next person "simplifying" a
  deliberate decision.
- Business logic lives in `SECURITY DEFINER` Postgres functions (`create_reservation`,
  `admit_pass`, `confirm_payment`, `refund_order`), not in the application. Concurrency is
  handled with advisory locks and unique constraints.
- **Any new `SECURITY DEFINER` function must have its `EXECUTE` revoked from `PUBLIC`
  explicitly.** See §5. The default is not what you want, and it is silent.

### Testing / verification conventions

`npm run lint` and `npm run build` from `meatsoko-ticketing/`; `deno check <file>` for Edge
Functions (they are excluded from `tsconfig.json`, so `next build` does not check them).
Beyond that, verification is manual — and the honest scope of what a check proves belongs in
the commit message and in `REMAINING_GAPS.md`.

---

## 10. Known limitations and unresolved issues

Full register in `REMAINING_GAPS.md`. The ones that will bite:

- **`resolve_pass` is still `PUBLIC`-callable** — the other half of §5. Lower severity (a
  token holder is meant to see their own pass) but it leaks holder name and party size to
  anyone with a token. Deliberately not bundled with the `admit_pass` fix.
- **`order-status` returns ticket QR tokens** for a paid order to anyone supplying a
  `CheckoutRequestID`, which is derivable from a phone and a timestamp (~600 guesses). Only
  low-risk today because there are no tickets. Fix: key on `orderId`, already an
  unguessable UUID.
- **A shared handset silently overwrites a booking.** `unique (event_id, phone)` plus the
  in-place update means reserving for yourself and then for a friend from the same phone
  *replaces* your row — same number, one pass, first guest gone, no warning. Party size is
  the intended answer; nothing says so. The 2026-09-24 duplicate-email work addressed the
  *other* direction (same email, different phone) and did not touch this.
- **`notify_whatsapp` cannot deliver.** The field is editable and looks functional; it needs
  a `WHATSAPP_WEBHOOK_URL` that is not configured and has no provider behind it. Use
  `notify_email`. Organiser notification also fires only in the free-reservation branch of
  `reserve` — a paid preorder notifies nobody.
- **Email is stored case-preserved** (`nullif(btrim(p_email),'')`). Current lookups
  normalise with `lower()`; any future unique index needs a normalisation pass first.
- **The offline token cache survives sign-out** (guest names, party sizes in IndexedDB).
  Judged acceptable — it is only readable through an authenticated screen, and clearing it
  would force a re-sync over venue wifi.
- **No root `.gitignore`.** `.claude/settings.local.json` is ignored only via a *global*
  gitignore on the original machine; elsewhere it will appear untracked. Do not commit it.

---

## 11. Do not do this

- **Do not weaken authentication.** Not `verify_jwt = false` on a protected function, not
  bypassing `requireStaff()`, not relaxing RLS to make something work.
- **Do not create credentials — or accounts — to make an automated test pass.** If a check
  needs a staff session, say so and hand it to a human. That is the correct outcome, not a
  failure.
- **Do not grant `PUBLIC`, `anon` or `authenticated` execute on `admit_pass`.** Do not
  revert `20260924140000_lock_admit_pass.sql` because a verification is *pending*. Revert
  only on a real `42501` from a real staff scan (§5).
- **Do not touch unrelated RPC permissions** while working on this. `availability` and
  `expected_attendance` are intentionally granted to `anon`/`authenticated`; the public
  event page needs them.
- **Do not put secrets in commits, documentation or commit messages.** No API keys, no
  service-role key, no database password, no `access_token` values. `.env`, `.env.supabase`
  and `*.local.md` are gitignored for this reason. Name variables, never values.
- **Do not widen the scanner's 32-hex token check** to accept reservation numbers. The short
  number is enumerable and is deliberately not an admission credential.
- **Do not delete production data** to make something tidy. `NF-23X5MW` is the one row
  explicitly approved for deletion.
- **Do not trust an anon-key query returning zero rows.** RLS. See §9.

## 12. Next steps — genuinely outstanding

1. **Create real staff accounts**, one per device (`ADMIN_ACCESS.md`), then delete the demo
   account. *The last launch blocker.*
2. **Camera-scan `NF-23X5MW` while signed in** — settles the QR fix, the service-role path
   and the `admit_pass` revoke in one action. Scan twice. Then delete the row.
3. **Verify the `authenticated` role cannot call `admit_pass`** — never directly observed,
   only inferred from the `PUBLIC` revoke: `select proacl from pg_proc where proname =
   'admit_pass';`
4. **Revoke `EXECUTE` on `resolve_pass` from `PUBLIC`** — two lines, same pattern as §5.
5. **Confirm `NEXT_PUBLIC_APP_URL` and the `APP_URL` secret** are both
   `https://event.meatsokogroup.com`.
6. **Content:** poster (`banner_url` is null), real event copy, `contact_phone`,
   `notify_email`.
7. **On the day:** tap *Sync cache* on every gate phone before doors open.
8. **After the event:** the `order-status` token leak, the shared-handset overwrite, and
   `resolve_pass` if not already done. M-Pesa when Safaricom enables M-Pesa Express.
