# Backend (NestJS + PostgreSQL/PostGIS)

All server logic: accounts and profiles, orders, matching, cash ledger, ratings, push-only notifications, staff functions, security.

## Folders
- `db/`            schema files 001 to 008, applied in order by `npm run migrate`. They create tables and rules only: NO data is ever inserted.
- `docs/API_CONTRACT_v1.md`  the contract the apps and the backend are both built from (every function, who may call it, what it returns).
- `docs/SECURITY.md`         security layers, bugs found and fixed, what is NOT covered, the routine.
- `deploy/`        server templates (HTTPS with Caddy, sandboxed service, encrypted backup, env file). Written but NOT yet tested on a real server.
- `src/`           the server. `src/dev/` holds test hooks, loaded only when `TEST_HOOKS=1` (a production server refuses to start with it).
- `src/scripts/`   migrate, setup-db-roles, create-admin, reset-2fa, launch-check, security-report.
- `test/`          268 end-to-end tests (73 are attacks) + `db_rules.sql`. They refuse to run on a database named `delivery`.

## Tests
From the project root: `bash scripts/dev-setup.sh` once, then `bash scripts/test-all.sh`.

## Launch on a real server (not done yet)
1. Create an empty PostgreSQL 16 database with PostGIS.
2. Copy `deploy/env.example` to `/etc/delivery/env` and fill it. Never set `TEST_HOOKS`.
3. `npm ci && npm run build`, then as the OWNER database user: `npm run migrate`, then `APP_DB_PASSWORD='(16+ random chars)' npm run setup-db-roles`, and point `DATABASE_URL` at the limited role `delivery_app`.
4. `ADMIN_PASSWORD='(12+ chars)' npm run create-admin -- you@example.com "Your Name"` (prints the authenticator secret ONCE).
5. `npm run launch-check` must show 0 blockers. Then `npm start`.
