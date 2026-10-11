#!/usr/bin/env bash
# Run SQL against the linked Supabase project.
#
# The CLI has no `supabase db query` — `db` only does diff/dump/lint/pull/push/
# reset/start. This wraps psql against the pooler connection `supabase link`
# already saved in supabase/.temp/pooler-url.
#
# Needs the database password (Dashboard → Settings → Database). Either export
# SUPABASE_DB_PASSWORD, or put it in .env.local as SUPABASE_DB_PASSWORD=...
#
#   ./scripts/db.sh "select count(*) from reservations;"
#   ./scripts/db.sh < some_query.sql
#
# Connects as `postgres`, so it bypasses RLS — unlike the anon key, which sees
# nothing in reservations/orders (both are staff-read-only).
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env.local ] && { set -a; . ./.env.local; set +a; }

url_file=supabase/.temp/pooler-url
if [ ! -f "$url_file" ]; then
  echo "No $url_file — run: supabase link --project-ref <ref>" >&2
  exit 1
fi

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "SUPABASE_DB_PASSWORD is not set." >&2
  echo "Get it from Dashboard → Settings → Database, then:" >&2
  echo "  echo 'SUPABASE_DB_PASSWORD=...' >> .env.local" >&2
  exit 1
fi

# The saved URL has no password in it; hand it to psql via PGPASSWORD so we
# never have to URL-encode the thing.
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

if [ "$#" -gt 0 ]; then
  exec psql "$(cat "$url_file")" -v ON_ERROR_STOP=1 -c "$*"
else
  exec psql "$(cat "$url_file")" -v ON_ERROR_STOP=1
fi
