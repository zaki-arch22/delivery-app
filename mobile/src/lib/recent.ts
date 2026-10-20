import type { KeyStore } from '../core/storage';
import type { Address } from './orders';

// The last places a person sent parcels to, kept ONLY on this phone (no saved addresses on the server: CLAUDE.md
// section 4), so "Where to?" can offer them in one tap, like the reference app's recent destinations.
export interface RecentPlace { name: string; lat: number; lng: number; address: Address; recipient_name?: string; recipient_phone?: string; at: string }
const KEY = 'recent_places', MAX = 6;
export async function listRecent(store: KeyStore): Promise<RecentPlace[]> {
  try { const v = JSON.parse((await store.get(KEY)) ?? '[]'); return Array.isArray(v) ? v.slice(0, MAX) : []; } catch { return []; }
}
export async function addRecent(store: KeyStore, p: Omit<RecentPlace, 'at'>) {
  const near = (a: RecentPlace) => Math.abs(a.lat - p.lat) < 0.0003 && Math.abs(a.lng - p.lng) < 0.0003;
  const list = (await listRecent(store)).filter(a => !near(a));
  list.unshift({ ...p, at: new Date().toISOString() });
  await store.set(KEY, JSON.stringify(list.slice(0, MAX))).catch(() => {});
}
