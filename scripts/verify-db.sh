#!/usr/bin/env bash
# Validates migrations and SQL tests only inside a Docker database created by this invocation.
# External database URLs are refused; this script never connects to a supplied PostgreSQL target.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/verify-db-safety.mjs

command -v docker >/dev/null || { echo "Docker is required to create an isolated disposable database."; exit 2; }
if [ -n "${DOCKER_HOST:-}" ]; then
  echo "Refusing database validation: DOCKER_HOST may point to a remote Docker daemon."
  exit 2
fi
DOCKER_CONTEXT_NAME=$(docker context show)
DOCKER_ENDPOINT=$(docker context inspect "$DOCKER_CONTEXT_NAME" --format '{{.Endpoints.docker.Host}}')
case "$DOCKER_ENDPOINT" in
  unix://*) ;;
  *) echo "Refusing database validation: Docker context is not a local Unix socket."; exit 2 ;;
esac
CONTAINER_ID=
OUT=
cleanup() {
  [ -n "$OUT" ] && rm -f -- "$OUT"
  [ -n "$CONTAINER_ID" ] && docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

CONTAINER_ID=$(docker run -d -e POSTGRES_PASSWORD=verify postgres:16)
ready=0
for i in $(seq 1 40); do
  if docker exec "$CONTAINER_ID" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || { echo "Disposable PostgreSQL container did not become ready."; exit 2; }
psql_() { docker exec -i "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }
echo "== bootstrap (Supabase stand-ins)"; psql_ < supabase/tests/local_bootstrap.sql
for f in supabase/migrations/*.sql; do echo "== migration $(basename "$f")"; psql_ < "$f"; done

OUT=$(mktemp)
for t in supabase/tests/rls_isolation.sql supabase/tests/slice1_rls.sql supabase/tests/chat_rls.sql supabase/tests/voice_upload_guards.sql supabase/tests/ai_usage_limits.sql supabase/tests/marketplace_rls.sql; do
  echo "== test $(basename "$t")"
  psql_ < "$t" 2>&1 | tee -a "$OUT"
done
PASS=$(grep -c "PASS" "$OUT" || true)
FAILS=$(grep -c "FAIL" "$OUT" || true)
echo "== RESULT: $PASS PASS, $FAILS FAIL"
[ "$FAILS" -eq 0 ] && [ "$PASS" -gt 0 ]
