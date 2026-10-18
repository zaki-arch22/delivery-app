// Builds the database from the schema files in db/, in order, once each. Creates NO data.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { applyGrants } from './grants';
(async () => {
  const url = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL; if (!url) throw new Error('OWNER_DATABASE_URL (or DATABASE_URL) is required');
  const c = new Client({ connectionString: url }); await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await c.query(`SELECT name FROM schema_migrations`)).rows.map(r => r.name));
  const dir = join(__dirname, '..', '..', 'db');
  for (const f of readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
    if (done.has(f)) { console.log(`skip   ${f}`); continue; }
    await c.query('BEGIN'); try { await c.query(readFileSync(join(dir, f), 'utf8')); await c.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]); await c.query('COMMIT'); console.log(`applied ${f}`); }
    catch (e) { await c.query('ROLLBACK'); throw e; }
  }
  if (process.env.APP_DB_PASSWORD) { await applyGrants(c, process.env.APP_DB_ROLE ?? 'delivery_app', process.env.APP_DB_PASSWORD); console.log('limited app role refreshed'); }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
