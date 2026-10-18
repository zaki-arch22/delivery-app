import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Db } from '../db/db.service';
import { bad, fail, isInt, point, uuid } from '../common/errors';
import { notify } from '../notify/notify';
import { createReturnLeg } from '../orders/return-leg';

const REASONS = ['no_answer', 'refused', 'wrong_address'];
const cashToCollect = (o: any) => (o.leg === 'return' ? 0 : o.cod_amount_da + (o.payer === 'recipient' ? o.locked_da : 0));

@Injectable()
export class DriverService {
  constructor(private db: Db) {}

  async setOnline(driverId: string, online: any) {
    if (typeof online !== 'boolean') throw bad('BAD_INPUT', 'online must be true or false');
    if (!online) {
      const job = await this.db.one(`SELECT 1 FROM orders WHERE driver_profile_id=$1 AND status IN ('assigned','picked_up')`, [driverId]);
      if (job) throw fail(409, 'ON_JOB', 'Finish your current job before going offline');
    }
    await this.db.query(`UPDATE driver_details SET is_online=$2 WHERE profile_id=$1`, [driverId, online]);
    if (!online) await this.db.query(`UPDATE offers SET status='declined' WHERE driver_profile_id=$1 AND status='offered'`, [driverId]);
    return { online };
  }

  async updateLocation(driverId: string, b: any) {
    const p = point(b, 'location');
    const r = await this.db.one(`UPDATE driver_details SET last_location=ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, last_location_at=now() WHERE profile_id=$1 AND is_online RETURNING 1 AS ok`, [driverId, p.lng, p.lat]);
    if (!r) throw fail(409, 'NOT_ONLINE', 'Go online first');
    return { ok: true };
  }

  async home(driverId: string) {
    const [e] = await this.db.query(
      `SELECT COALESCE(sum(locked_da),0)::int earnings FROM orders WHERE driver_profile_id=$1 AND status='delivered' AND leg='delivery'
         AND delivered_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Algiers') AT TIME ZONE 'Africa/Algiers')`, [driverId]);
    const [c] = await this.db.query(`SELECT COALESCE(sum(amount_da),0)::int held FROM cash_ledger WHERE driver_profile_id=$1`, [driverId]);
    const d = await this.db.one(`SELECT d.is_online, d.cash_limit_da, CASE WHEN p.rating_count=0 THEN NULL ELSE round(p.rating_sum::numeric/p.rating_count,2) END rating, p.rating_count
                                 FROM driver_details d JOIN profiles p ON p.id=d.profile_id WHERE d.profile_id=$1`, [driverId]);
    return { online: d.is_online, earnings_today_da: e.earnings, cash_held_da: c.held, cash_limit_da: d.cash_limit_da, rating: d.rating, rating_count: d.rating_count };
  }

  async currentOffer(driverId: string) {
    const o = await this.db.one(
      `SELECT f.id offer_id, f.expires_at, ord.id order_id, ord.ref, ord.offered_da price_da, ord.payer, ord.cod_amount_da, ord.size, ord.vehicle, ord.distance_m trip_distance_m,
         round(ST_Distance(d.last_location, ord.pickup_point))::int pickup_distance_m, ord.pickup_address,
         CASE WHEN sp.rating_count=0 THEN NULL ELSE round(sp.rating_sum::numeric/sp.rating_count,2) END sender_rating
       FROM offers f JOIN orders ord ON ord.id=f.order_id AND ord.status='searching'
       JOIN profiles sp ON sp.id=ord.user_profile_id JOIN driver_details d ON d.profile_id=f.driver_profile_id
       WHERE f.driver_profile_id=$1 AND f.status='offered' AND f.expires_at > now() ORDER BY f.id DESC LIMIT 1`, [driverId]);
    if (o) o.offer_id = Number(o.offer_id);   // big ids come out of PostgreSQL as text; the app always gets a number
    return { offer: o ?? null };
  }

  async accept(driverId: string, offerId: any) {
    if (!isInt(offerId)) throw bad('BAD_ID', 'offer_id must be a number');
    return this.db.tx(async q => {
      const [f] = await q(`UPDATE offers SET status='accepted' WHERE id=$1 AND driver_profile_id=$2 AND status='offered' AND expires_at > now() RETURNING order_id`, [offerId, driverId]);
      if (!f) throw fail(409, 'OFFER_GONE', 'This offer is no longer available');
      let o;
      try {
        [o] = await q(`UPDATE orders SET status='assigned', driver_profile_id=$2, locked_da=offered_da, assigned_at=now() WHERE id=$1 AND status='searching' AND driver_profile_id IS NULL RETURNING id, user_profile_id, ref`, [f.order_id, driverId]);
      } catch (e: any) { if (e.code === '23505') throw fail(409, 'ALREADY_ON_JOB', 'You already have an active job'); throw e; }
      if (!o) throw fail(409, 'ORDER_TAKEN', 'Order already taken or cancelled');
      await q(`UPDATE offers SET status='expired' WHERE order_id=$1 AND status='offered'`, [f.order_id]);
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'assigned',$2,'{}')`, [f.order_id, driverId]);
      await notify(q, { profile: o.user_profile_id, kind: 'order.assigned', order: f.order_id, dedupe: `order:${f.order_id}:assigned`, data: { ref: o.ref } });
      return { job_order_id: f.order_id };
    }).then(async r => ({ job: await this.job(driverId, r.job_order_id) }));
  }

  async decline(driverId: string, offerId: any) {
    if (!isInt(offerId)) throw bad('BAD_ID', 'offer_id must be a number');
    const r = await this.db.one(`UPDATE offers SET status='declined' WHERE id=$1 AND driver_profile_id=$2 AND status='offered' RETURNING order_id`, [offerId, driverId]);
    if (!r) throw fail(409, 'OFFER_GONE', 'This offer is no longer available');
    await this.db.query(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'offer_declined',$2,'{}')`, [r.order_id, driverId]);
    return { ok: true };
  }

  // The driver's current job, or null. Recipient details are visible only after assignment.
  async job(driverId: string, orderId?: string) {
    const o = await this.db.one(
      `SELECT o.id, o.ref, o.leg, o.status, o.size, o.vehicle, o.payer, o.cod_amount_da, o.locked_da, o.distance_m, o.recipient_name, o.recipient_phone,
         o.pickup_address, o.dropoff_address, ST_Y(o.pickup_point::geometry) pickup_lat, ST_X(o.pickup_point::geometry) pickup_lng,
         ST_Y(o.dropoff_point::geometry) dropoff_lat, ST_X(o.dropoff_point::geometry) dropoff_lng,
         sp.display_name sender_name, sa.phone sender_phone
       FROM orders o JOIN profiles sp ON sp.id=o.user_profile_id JOIN accounts sa ON sa.id=sp.account_id
       WHERE o.driver_profile_id=$1 AND ${orderId ? 'o.id=$2' : `o.status IN ('assigned','picked_up')`} ORDER BY o.created_at DESC LIMIT 1`,
      orderId ? [driverId, orderId] : [driverId]);
    if (!o) return null;
    return { ...o, cash_to_collect_da: cashToCollect(o), next_step: o.status === 'assigned' ? 'picked_up' : o.status === 'picked_up' ? 'delivered' : null };
  }

  async step(driverId: string, b: any) {
    if (!['picked_up', 'delivered'].includes(b?.step)) throw bad('BAD_STEP', 'step must be picked_up or delivered');
    uuid(b?.order_id, 'order_id');
    const out = await this.db.tx(async q => {
      const [o] = await q(`SELECT * FROM orders WHERE id=$1 AND driver_profile_id=$2 FOR UPDATE`, [b.order_id, driverId]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Job not found');
      // The courier app queues actions offline and may resend them: repeating a finished step is a harmless success.
      if (b.step === 'picked_up' && ['picked_up', 'delivered'].includes(o.status)) return { again: true };
      if (b.step === 'delivered' && o.status === 'delivered') return { again: true };
      if (b.step === 'picked_up') {
        if (o.status !== 'assigned') throw fail(409, 'WRONG_STEP', `Order is ${o.status}`);
        await q(`UPDATE orders SET status='picked_up', picked_up_at=now() WHERE id=$1`, [o.id]);
        await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'picked_up',$2,'{}')`, [o.id, driverId]);
        await notify(q, { profile: o.user_profile_id, kind: 'order.picked_up', order: o.id, dedupe: `order:${o.id}:picked_up`, data: { ref: o.ref } });
        return { again: false };
      }
      if (o.status !== 'picked_up') throw fail(409, 'WRONG_STEP', 'Pick the parcel up first');
      if (o.code_attempts >= 5) return { locked: true };   // too many wrong codes: only staff can continue this order
      const code = Buffer.from(String(b.delivery_code ?? '')), real = Buffer.from(o.delivery_code);
      if (code.length !== real.length || !timingSafeEqual(code, real)) {
        await q(`UPDATE orders SET code_attempts = code_attempts + 1 WHERE id=$1`, [o.id]);
        await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'code_wrong',$2,'{}')`, [o.id, driverId]);
        return { wrong: true };                          // committed first, THEN refused, so the attempt is counted
      }
      const expected = cashToCollect(o), got = b.cash_collected_da ?? 0;
      if (!isInt(got) || got !== expected) throw bad('CASH_MISMATCH', `Cash to collect is ${expected} DA`);
      await q(`UPDATE orders SET status='delivered', delivered_at=now() WHERE id=$1`, [o.id]);
      // Only the goods money (cash on delivery) goes into the driver's cash ledger. Delivery-fee handling is a finance rule, parked.
      if (o.leg === 'delivery' && o.cod_amount_da > 0) await q(`INSERT INTO cash_ledger(driver_profile_id, order_id, type, amount_da) VALUES ($1,$2,'cod_collected',$3)`, [driverId, o.id, o.cod_amount_da]);
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'delivered',$2,$3)`, [o.id, driverId, { cash_collected_da: got }]);
      await notify(q, { profile: o.user_profile_id, kind: o.leg === 'return' ? 'return.delivered' : 'order.delivered', order: o.id, dedupe: `order:${o.id}:delivered`, data: { ref: o.ref } });
      return { again: false };
    });
    if ((out as any).locked) throw fail(423, 'CODE_LOCKED', 'Too many wrong codes. Contact support.');
    if ((out as any).wrong) throw bad('CODE_WRONG', 'Wrong delivery code');
    return { ...out, job: await this.job(driverId, b.order_id), order_status: (await this.db.one(`SELECT status FROM orders WHERE id=$1`, [b.order_id])).status };
  }

  async failDelivery(driverId: string, b: any) {
    if (!REASONS.includes(b?.reason)) throw bad('BAD_REASON', 'reason must be no_answer, refused or wrong_address');
    uuid(b?.order_id, 'order_id');
    const returnId = await this.db.tx(async q => {
      const [o] = await q(`SELECT o.*, sp.display_name sender_name, sa.phone sender_phone FROM orders o JOIN profiles sp ON sp.id=o.user_profile_id JOIN accounts sa ON sa.id=sp.account_id
                           WHERE o.id=$1 AND o.driver_profile_id=$2 FOR UPDATE OF o`, [b?.order_id ?? null, driverId]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Job not found');
      if (o.status !== 'picked_up') throw fail(409, 'WRONG_STEP', 'Only a picked-up parcel can fail delivery');
      await q(`UPDATE orders SET status='failed' WHERE id=$1`, [o.id]);
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'delivery_failed',$2,$3)`, [o.id, driverId, { reason: b.reason }]);
      await q(`INSERT INTO problem_reports(order_id, reporter_profile_id, reason) VALUES ($1,$2,$3)`, [o.id, driverId, `delivery_failed:${b.reason}`]);
      await notify(q, { profile: o.user_profile_id, kind: 'order.failed', order: o.id, dedupe: `order:${o.id}:failed`, data: { ref: o.ref, reason: b.reason } });
      if (o.leg === 'return') return null;       // a failed return goes to staff, no second return
      return createReturnLeg(q, o, { profile: driverId });
    });
    return { job: returnId ? await this.job(driverId, returnId) : null };
  }

  async jobs(driverId: string, page: any) {
    const p = Math.max(1, Number(page) || 1);
    const rows = await this.db.query(`SELECT id, ref, leg, status, locked_da, cod_amount_da, delivered_at, created_at FROM orders WHERE driver_profile_id=$1 ORDER BY created_at DESC LIMIT 20 OFFSET $2`, [driverId, (p - 1) * 20]);
    return { page: p, jobs: rows };
  }

  async cash(driverId: string) {
    const [b] = await this.db.query(`SELECT COALESCE(sum(amount_da),0)::int balance FROM cash_ledger WHERE driver_profile_id=$1`, [driverId]);
    const entries = await this.db.query(`SELECT id, type, amount_da, order_id, note, created_at FROM cash_ledger WHERE driver_profile_id=$1 ORDER BY id DESC LIMIT 50`, [driverId]);
    return { balance_da: b.balance, entries: entries.map((e: any) => ({ ...e, id: Number(e.id) })) };
  }
}
