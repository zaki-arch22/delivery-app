import type { Client } from '../core/api';
import type { Address } from './orders';

// The driver-path functions of the contract (section C), typed for the screens.
export interface DriverHome { online: boolean; earnings_today_da: number; cash_held_da: number; cash_limit_da: number | null; rating: string | null; rating_count: number }
export interface Offer { offer_id: number; expires_at: string; order_id: string; ref: string; price_da: number; payer: 'sender' | 'recipient'; cod_amount_da: number; size: string; vehicle: string; trip_distance_m: number; pickup_distance_m: number | null; pickup_address: Address; sender_rating: string | null }
// A request shown to this courier (several couriers see it at once): he accepts the customer's price or offers more.
export interface Request extends Offer { status: 'offered' | 'bid'; max_da: number; my_price_da: number | null; bid_expires_at: string | null; trip_duration_s: number; pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number; sender_rating_count: number }
export interface Job {
  id: string; ref: string; leg: 'delivery' | 'return'; status: 'assigned' | 'picked_up' | 'delivered' | 'failed' | 'cancelled' | 'searching' | 'expired';
  payer: 'sender' | 'recipient'; cod_amount_da: number; locked_da: number; distance_m: number; recipient_name: string; recipient_phone: string;
  pickup_address: Address; dropoff_address: Address; pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number;
  sender_name: string; sender_phone: string; cash_to_collect_da: number; next_step: 'picked_up' | 'delivered' | null;
  inspection: 'outside' | 'open'; recipient_expecting_at: string | null; needs_pickup_code: boolean;
}
export type FailReason = 'no_answer' | 'wrong_address' | 'refused_damaged' | 'refused_wrong_item' | 'refused_not_ordered' | 'refused_changed_mind' | 'refused_cannot_pay';
export const FAIL_REASONS: FailReason[] = ['no_answer', 'wrong_address', 'refused_damaged', 'refused_wrong_item', 'refused_not_ordered', 'refused_changed_mind', 'refused_cannot_pay'];
export const NEEDS_EVIDENCE: FailReason[] = ['refused_damaged', 'refused_wrong_item'];
export type ReleaseReason = 'vehicle_problem' | 'emergency' | 'sender_unreachable' | 'parcel_not_ready' | 'parcel_too_big' | 'unsafe_or_prohibited' | 'other';
export const RELEASE_REASONS: ReleaseReason[] = ['vehicle_problem', 'emergency', 'sender_unreachable', 'parcel_not_ready', 'parcel_too_big', 'unsafe_or_prohibited', 'other'];
type Pt = { lat: number; lng: number };
export interface JobRow { id: string; ref: string; leg: 'delivery' | 'return'; status: Job['status']; locked_da: number | null; cod_amount_da: number; delivered_at: string | null; created_at: string }
export interface CashEntry { id: number; type: 'cod_collected' | 'handover' | 'adjustment'; amount_da: number; order_id: string | null; note: string | null; created_at: string }

export const driver = (c: Client) => ({
  home: () => c.call<DriverHome>('/get_driver_home'),
  setOnline: (online: boolean) => c.call<{ online: boolean }>('/set_online', { online }),
  location: (lat: number, lng: number) => c.call('/update_location', { lat, lng }),
  offer: () => c.call<{ offer: Offer | null }>('/get_current_offer').then(r => r.offer),
  requests: () => c.call<{ requests: Request[] }>('/list_requests').then(r => r.requests),
  // price omitted = the customer's own price. Returns the job when the customer had switched on auto-accept.
  bid: (offerId: number, price?: number) => c.call<{ job: Job | null; bid?: { offer_id: number; price_da: number; eta_s: number | null; expires_in_s: number } }>('/make_bid', { offer_id: offerId, price_da: price }),
  accept: (offerId: number) => c.call<{ job: Job }>('/accept_offer', { offer_id: offerId }).then(r => r.job),
  decline: (offerId: number) => c.call('/decline_offer', { offer_id: offerId }),
  job: () => c.call<{ job: Job | null }>('/get_job').then(r => r.job),
  // Photos (parcel at pickup, evidence) are uploaded first; the step then names them.
  photo: (kind: 'parcel_photo' | 'evidence_photo', blob: Blob) => c.call<{ document_id: string }>('/upload_document?kind=' + kind, blob).then(r => r.document_id),
  pickedUp: (orderId: string, pickupCode: string, parcelPhoto: string, location: Pt) => c.call<{ job: Job; order_status: string }>('/update_job_step', { order_id: orderId, step: 'picked_up', pickup_code: pickupCode, parcel_photo: parcelPhoto, location }),
  delivered: (orderId: string, code: string, cash: number, location: Pt, method: 'code' | 'qr') => c.call<{ job: Job; order_status: string }>('/update_job_step', { order_id: orderId, step: 'delivered', delivery_code: code, cash_collected_da: cash, location, method }),
  fail: (orderId: string, reason: FailReason, extra: { evidence_photo?: string; note?: string; location?: Pt | null } = {}) => c.call<{ job: Job | null }>('/report_delivery_failure', { order_id: orderId, reason, ...extra }).then(r => r.job),
  release: (orderId: string, reason: ReleaseReason, extra: { evidence_photo?: string; note?: string } = {}) => c.call<{ job: null }>('/release_job', { order_id: orderId, reason, ...extra }),
  jobs: (page = 1) => c.call<{ page: number; jobs: JobRow[] }>('/list_jobs?page=' + page),
  cash: () => c.call<{ balance_da: number; entries: CashEntry[] }>('/get_cash_balance'),
});
