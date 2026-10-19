import { KeyStore } from './storage';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterS = 0) { super(message || code); }
}
export interface Profile { id: string; type: 'user' | 'driver'; display_name: string; status: string; rating: string | null; rating_count: number }
type Listener = () => void;
const REFRESH_KEY = 'refresh_token';

// The ONE place the app talks to the server.
// - The short-lived access key lives in memory only; the long-lived refresh key lives in the secure vault.
// - When the access key expires, it is renewed automatically. If several requests notice at the same moment,
//   exactly ONE renewal is sent (the server treats a reused refresh key as theft and would end the session).
export class Client {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<Listener>();
  constructor(readonly baseUrl: string, private store: KeyStore, private fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  onSignedOut(f: Listener) { this.listeners.add(f); return () => this.listeners.delete(f); }
  get token() { return this.access; }
  async setSession(access: string, refresh?: string) { this.access = access; if (refresh) await this.store.set(REFRESH_KEY, refresh); }
  async clearSession() { this.access = null; await this.store.del(REFRESH_KEY); this.listeners.forEach(f => f()); }
  async hasStoredSession() { return (await this.store.get(REFRESH_KEY)) !== null; }

  private async raw(path: string, body: unknown, headers: Record<string, string>, auth: boolean) {
    let r: Response;
    // A photo (Blob) is sent as it is, with its own type; everything else is JSON.
    const isFile = typeof Blob !== 'undefined' && body instanceof Blob;
    const type = isFile ? (body as Blob).type || 'image/jpeg' : 'application/json';
    try {
      r = await this.fetchFn(this.baseUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': type, ...(auth && this.access ? { authorization: 'Bearer ' + this.access } : {}), ...headers }, body: body === undefined ? undefined : isFile ? (body as Blob) : JSON.stringify(body) });
    } catch { throw new ApiError(0, 'NETWORK', 'No connection'); }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, j.error ?? 'ERROR', j.message ?? '', Number(r.headers.get('retry-after') ?? 0));
    return j;
  }

  // Renew the access key. Concurrent callers share the same single renewal.
  refresh(): Promise<boolean> {
    if (!this.refreshing) this.refreshing = (async () => {
      const rt = await this.store.get(REFRESH_KEY);
      if (!rt) return false;
      try { const r = await this.raw('/refresh_token', { refresh_token: rt }, {}, false); await this.setSession(r.token, r.refresh_token); return true; }
      catch (e) { if (e instanceof ApiError && e.status === 401) { await this.clearSession(); return false; } throw e; }   // offline: keep the session, try later
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async call<T = any>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    if (!this.access && (await this.hasStoredSession())) await this.refresh();
    const used = this.access;
    try { return await this.raw(path, body, headers, true); }
    catch (e) {
      // An expired access key comes back as BAD_TOKEN: renew once and retry once. Anything else is the caller's to handle.
      if (e instanceof ApiError && e.status === 401 && e.code === 'BAD_TOKEN' && (await this.hasStoredSession())) {
        // If another request ALREADY renewed the key while this one was travelling, just retry with the new key:
        // renewing again would be wasteful and could look like a stolen key to the server.
        if (this.access && this.access !== used) return this.raw(path, body, headers, true);
        if (await this.refresh()) return this.raw(path, body, headers, true);
      }
      if (e instanceof ApiError && e.status === 401 && e.code === 'SESSION_ENDED') await this.clearSession();
      throw e;
    }
  }
  // For login screens: no access key needed.
  publicCall<T = any>(path: string, body?: unknown): Promise<T> { return this.raw(path, body, {}, false); }
}

// A fresh random key for one user INTENT (one tap on "Confirm order"). Reuse it when retrying that same intent,
// so a flaky network can never create a second order.
export const idempotencyKey = () => Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
