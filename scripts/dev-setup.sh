#!/usr/bin/env bash
# Prepares a LOCAL TEST database on this computer. It never touches a real (production) database.
# Run once on a new computer, after installing Node.js 22, PostgreSQL 16 with PostGIS, and (Ubuntu/Debian) libtbb12 libtbbmalloc2 for the OSRM road-distance tests:
#   bash scripts/dev-setup.sh
# It creates:
#   - database  delivery_test
#   - role      delivery_test_owner  (local tests only; superuser so migrations can create extensions and roles)
#   - role      delivery_app         (the LIMITED role the server runs as, exactly like production)
# The generated passwords are saved in .local/test.env (ignored by git, never commit it).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/.local/test.env"
mkdir -p "$ROOT/.local"; chmod 700 "$ROOT/.local"

if [ -f "$ENVF" ]; then
  # shellcheck disable=SC1090
  source "$ENVF"
else
  OWNER_PW="$(openssl rand -hex 24)"; APP_PW="$(openssl rand -hex 24)"
  cat > "$ENVF" <<EOF
OWNER_PW=$OWNER_PW
APP_PW=$APP_PW
TEST_OWNER_URL=postgres://delivery_test_owner:$OWNER_PW@127.0.0.1:5432/delivery_test
TEST_APP_URL=postgres://delivery_app:$APP_PW@127.0.0.1:5432/delivery_test
EOF
  chmod 600 "$ENVF"
fi
# shellcheck disable=SC1090
source "$ENVF"

SQL="$(mktemp /tmp/delivery-setup-XXXX.sql)"; chmod 644 "$SQL"
cat > "$SQL" <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delivery_test_owner') THEN
    CREATE ROLE delivery_test_owner LOGIN SUPERUSER PASSWORD '$OWNER_PW';
  ELSE
    ALTER ROLE delivery_test_owner LOGIN SUPERUSER PASSWORD '$OWNER_PW';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE delivery_test OWNER delivery_test_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'delivery_test') \gexec
EOF
if [ "$(id -u)" = "0" ]; then su postgres -c "psql -v ON_ERROR_STOP=1 -q -f '$SQL'"; else sudo -u postgres psql -v ON_ERROR_STOP=1 -q -f "$SQL"; fi
rm -f "$SQL"
echo "test database and owner role ready"

cd "$ROOT/backend"
[ -d node_modules ] || npm ci --silent
# Build the schema from the migration files, then create/refresh the limited app role.
OWNER_DATABASE_URL="$TEST_OWNER_URL" APP_DB_PASSWORD="$APP_PW" npx ts-node src/scripts/migrate.ts
echo
echo "Done. The test database is built only from the migration files (no data inserted)."
echo "Next: bash scripts/test-all.sh"
