#!/usr/bin/env bash
# Restore drill (NFR-07: run every quarter, target RTO 4 h). Restores a pg_dump custom-format dump into a SCRATCH database on a SCRATCH server, applies no migration,
# compares per-tenant row counts of every tenant table with a manifest, verifies the audit chain of every tenant, and prints the elapsed time against the RTO budget.
# See .claude/docs/deploy/backup-restore.md. It never touches the database named in the dump's source: it only creates and drops restore_drill_<epoch> on --admin-url.
#
#   restore-drill.sh --dump FILE --manifest FILE --admin-url URL     the drill (needs psql, pg_restore, node and the repo's node_modules)
#   restore-drill.sh --write-manifest --source-url URL --manifest FILE   write the per-tenant counts of a database (run right after the dump, same quiet moment)
#   restore-drill.sh --self-test                                      the whole thing against a throwaway Postgres 16 in Docker seeded with the demo data
# Options: --tolerance-rows N (default 0: allowed total row difference when the manifest was not taken at the exact dump moment), --rto-hours H (default 4), --keep (keep the scratch database).
# --admin-url is a superuser connection to a server that is NOT production (for example postgres://postgres:...@host:5432/postgres). Set DRILL_CONFIRM_SCRATCH=yes to confirm it.
# Exit: 0 pass, 1 row counts differ, 2 an audit chain is broken, 3 restore failed, 4 usage or a missing tool. Prints names and counts, never a row, never a password.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
TSX="$REPO/node_modules/.bin/tsx"

die() { echo "restore-drill: $*" >&2; exit "${2:-4}"; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (PostgreSQL client tools 16 or newer, node)"; }
with_db() { # with_db URL DBNAME -> URL with its database replaced
  local base="${1%%\?*}" q=""
  [ "$base" != "$1" ] && q="?${1#*\?}"
  echo "${base%/*}/$2$q"
}
# pg_dump and pg_restore must be the SAME major version as the server (a newer pg_dump writes settings an older server rejects). The self-test runs them inside its
# own Postgres 16 container (DRILL_PG_CONTAINER); a real drill runs them from the PostgreSQL client tools of the server's major version.
in_container_url() { echo "$1" | sed -E 's#@[^/]*/#@127.0.0.1:5432/#'; }
pg_restore_file() { # pg_restore_file URL FILE
  if [ -n "${DRILL_PG_CONTAINER:-}" ]; then docker exec -i "$DRILL_PG_CONTAINER" pg_restore --exit-on-error --dbname "$(in_container_url "$1")" < "$2"
  else pg_restore --exit-on-error --dbname "$1" "$2"; fi
}
pg_dump_file() { # pg_dump_file URL FILE
  if [ -n "${DRILL_PG_CONTAINER:-}" ]; then docker exec -i "$DRILL_PG_CONTAINER" pg_dump -Fc --dbname "$(in_container_url "$1")" > "$2"
  else pg_dump -Fc --dbname "$1" -f "$2"; fi
}
redact() { sed -E 's#(://[^:/@]*):[^@]*@#\1:***@#g'; }

MODE=drill; DUMP=""; MANIFEST=""; ADMIN=""; SOURCE=""; TOL=0; RTO_H=4; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --self-test) MODE=selftest ;;
    --write-manifest) MODE=manifest ;;
    --dump) DUMP="${2:-}"; shift ;;
    --manifest) MANIFEST="${2:-}"; shift ;;
    --admin-url) ADMIN="${2:-}"; shift ;;
    --source-url) SOURCE="${2:-}"; shift ;;
    --tolerance-rows) TOL="${2:-}"; shift ;;
    --rto-hours) RTO_H="${2:-}"; shift ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
case "$TOL" in ''|*[!0-9]*) die "--tolerance-rows must be a whole number" ;; esac
case "$RTO_H" in ''|*[!0-9]*) die "--rto-hours must be a whole number" ;; esac

# Per-tenant row counts of every base table that has a tenant_id column: lines "table<TAB>tenant_id<TAB>count", sorted. Superuser connections bypass RLS, so all tenants are counted.
counts() { # counts URL
  local url="$1" t
  psql "$url" -X -At -v ON_ERROR_STOP=1 -c "select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='public' and c.column_name='tenant_id' and t.table_type='BASE TABLE' order by 1" |
  while IFS= read -r t; do
    psql "$url" -X -At -F "$(printf '\t')" -v ON_ERROR_STOP=1 -c "select '$t', tenant_id::text, count(*) from public.\"$t\" group by tenant_id" || return 1
  done | LC_ALL=C sort
}

if [ "$MODE" = manifest ]; then
  need psql; [ -n "$SOURCE" ] && [ -n "$MANIFEST" ] || die "--write-manifest needs --source-url and --manifest"
  counts "$SOURCE" > "$MANIFEST.tmp" || { rm -f "$MANIFEST.tmp"; die "could not read the source database" 3; }
  mv "$MANIFEST.tmp" "$MANIFEST"
  echo "manifest written: $(wc -l < "$MANIFEST" | tr -d ' ') table-tenant rows, $(cut -f1 "$MANIFEST" | sort -u | wc -l | tr -d ' ') tables"
  exit 0
fi

drill() { # drill DUMP MANIFEST ADMIN  -> exit code per the header
  local dump="$1" manifest="$2" admin="$3" start end name scratch rc
  need psql; [ -n "${DRILL_PG_CONTAINER:-}" ] || need pg_restore; need node; [ -x "$TSX" ] || die "node_modules is missing: run npm ci in the repo"
  [ -f "$dump" ] || die "dump not found: $dump"
  [ -f "$manifest" ] || die "manifest not found: $manifest (write one with --write-manifest)"
  [ "${DRILL_CONFIRM_SCRATCH:-}" = yes ] || die "set DRILL_CONFIRM_SCRATCH=yes to confirm --admin-url is a scratch server, not production"
  TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' RETURN
  start=$(date +%s); name="restore_drill_$start"; scratch="$(with_db "$admin" "$name")"
  echo "== restore drill: creating scratch database $name on $(echo "$admin" | redact)"
  psql "$admin" -X -v ON_ERROR_STOP=1 -c "create database $name" >/dev/null || die "cannot create the scratch database" 3
  cleanup() { [ "$KEEP" = 1 ] || psql "$admin" -X -c "drop database if exists $name" >/dev/null 2>&1; }
  # step 1: roles exist cluster-wide (idempotent bootstrap), then the dump is restored with its owners and grants. No migration is applied.
  psql "$scratch" -X -v ON_ERROR_STOP=1 -q -f "$REPO/api/src/db/bootstrap/roles.sql" >/dev/null || { cleanup; die "roles bootstrap failed" 3; }
  echo "== step 1: pg_restore"
  pg_restore_file "$scratch" "$dump" >/dev/null 2>"$TMPD/err" || { echo "restore failed (first lines of the error):" >&2; head -5 "$TMPD/err" | redact >&2; rm -f "$TMPD/err"; cleanup; return 3; }
  rm -f "$TMPD/err"
  # step 2: per-tenant counts against the manifest
  echo "== step 2: per-tenant row counts against the manifest"
  counts "$scratch" > "$TMPD/counts" || { cleanup; die "could not count the restored tables" 3; }
  awk -F '\t' -v tol="$TOL" 'NR==FNR { m[$1 FS $2]=$3; keys[$1 FS $2]=1; next } { r[$1 FS $2]=$3; keys[$1 FS $2]=1 }
    END { diff=0; bad=0; tables=0
      for (k in keys) { d=r[k]-m[k]; if (d<0) d=-d; if (d>0) { diff+=d; bad++; split(k,p,FS); printf "  differs: %s tenant %s manifest %d restored %d\n", p[1], p[2], m[k], r[k] } }
      printf "  table-tenant rows compared: %d, rows differing in total: %d (tolerance %d)\n", length(keys), diff, tol
      exit (diff>tol) ? 1 : 0 }' "$manifest" "$TMPD/counts"
  rc=$?; rm -f "$TMPD/counts"
  if [ $rc -ne 0 ]; then cleanup; echo "RESULT: FAIL (row counts)"; return 1; fi
  # step 3: audit chain of every tenant
  echo "== step 3: audit chain of every tenant"
  ( cd "$REPO/api" && DRILL_DATABASE_URL="$scratch" "$TSX" scripts/restore-verify.ts ) || { rc=$?; cleanup; echo "RESULT: FAIL (audit chain)"; [ $rc -eq 1 ] && return 2; return 3; }
  cleanup
  end=$(date +%s)
  local secs=$((end-start)) budget=$((RTO_H*3600)) verdict="within"
  [ $secs -gt $budget ] && verdict="OVER"
  echo "== elapsed: $((secs/60)) min $((secs%60)) s of the ${RTO_H} h RTO budget ($verdict). Record it, plus the dump download time, in the drill log."
  echo "RESULT: PASS"
  return 0
}

selftest() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || { echo "SKIP: docker is not available, the restore drill self-test needs a Docker daemon"; return 0; }
  need psql; need node
  [ -x "$TSX" ] || die "node_modules is missing: run npm ci in the repo"
  local cname="opsdesk-drill-selftest-$$" tmp port admin src owner user rc
  tmp="$(mktemp -d)"
  trap 'docker rm -f "'"$cname"'" >/dev/null 2>&1; rm -rf "'"$tmp"'"' EXIT
  docker run -d --rm --name "$cname" -e POSTGRES_PASSWORD=selftest-pw -p 127.0.0.1::5432 postgres:16 >/dev/null || die "could not start the Postgres container" 3
  export DRILL_PG_CONTAINER="$cname"
  port="$(docker port "$cname" 5432/tcp | head -1 | sed 's/.*://')"
  admin="postgres://postgres:selftest-pw@127.0.0.1:$port/postgres"
  local i=0; until psql "$admin" -X -qAt -c "select 1" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && die "the Postgres container did not become ready" 3; sleep 1; done
  echo "== self-test: building a demo database (roles, migrations as app_owner, demo seed)"
  psql "$admin" -X -qAt -c "create database opsdesk_src" >/dev/null
  psql "$(with_db "$admin" opsdesk_src)" -X -v ON_ERROR_STOP=1 -q -f "$REPO/api/src/db/bootstrap/roles.sql" >/dev/null
  psql "$admin" -X -qAt -c "alter role app_owner login password 'owner-selftest-pw'" -c "alter role app_user login password 'user-selftest-pw'" >/dev/null
  src="$(with_db "$admin" opsdesk_src)"
  owner="postgres://app_owner:owner-selftest-pw@127.0.0.1:$port/opsdesk_src"; user="postgres://app_user:user-selftest-pw@127.0.0.1:$port/opsdesk_src"
  ( cd "$REPO/api" && DATABASE_OWNER_URL="$owner" "$TSX" scripts/migrate.ts ) || die "migrations failed" 3
  ( cd "$REPO/api" && NODE_ENV=development ALLOW_DEMO_SEED=1 SEED_DEMO_PASSWORD="selftest-demo-password-12" DATABASE_URL="$user" DATABASE_OWNER_URL="$owner" BETTER_AUTH_SECRET="selftest-auth-secret-selftest-auth-secret" APP_URL="http://localhost:3000" "$TSX" scripts/seed-demo.ts >/dev/null ) || die "demo seed failed" 3
  pg_dump_file "$src" "$tmp/good.dump" || die "pg_dump failed" 3
  "$0" --write-manifest --source-url "$src" --manifest "$tmp/manifest.tsv" || die "manifest failed" 3
  export DRILL_CONFIRM_SCRATCH=yes
  echo "== self-test 1/3: a good dump must pass"
  "$0" --dump "$tmp/good.dump" --manifest "$tmp/manifest.tsv" --admin-url "$admin"; rc=$?
  [ $rc -eq 0 ] || die "self-test 1 failed: expected exit 0, got $rc" 1
  echo "== self-test 2/3: a manifest with a wrong count must fail with exit 1"
  awk -F '\t' 'BEGIN{OFS="\t"} NR==1 {$3=$3+1} {print}' "$tmp/manifest.tsv" > "$tmp/bad-manifest.tsv"
  "$0" --dump "$tmp/good.dump" --manifest "$tmp/bad-manifest.tsv" --admin-url "$admin" >/dev/null; rc=$?
  [ $rc -eq 1 ] || die "self-test 2 failed: expected exit 1, got $rc" 1
  echo "== self-test 3/3: a tampered audit row must fail the chain check with exit 2"
  psql "$src" -X -qAt -v ON_ERROR_STOP=1 -c "update audit_events set action = action || '.edited' where id = (select id from audit_events order by seq limit 1)" >/dev/null
  pg_dump_file "$src" "$tmp/tampered.dump" || die "pg_dump failed" 3
  "$0" --dump "$tmp/tampered.dump" --manifest "$tmp/manifest.tsv" --admin-url "$admin" >/dev/null; rc=$?
  [ $rc -eq 2 ] || die "self-test 3 failed: expected exit 2, got $rc" 1
  echo "SELF-TEST: PASS"
}

case "$MODE" in
  selftest) selftest; exit $? ;;
  drill) [ -n "$DUMP" ] && [ -n "$MANIFEST" ] && [ -n "$ADMIN" ] || die "usage: --dump FILE --manifest FILE --admin-url URL (see --help)"; drill "$DUMP" "$MANIFEST" "$ADMIN"; exit $? ;;
esac
