#!/usr/bin/env bash
# Runs EVERY test of the project against the real backend and a LOCAL TEST database:
#   database rules, backend (accounts, orders, notifications, staff, security attacks), staff console, mobile foundation.
# Run scripts/dev-setup.sh once first. Then:   bash scripts/test-all.sh
# Fresh random secrets are generated for every run; nothing secret is stored in the code.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/.local/test.env"
[ -f "$ENVF" ] || { echo "Run scripts/dev-setup.sh first"; exit 1; }
# shellcheck disable=SC1090
source "$ENVF"
export JWT_SECRET="$(openssl rand -hex 32)" HASH_PEPPER="$(openssl rand -hex 16)"
LOG="$ROOT/.local/logs"; mkdir -p "$LOG"
SERVER_PID=""; RESULTS=(); FAILED=0

for p in backend staff-console mobile; do [ -d "$ROOT/$p/node_modules" ] || (echo "installing $p ..."; cd "$ROOT/$p" && npm ci --silent); done

# The schema is current, and the limited role has exactly the right permissions.
(cd "$ROOT/backend" && OWNER_DATABASE_URL="$TEST_OWNER_URL" APP_DB_PASSWORD="$APP_PW" npx ts-node src/scripts/migrate.ts >"$LOG/migrate.log" 2>&1) || { echo "migration failed, see $LOG/migrate.log"; exit 1; }

psql_owner() { psql "$TEST_OWNER_URL" -v ON_ERROR_STOP=0 "$@"; }
wipe() { psql_owner -q -c "TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, profiles, accounts, zones, pricing_rules, staff_audit, staff_users, security_events RESTART IDENTITY CASCADE" >/dev/null; }

port_busy() { curl -s -m 1 -o /dev/null "http://127.0.0.1:$1/" ; }
# The server runs in its own process group, so stopping it stops EVERY process it started (npx, ts-node, node).
stop_server() {
  if [ -n "$SERVER_PID" ]; then kill -- "-$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; fi
  for p in 3398 3399; do for _ in $(seq 1 20); do port_busy "$p" || break; sleep 0.5; done; done
}
trap stop_server EXIT
# start_server <port> <logname> [ENV=VALUE ...]   The server always runs as the LIMITED database role.
start_server() {
  local port="$1" name="$2"; shift 2; stop_server
  if port_busy "$port"; then echo "port $port is already used by another program: stop it first"; exit 1; fi
  ( cd "$ROOT/backend" && exec setsid env DATABASE_URL="$TEST_APP_URL" TEST_HOOKS=1 PORT="$port" PUSH_TICK_MS=300 RETRY_BASE_S=0.3 TICK_MS=500 "$@" npx ts-node src/main.ts >"$LOG/server-$name.log" 2>&1 ) &
  SERVER_PID=$!
  for _ in $(seq 1 60); do curl -s -m 2 -o /dev/null "http://127.0.0.1:$port/get_me" -H 'x-forwarded-for: 127.0.0.9' && return 0; sleep 1; done
  echo "server did not start, see $LOG/server-$name.log"; exit 1
}
record() { if [ "$2" = 0 ]; then RESULTS+=("PASS  $1"); else RESULTS+=("FAIL  $1   (log: $LOG/$3.log)"); FAILED=1; fi; }
run() {  # run <title> <logname> <dir> <command...>
  local title="$1" name="$2" dir="$3"; shift 3
  echo "== $title"; (cd "$dir" && "$@") >"$LOG/$name.log" 2>&1; local rc=$?
  grep -E "passed|Tests:|Test Files" "$LOG/$name.log" | tail -2 | sed 's/\x1b\[[0-9;]*m//g; s/^/   /'
  record "$title" "$rc" "$name"
}
B="$ROOT/backend"; T="TEST_DATABASE_URL=$TEST_OWNER_URL"

# 1. Rules enforced by the database itself (10 forbidden actions must be refused, the cash balance must be 5000).
echo "== database rules"; wipe
psql_owner -f "$B/test/db_rules.sql" >"$LOG/db-rules.log" 2>&1
REFUSED=$(grep -c "ERROR:" "$LOG/db-rules.log"); BAL=$(grep -cE "^ t +\| +5000" "$LOG/db-rules.log")
echo "   refused: $REFUSED of 10 expected; final balance check: $BAL"
[ "$REFUSED" = 10 ] && [ "$BAL" = 1 ]; record "database rules" $? db-rules; wipe

# 2. Orders and accounts (fast timers).
start_server 3399 orders RATE_LIMIT_DISABLED=1 OFFER_TTL_S=3 SEARCH_WINDOW_S=15 WIDEN_AFTER_S=6
run "backend: orders, matching, cash, ratings" orders "$B" env $T npx ts-node test/orders.e2e.ts
wipe; run "backend: accounts and profiles" auth "$B" env $T npx ts-node test/auth.e2e.ts

# 3. Notifications.
start_server 3399 notify RATE_LIMIT_DISABLED=1 OFFER_TTL_S=3 SEARCH_WINDOW_S=60 WIDEN_AFTER_S=30
run "backend: notifications" notify "$B" env $T npx ts-node test/notify.e2e.ts

# 4. Staff functions, staff console, mobile foundation (slower timers).
start_server 3399 staff RATE_LIMIT_DISABLED=1 OFFER_TTL_S=10 SEARCH_WINDOW_S=120 WIDEN_AFTER_S=60
run "backend: staff functions" staff "$B" env $T npx ts-node test/staff.e2e.ts
run "staff console: contract match" console-contract "$ROOT/staff-console" node scripts/check-contract.mjs
run "staff console: type check and build" console-build "$ROOT/staff-console" env VITE_API_URL=http://localhost:3399 npm run build
run "staff console: screens against the real backend" console "$ROOT/staff-console" env VITE_API_URL=http://localhost:3399 $T npx vitest run
run "mobile: type check" mobile-tsc "$ROOT/mobile" npx tsc --noEmit
run "mobile: foundation against the real backend" mobile "$ROOT/mobile" env API_URL=http://localhost:3399 $T npx jest --runInBand

# 5. Attacks, with every protection switched ON (rate limits, proxy, cross-origin rules).
start_server 3398 security TRUST_PROXY=1 STAFF_ORIGINS=https://staff.example.test SMS_DAILY_CAP=100 OFFER_TTL_S=10 SEARCH_WINDOW_S=120 WIDEN_AFTER_S=60
run "backend: security attacks" security "$B" env $T TEST_APP_DATABASE_URL="$TEST_APP_URL" SMS_DAILY_CAP=100 npx ts-node test/security.e2e.ts
stop_server; wipe

echo; echo "================ SUMMARY ================"; printf '%s\n' "${RESULTS[@]}"
[ "$FAILED" = 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED (see the logs above)"
exit "$FAILED"
