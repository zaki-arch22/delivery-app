import { tx } from './i18n';

const BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
// The login token lives ONLY in this variable (memory). It is never written to storage, so closing the tab erases it.
let token: string | null = null;
let onExpired: () => void = () => {};
export const setToken = (t: string | null) => { token = t; };
export const hasToken = () => token !== null;
export const setOnExpired = (f: () => void) => { onExpired = f; };

export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const errText = (e: unknown): string => {
  if (e instanceof ApiError) return tx('err.' + e.code, e.status === 0 ? tx('err.network') : e.message || tx('err.generic'));
  return tx('err.generic');
};

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(0, 'network', ''); }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token && ['SESSION_ENDED', 'BAD_TOKEN'].includes(j.error)) { token = null; onExpired(); }
    throw new ApiError(r.status, j.error ?? 'ERROR', j.message ?? '');
  }
  return j as T;
}
export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return p ? '?' + p : '';
};
