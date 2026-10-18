// Sliding-window rate limiter held in memory (one server process). Moving it to Redis is a later scaling step.
export class SlidingLimiter {
  private m = new Map<string, number[]>();
  constructor() { setInterval(() => this.sweep(), 60_000).unref(); }
  hit(key: string, max: number, windowMs: number): { ok: boolean; retryS: number } {
    const now = Date.now(), arr = (this.m.get(key) ?? []).filter(t => t > now - windowMs);
    if (arr.length >= max) { this.m.set(key, arr); return { ok: false, retryS: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) }; }
    arr.push(now); this.m.set(key, arr); return { ok: true, retryS: 0 };
  }
  private sweep() { const cut = Date.now() - 3_600_000; for (const [k, a] of this.m) if (!a.length || a[a.length - 1] < cut) this.m.delete(k); }
}
export const limiter = new SlidingLimiter();
// Test servers may switch limits off, but ONLY with TEST_HOOKS=1 (which a production server refuses to start with).
export const limitsOff = () => process.env.TEST_HOOKS === '1' && process.env.RATE_LIMIT_DISABLED === '1';
