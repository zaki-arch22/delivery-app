// New authenticator secret for a staff member (lost phone). Also logs them out everywhere. Usage:
//   JWT_SECRET=... npm run reset-2fa -- you@example.com
import { Client } from 'pg';
import { seal } from '../security/crypto';
import { newSecret, otpauthUri } from '../security/totp';
(async () => {
  const email = (process.argv[2] ?? '').toLowerCase(), url = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || !email) throw new Error('Usage: npm run reset-2fa -- <email>  (needs OWNER_DATABASE_URL or DATABASE_URL, and JWT_SECRET)');
  const secret = newSecret(), c = new Client({ connectionString: url }); await c.connect();
  const r = await c.query(`UPDATE staff_users SET totp_secret_sealed=$2, totp_last_step=0, token_version=token_version+1, failed_attempts=0, locked_until=NULL WHERE email=$1 RETURNING id`, [email, seal(secret, 'totp')]);
  if (!r.rowCount) throw new Error('No such staff member');
  await c.query(`INSERT INTO staff_audit(staff_id, action, target_type, target_id, data) VALUES ($1,'reset_2fa','staff',$1::text,'{"by":"server owner"}')`, [r.rows[0].id]);
  console.log(`New authenticator secret for ${email} (shown once):\n  Secret: ${secret}\n  Link:   ${otpauthUri(secret, email)}\nAll their sessions were ended.`); await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
