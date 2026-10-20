import { limiter, limitsOff } from './limiter';
import { SecurityLog } from './security-log.service';

export const headers = (_req: any, res: any, next: any) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
};

const ROUTE: Record<string, [number, number]> = { '/upload_document': [30, 3_600_000], '/send_code': [10, 3_600_000], '/verify_code': [30, 900_000], '/staff_login': [10, 900_000], '/refresh_token': [60, 3_600_000], '/track_report': [10, 3_600_000], '/track_expecting': [30, 3_600_000], '/track_confirm': [30, 3_600_000], '/track_decline': [30, 3_600_000], '/search_places': [120, 3_600_000], '/reverse_place': [240, 3_600_000] };
export const ipLimit = (sec: SecurityLog) => (req: any, res: any, next: any) => {
  if (limitsOff()) return next();
  const path = req.path as string, [max, win] = ROUTE[path] ?? [300, 60_000];
  const r = limiter.hit(`${req.ip}|${ROUTE[path] ? path : '*'}`, max, win);
  if (r.ok) return next();
  sec.event('rate_limited', req.ip, { path });
  res.setHeader('Retry-After', String(r.retryS));
  res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' });
};

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasBadKey = (v: any, depth = 0): boolean => { if (depth > 8 || v === null || typeof v !== 'object') return false; for (const k of Object.keys(v)) if (BAD_KEYS.has(k) || hasBadKey(v[k], depth + 1)) return true; return false; };
// JSON only on POST; no prototype-pollution keys; query values must be plain text (no arrays/objects).
export const inputGuard = (req: any, res: any, next: any) => {
  if (req.method === 'POST' && req.path === '/upload_document') {   // the photo route: an image body only (checked again by decoding it)
    if (!/^image\/(jpeg|png|webp)$/i.test(String(req.headers['content-type'] ?? '').split(';')[0].trim())) return res.status(415).json({ error: 'IMAGE_ONLY', message: 'Send a JPEG, PNG or WebP photo' });
  } else if (req.method === 'POST' && !/^application\/json/i.test(req.headers['content-type'] ?? '')) return res.status(415).json({ error: 'JSON_ONLY', message: 'Send application/json' });
  if (!Buffer.isBuffer(req.body) && hasBadKey(req.body)) return res.status(400).json({ error: 'BAD_INPUT', message: 'Invalid input' });
  for (const v of Object.values(req.query ?? {})) if (typeof v !== 'string') return res.status(400).json({ error: 'BAD_INPUT', message: 'Invalid query' });
  next();
};

export function clientIp(req: any): string {
  const hops = Number(process.env.TRUST_PROXY ?? 0), xff = String(req.headers?.['x-forwarded-for'] ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
  return hops > 0 && xff.length >= hops ? xff[xff.length - hops] : req.socket?.remoteAddress ?? 'unknown';
}
