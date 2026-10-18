import { Client } from 'pg';
// The app connects as a LIMITED database role. Even if the app were fully taken over, the database itself refuses to:
// edit or delete history (cash ledger, order events, ratings, audit trail, security log), change staff passwords or add staff,
// drop or alter tables, switch off the rules (triggers), or truncate anything.
const APPEND_ONLY = ['order_events', 'cash_ledger', 'ratings', 'staff_audit', 'security_events'];
export async function applyGrants(c: Client, role: string, password?: string) {
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const exists = (await q(`SELECT 1 FROM pg_roles WHERE rolname=$1`, [role])).length > 0;
  if (!exists) {
    if (!password || password.length < 16) throw new Error('APP_DB_PASSWORD (at least 16 characters) is required to create the role');
    await c.query((await q(`SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS s`, [role, password]))[0].s);
  } else if (password) {
    await c.query((await q(`SELECT format('ALTER ROLE %I PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS s`, [role, password]))[0].s);
  }
  const I = (n: string) => '"' + n.replace(/"/g, '""') + '"', R = I(role);
  const db = (await q(`SELECT current_database() d`))[0].d;
  await c.query(`GRANT CONNECT ON DATABASE ${I(db)} TO ${R}`);
  await c.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${R}`);
  await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${R}`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${R}`);
  await c.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${APPEND_ONLY.map(I).join(', ')} FROM ${R}`);
  await c.query(`REVOKE ALL ON staff_users FROM ${R}`);
  await c.query(`GRANT SELECT ON staff_users TO ${R}`);
  await c.query(`GRANT UPDATE (failed_attempts, locked_until, totp_last_step, token_version) ON staff_users TO ${R}`);
  await c.query(`REVOKE ALL ON schema_migrations FROM ${R}`);
  await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${R}`);
  return role;
}
