// Tells you exactly what is still missing before real users can be served. Changes nothing.
import { Client } from 'pg';
type R = { level: 'OK' | 'BLOCKER' | 'WARNING'; text: string };
(async () => {
  const r: R[] = [], add = (level: R['level'], text: string) => r.push({ level, text });
  const env = process.env, url = env.OWNER_DATABASE_URL ?? env.DATABASE_URL;
  env.NODE_ENV === 'production' ? add('OK', 'NODE_ENV=production') : add('BLOCKER', 'NODE_ENV is not "production"');
  env.TEST_HOOKS === '1' ? add('BLOCKER', 'TEST_HOOKS is on: test routes and fake providers are enabled') : add('OK', 'Test hooks are off');
  (env.JWT_SECRET?.length ?? 0) >= 32 ? add('OK', 'JWT_SECRET is set') : add('BLOCKER', 'JWT_SECRET (32+ random characters) is missing');
  (env.HASH_PEPPER?.length ?? 0) >= 16 && env.HASH_PEPPER !== env.JWT_SECRET ? add('OK', 'HASH_PEPPER is set and different from JWT_SECRET') : add('BLOCKER', 'HASH_PEPPER (16+ random chars, different from JWT_SECRET) is missing or weak');
  Number(env.TRUST_PROXY ?? 0) > 0 ? add('OK', 'TRUST_PROXY is set (real client addresses behind the reverse proxy)') : add('WARNING', 'TRUST_PROXY is not set: behind a reverse proxy every visitor looks like the same address, so rate limits would hit everyone together');
  env.STAFF_ORIGINS ? add('OK', 'STAFF_ORIGINS is set (only the staff console may call from a browser)') : add('WARNING', 'STAFF_ORIGINS is not set: browsers will be refused (fine until the staff console is hosted)');
  // Providers
  add('BLOCKER', 'No SMS provider is connected: nobody can log in (SMS is used only for the login code)');
  env.FIREBASE_SERVICE_ACCOUNT_JSON ? add('OK', 'Firebase key is set (push notifications)') : add('BLOCKER', 'FIREBASE_SERVICE_ACCOUNT_JSON is missing: no phone push notifications');
  env.ROUTING_URL ? add('OK', 'ROUTING_URL is set (road distances from our own OSRM server; if it is down, prices fall back to an estimate)') : add('WARNING', 'ROUTING_URL is not set: distances use a straight-line estimate, so prices are approximate (set up OSRM: deploy/osrm.md)');
  if (!url) add('BLOCKER', 'DATABASE_URL is missing');
  else {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      const n = async (sql: string) => Number((await c.query(sql)).rows[0].n);
      const me = (await c.query(`SELECT rolsuper FROM pg_roles WHERE rolname = (SELECT usename FROM pg_stat_activity WHERE pid = pg_backend_pid())`)).rows[0];
      if (env.DATABASE_URL && env.OWNER_DATABASE_URL && env.DATABASE_URL !== env.OWNER_DATABASE_URL) { const a = new Client({ connectionString: env.DATABASE_URL }); try { await a.connect(); const r = (await a.query(`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user`)).rows[0]; (!r.rolsuper && !r.rolcreatedb && !r.rolcreaterole) ? add('OK', 'The app connects as a LIMITED database role') : add('BLOCKER', 'The app database role has dangerous powers (superuser/create)'); } catch (e: any) { add('BLOCKER', 'The app cannot connect with DATABASE_URL: ' + e.message); } finally { await a.end().catch(() => {}); } }
      else add(me?.rolsuper ? 'BLOCKER' : 'WARNING', 'The app and the owner share ONE database login: create the limited role (npm run setup-db-roles) and set DATABASE_URL to it, OWNER_DATABASE_URL to the owner');
      const mig = await n(`SELECT count(*) n FROM schema_migrations`).catch(() => 0);
      mig > 0 ? add('OK', `Database schema is built (${mig} migrations)`) : add('BLOCKER', 'Database schema is not built: run npm run migrate');
      if (mig > 0) {
        (await n(`SELECT count(*) n FROM staff_users WHERE active`)) > 0 ? add('OK', 'A staff account exists') : add('BLOCKER', 'No staff account: run npm run create-admin');
        (await n(`SELECT count(*) n FROM staff_users WHERE active AND totp_secret_sealed IS NULL`)) === 0 ? add('OK', 'Every active staff account has two-factor') : add('BLOCKER', 'A staff account has no two-factor: run npm run reset-2fa');
        (await n(`SELECT count(*) n FROM pricing_rules WHERE active`)) > 0 ? add('OK', 'A price table is active') : add('BLOCKER', 'No active price table: orders cannot be priced');
        (await n(`SELECT count(*) n FROM zones WHERE is_open`)) > 0 ? add('OK', 'At least one zone is open') : add('BLOCKER', 'No open zone: every order is refused');
        const acc = await n(`SELECT count(*) n FROM accounts`), ord = await n(`SELECT count(*) n FROM orders`);
        add(acc + ord === 0 ? 'OK' : 'WARNING', `Data in the database: ${acc} accounts, ${ord} orders ${acc + ord === 0 ? '(clean)' : '(if this is not a live system, it is not clean)'}`);
      }
    } catch (e: any) { add('BLOCKER', `Cannot reach the database: ${e.message}`); } finally { await c.end().catch(() => {}); }
  }
  for (const x of r) console.log(`${x.level.padEnd(8)} ${x.text}`);
  const b = r.filter(x => x.level === 'BLOCKER').length; console.log(`\n${b} blocker(s) before launch.`); process.exit(b ? 1 : 0);
})();
