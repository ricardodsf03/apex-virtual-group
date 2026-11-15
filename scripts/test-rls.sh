#!/usr/bin/env bash
# Testa as migrações Supabase e a RLS num Postgres descartável.
# Usa as variáveis PG* habituais (PGHOST, PGUSER, PGPASSWORD, PGPORT).
# Cria um banco de dados temporário e apaga no fim. Nunca toca no Supabase real.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="apex_rls_test_$$"
cleanup() { psql -q -d postgres -c "drop database if exists ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database ${DB}"
run() { psql -q -v ON_ERROR_STOP=1 -d "${DB}" -f "$1"; }

run supabase/tests/auth-stub.sql
for migration in supabase/migrations/*.sql; do
  echo "Aplicando ${migration}"
  run "${migration}"
done
run supabase/tests/rls.test.sql
