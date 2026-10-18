import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
// Standard TOTP (RFC 6238): 6 digits, 30 seconds. Works with any free authenticator app (Aegis, FreeOTP, Google Authenticator, Microsoft Authenticator).
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newSecret = () => { const b = randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5), 2)]; return out; };
const decode = (s: string) => { let bits = ''; for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export const stepNow = (t = Date.now()) => Math.floor(t / 30000);
export function codeAt(secret: string, step: number) {
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac('sha1', decode(secret)).update(m).digest(); const o = h[h.length - 1] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000).padStart(6, '0');
}
// Returns the matched time step, or null. A step at or before `lastStep` is refused: a code can be used ONCE (stops replay of a shoulder-surfed code).
export function verifyTotp(secret: string, code: string, lastStep: number, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code ?? '')) return null;
  for (const s of [stepNow(now) - 1, stepNow(now), stepNow(now) + 1]) {
    const a = Buffer.from(codeAt(secret, s)), b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b) && s > lastStep) return s;
  }
  return null;
}
export const otpauthUri = (secret: string, email: string) => `otpauth://totp/Delivery:${encodeURIComponent(email)}?secret=${secret}&issuer=Delivery&digits=6&period=30`;
