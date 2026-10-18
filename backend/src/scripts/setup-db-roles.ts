// Creates (or refreshes) the limited database role the app uses. Run it after every migration. Usage:
//   OWNER_DATABASE_URL=... APP_DB_PASSWORD='(16+ random chars)' npm run setup-db-roles
import { Client } from 'pg';
import { applyGrants } from './grants';
(async () => {
  const url = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL; if (!url) throw new Error('OWNER_DATABASE_URL is required');
  const c = new Client({ connectionString: url }); await c.connect();
  const role = process.env.APP_DB_ROLE ?? 'delivery_app';
  await applyGrants(c, role, process.env.APP_DB_PASSWORD); console.log(`Database role "${role}" is ready (limited: cannot edit history, staff passwords, or the schema).`); await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
