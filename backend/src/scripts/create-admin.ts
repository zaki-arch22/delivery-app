// Creates a staff account WITH two-factor. Usage:
//   ADMIN_PASSWORD='(12+ chars)' JWT_SECRET=... npm run create-admin -- you@example.com "Your Name"
// It prints the authenticator secret ONCE. Add it to a free authenticator app (Aegis, FreeOTP, Google Authenticator, Microsoft Authenticator).
import { Client } from 'pg';
import { hashPassword } from '../auth/password';
import { seal } from '../security/crypto';
import { newSecret, otpauthUri } from '../security/totp';
(async () => {
  const [email, name] = process.argv.slice(2), pw = process.env.ADMIN_PASSWORD, url = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('OWNER_DATABASE_URL (or DATABASE_URL) is required');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw new Error('Usage: ADMIN_PASSWORD=... npm run create-admin -- <email> "<name>"');
  if (!pw || pw.length < 12) throw new Error('ADMIN_PASSWORD (at least 12 characters) is required');
  const secret = newSecret(), c = new Client({ connectionString: url }); await c.connect();
  await c.query(`INSERT INTO staff_users(email, name, password_hash, totp_secret_sealed) VALUES (lower($1), $2, $3, $4)`, [email, name, hashPassword(pw), seal(secret, 'totp')]);
  console.log(`Staff account created: ${email.toLowerCase()}\n\nAUTHENTICATOR SETUP (shown once, write it down safely):\n  Secret: ${secret}\n  Link:   ${otpauthUri(secret, email.toLowerCase())}\n`); await c.end();
})().catch(e => { console.error(e.message.includes('duplicate') ? 'That email already exists' : e.message); process.exit(1); });
