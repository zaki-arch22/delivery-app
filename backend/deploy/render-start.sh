#!/usr/bin/env bash
# Start command for a small free host (Render web service + Neon database). Steps on every start:
#   1. bring the database schema up to date and refresh the LIMITED app role (as the database owner);
#   2. create the first staff account if there is none (FIRST_ADMIN_*), printing its authenticator secret once;
#   3. start the server as the LIMITED role, WITHOUT the owner's password in its environment.
# Setup guide: deploy/render.md
set -euo pipefail
cd "$(dirname "$0")/.."
OWNER_DATABASE_URL="$(node dist/scripts/db-url.js owner)"; export OWNER_DATABASE_URL
node dist/scripts/migrate.js
node dist/scripts/first-admin.js
DATABASE_URL="$(node dist/scripts/db-url.js app)"; export DATABASE_URL
export STAFF_CONSOLE_DIR="${STAFF_CONSOLE_DIR:-$PWD/../staff-console/dist}"
exec env -u OWNER_DATABASE_URL -u FIRST_ADMIN_PASSWORD -u APP_DB_PASSWORD node dist/main.js
