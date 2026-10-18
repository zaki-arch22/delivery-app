import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
// Staff passwords: scrypt with a random salt. Format: scrypt:<salt hex>:<hash hex>
export const hashPassword = (pw: string) => { const salt = randomBytes(16); return `scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`; };
export function verifyPassword(pw: string, stored: string) {
  const [kind, salt, hash] = stored.split(':'); if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 64), b = Buffer.from(hash, 'hex'); return a.length === b.length && timingSafeEqual(a, b);
}
