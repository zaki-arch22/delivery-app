import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { bad } from '../common/errors';
import { cfg } from '../common/config';

const page = (p: any) => Math.max(1, Number(p) || 1);
const LOCAL = (col: string) => `(${col} AT TIME ZONE 'Africa/Algiers')::date`;   // the day in Algiers
const TODAY = `(now() AT TIME ZONE 'Africa/Algiers')::date`;

// What staff need to RUN the service (owner's wish, Oct 2026): what is happening now (live operations), what happened on
// each day (the operations log), alerts for the important things only (seen or not, per staff member), and one search box.
@Injectable()
export class StaffOpsService {
  constructor(private db: Db) {}

  // ---------- live operations: every order in progress, with what may need a hand, and the couriers online ----------
  async live() {
    const orders = await this.db.query(
      `SELECT o.id, o.ref, o.leg, o.status, o.size, o.vehicle, o.offered_da, o.locked_da, o.cod_amount_da, o.payer, o.code_attempts,
              o.created_at, o.search_started_at, o.assigned_at, o.picked_up_at, o.pickup_address, o.dropoff_address,
              ST_Y(o.pickup_point::geometry) pickup_lat, ST_X(o.pickup_point::geometry) pickup_lng, ST_Y(o.dropoff_point::geometry) dropoff_lat, ST_X(o.dropoff_point::geometry) dropoff_lng,
              up.display_name user_name, ua.phone user_phone, dp.display_name driver_name, da.phone driver_phone,
              ST_Y(dd.last_location::geometry) driver_lat, ST_X(dd.last_location::geometry) driver_lng, extract(epoch FROM now() - dd.last_location_at)::int driver_seen_s,
              extract(epoch FROM now() - COALESCE(o.picked_up_at, o.assigned_at, o.search_started_at, o.created_at))::int in_state_s,
              (SELECT count(*) FROM offers f WHERE f.order_id=o.id AND f.status IN ('offered','bid'))::int couriers_notified,
              (SELECT count(*) FROM offers f WHERE f.order_id=o.id AND f.status='bid' AND f.bid_expires_at > now())::int bids,
              (SELECT count(*) FROM problem_reports r WHERE r.order_id=o.id AND r.status <> 'resolved')::int open_problems
       FROM orders o JOIN profiles up ON up.id=o.user_profile_id LEFT JOIN accounts ua ON ua.id=up.account_id
         LEFT JOIN profiles dp ON dp.id=o.driver_profile_id LEFT JOIN accounts da ON da.id=dp.account_id LEFT JOIN driver_details dd ON dd.profile_id=dp.id
       WHERE o.status IN ('searching','assigned','picked_up') ORDER BY o.created_at LIMIT 300`);
    // Flags: what a person should look at (the same limits as the automatic checks).
    for (const o of orders) {
      const f: string[] = [];
      if (o.status === 'searching' && o.in_state_s > 600) f.push('no_courier_10min');
      if (o.status === 'searching' && o.couriers_notified === 0 && o.in_state_s > 60) f.push('nobody_near');
      if (o.status === 'assigned' && o.in_state_s > cfg.pickupLateMin() * 60) f.push('pickup_late');
      if (o.status === 'picked_up' && o.in_state_s > cfg.overdueMin() * 60) f.push('parcel_overdue');
      if (o.status !== 'searching' && (o.driver_seen_s == null || o.driver_seen_s > 300)) f.push('courier_silent');
      if (o.code_attempts >= 5) f.push('code_locked');
      if (o.open_problems > 0) f.push('problem');
      o.flags = f;
    }
    const couriers = await this.db.query(
      `SELECT p.id, p.display_name, a.phone, d.vehicle, ST_Y(d.last_location::geometry) lat, ST_X(d.last_location::geometry) lng,
              extract(epoch FROM now() - d.last_location_at)::int seen_s,
              (SELECT o.ref FROM orders o WHERE o.driver_profile_id=p.id AND o.status IN ('assigned','picked_up') LIMIT 1) job_ref
       FROM driver_details d JOIN profiles p ON p.id=d.profile_id LEFT JOIN accounts a ON a.id=p.account_id
       WHERE d.is_online AND p.status='active' ORDER BY p.display_name LIMIT 500`);
    return { at: new Date().toISOString(), orders, couriers };
  }

  // ---------- operations log: one day at a time (Algiers time) ----------
  async dayLog(f: any) {
    const day = typeof f.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.day) && !Number.isNaN(Date.parse(f.day)) ? f.day : null;
    const outcome = f.outcome ?? 'all';
    if (!['all', 'delivered', 'failed', 'cancelled', 'returns'].includes(outcome)) throw bad('BAD_OUTCOME', 'outcome must be all, delivered, failed, cancelled or returns');
    const d = day ?? (await this.db.one(`SELECT to_char(${TODAY}, 'YYYY-MM-DD') d`)).d;
    // The days list (last 30 days) for moving around, with their numbers.
    const days = await this.db.query(
      `SELECT to_char(x.d, 'YYYY-MM-DD') AS day,
              count(o.id) FILTER (WHERE o.leg='delivery')::int created,
              count(o.id) FILTER (WHERE o.leg='delivery' AND o.status='delivered')::int delivered,
              count(o.id) FILTER (WHERE o.status IN ('failed','cancelled','expired'))::int not_done
       FROM generate_series(${TODAY} - 29, ${TODAY}, interval '1 day') g(t) CROSS JOIN LATERAL (SELECT t::date d) x
       LEFT JOIN orders o ON o.status IN ('delivered','failed','cancelled','expired') AND ${LOCAL('COALESCE(o.ended_at, o.delivered_at, o.created_at)')} = x.d
       GROUP BY x.d ORDER BY x.d DESC`);
    const [summary] = await this.db.query(
      `SELECT count(*) FILTER (WHERE ${LOCAL('o.created_at')} = $1::date AND o.leg='delivery')::int created,
              count(*) FILTER (WHERE o.status='delivered' AND o.leg='delivery' AND ${LOCAL('o.delivered_at')} = $1::date)::int delivered,
              count(*) FILTER (WHERE o.status='failed' AND o.leg='delivery' AND ${LOCAL('COALESCE(o.ended_at, o.created_at)')} = $1::date)::int failed,
              count(*) FILTER (WHERE o.status IN ('cancelled','expired') AND ${LOCAL('COALESCE(o.ended_at, o.created_at)')} = $1::date)::int cancelled,
              count(*) FILTER (WHERE o.leg='return' AND o.status='delivered' AND ${LOCAL('o.delivered_at')} = $1::date)::int returns,
              COALESCE(sum(o.locked_da) FILTER (WHERE o.status='delivered' AND o.leg='delivery' AND ${LOCAL('o.delivered_at')} = $1::date),0)::int fees_da,
              COALESCE(sum(o.cod_amount_da) FILTER (WHERE o.status='delivered' AND o.leg='delivery' AND ${LOCAL('o.delivered_at')} = $1::date),0)::int cod_da,
              COALESCE(sum(o.commission_da) FILTER (WHERE o.status='delivered' AND ${LOCAL('o.delivered_at')} = $1::date),0)::int commission_da,
              round(avg(extract(epoch FROM o.assigned_at - o.search_started_at)) FILTER (WHERE ${LOCAL('o.assigned_at')} = $1::date))::int avg_assign_s,
              round(avg(extract(epoch FROM o.delivered_at - o.picked_up_at)) FILTER (WHERE o.leg='delivery' AND o.status='delivered' AND ${LOCAL('o.delivered_at')} = $1::date))::int avg_trip_s,
              (SELECT count(*) FROM problem_reports r WHERE ${LOCAL('r.created_at')} = $1::date)::int problems,
              (SELECT count(*) FROM staff_audit a WHERE ${LOCAL('a.created_at')} = $1::date)::int staff_actions
       FROM orders o`, [d]);
    const where = outcome === 'delivered' ? `o.status='delivered' AND o.leg='delivery'` : outcome === 'failed' ? `o.status='failed'`
      : outcome === 'cancelled' ? `o.status IN ('cancelled','expired')` : outcome === 'returns' ? `o.leg='return'` : `true`;
    const orders = await this.db.query(
      `SELECT o.id, o.ref, o.leg, o.status, o.locked_da, o.offered_da, o.cod_amount_da, o.created_at, o.delivered_at, COALESCE(o.ended_at, o.delivered_at) ended_at,
              up.display_name user_name, dp.display_name driver_name, o.cancel_reason,
              (SELECT e.data->>'reason' FROM order_events e WHERE e.order_id=o.id AND e.type='delivery_failed' ORDER BY e.id DESC LIMIT 1) fail_reason,
              (SELECT count(*) FROM problem_reports r WHERE r.order_id=o.id)::int problems
       FROM orders o JOIN profiles up ON up.id=o.user_profile_id LEFT JOIN profiles dp ON dp.id=o.driver_profile_id
       WHERE o.status IN ('delivered','failed','cancelled','expired') AND ${LOCAL('COALESCE(o.ended_at, o.delivered_at, o.created_at)')} = $1::date AND ${where}
       ORDER BY COALESCE(o.ended_at, o.delivered_at, o.created_at) DESC LIMIT 100 OFFSET $2`, [d, (page(f.page) - 1) * 100]);
    return { day: d, page: page(f.page), summary, orders, days };
  }

  // ---------- alerts: only what needs a person (SOS, reports, checks, money disputes, decisions waiting) ----------
  async alerts(staff: string) {
    const [s] = await this.db.query(`SELECT alerts_seen_at FROM staff_users WHERE id=$1`, [staff]);
    const rows = await this.db.query(
      `(SELECT 'p'||r.id AS key, r.created_at AS at, CASE WHEN r.reason='emergency' THEN 'sos' WHEN r.reason IN ('cod_not_received','check:cod_overdue') THEN 'money' WHEN r.reporter_kind='system' THEN 'check' ELSE 'report' END AS kind,
               r.reason AS reason, o.id AS order_id, o.ref, NULL::uuid AS profile_id, NULL::text AS name, (r.status = 'resolved') AS handled, 'problems' AS page
        FROM problem_reports r LEFT JOIN orders o ON o.id=r.order_id WHERE r.created_at > now() - interval '7 days' ORDER BY r.id DESC LIMIT 100)
       UNION ALL
       (SELECT 'd'||p.id, p.created_at, 'driver', NULL, NULL, NULL, p.id, p.display_name, (p.status <> 'pending_approval'), 'drivers'
        FROM profiles p WHERE p.type='driver' AND p.created_at > now() - interval '7 days' ORDER BY p.created_at DESC LIMIT 30)
       UNION ALL
       (SELECT 't'||t.id, t.created_at, 'topup', NULL, NULL, NULL, t.driver_profile_id, NULL, (t.status <> 'pending'), 'wallets'
        FROM wallet_topups t WHERE t.created_at > now() - interval '7 days' ORDER BY t.id DESC LIMIT 30)
       UNION ALL
       (SELECT 'v'||v.id, v.appealed_at, 'appeal', v.rule, v.order_id, NULL, v.profile_id, NULL, (v.status <> 'appealed'), 'trust'
        FROM violations v WHERE v.appealed_at > now() - interval '7 days' ORDER BY v.appealed_at DESC LIMIT 30)
       ORDER BY at DESC LIMIT 120`);
    const LEVEL: Record<string, 'danger' | 'warn' | 'info'> = { sos: 'danger', money: 'danger', check: 'warn', report: 'warn', driver: 'info', topup: 'info', appeal: 'info' };
    const seen = s?.alerts_seen_at ? new Date(s.alerts_seen_at).getTime() : 0;
    const alerts = rows.map((r: any) => ({ ...r, level: LEVEL[r.kind], unseen: new Date(r.at).getTime() > seen }));
    return { now: new Date().toISOString(), seen_at: s?.alerts_seen_at ?? null, unseen: alerts.filter(a => a.unseen).length, open: alerts.filter(a => !a.handled).length, alerts };
  }

  async markAlertsSeen(staff: string) {
    await this.db.query(`UPDATE staff_users SET alerts_seen_at=now() WHERE id=$1`, [staff]);
    return { ok: true };
  }

  // ---------- one search box: an order reference, a phone number or a name ----------
  async search(f: any) {
    const q = typeof f.q === 'string' ? f.q.trim().slice(0, 40) : '';
    if (q.length < 2) return { results: [] };
    const digits = q.replace(/\D/g, '');
    const orders = await this.db.query(`SELECT o.id, o.ref, o.status FROM orders o WHERE o.ref = upper($1) OR ($2 <> '' AND length($2) >= 6 AND o.recipient_phone LIKE '%'||$2||'%') ORDER BY o.created_at DESC LIMIT 8`, [q, digits]);
    const people = await this.db.query(
      `SELECT p.id, p.type, p.display_name, p.status, a.phone FROM profiles p JOIN accounts a ON a.id=p.account_id
       WHERE p.status <> 'deleted' AND (p.display_name ILIKE '%'||$1||'%' OR ($2 <> '' AND length($2) >= 6 AND a.phone LIKE '%'||$2||'%')) ORDER BY p.created_at DESC LIMIT 12`, [q, digits]);
    return { results: [
      ...orders.map((o: any) => ({ type: 'order', id: o.id, label: o.ref, sub: o.status })),
      ...people.map((p: any) => ({ type: p.type, id: p.id, label: p.display_name, sub: p.phone, status: p.status })),
    ] };
  }
}
