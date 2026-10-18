import { randomBytes, randomInt, timingSafeEqual } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { deriveKey, mac } from '../security/crypto';

// Lookup hashes (login codes, refresh tokens) are keyed with the secret pepper; the pepper is REQUIRED (no empty default).
export const sha = mac;
export const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const newRefresh = () => randomBytes(32).toString('hex');

export interface Claims { sid: string; acc: string; pid: string | null; typ: 'user' | 'driver' | null }
export interface StaffClaims { stf: string; tv: number }
// App and staff tokens use DIFFERENT keys and audiences, and only HS256 is accepted (blocks "alg: none" and algorithm-swap attacks).
const OPT = { algorithms: ['HS256'] as jwt.Algorithm[], issuer: 'delivery' };
export const signAccess = (c: Claims) => jwt.sign(c, deriveKey('JWT_SECRET', 'jwt-app'), { algorithm: 'HS256', expiresIn: '15m', issuer: 'delivery', audience: 'delivery-app' });
export const readAccess = (t: string) => jwt.verify(t, deriveKey('JWT_SECRET', 'jwt-app'), { ...OPT, audience: 'delivery-app' }) as unknown as Claims & { exp: number };
export const signStaff = (staffId: string, tv: number) => jwt.sign({ stf: staffId, tv }, deriveKey('JWT_SECRET', 'jwt-staff'), { algorithm: 'HS256', expiresIn: '2h', issuer: 'delivery', audience: 'delivery-staff' });
export function readToken(t: string): { kind: 'user'; c: Claims } | { kind: 'staff'; c: StaffClaims } {
  const aud = (jwt.decode(t) as any)?.aud;   // only used to pick the key; the signature, audience and algorithm are then verified strictly
  if (aud === 'delivery-staff') return { kind: 'staff', c: jwt.verify(t, deriveKey('JWT_SECRET', 'jwt-staff'), { ...OPT, audience: 'delivery-staff' }) as unknown as StaffClaims };
  return { kind: 'user', c: readAccess(t) };
}
