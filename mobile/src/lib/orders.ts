import type { Client } from '../core/api';
import type { Point } from './location';
import type { Lang } from '../i18n';

// The user-path functions of the contract (section B), typed for the screens.
export type Size = 'small' | 'medium' | 'large';
export type Status = 'searching' | 'assigned' | 'picked_up' | 'delivered' | 'failed' | 'cancelled' | 'expired';
export interface Address { street?: string; landmark?: string; building?: string; notes?: string }
export interface Quote { quote_id: string; expires_at: string; vehicle: 'motorbike' | 'car'; distance_m: number; duration_s: number; distance_estimated: boolean; recommended_da: number; min_da: number; max_da: number }
export interface Order {
  id: string; ref: string; leg: 'delivery' | 'return'; status: Status; size: Size; vehicle: 'motorbike' | 'car'; payer: 'sender' | 'recipient';
  cod_amount_da: number; recommended_da: number; min_da: number; max_da: number; offered_da: number; locked_da: number | null;
  distance_m: number; duration_s: number; delivery_code: string; pickup_address: Address; dropoff_address: Address; recipient_name: string; recipient_phone: string;
  pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number; created_at: string; rated: boolean;
  driver: null | { name: string; photo_url: string | null; rating: string | null; vehicle: 'motorbike' | 'car'; location: null | { lat: number; lng: number; at: string } };
}
export const ACTIVE: Status[] = ['searching', 'assigned', 'picked_up'];

export const orders = (c: Client) => ({
  quote: (pickup: Point, dropoff: Point, size: Size) => c.call<Quote>('/get_quote', { pickup, dropoff, size }),
  create: (key: string, b: { quote_id: string; offered_da: number; pickup_address: Address; dropoff_address: Address; recipient_name: string; recipient_phone: string; payer: 'sender' | 'recipient'; cod_amount_da: number }) =>
    c.call<Order>('/create_order', b, { 'Idempotency-Key': key }),
  get: (id: string) => c.call<Order>('/get_order?id=' + encodeURIComponent(id)),
  list: (page = 1) => c.call<{ page: number; orders: Order[] }>('/list_orders?page=' + page),
  cancel: (id: string, reason: string) => c.call<Order>('/cancel_order', { order_id: id, reason }),
  raise: (id: string, price: number) => c.call<Order>('/raise_price', { order_id: id, new_offered_da: price }),
  rate: (id: string, stars: number, comment?: string) => c.call('/submit_rating', { order_id: id, stars, comment: comment || undefined }),
  problem: (id: string, reason: string, note?: string) => c.call('/report_problem', { order_id: id, reason, note: note || undefined }),
});

// 12500 -> "12 500" (how prices are written in Algeria). Digits stay Western in every language, like on Algerian price tags.
export const money = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const km = (m: number) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
export const minutes = (s: number) => String(Math.max(1, Math.round(s / 60)));
export function when(iso: string, lang: Lang) {
  const d = new Date(iso);
  try { return d.toLocaleString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' } as any); }
  catch { return d.toISOString().slice(0, 16).replace('T', ' '); }
}
export const addressLine = (a: Address) => [a.street, a.building, a.landmark].filter(Boolean).join(' · ');
