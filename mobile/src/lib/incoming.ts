import type { KeyStore } from '../core/storage';

// Parcels sent TO this person by someone else (notification order.incoming, contract G4): the reference and the delivery
// code they will give to the driver. Kept only on this phone, for 3 days, at most 10.
export interface Incoming { order_id: string; ref: string; delivery_code: string; at: string }
const KEY = 'incoming', KEEP_MS = 3 * 24 * 3600 * 1000;

export async function listIncoming(store: KeyStore): Promise<Incoming[]> {
  let all: Incoming[] = [];
  try { all = JSON.parse((await store.get(KEY)) ?? '[]'); } catch { all = []; }
  return all.filter(i => Date.now() - new Date(i.at).getTime() < KEEP_MS);
}
export async function addIncoming(store: KeyStore, data: Record<string, unknown>, orderId: string | null): Promise<Incoming[]> {
  const ref = String(data.ref ?? ''), code = String(data.delivery_code ?? '');
  if (!orderId || !/^\d{4}$/.test(code)) return listIncoming(store);
  const list = (await listIncoming(store)).filter(i => i.order_id !== orderId);
  list.unshift({ order_id: orderId, ref, delivery_code: code, at: new Date().toISOString() });
  const kept = list.slice(0, 10);
  await store.set(KEY, JSON.stringify(kept));
  return kept;
}
