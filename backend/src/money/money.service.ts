import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Q, notify } from '../notify/notify';
import { bad, fail, isInt, text, uuid } from '../common/errors';
import { cfg, walletOn } from '../common/config';
import { Documents } from '../documents/documents.service';
import { SecurityLog } from '../security/security-log.service';
import { limiter, limitsOff } from '../security/limiter';
import { recordViolation } from '../trust/rules';
import { CASH_LIMIT_SQL } from '../orders/matching.service';

// The money system (owner's decisions, Oct 2026). The platform never holds customers' money:
//  - the delivery fee is cash for the courier;
//  - the goods money (cash on delivery) goes from the courier STRAIGHT to the seller's Algérie Poste account (BaridiMob)
//    or by hand, within 24 hours; the courier proves it (reference + receipt photo), the seller confirms or disputes;
//  - the platform's commission comes out of the courier's prepaid wallet, topped up by transfer to the platform's account.
// Every step is written in the order's permanent history; ledgers are never edited.

// Algérie Poste account (RIP): 20 digits, 007 99999 + CCP account (10 digits) + key (2 digits). Spaces are ignored.
// The key is not recomputed here (no official formula was found); the account holder's name is shown before each transfer
// and the seller confirms the money arrived, so a typing mistake is caught by people, never silently.
export const RIP = /^00799999[0-9]{12}$/;
export const cleanRip = (v: any) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : '');
const SETTLEMENT_COLS = `s.order_id, o.ref, s.amount_da, s.status, s.due_at, s.method, s.reference, s.receipt_doc IS NOT NULL has_receipt, s.sent_at, s.confirmed_at,
  s.dispute_note, s.disputed_at, s.resolution_note, s.resolved_at, s.overdue_at IS NOT NULL was_late, s.created_at, (s.status='pending' AND s.due_at < now()) overdue`;

async function event(q: Q, orderId: string, type: string, actor: string | null, data: any = {}) {
  await q(`INSERT INTO order_events(order_id, type, actor_profile_id, data) VALUES ($1,$2,$3,$4)`, [orderId, type, actor, data]);
}

// Called inside the "delivered" transaction: the commission is taken from the courier's wallet and, for cash on delivery,
// the goods money becomes a debt to the seller, due within 24 hours.
export async function onDelivered(q: Q, o: any, driverId: string) {
  if (o.leg !== 'delivery') return;
  if (walletOn()) {
    const [p] = await q(`SELECT commission_percent FROM pricing_rules WHERE version=$1`, [o.pricing_version]);
    const commission = Math.round((o.locked_da * (p?.commission_percent ?? 10)) / 100);
    await q(`UPDATE orders SET commission_da=$2 WHERE id=$1`, [o.id, commission]);
    if (commission > 0) await q(`INSERT INTO wallet_ledger(driver_profile_id, type, amount_da, order_id) VALUES ($1,'commission',$2,$3) ON CONFLICT DO NOTHING`, [driverId, -commission, o.id]);
  }
  if (o.cod_amount_da > 0 && o.cod_rip) {
    const [s] = await q(`INSERT INTO cod_settlements(order_id, driver_profile_id, seller_profile_id, amount_da, seller_rip, seller_holder, due_at)
                         VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7)) ON CONFLICT DO NOTHING RETURNING due_at`,
      [o.id, driverId, o.user_profile_id, o.cod_amount_da, o.cod_rip, o.cod_holder, cfg.codSettleHours()]);
    if (s) {
      await notify(q, { profile: driverId, kind: 'settlement.due', order: o.id, dedupe: `settle:${o.id}:due`, data: { ref: o.ref, amount_da: o.cod_amount_da, due_at: s.due_at } });
      await notify(q, { profile: o.user_profile_id, kind: 'sale.collected', order: o.id, dedupe: `settle:${o.id}:collected`, data: { ref: o.ref, amount_da: o.cod_amount_da, due_at: s.due_at } });
    }
  }
}

// Every minute (watchdog): goods money not sent within 24 hours = a rule break (points), the courier gets no new work until
// it is settled, and staff get a case. Once per settlement.
export async function flagOverdue(db: Db) {
  const late = await db.query(`SELECT order_id FROM cod_settlements WHERE status='pending' AND due_at < now() AND overdue_at IS NULL LIMIT 100`);
  for (const l of late) await db.tx(async q => {
    const [s] = await q(`UPDATE cod_settlements s SET overdue_at=now() FROM orders o WHERE o.id=s.order_id AND s.order_id=$1 AND s.status='pending' AND s.overdue_at IS NULL
                         RETURNING s.driver_profile_id, s.seller_profile_id, s.amount_da, o.ref`, [l.order_id]);
    if (!s) return;
    await event(q, l.order_id, 'settlement_overdue', null, { amount_da: s.amount_da });
    await q(`INSERT INTO problem_reports(order_id, reporter_kind, reason, note) VALUES ($1,'system','check:cod_overdue',$2)`, [l.order_id, `Goods money (${s.amount_da} DA) not sent to the seller within ${cfg.codSettleHours()} hours`]);
    await recordViolation(q, { profile: s.driver_profile_id, rule: 'cod_late', order: l.order_id, note: `Goods money not sent to the seller within ${cfg.codSettleHours()} hours`, source: 'system' });
    await notify(q, { profile: s.driver_profile_id, kind: 'settlement.overdue', order: l.order_id, priority: 'high', dedupe: `settle:${l.order_id}:overdue`, data: { ref: s.ref, amount_da: s.amount_da } });
    await notify(q, { profile: s.seller_profile_id, kind: 'sale.overdue', order: l.order_id, dedupe: `settle:${l.order_id}:sale_overdue`, data: { ref: s.ref, amount_da: s.amount_da } });
  });
  return late.length;
}

@Injectable()
export class MoneyService {
  constructor(private db: Db, private documents: Documents, private sec: SecurityLog) {}

  // ---------- where a person receives money (sender or courier: one per account) ----------
  async getPayout(accountId: string) {
    const p = await this.db.one(`SELECT rip, holder_name, updated_at FROM payout_accounts WHERE account_id=$1`, [accountId]);
    return { payout: p ?? null };
  }

  async setPayout(accountId: string, profileId: string | null, ip: string, b: any) {
    const rip = cleanRip(b?.rip);
    if (!RIP.test(rip)) throw bad('BAD_RIP', 'The RIP must be the 20 digits of your Algérie Poste account, starting with 007 99999');
    const holder = text(b?.holder_name, 'holder_name', 3, 80);
    if (/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/.test(holder)) throw bad('BAD_TEXT', 'holder_name has hidden characters');
    // Changing where money goes is sensitive (a stolen phone could redirect it): limited, logged, and announced.
    if (!limitsOff() && !limiter.hit('payout:' + accountId, 5, 86400_000).ok) throw fail(429, 'RATE_LIMITED', 'Too many changes today. Try again tomorrow.');
    const before = await this.db.one(`SELECT rip FROM payout_accounts WHERE account_id=$1`, [accountId]);
    await this.db.tx(async q => {
      await q(`INSERT INTO payout_accounts(account_id, rip, holder_name) VALUES ($1,$2,$3)
               ON CONFLICT (account_id) DO UPDATE SET rip=EXCLUDED.rip, holder_name=EXCLUDED.holder_name, updated_at=now()`, [accountId, rip, holder]);
      if (before && before.rip !== rip) for (const p of await q(`SELECT id FROM profiles WHERE account_id=$1 AND status <> 'deleted'`, [accountId]))
        await notify(q, { profile: p.id, kind: 'payout.changed', dedupe: `payout:${accountId}:${Date.now()}`, data: { last4: rip.slice(-4) } });
    });
    this.sec.event(before ? 'payout_changed' : 'payout_set', ip, { last4: rip.slice(-4) }, { account: accountId });
    return this.getPayout(accountId);
  }

  // ---------- SELLER (user profile): money from my cash-on-delivery sales ----------
  async listSales(userId: string) {
    const rows = await this.db.query(
      `SELECT ${SETTLEMENT_COLS}, dp.display_name driver_name, da.phone driver_phone
       FROM cod_settlements s JOIN orders o ON o.id=s.order_id JOIN profiles dp ON dp.id=s.driver_profile_id LEFT JOIN accounts da ON da.id=dp.account_id
       WHERE s.seller_profile_id=$1 ORDER BY (s.status IN ('pending','sent','disputed')) DESC, s.created_at DESC LIMIT 100`, [userId]);
    const [t] = await this.db.query(
      `SELECT COALESCE(sum(amount_da) FILTER (WHERE status IN ('pending','sent','disputed')),0)::int waiting_da,
              COALESCE(sum(amount_da) FILTER (WHERE status IN ('confirmed','resolved_paid')),0)::int received_da FROM cod_settlements WHERE seller_profile_id=$1`, [userId]);
    return { ...t, sales: rows };
  }

  // "I received the money": closes the debt. Also works before the courier pressed "sent" (e.g. paid by hand).
  async confirm(userId: string, orderId: any) {
    uuid(orderId, 'order_id');
    await this.db.tx(async q => {
      const [s] = await q(`SELECT s.*, o.ref FROM cod_settlements s JOIN orders o ON o.id=s.order_id WHERE s.order_id=$1 AND s.seller_profile_id=$2 FOR UPDATE OF s`, [orderId, userId]);
      if (!s) throw fail(404, 'NOT_FOUND', 'Sale not found');
      if (!['pending', 'sent', 'disputed'].includes(s.status)) throw fail(409, 'ALREADY_CLOSED', `This payment is already ${s.status}`);
      await q(`UPDATE cod_settlements SET status='confirmed', confirmed_at=now() WHERE order_id=$1`, [orderId]);
      await q(`INSERT INTO cash_ledger(driver_profile_id, order_id, type, amount_da) VALUES ($1,$2,'paid_to_seller',$3) ON CONFLICT DO NOTHING`, [s.driver_profile_id, orderId, -s.amount_da]);
      await event(q, orderId, 'settlement_confirmed', userId, { amount_da: s.amount_da, from: s.status });
      // The seller says the money arrived: the cases about this payment are settled too.
      await q(`UPDATE problem_reports SET status='resolved', resolution='The seller confirmed the money arrived', resolved_at=now() WHERE order_id=$1 AND reason IN ('cod_not_received','check:cod_overdue') AND status <> 'resolved'`, [orderId]);
      await notify(q, { profile: s.driver_profile_id, kind: 'settlement.confirmed', order: orderId, dedupe: `settle:${orderId}:confirmed`, data: { ref: s.ref, amount_da: s.amount_da } });
    });
    return this.listSales(userId);
  }

  // "The money did not arrive": only after the courier said he sent it, or after the 24 hours passed. Staff judge with the proofs.
  async dispute(userId: string, orderId: any, note: any) {
    uuid(orderId, 'order_id');
    const why = text(note, 'note', 3, 500);
    await this.db.tx(async q => {
      const [s] = await q(`SELECT s.*, o.ref, (s.due_at < now()) late FROM cod_settlements s JOIN orders o ON o.id=s.order_id WHERE s.order_id=$1 AND s.seller_profile_id=$2 FOR UPDATE OF s`, [orderId, userId]);
      if (!s) throw fail(404, 'NOT_FOUND', 'Sale not found');
      if (!(s.status === 'sent' || (s.status === 'pending' && s.late))) throw fail(409, 'CANNOT_DISPUTE', s.status === 'pending' ? 'The courier still has time to send the money' : `This payment is ${s.status}`);
      await q(`UPDATE cod_settlements SET status='disputed', dispute_note=$2, disputed_at=now() WHERE order_id=$1`, [orderId, why]);
      await event(q, orderId, 'settlement_disputed', userId, { note: why });
      await q(`INSERT INTO problem_reports(order_id, reporter_profile_id, reason, note) VALUES ($1,$2,'cod_not_received',$3)`, [orderId, userId, why]);
      await notify(q, { profile: s.driver_profile_id, kind: 'settlement.disputed', order: orderId, priority: 'high', dedupe: `settle:${orderId}:disputed:${Date.now()}`, data: { ref: s.ref, amount_da: s.amount_da } });
    });
    return this.listSales(userId);
  }

  // ---------- COURIER: goods money to send to sellers ----------
  async listSettlements(driverId: string) {
    const rows = await this.db.query(
      `SELECT ${SETTLEMENT_COLS}, s.seller_rip, s.seller_holder, sp.display_name seller_name, sa.phone seller_phone
       FROM cod_settlements s JOIN orders o ON o.id=s.order_id JOIN profiles sp ON sp.id=s.seller_profile_id LEFT JOIN accounts sa ON sa.id=sp.account_id
       WHERE s.driver_profile_id=$1 ORDER BY (s.status IN ('pending','disputed')) DESC, s.due_at ASC LIMIT 100`, [driverId]);
    const [t] = await this.db.query(`SELECT COALESCE(sum(amount_da) FILTER (WHERE status IN ('pending','disputed')),0)::int to_send_da,
                                            COALESCE(sum(amount_da) FILTER (WHERE status='sent'),0)::int waiting_confirmation_da FROM cod_settlements WHERE driver_profile_id=$1`, [driverId]);
    return { ...t, settlements: rows };
  }

  // "I sent the money": by BaridiMob (transfer reference + photo of the receipt, both required) or by hand to the seller.
  async markSent(driverId: string, b: any) {
    uuid(b?.order_id, 'order_id');
    if (!['baridimob', 'cash'].includes(b?.method)) throw bad('BAD_METHOD', 'method must be baridimob or cash');
    const reference = b.method === 'baridimob' ? text(b?.reference, 'reference', 4, 40) : null;
    if (reference && !/^[A-Za-z0-9 \-/.]+$/.test(reference)) throw bad('BAD_REFERENCE', 'The reference may contain letters, digits, spaces and - / .');
    await this.db.tx(async q => {
      const [s] = await q(`SELECT s.*, o.ref, p.account_id FROM cod_settlements s JOIN orders o ON o.id=s.order_id JOIN profiles p ON p.id=s.driver_profile_id
                           WHERE s.order_id=$1 AND s.driver_profile_id=$2 FOR UPDATE OF s`, [b.order_id, driverId]);
      if (!s) throw fail(404, 'NOT_FOUND', 'Payment not found');
      if (!['pending', 'disputed'].includes(s.status)) throw fail(409, 'ALREADY_SENT', `This payment is ${s.status}`);
      const receipt = b.method === 'baridimob' ? await this.documents.attachToOrder(q, s.account_id, s.order_id, b.receipt_photo, 'transfer_receipt') : null;
      await q(`UPDATE cod_settlements SET status='sent', method=$2, reference=$3, receipt_doc=$4, sent_at=now() WHERE order_id=$1`, [s.order_id, b.method, reference, receipt]);
      await event(q, s.order_id, 'settlement_sent', driverId, { method: b.method, reference, receipt: !!receipt, again: s.status === 'disputed' });
      await notify(q, { profile: s.seller_profile_id, kind: 'sale.sent', order: s.order_id, priority: 'high', dedupe: `settle:${s.order_id}:sent:${Date.now()}`, data: { ref: s.ref, amount_da: s.amount_da, method: b.method } });
    });
    return this.listSettlements(driverId);
  }

  // The receipt photo of one payment, for the seller and the courier of that payment only.
  async receipt(profileId: string, orderId: any) {
    uuid(orderId, 'order_id');
    const s = await this.db.one(`SELECT receipt_doc FROM cod_settlements WHERE order_id=$1 AND (seller_profile_id=$2 OR driver_profile_id=$2)`, [orderId, profileId]);
    const p = s?.receipt_doc ? await this.documents.orderPhoto(orderId, s.receipt_doc) : null;
    if (!p) throw fail(404, 'NOT_FOUND', 'Receipt not found');
    return p;
  }

  // ---------- COURIER: prepaid wallet (the platform's commission) ----------
  async wallet(driverId: string) {
    const [b] = await this.db.query(`SELECT COALESCE(sum(amount_da),0)::int balance FROM wallet_ledger WHERE driver_profile_id=$1`, [driverId]);
    const entries = await this.db.query(`SELECT w.id, w.type, w.amount_da, w.note, w.created_at, o.ref FROM wallet_ledger w LEFT JOIN orders o ON o.id=w.order_id WHERE w.driver_profile_id=$1 ORDER BY w.id DESC LIMIT 50`, [driverId]);
    const topups = await this.db.query(`SELECT id, amount_da, reference, status, reason, created_at, decided_at FROM wallet_topups WHERE driver_profile_id=$1 ORDER BY id DESC LIMIT 20`, [driverId]);
    const [c] = await this.db.query(`SELECT COALESCE((SELECT sum(amount_da) FROM cash_ledger WHERE driver_profile_id=$1),0)::int held, ${CASH_LIMIT_SQL('p')} AS limit_da
                                     FROM profiles p JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1`, [driverId]);
    const [r] = await this.db.query(`SELECT commission_percent FROM pricing_rules WHERE active LIMIT 1`);
    return {
      active: walletOn(), balance_da: b.balance, credit_da: cfg.walletCreditDa(), commission_percent: r?.commission_percent ?? null,
      platform_account: walletOn() ? { rip: cfg.platformRip(), holder_name: cfg.platformHolder() } : null,
      cash_held_da: c?.held ?? 0, cash_limit_da: c?.limit_da ?? null,
      entries: entries.map((e: any) => ({ ...e, id: Number(e.id) })), topups: topups.map((t: any) => ({ ...t, id: Number(t.id) })),
    };
  }

  // "I topped up": the courier transferred money to the platform's account; it counts once a staff member checks the receipt.
  async requestTopup(driverId: string, b: any) {
    if (!walletOn()) throw fail(409, 'WALLET_NOT_OPEN', 'Top-ups open when the platform account is announced');
    if (!isInt(b?.amount_da) || b.amount_da < 100 || b.amount_da > 200000) throw bad('BAD_AMOUNT', 'amount_da must be 100 to 200000 dinars');
    const reference = text(b?.reference, 'reference', 4, 40);
    if (!/^[A-Za-z0-9 \-/.]+$/.test(reference)) throw bad('BAD_REFERENCE', 'The reference may contain letters, digits, spaces and - / .');
    const doc = typeof b?.receipt_photo === 'string' && /^[0-9a-f-]{36}$/i.test(b.receipt_photo) ? b.receipt_photo : null;
    if (!doc) throw bad('PHOTO_REQUIRED', 'A photo of the transfer receipt is required');
    const t = await this.db.tx(async q => {
      const [open] = await q(`SELECT count(*)::int n FROM wallet_topups WHERE driver_profile_id=$1 AND status='pending'`, [driverId]);
      if (open.n >= 3) throw fail(429, 'TOO_MANY_PENDING', 'Wait until your other top-ups are checked');
      const [d] = await q(`UPDATE documents SET profile_id=$2 WHERE id=$1 AND account_id=(SELECT account_id FROM profiles WHERE id=$2) AND kind='transfer_receipt' AND profile_id IS NULL AND order_id IS NULL RETURNING id`, [doc, driverId]);
      if (!d) throw bad('BAD_DOCUMENT', 'The receipt must be a photo you just took');
      try {
        const [x] = await q(`INSERT INTO wallet_topups(driver_profile_id, amount_da, reference, receipt_doc) VALUES ($1,$2,$3,$4) RETURNING id`, [driverId, b.amount_da, reference, d.id]);
        return x;
      } catch (e: any) { if (e.code === '23505') throw fail(409, 'REFERENCE_USED', 'This transfer reference was already sent'); throw e; }
    });
    return { topup_id: Number(t.id), ...(await this.wallet(driverId)) };
  }
}
