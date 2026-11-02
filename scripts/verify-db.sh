#!/usr/bin/env bash
# Validates migrations 001-013 and every RLS test on a DISPOSABLE local PostgreSQL (Docker). Touches nothing else.
# Usage:  ./scripts/verify-db.sh            (needs Docker)   or   PGURL=postgres://... ./scripts/verify-db.sh   (a throwaway database you own)
# NEVER point PGURL at production or at a Supabase project. Exit code 0 only if every migration applies and no test prints FAIL.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=ntinginya-verify-db
cleanup() { [ -n "${STARTED:-}" ] && docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [ -z "${PGURL:-}" ]; then
  command -v docker >/dev/null || { echo "Docker is required (or set PGURL to a throwaway database)."; exit 2; }
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=verify -p 54399:5432 postgres:16 >/dev/null; STARTED=1
  PGURL="postgres://postgres:verify@localhost:54399/postgres"
  for i in $(seq 1 40); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  sleep 2
else
  case "$PGURL" in *supabase.co*|*pooler.supabase*) echo "Refusing: PGURL looks like a Supabase project. Use a disposable database."; exit 2;; esac
fi
psql_() { if [ -n "${STARTED:-}" ]; then docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; else psql "$PGURL" -v ON_ERROR_STOP=1 -q "$@"; fi; }
echo "== bootstrap (Supabase stand-ins)"; psql_ < supabase/tests/local_bootstrap.sql
for f in supabase/migrations/*.sql; do echo "== migration $(basename "$f")"; psql_ < "$f"; done
OUT=$(mktemp); FAILS=0
for t in supabase/tests/rls_isolation.sql supabase/tests/slice1_rls.sql supabase/tests/chat_rls.sql; do
  echo "== test $(basename "$t")"; psql_ < "$t" 2>&1 | tee -a "$OUT"
done
PASS=$(grep -c "PASS" "$OUT" || true); FAILS=$(grep -c "FAIL" "$OUT" || true)
echo "== RESULT: $PASS PASS, $FAILS FAIL"
[ "$FAILS" -eq 0 ] && [ "$PASS" -gt 0 ]
