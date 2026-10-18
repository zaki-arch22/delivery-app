// What happened in the last 24 hours that a security person would care about. Reads only. Usage: npm run security-report
import { Client } from 'pg';
(async () => {
  const url = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL; if (!url) throw new Error('OWNER_DATABASE_URL (or DATABASE_URL) is required');
  const c = new Client({ connectionString: url }); await c.connect();
  const by = (await c.query(`SELECT type, count(*)::int n, count(DISTINCT ip)::int ips FROM security_events WHERE created_at > now() - interval '24 hours' GROUP BY type ORDER BY n DESC`)).rows;
  console.log('SECURITY EVENTS, LAST 24 HOURS'); if (!by.length) console.log('  none'); for (const r of by) console.log(`  ${String(r.n).padStart(5)}  ${r.type.padEnd(28)} from ${r.ips} address(es)`);
  const top = (await c.query(`SELECT ip, count(*)::int n FROM security_events WHERE created_at > now() - interval '24 hours' AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 5`)).rows;
  if (top.length) { console.log('\nMOST ACTIVE SOURCES'); for (const r of top) console.log(`  ${String(r.n).padStart(5)}  ${r.ip}`); }
  const urgent = by.filter(r => ['refresh_token_reuse', 'staff_login_locked', 'sms_daily_cap_reached'].includes(r.type));
  console.log(urgent.length ? '\nNEEDS ATTENTION: ' + urgent.map(r => r.type).join(', ') : '\nNothing urgent.'); await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
