// First start of a hosted server: creates the FIRST staff account if there is none yet, from the host's settings
// FIRST_ADMIN_EMAIL, FIRST_ADMIN_PASSWORD (12+ characters) and FIRST_ADMIN_NAME, and prints the authenticator secret ONCE
// in the server log. Does nothing when FIRST_ADMIN_EMAIL is empty or a staff account already exists.
// After setting up the authenticator app, delete FIRST_ADMIN_PASSWORD from the host's settings.
import { Client } from 'pg';
import { hashPassword } from '../auth/password';
import { seal } from '../security/crypto';
import { newSecret, otpauthUri } from '../security/totp';
(async () => {
  const email = (process.env.FIRST_ADMIN_EMAIL ?? '').trim().toLowerCase(), pw = process.env.FIRST_ADMIN_PASSWORD ?? '', name = (process.env.FIRST_ADMIN_NAME ?? '').trim() || 'Owner';
  if (!email) return;
  const c = new Client({ connectionString: process.env.OWNER_DATABASE_URL }); await c.connect();
  try {
    const n = (await c.query(`SELECT count(*)::int n FROM staff_users`)).rows[0].n;
    if (n > 0) { console.log('first-admin: a staff account already exists, nothing to do (you can delete FIRST_ADMIN_* settings)'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('FIRST_ADMIN_EMAIL is not an email address');
    if (pw.length < 12) throw new Error('FIRST_ADMIN_PASSWORD must have at least 12 characters');
    const secret = newSecret();
    await c.query(`INSERT INTO staff_users(email, name, password_hash, totp_secret_sealed) VALUES ($1, $2, $3, $4)`, [email, name.slice(0, 60), hashPassword(pw), seal(secret, 'totp')]);
    console.log(`\n================ FIRST STAFF ACCOUNT CREATED: ${email} ================\n` +
      `Add this secret to a free authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP):\n  ${secret}\n` +
      `(or open this link on the phone: ${otpauthUri(secret, email)})\n` +
      `Shown ONCE. Then delete FIRST_ADMIN_PASSWORD from the server settings.\n=====================================================================\n`);
  } finally { await c.end(); }
})().catch(e => { console.error('first-admin: ' + e.message); process.exit(1); });
