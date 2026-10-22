import { Client } from 'pg';
// The app connects as a LIMITED database role. Even if the app were fully taken over, the database itself refuses to:
// edit or delete history (cash ledger, order events, ratings, audit trail, security log), change staff passwords or add staff,
// delete seller payments or top-ups, drop or alter tables, switch off the rules (triggers), or truncate anything.
const APPEND_ONLY = ['order_events', 'cash_ledger', 'wallet_ledger', 'ratings', 'staff_audit', 'security_events'];
export async function applyGrants(c: Client, role: string, password?: string) {
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const exists = (await q(`SELECT 1 FROM pg_roles WHERE rolname=$1`, [role])).length > 0;
  if (!exists) {
    if (!password || password.length < 16) throw new Error('APP_DB_PASSWORD (at least 16 characters) is required to create the role');
    await c.query((await q(`SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS s`, [role, password]))[0].s);
  } else if (password) {
    // Only the password: on hosted databases (Neon) the owner is not a superuser and may not restate special powers.
    await c.query((await q(`SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS s`, [role, password]))[0].s);
  }
  // The app role must never have special powers, whoever created it.
  const [r] = await q(`SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS powerful FROM pg_roles WHERE rolname=$1`, [role]);
  if (r.powerful) throw new Error(`database role "${role}" has special powers (superuser, create, replication or bypass rules): refusing to use it`);
  const I = (n: string) => '"' + n.replace(/"/g, '""') + '"', R = I(role);
  const db = (await q(`SELECT current_database() d`))[0].d;
  await c.query(`GRANT CONNECT ON DATABASE ${I(db)} TO ${R}`);
  await c.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${R}`);
  await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${R}`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${R}`);
  await c.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${APPEND_ONLY.map(I).join(', ')} FROM ${R}`);
  // Money records are never deleted (a seller payment, a top-up): they are only moved forward by their own rules.
  await c.query(`REVOKE DELETE, TRUNCATE ON cod_settlements, wallet_topups FROM ${R}`);
  await c.query(`REVOKE ALL ON staff_users FROM ${R}`);
  await c.query(`GRANT SELECT ON staff_users TO ${R}`);
  await c.query(`GRANT UPDATE (failed_attempts, locked_until, totp_last_step, token_version) ON staff_users TO ${R}`);
  await c.query(`REVOKE ALL ON schema_migrations FROM ${R}`);
  await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${R}`);
  return role;
}
