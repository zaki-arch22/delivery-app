import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'crypto';

const need = (k: string, min: number) => { const v = process.env[k]; if (!v || v.length < min) throw new Error(`${k} (at least ${min} characters) is required`); return v; };
const cache = new Map<string, Buffer>();
// Every purpose gets its OWN key derived from the master secret, so one leaked or misused key never opens another door.
export function deriveKey(secretEnv: 'JWT_SECRET' | 'HASH_PEPPER', label: string): Buffer {
  const id = secretEnv + ':' + label; let k = cache.get(id);
  if (!k) { k = Buffer.from(hkdfSync('sha256', need(secretEnv, secretEnv === 'JWT_SECRET' ? 32 : 16), 'delivery-v1', label, 32)); cache.set(id, k); }
  return k;
}
// Keyed hash for lookups (login codes, refresh tokens). Without the pepper a stolen database cannot be used to guess them.
export const mac = (v: string) => createHmac('sha256', deriveKey('HASH_PEPPER', 'lookup')).update(v).digest('hex');

// AES-256-GCM sealing for small secrets stored in the database (staff authenticator secret).
export function seal(plain: string, label: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', deriveKey('JWT_SECRET', 'seal:' + label), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}
export function unseal(s: string, label: string): string {
  const [v, iv, tag, ct] = s.split('.'); if (v !== 'v1') throw new Error('bad sealed value');
  const d = createDecipheriv('aes-256-gcm', deriveKey('JWT_SECRET', 'seal:' + label), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
