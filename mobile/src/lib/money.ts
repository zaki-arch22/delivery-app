import type { Client } from '../core/api';

// The money functions (owner's decisions, Oct 2026): where a person receives money (BaridiMob RIP), the goods money a
// courier sends to sellers within 24 hours (and the seller confirms), and the courier's prepaid commission wallet.
export interface Payout { rip: string; holder_name: string; updated_at: string }
export type SettleStatus = 'pending' | 'sent' | 'confirmed' | 'disputed' | 'resolved_paid' | 'resolved_unpaid';
export interface Settlement {
  order_id: string; ref: string; amount_da: number; status: SettleStatus; due_at: string; overdue: boolean; was_late: boolean;
  method: 'baridimob' | 'cash' | null; reference: string | null; has_receipt: boolean; sent_at: string | null; confirmed_at: string | null;
  dispute_note: string | null; resolution_note: string | null; created_at: string;
}
export interface CourierSettlement extends Settlement { seller_rip: string; seller_holder: string; seller_name: string; seller_phone: string | null }
export interface Sale extends Settlement { driver_name: string; driver_phone: string | null }
export interface WalletEntry { id: number; type: 'topup' | 'commission' | 'adjustment'; amount_da: number; note: string | null; created_at: string; ref: string | null }
export interface Topup { id: number; amount_da: number; reference: string; status: 'pending' | 'approved' | 'rejected'; reason: string | null; created_at: string }
export interface Wallet {
  active: boolean; balance_da: number; credit_da: number; commission_percent: number | null; platform_account: { rip: string; holder_name: string } | null;
  cash_held_da: number; cash_limit_da: number | null; entries: WalletEntry[]; topups: Topup[];
}

// Algérie Poste account: 20 digits starting 007 99999. Shown in groups (007 99999 0012345678 90) so it is easy to check.
export const cleanRip = (v: string) => v.replace(/\D/g, '').slice(0, 20);
export const ripOk = (v: string) => /^00799999\d{12}$/.test(cleanRip(v));
export const showRip = (v: string) => { const d = cleanRip(v); return [d.slice(0, 3), d.slice(3, 8), d.slice(8, 18), d.slice(18)].filter(Boolean).join(' '); };

export const money = (c: Client) => ({
  payout: () => c.call<{ payout: Payout | null }>('/get_payout_account').then(r => r.payout),
  setPayout: (rip: string, holder: string) => c.call<{ payout: Payout }>('/set_payout_account', { rip: cleanRip(rip), holder_name: holder.trim() }).then(r => r.payout),
  sales: () => c.call<{ waiting_da: number; received_da: number; sales: Sale[] }>('/list_sales'),
  confirm: (orderId: string) => c.call('/confirm_settlement', { order_id: orderId }),
  dispute: (orderId: string, note: string) => c.call('/dispute_settlement', { order_id: orderId, note }),
  settlements: () => c.call<{ to_send_da: number; waiting_confirmation_da: number; settlements: CourierSettlement[] }>('/list_settlements'),
  receiptPhoto: (blob: Blob | Uint8Array) => c.call<{ document_id: string }>('/upload_document?kind=transfer_receipt', blob).then(r => r.document_id),
  markSent: (orderId: string, b: { method: 'baridimob'; reference: string; receipt_photo: string } | { method: 'cash' }) => c.call('/mark_settlement_sent', { order_id: orderId, ...b }),
  wallet: () => c.call<Wallet>('/get_wallet'),
  topup: (amount: number, reference: string, receipt: string) => c.call<Wallet>('/request_topup', { amount_da: amount, reference: reference.trim(), receipt_photo: receipt }),
});
