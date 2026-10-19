import type { Client } from '../core/api';
import type { Address } from './orders';

// The driver-path functions of the contract (section C), typed for the screens.
export interface DriverHome { online: boolean; earnings_today_da: number; cash_held_da: number; cash_limit_da: number | null; rating: string | null; rating_count: number }
export interface Offer { offer_id: number; expires_at: string; order_id: string; ref: string; price_da: number; payer: 'sender' | 'recipient'; cod_amount_da: number; size: string; vehicle: string; trip_distance_m: number; pickup_distance_m: number | null; pickup_address: Address; sender_rating: string | null }
export interface Job {
  id: string; ref: string; leg: 'delivery' | 'return'; status: 'assigned' | 'picked_up' | 'delivered' | 'failed' | 'cancelled' | 'searching' | 'expired';
  payer: 'sender' | 'recipient'; cod_amount_da: number; locked_da: number; distance_m: number; recipient_name: string; recipient_phone: string;
  pickup_address: Address; dropoff_address: Address; pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number;
  sender_name: string; sender_phone: string; cash_to_collect_da: number; next_step: 'picked_up' | 'delivered' | null;
}
export interface JobRow { id: string; ref: string; leg: 'delivery' | 'return'; status: Job['status']; locked_da: number | null; cod_amount_da: number; delivered_at: string | null; created_at: string }
export interface CashEntry { id: number; type: 'cod_collected' | 'handover' | 'adjustment'; amount_da: number; order_id: string | null; note: string | null; created_at: string }

export const driver = (c: Client) => ({
  home: () => c.call<DriverHome>('/get_driver_home'),
  setOnline: (online: boolean) => c.call<{ online: boolean }>('/set_online', { online }),
  location: (lat: number, lng: number) => c.call('/update_location', { lat, lng }),
  offer: () => c.call<{ offer: Offer | null }>('/get_current_offer').then(r => r.offer),
  accept: (offerId: number) => c.call<{ job: Job }>('/accept_offer', { offer_id: offerId }).then(r => r.job),
  decline: (offerId: number) => c.call('/decline_offer', { offer_id: offerId }),
  job: () => c.call<{ job: Job | null }>('/get_job').then(r => r.job),
  pickedUp: (orderId: string) => c.call<{ job: Job; order_status: string }>('/update_job_step', { order_id: orderId, step: 'picked_up' }),
  delivered: (orderId: string, code: string, cash: number) => c.call<{ job: Job; order_status: string }>('/update_job_step', { order_id: orderId, step: 'delivered', delivery_code: code, cash_collected_da: cash }),
  fail: (orderId: string, reason: 'no_answer' | 'refused' | 'wrong_address') => c.call<{ job: Job | null }>('/report_delivery_failure', { order_id: orderId, reason }).then(r => r.job),
  jobs: (page = 1) => c.call<{ page: number; jobs: JobRow[] }>('/list_jobs?page=' + page),
  cash: () => c.call<{ balance_da: number; entries: CashEntry[] }>('/get_cash_balance'),
});
