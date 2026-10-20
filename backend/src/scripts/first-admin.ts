// Hosted server start (deploy/render-start.sh), run as the database owner:
//  - FIRST_ADMIN_EMAIL (+ FIRST_ADMIN_PASSWORD, 12+ chars, FIRST_ADMIN_NAME): creates the FIRST staff account if none exists;
//  - FIRST_ADMIN_RESET = the same email, with a NEW FIRST_ADMIN_PASSWORD: that staff member gets a new authenticator secret and
//    that password (once per password), is unlocked and logged out everywhere. For a lost authenticator or a secret that scrolled out of the log. Only
//    someone who can change the host's settings can do this (the same trust as creating the account).
// The authenticator secret is printed ONCE in the server log. Afterwards delete FIRST_ADMIN_PASSWORD and FIRST_ADMIN_RESET.
import { createHash } from 'crypto';
import { Client } from 'pg';
import { hashPassword } from '../auth/password';
import { seal } from '../security/crypto';
import { newSecret, otpauthUri } from '../security/totp';
const show = (title: string, email: string, secret: string) => console.log(`\n================ ${title}: ${email} ================\n` +
  `Add this secret to a free authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP):\n  ${secret}\n` +
  `(or open this link on the phone: ${otpauthUri(secret, email)})\n` +
  `Shown ONCE. Then delete FIRST_ADMIN_PASSWORD and FIRST_ADMIN_RESET from the server settings.\n=====================================================================\n`);
(async () => {
  const email = (process.env.FIRST_ADMIN_EMAIL ?? '').trim().toLowerCase(), pw = process.env.FIRST_ADMIN_PASSWORD ?? '', name = (process.env.FIRST_ADMIN_NAME ?? '').trim() || 'Owner';
  const reset = (process.env.FIRST_ADMIN_RESET ?? '').trim().toLowerCase();
  const c = new Client({ connectionString: process.env.OWNER_DATABASE_URL }); await c.connect();
  try {
    const n = (await c.query(`SELECT count(*)::int n FROM staff_users`)).rows[0].n;
    if (reset) {
      // A reset needs a NEW password and happens once per password: a free server restarts often, and must not reset
      // the authenticator again at every restart if the setting is forgotten.
      if (pw.length < 12) throw new Error('FIRST_ADMIN_RESET needs FIRST_ADMIN_PASSWORD (a new password, 12+ characters)');
      const mark = createHash('sha256').update(`reset:${reset}:${pw}`).digest('hex');
      const done = await c.query(`SELECT 1 FROM staff_audit WHERE action='staff_reset_by_host' AND data->>'mark'=$1`, [mark]);
      if (done.rowCount) { console.log('first-admin: this reset was already done (delete FIRST_ADMIN_RESET and FIRST_ADMIN_PASSWORD now)'); return; }
      const secret = newSecret();
      const r = await c.query(`UPDATE staff_users SET totp_secret_sealed=$2, totp_last_step=0, failed_attempts=0, locked_until=NULL, token_version=token_version+1,
          password_hash = $3 WHERE email=$1 RETURNING id`, [reset, seal(secret, 'totp'), hashPassword(pw)]);
      if (!r.rowCount) { console.log(`first-admin: FIRST_ADMIN_RESET: no staff account with the email ${reset}`); }
      else {
        await c.query(`INSERT INTO staff_audit(staff_id, action, target_type, target_id, data) VALUES ($1::uuid,'staff_reset_by_host','staff',$2::text,$3)`, [r.rows[0].id, r.rows[0].id, { mark }]);
        show('STAFF ACCOUNT RESET', reset, secret); return;
      }
    }
    if (!email) { console.log(n ? 'first-admin: a staff account exists' : 'first-admin: FIRST_ADMIN_EMAIL is empty: no staff account was created'); return; }
    if (n > 0) { console.log('first-admin: a staff account already exists, nothing to do (to get a new authenticator secret, set FIRST_ADMIN_RESET to your staff email)'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('FIRST_ADMIN_EMAIL is not an email address');
    if (pw.length < 12) throw new Error('FIRST_ADMIN_PASSWORD must have at least 12 characters');
    const secret = newSecret();
    await c.query(`INSERT INTO staff_users(email, name, password_hash, totp_secret_sealed) VALUES ($1, $2, $3, $4)`, [email, name.slice(0, 60), hashPassword(pw), seal(secret, 'totp')]);
    show('FIRST STAFF ACCOUNT CREATED', email, secret);
  } finally { await c.end(); }
})().catch(e => { console.error('first-admin: ' + e.message); process.exit(1); });
