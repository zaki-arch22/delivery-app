import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Q, notify } from '../notify/notify';
import { bad, fail, isId, isInt, nat, text, uuid } from '../common/errors';
import { cfg, walletOn } from '../common/config';
import { CASH_LIMIT_SQL } from '../orders/matching.service';

const audit = (q: Q, staff: string, action: string, type: string, id: string, data: any = {}) =>
  q(`INSERT INTO staff_audit(staff_id, action, target_type, target_id, data) VALUES ($1,$2,$3,$4,$5)`, [staff, action, type, id, data]);
const page = (p: any) => Math.max(1, Number(p) || 1);
const num = (rows: any[], ...keys: string[]) => rows.map(r => { for (const k of keys) if (r[k] != null) r[k] = Number(r[k]); return r; });
const DAY = `(date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') AT TIME ZONE 'Africa/Algiers')`;   // start of today in Algiers

// Staff: the money pages (seller payments, courier wallets, cash limits), the dashboard, the live feed and the audit log.
@Injectable()
export class StaffMoneyService {
  constructor(private db: Db) {}

  // ---------- goods money owed by couriers to sellers ----------
  async listSettlements(f: any) {
    const st = f.status ?? null;
    if (st !== null && !['pending', 'overdue', 'sent', 'confirmed', 'disputed', 'resolved_paid', 'resolved_unpaid', 'open'].includes(st)) throw bad('BAD_STATUS', 'Unknown status');
    const rows = await this.db.query(
      `SELECT s.order_id, o.ref, s.amount_da, s.status, s.due_at, s.method, s.reference, s.receipt_doc, s.sent_at, s.confirmed_at, s.dispute_note, s.disputed_at,
              s.resolution_note, s.resolved_at, s.overdue_at, s.created_at, s.seller_rip, s.seller_holder, (s.status='pending' AND s.due_at < now()) overdue,
              dp.id driver_id, dp.display_name driver_name, da.phone driver_phone, sp.id seller_id, sp.display_name seller_name, sa.phone seller_phone, st.name resolved_by
       FROM cod_settlements s JOIN orders o ON o.id=s.order_id JOIN profiles dp ON dp.id=s.driver_profile_id LEFT JOIN accounts da ON da.id=dp.account_id
         JOIN profiles sp ON sp.id=s.seller_profile_id LEFT JOIN accounts sa ON sa.id=sp.account_id LEFT JOIN staff_users st ON st.id=s.resolved_by
       WHERE ($1::text IS NULL OR ($1='overdue' AND s.status='pending' AND s.due_at < now()) OR ($1='open' AND s.status IN ('pending','sent','disputed')) OR s.status=$1)
         AND ($2::text IS NULL OR o.ref=upper($2) OR da.phone LIKE '%'||$2||'%' OR sa.phone LIKE '%'||$2||'%')
       ORDER BY (s.status='disputed') DESC, (s.status='pending' AND s.due_at < now()) DESC, s.created_at DESC LIMIT 50 OFFSET $3`,
      [st, f.q ? String(f.q).trim().slice(0, 40) : null, (page(f.page) - 1) * 50]);
    const [t] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status='pending')::int pending, COALESCE(sum(amount_da) FILTER (WHERE status='pending'),0)::int pending_da,
              count(*) FILTER (WHERE status='pending' AND due_at < now())::int overdue, COALESCE(sum(amount_da) FILTER (WHERE status='pending' AND due_at < now()),0)::int overdue_da,
              count(*) FILTER (WHERE status='sent')::int sent, COALESCE(sum(amount_da) FILTER (WHERE status='sent'),0)::int sent_da,
              count(*) FILTER (WHERE status='disputed')::int disputed, COALESCE(sum(amount_da) FILTER (WHERE status='disputed'),0)::int disputed_da FROM cod_settlements`);
    return { page: page(f.page), totals: t, settlements: rows };
  }

  // Staff decide a dispute (or an unpaid debt) with the proofs: the money reached the seller, or it did not. The platform
  // never pays in the courier's place; "unpaid" keeps the debt on the courier's cash account (no more cash orders) and the
  // full record stays for the seller.
  async resolveSettlement(staff: string, b: any) {
    const oid = uuid(b?.order_id, 'order_id');
    if (!['paid', 'unpaid'].includes(b?.outcome)) throw bad('BAD_OUTCOME', 'outcome must be paid or unpaid');
    const note = text(b?.note, 'note', 3, 500);
    await this.db.tx(async q => {
      const [s] = await q(`SELECT s.*, o.ref FROM cod_settlements s JOIN orders o ON o.id=s.order_id WHERE s.order_id=$1 FOR UPDATE OF s`, [oid]);
      if (!s) throw fail(404, 'NOT_FOUND', 'Payment not found');
      if (!['pending', 'sent', 'disputed'].includes(s.status)) throw fail(409, 'ALREADY_CLOSED', `This payment is already ${s.status}`);
      const status = b.outcome === 'paid' ? 'resolved_paid' : 'resolved_unpaid';
      await q(`UPDATE cod_settlements SET status=$2, resolved_by=$3, resolution_note=$4, resolved_at=now() WHERE order_id=$1`, [oid, status, staff, note]);
      if (b.outcome === 'paid') await q(`INSERT INTO cash_ledger(driver_profile_id, order_id, type, amount_da) VALUES ($1,$2,'paid_to_seller',$3) ON CONFLICT DO NOTHING`, [s.driver_profile_id, oid, -s.amount_da]);
      await q(`INSERT INTO order_events(order_id,type,actor_staff_id,data) VALUES ($1,'settlement_resolved',$2,$3)`, [oid, staff, { outcome: b.outcome, note, from: s.status }]);
      await q(`UPDATE problem_reports SET status='resolved', handled_by=$2, resolution=$3, resolved_at=now() WHERE order_id=$1 AND reason IN ('cod_not_received','check:cod_overdue') AND status <> 'resolved'`, [oid, staff, note]);
      await audit(q, staff, 'resolve_settlement', 'order', oid, { outcome: b.outcome, note, amount_da: s.amount_da });
      for (const p of [s.driver_profile_id, s.seller_profile_id])
        await notify(q, { profile: p, kind: 'settlement.resolved', order: oid, dedupe: `settle:${oid}:resolved:${p}`, data: { ref: s.ref, outcome: b.outcome, amount_da: s.amount_da } });
    });
    return { ok: true };
  }

  // ---------- courier wallets (the platform's commission) ----------
  async listTopups(f: any) {
    const st = f.status ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(st)) throw bad('BAD_STATUS', 'status must be pending, approved, rejected or all');
    const rows = await this.db.query(
      `SELECT t.id, t.amount_da, t.reference, t.receipt_doc, t.status, t.reason, t.created_at, t.decided_at, s.name decided_by, p.id driver_id, p.display_name driver_name, a.phone driver_phone,
              COALESCE((SELECT sum(amount_da) FROM wallet_ledger w WHERE w.driver_profile_id=p.id),0)::int balance_da
       FROM wallet_topups t JOIN profiles p ON p.id=t.driver_profile_id LEFT JOIN accounts a ON a.id=p.account_id LEFT JOIN staff_users s ON s.id=t.decided_by
       WHERE ($1='all' OR t.status=$1) ORDER BY t.id ${st === 'pending' ? 'ASC' : 'DESC'} LIMIT 50 OFFSET $2`, [st, (page(f.page) - 1) * 50]);
    return { page: page(f.page), platform_account: walletOn() ? { rip: cfg.platformRip(), holder_name: cfg.platformHolder() } : null, topups: num(rows, 'id') };
  }

  // A staff member checks the transfer arrived on the platform's account (reference, amount, receipt), then approves it.
  async decideTopup(staff: string, b: any) {
    if (!isId(b?.id)) throw bad('BAD_ID', 'id is required');
    if (!['approve', 'reject'].includes(b?.decision)) throw bad('BAD_DECISION', 'decision must be approve or reject');
    const reason = b.decision === 'reject' ? text(b?.reason, 'reason', 3, 300) : null;
    return this.db.tx(async q => {
      const [t] = await q(`UPDATE wallet_topups SET status=$2, decided_by=$3, decided_at=now(), reason=$4 WHERE id=$1 AND status='pending' RETURNING id, driver_profile_id, amount_da, reference`,
        [b.id, b.decision === 'approve' ? 'approved' : 'rejected', staff, reason]);
      if (!t) throw fail(409, 'ALREADY_DECIDED', 'This top-up is not waiting any more');
      if (b.decision === 'approve') await q(`INSERT INTO wallet_ledger(driver_profile_id, type, amount_da, topup_id) VALUES ($1,'topup',$2,$3)`, [t.driver_profile_id, t.amount_da, t.id]);
      await audit(q, staff, b.decision === 'approve' ? 'approve_topup' : 'reject_topup', 'profile', t.driver_profile_id, { topup: Number(t.id), amount_da: t.amount_da, reference: t.reference, reason });
      await notify(q, { profile: t.driver_profile_id, kind: b.decision === 'approve' ? 'wallet.topup_approved' : 'wallet.topup_rejected', dedupe: `topup:${t.id}:decided`, data: { amount_da: t.amount_da, reason } });
      return { ok: true };
    });
  }

  async getWallet(id: any) {
    const pid = uuid(id, 'profile_id');
    const d = await this.db.one(`SELECT p.display_name, d.cash_limit_da, ${CASH_LIMIT_SQL('p')} AS effective_limit_da FROM profiles p JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1`, [pid]);
    if (!d) throw fail(404, 'NOT_FOUND', 'Driver not found');
    const [b] = await this.db.query(`SELECT COALESCE(sum(amount_da),0)::int balance FROM wallet_ledger WHERE driver_profile_id=$1`, [pid]);
    const entries = await this.db.query(`SELECT w.id, w.type, w.amount_da, w.note, w.created_at, o.ref, s.name staff FROM wallet_ledger w LEFT JOIN orders o ON o.id=w.order_id LEFT JOIN staff_users s ON s.id=w.staff_id
                                         WHERE w.driver_profile_id=$1 ORDER BY w.id DESC LIMIT 100`, [pid]);
    return { driver: d.display_name, balance_da: b.balance, credit_da: cfg.walletCreditDa(), cash_limit_da: d.cash_limit_da, effective_limit_da: d.effective_limit_da, entries: num(entries, 'id') };
  }

  async walletAdjust(staff: string, b: any) {
    const pid = uuid(b?.driver_profile_id, 'driver_profile_id'), note = text(b?.note, 'note', 3, 300);
    if (!isInt(b?.amount_da) || b.amount_da === 0 || Math.abs(b.amount_da) > 200000) throw bad('BAD_AMOUNT', 'amount_da must be a non-zero whole number (at most 200000)');
    return this.db.tx(async q => {
      const [d] = await q(`SELECT profile_id FROM driver_details WHERE profile_id=$1`, [pid]);
      if (!d) throw fail(404, 'NOT_FOUND', 'Driver not found');
      const [e] = await q(`INSERT INTO wallet_ledger(driver_profile_id, type, amount_da, staff_id, note) VALUES ($1,'adjustment',$2,$3,$4) RETURNING id`, [pid, b.amount_da, staff, note]);
      await audit(q, staff, 'wallet_adjustment', 'profile', pid, { entry: Number(e.id), amount_da: b.amount_da, note });
      await notify(q, { profile: pid, kind: 'wallet.adjusted', dedupe: `wallet:${e.id}`, data: { amount_da: b.amount_da } });
      const [bal] = await q(`SELECT COALESCE(sum(amount_da),0)::int balance FROM wallet_ledger WHERE driver_profile_id=$1`, [pid]);
      return { entry: Number(e.id), balance_da: bal.balance };
    });
  }

  // The ceiling of a courier's cash limit (0 = no cash-on-delivery orders). Below it, the limit grows by itself with experience.
  async setCashLimit(staff: string, b: any) {
    const pid = uuid(b?.driver_profile_id, 'driver_profile_id'), limit = nat(b?.cash_limit_da, 'cash_limit_da');
    return this.db.tx(async q => {
      const [d] = await q(`UPDATE driver_details SET cash_limit_da=$2 WHERE profile_id=$1 RETURNING profile_id`, [pid, limit]);
      if (!d) throw fail(404, 'NOT_FOUND', 'Driver not found');
      await audit(q, staff, 'set_cash_limit', 'profile', pid, { cash_limit_da: limit });
      return { ok: true, cash_limit_da: limit };
    });
  }

  // ---------- dashboard: the whole platform at a glance ----------
  async dashboard() {
    const one = async (sql: string, p: any[] = []) => (await this.db.query(sql, p))[0];
    const [orders, people, money, cases, days] = await Promise.all([
      one(`SELECT count(*) FILTER (WHERE created_at >= ${DAY} AND leg='delivery')::int created_today,
                  count(*) FILTER (WHERE delivered_at >= ${DAY} AND status='delivered' AND leg='delivery')::int delivered_today,
                  count(*) FILTER (WHERE status='cancelled' AND created_at >= ${DAY})::int cancelled_today,
                  count(*) FILTER (WHERE status='failed' AND created_at >= ${DAY} AND leg='delivery')::int failed_today,
                  count(*) FILTER (WHERE status='searching')::int searching_now,
                  count(*) FILTER (WHERE status IN ('assigned','picked_up'))::int active_now,
                  COALESCE(sum(locked_da) FILTER (WHERE delivered_at >= ${DAY} AND status='delivered' AND leg='delivery'),0)::int fees_today_da,
                  COALESCE(sum(cod_amount_da) FILTER (WHERE delivered_at >= ${DAY} AND status='delivered' AND leg='delivery'),0)::int cod_today_da,
                  round(avg(extract(epoch FROM assigned_at - search_started_at)) FILTER (WHERE assigned_at >= now() - interval '7 days'))::int avg_assign_s,
                  round(avg(extract(epoch FROM delivered_at - picked_up_at)) FILTER (WHERE delivered_at >= now() - interval '7 days' AND leg='delivery'))::int avg_trip_s,
                  count(*) FILTER (WHERE status='delivered' AND leg='delivery')::int delivered_total FROM orders`),
      one(`SELECT count(*) FILTER (WHERE type='user' AND status='active')::int users,
                  count(*) FILTER (WHERE type='user' AND created_at > now() - interval '7 days')::int users_new_7d,
                  count(*) FILTER (WHERE type='driver' AND status='active')::int drivers,
                  count(*) FILTER (WHERE type='driver' AND status='pending_approval')::int drivers_pending,
                  (SELECT count(*) FROM driver_details d JOIN profiles x ON x.id=d.profile_id WHERE d.is_online AND x.status='active' AND d.last_location_at > now() - interval '2 minutes')::int drivers_online,
                  (SELECT count(DISTINCT profile_id) FROM sanctions WHERE lifted_at IS NULL AND kind IN ('block','ban') AND (until IS NULL OR until > now()))::int blocked FROM profiles`),
      one(`SELECT (SELECT COALESCE(sum(amount_da),0) FROM cash_ledger)::int cash_held_da,
                  (SELECT count(*) FROM cod_settlements WHERE status='pending')::int settle_pending, (SELECT COALESCE(sum(amount_da),0) FROM cod_settlements WHERE status='pending')::int settle_pending_da,
                  (SELECT count(*) FROM cod_settlements WHERE status='pending' AND due_at < now())::int settle_overdue, (SELECT COALESCE(sum(amount_da),0) FROM cod_settlements WHERE status='pending' AND due_at < now())::int settle_overdue_da,
                  (SELECT count(*) FROM cod_settlements WHERE status='sent')::int settle_sent, (SELECT count(*) FROM cod_settlements WHERE status='disputed')::int settle_disputed,
                  (SELECT COALESCE(sum(amount_da),0) FROM cod_settlements WHERE status IN ('confirmed','resolved_paid') AND COALESCE(confirmed_at, resolved_at) > now() - interval '30 days')::int paid_to_sellers_30d_da,
                  (SELECT count(*) FROM wallet_topups WHERE status='pending')::int topups_pending, (SELECT COALESCE(sum(amount_da),0) FROM wallet_topups WHERE status='pending')::int topups_pending_da,
                  (SELECT COALESCE(-sum(amount_da),0) FROM wallet_ledger WHERE type='commission' AND created_at >= ${DAY})::int commission_today_da,
                  (SELECT COALESCE(-sum(amount_da),0) FROM wallet_ledger WHERE type='commission' AND created_at > now() - interval '30 days')::int commission_30d_da,
                  (SELECT count(*) FROM (SELECT driver_profile_id FROM wallet_ledger GROUP BY 1 HAVING sum(amount_da) < 0) x)::int wallets_owing`),
      one(`SELECT (SELECT count(*) FROM problem_reports WHERE status <> 'resolved')::int problems_open,
                  (SELECT count(*) FROM problem_reports WHERE status <> 'resolved' AND reporter_kind='system')::int checks_open,
                  (SELECT count(*) FROM violations WHERE status='appealed')::int appeals,
                  (SELECT count(*) FROM order_events WHERE type='emergency' AND created_at > now() - interval '24 hours')::int sos_24h,
                  (SELECT count(*) FROM orders WHERE status='picked_up' AND code_attempts >= 5)::int locked_codes`),
      this.db.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
                       (SELECT count(*) FROM orders o WHERE o.leg='delivery' AND (o.created_at AT TIME ZONE 'Africa/Algiers')::date = d)::int created,
                       (SELECT count(*) FROM orders o WHERE o.leg='delivery' AND o.status='delivered' AND (o.delivered_at AT TIME ZONE 'Africa/Algiers')::date = d)::int delivered,
                       (SELECT COALESCE(sum(locked_da),0) FROM orders o WHERE o.leg='delivery' AND o.status='delivered' AND (o.delivered_at AT TIME ZONE 'Africa/Algiers')::date = d)::int fees_da
                     FROM generate_series((now() AT TIME ZONE 'Africa/Algiers')::date - 13, (now() AT TIME ZONE 'Africa/Algiers')::date, interval '1 day') AS g(t), LATERAL (SELECT t::date AS d) x ORDER BY d`),
    ]);
    return { at: new Date().toISOString(), wallet_active: walletOn(), orders, people, money, cases, days };
  }

  // ---------- live feed: what happened since the last look (the console asks every few seconds) ----------
  async feed(f: any) {
    const since = typeof f.since === 'string' && !Number.isNaN(Date.parse(f.since)) ? new Date(f.since) : new Date(Date.now() - 24 * 3600_000);
    const rows = await this.db.query(
      `(SELECT 'e'||e.id key, e.created_at at, e.type kind, o.id order_id, o.ref, e.data FROM order_events e JOIN orders o ON o.id=e.order_id
          WHERE e.created_at > $1 AND e.type IN ('created','assigned','delivered','delivery_failed','cancelled','cancelled_by_support','recalled_by_sender','emergency','flag_far_away','flag_check',
            'settlement_sent','settlement_confirmed','settlement_disputed','settlement_overdue','settlement_resolved','recipient_reported') ORDER BY e.id DESC LIMIT 60)
       UNION ALL
       (SELECT 'p'||r.id, r.created_at, 'problem', o.id, o.ref, jsonb_build_object('reason', r.reason) FROM problem_reports r LEFT JOIN orders o ON o.id=r.order_id
          WHERE r.created_at > $1 ORDER BY r.id DESC LIMIT 30)
       UNION ALL
       (SELECT 'd'||p.id, p.created_at, 'driver_signup', NULL, NULL, jsonb_build_object('name', p.display_name) FROM profiles p WHERE p.type='driver' AND p.created_at > $1 ORDER BY p.created_at DESC LIMIT 20)
       UNION ALL
       (SELECT 't'||t.id, t.created_at, 'topup_request', NULL, NULL, jsonb_build_object('amount_da', t.amount_da) FROM wallet_topups t WHERE t.created_at > $1 ORDER BY t.id DESC LIMIT 20)
       UNION ALL
       (SELECT 'v'||v.id, v.appealed_at, 'appeal', v.order_id, NULL, jsonb_build_object('rule', v.rule) FROM violations v WHERE v.appealed_at > $1 ORDER BY v.appealed_at DESC LIMIT 20)
       ORDER BY at DESC LIMIT 80`, [since]);
    const DANGER = ['emergency', 'settlement_disputed', 'settlement_overdue'], WARN = ['delivery_failed', 'flag_far_away', 'flag_check', 'problem', 'recipient_reported', 'appeal', 'cancelled_by_support', 'recalled_by_sender'];
    return { now: new Date().toISOString(), items: rows.map((r: any) => ({ ...r, level: DANGER.includes(r.kind) ? 'danger' : WARN.includes(r.kind) ? 'warn' : 'info' })) };
  }

  // ---------- audit: every staff action, forever ----------
  async auditLog(f: any) {
    const rows = await this.db.query(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.data, a.created_at, s.name staff, s.email staff_email
       FROM staff_audit a JOIN staff_users s ON s.id=a.staff_id
       WHERE ($1::text IS NULL OR a.action=$1) AND ($2::text IS NULL OR a.target_id=$2) ORDER BY a.id DESC LIMIT 100 OFFSET $3`,
      [typeof f.action === 'string' && /^[a-z_]{2,40}$/.test(f.action) ? f.action : null, typeof f.target === 'string' && f.target.length <= 64 ? f.target : null, (page(f.page) - 1) * 100]);
    return { page: page(f.page), entries: num(rows, 'id') };
  }

  // ---------- customers ----------
  async listUsers(f: any) {
    const q = typeof f.q === 'string' ? f.q.trim().slice(0, 40) : '';
    const rows = await this.db.query(
      `SELECT p.id, p.display_name, p.status, a.phone, p.created_at, p.rating_count,
              CASE WHEN p.rating_count=0 THEN NULL ELSE round(p.rating_sum::numeric/p.rating_count,2) END rating,
              (SELECT count(*) FROM orders o WHERE o.user_profile_id=p.id AND o.leg='delivery')::int orders,
              (SELECT count(*) FROM orders o WHERE o.user_profile_id=p.id AND o.leg='delivery' AND o.status='delivered')::int delivered,
              (SELECT COALESCE(sum(amount_da),0) FROM cod_settlements s WHERE s.seller_profile_id=p.id AND s.status IN ('pending','sent','disputed'))::int cod_waiting_da,
              (pa.account_id IS NOT NULL) has_payout
       FROM profiles p JOIN accounts a ON a.id=p.account_id LEFT JOIN payout_accounts pa ON pa.account_id=a.id
       WHERE p.type='user' AND ($1 = '' OR p.display_name ILIKE '%'||$1||'%' OR a.phone LIKE '%'||$1||'%')
       ORDER BY p.created_at DESC LIMIT 50 OFFSET $2`, [q, (page(f.page) - 1) * 50]);
    return { page: page(f.page), users: rows };
  }
}
