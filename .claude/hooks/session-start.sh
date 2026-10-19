#!/bin/bash
# Prepares a fresh Claude Code cloud machine so `bash scripts/test-all.sh` works:
# PostGIS, a running PostgreSQL 16, npm packages, and the local TEST database.
# Safe to run many times. Never touches a real (production) database.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# PostGIS (maps in the database) and the two libraries the OSRM routing engine needs (road-distance tests).
if ! ls /usr/share/postgresql/16/extension/postgis.control >/dev/null 2>&1 || ! ldconfig -p | grep -q libtbbmalloc.so.2 || ! ldconfig -p | grep -q libtbb.so.12; then
  apt-get update -qq >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16-postgis-3 libtbb12 libtbbmalloc2 >/dev/null
fi
pg_lsclusters -h | grep -q online || pg_ctlcluster 16 main start

for p in backend staff-console mobile; do
  (cd "$ROOT/$p" && { [ -d node_modules ] && [ node_modules -nt package-lock.json ] || npm install --no-audit --no-fund --silent; })
done

bash "$ROOT/scripts/dev-setup.sh" >/dev/null
echo "session-start: database and packages ready"
