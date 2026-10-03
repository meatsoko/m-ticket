#!/usr/bin/env bash
# Local integration harness: real Postgres + PostgREST + the real Edge Function
# files under Deno. Only Paystack, the FX feed and Resend are faked (in test.ts).
# Needs Docker. Nothing touches the live Supabase project.
#
#   ./tests/harness/run.sh            # from meatsoko-ticketing/
#   KEEP_LOG=1 ./tests/harness/run.sh # keep the full log in tests/harness/last-run.log
#
# The database is built fresh on every run, from the repo, in this order:
#   stubs.sql          what Supabase provides (roles, auth schema, pgcrypto, grants)
#   supabase/schema.sql  the original core tables (the base the migrations build on)
#   supabase/migrations/*.sql in order, EXCEPT *_cron.sql (pg_cron/pg_net are not
#                      in plain Postgres; the reconcile function itself is tested)
#   test-helpers.sql   test-only: create auth users for staff/admin checks
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
NET=mt-harness; PG=mt-harness-pg; REST=mt-harness-rest
JWT_SECRET="test-secret-test-secret-test-secret-00"   # local only; test.ts signs with it
BUNDLE="$(mktemp -t mt-harness-XXXX)"; LOG="$(mktemp -t mt-harness-log-XXXX)"

cleanup() { docker rm -f "$PG" "$REST" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -f "$BUNDLE"; }
trap cleanup EXIT
cleanup
{
  cat "$HERE/stubs.sql"
  cat "$APP/supabase/schema.sql"
  for f in "$APP"/supabase/migrations/*.sql; do
    case "$f" in *_cron.sql) continue ;; esac
    printf '\n-- ===== %s =====\n' "$(basename "$f")"; cat "$f"
  done
  cat "$HERE/test-helpers.sql"
} > "$BUNDLE"

docker network create "$NET" >/dev/null
docker run -d --rm --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
docker cp "$BUNDLE" "$PG:/all.sql"
if ! docker exec "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q -f /all.sql >"$LOG" 2>&1; then
  echo "Database build failed:"; grep -m5 ERROR "$LOG"; exit 1
fi
docker run -d --rm --name "$REST" --network "$NET" \
  -e PGRST_DB_URI="postgres://authenticator:auth@$PG:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" postgrest/postgrest:v12.2.3 >/dev/null
sleep 4
# test.ts reaches PostgREST at http://mt-harness-rest:3000 (see its fetch shim).
docker run --rm --network "$NET" -v "$APP/supabase/functions:/fns:ro" -v "$HERE:/harness:ro" -v "$APP/src:/src:ro" \
  -w /harness denoland/deno:2.6.3 deno run --allow-net --allow-env --allow-read --no-check test.ts >"$LOG" 2>&1 || true

ok=$(grep -cE '^ok' "$LOG" || true); fail=$(grep -cE '^FAIL' "$LOG" || true)
grep -E '^FAIL' "$LOG" || true
finished=0; grep -qE 'all passed|[0-9]+ FAILED' "$LOG" && finished=1
[ "$finished" = 1 ] || { echo "The run stopped early (crash) — last lines:"; tail -8 "$LOG" | cut -c1-200; }
echo "ok: $ok   FAIL: $fail"
[ "${KEEP_LOG:-}" = 1 ] && cp "$LOG" "$HERE/last-run.log"
rm -f "$LOG"
[ "$finished" = 1 ] && [ "$fail" = 0 ] && [ "$ok" -gt 0 ]
