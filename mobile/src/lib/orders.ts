import type { Client } from '../core/api';
import type { Point } from './location';
import type { Lang } from '../i18n';

// The user-path functions of the contract (section B), typed for the screens.
export type Size = 'small' | 'medium' | 'large';
export type Status = 'awaiting_recipient' | 'searching' | 'assigned' | 'picked_up' | 'delivered' | 'failed' | 'cancelled' | 'expired';
export interface Address { street?: string; landmark?: string; building?: string; notes?: string }
export interface Quote { quote_id: string; expires_at: string; vehicle: 'motorbike' | 'car'; distance_m: number; duration_s: number; distance_estimated: boolean; recommended_da: number; min_da: number; max_da: number; route: [number, number][] | null }
// A courier's answer to a request: his price and how long he needs to reach the pickup point.
export interface Bid { offer_id: number; price_da: number; eta_s: number | null; expires_at: string; driver: { name: string; photo_url: string | null; rating: string | null; rating_count: number; vehicle: 'motorbike' | 'car'; deliveries: number } }
export interface Place { name: string; detail: string; lat: number; lng: number }
export interface Order {
  id: string; ref: string; leg: 'delivery' | 'return'; status: Status; size: Size; vehicle: 'motorbike' | 'car'; payer: 'sender' | 'recipient';
  cod_amount_da: number; recommended_da: number; min_da: number; max_da: number; offered_da: number; locked_da: number | null;
  distance_m: number; duration_s: number; delivery_code: string; pickup_address: Address; dropoff_address: Address; recipient_name: string; recipient_phone: string;
  pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number; created_at: string; rated: boolean;
  driver: null | { name: string; photo_url: string | null; rating: string | null; vehicle: 'motorbike' | 'car'; deliveries: number; location: null | { lat: number; lng: number; at: string } };
  bids: Bid[]; auto_accept: boolean; recipient_answer: 'confirmed' | 'declined' | null; recipient_deadline_at: string | null; search_ends_at: string | null; search_started_at: string;
  couriers_notified: number; eta_s: number | null; eta_estimated: boolean; route: [number, number][] | null; cancel_reason: string | null;
  pickup_code: string | null; inspection: 'outside' | 'open'; tracking_token: string | null; recipient_expecting_at: string | null;
  pickup_photo_doc: string | null; pickup_distance_m: number | null; delivery_distance_m: number | null; evidence_photos: string[];
  history: { type: string; at: string; data: any }[];
}
export type RecallReason = 'buyer_cancelled' | 'wrong_parcel' | 'wrong_address' | 'other';
export interface RecipientHistory { delivered: number; refused: number; no_answer: number }
export const ACTIVE: Status[] = ['awaiting_recipient', 'searching', 'assigned', 'picked_up'];

export const orders = (c: Client) => ({
  quote: (pickup: Point, dropoff: Point, size: Size) => c.call<Quote>('/get_quote', { pickup, dropoff, size }),
  create: (key: string, b: { auto_accept: boolean; quote_id: string; offered_da: number; pickup_address: Address; dropoff_address: Address; recipient_name: string; recipient_phone: string; payer: 'sender' | 'recipient'; cod_amount_da: number; inspection: 'outside' | 'open' }) =>
    c.call<Order>('/create_order', b, { 'Idempotency-Key': key }),
  get: (id: string) => c.call<Order>('/get_order?id=' + encodeURIComponent(id)),
  list: (page = 1) => c.call<{ page: number; orders: Order[] }>('/list_orders?page=' + page),
  cancel: (id: string, reason: string) => c.call<Order>('/cancel_order', { order_id: id, reason }),
  raise: (id: string, price: number) => c.call<Order>('/raise_price', { order_id: id, new_offered_da: price }),
  rate: (id: string, stars: number, comment?: string) => c.call('/submit_rating', { order_id: id, stars, comment: comment || undefined }),
  problem: (id: string, reason: string, note?: string, photos: string[] = []) => c.call('/report_problem', { order_id: id, reason, note: note || undefined, photos }),
  recall: (id: string, reason: RecallReason) => c.call<Order>('/recall_order', { order_id: id, reason }),
  setAutoAccept: (id: string, on: boolean) => c.call<Order>('/set_auto_accept', { order_id: id, on }),
  acceptBid: (id: string, offerId: number) => c.call<Order>('/accept_bid', { order_id: id, offer_id: offerId }),
  declineBid: (id: string, offerId: number) => c.call<Order>('/decline_bid', { order_id: id, offer_id: offerId }),
  search: (q: string, lang: Lang, near?: Point) => c.call<{ places: Place[]; unavailable?: boolean }>(`/search_places?q=${encodeURIComponent(q)}&lang=${lang}` + (near ? `&lat=${near.lat.toFixed(5)}&lng=${near.lng.toFixed(5)}` : '')),
  reverse: (at: Point, lang: Lang) => c.call<{ place: Place | null }>(`/reverse_place?lat=${at.lat.toFixed(5)}&lng=${at.lng.toFixed(5)}&lang=${lang}`),
  // The receiver's yes/no, for a receiver who has the app (same public function as the tracking page).
  answerIncoming: (token: string, yes: boolean) => c.publicCall(yes ? '/track_confirm' : '/track_decline', yes ? { t: token } : { t: token, reason: 'not_ordered' }),
  recipientHistory: (phone: string) => c.call<RecipientHistory>('/recipient_history?phone=' + encodeURIComponent(phone)),
});

// 12500 -> "12 500" (how prices are written in Algeria). Digits stay Western in every language, like on Algerian price tags.
export const money = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const km = (m: number) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
export const minutes = (s: number) => String(Math.max(1, Math.round(s / 60)));
// A WhatsApp chat with this number, with the message already typed (free; opens WhatsApp if installed, else the browser).
export const whatsappUrl = (phone: string, text: string) => `https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`;
export function when(iso: string, lang: Lang) {
  const d = new Date(iso);
  try { return d.toLocaleString(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-DZ' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' } as any); }
  catch { return d.toISOString().slice(0, 16).replace('T', ' '); }
}
export const addressLine = (a: Address) => [a.street, a.building, a.landmark].filter(Boolean).join(' · ');
