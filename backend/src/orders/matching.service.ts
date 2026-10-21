import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db.service';
import { cfg } from '../common/config';
import { notify, Q } from '../notify/notify';
import { NOT_BLOCKED_SQL } from '../trust/rules';
import { fail } from '../common/errors';

// Who may see a request (all must be true): online with a fresh position, a vehicle that fits (a car takes any parcel, a
// motorbike only small and medium ones), near the pickup, not the
// sender's own account, no job in hand, not blocked, and (for cash-on-delivery) inside his cash limit.
export const ELIGIBLE_SQL = (p: string, o: string) => `
  d.is_online AND (d.vehicle = ${o}.vehicle OR d.vehicle = 'car') AND ${p}.type='driver' AND ${p}.status='active'
  AND d.last_location_at > now() - make_interval(secs => ${cfg.locationFreshS()})
  AND ${p}.account_id <> (SELECT account_id FROM profiles WHERE id = ${o}.user_profile_id)
  AND NOT EXISTS (SELECT 1 FROM orders j WHERE j.driver_profile_id = ${p}.id AND j.status IN ('assigned','picked_up'))
  AND ${NOT_BLOCKED_SQL(`${p}.id`)}
  AND (${o}.cod_amount_da = 0 OR (d.cash_limit_da IS NOT NULL AND
       COALESCE((SELECT sum(amount_da) FROM cash_ledger c WHERE c.driver_profile_id = ${p}.id), 0) + ${o}.cod_amount_da <= d.cash_limit_da))`;

// Gives the order to one courier at the given price, in the caller's transaction. Used when the customer chooses a
// courier's offer, and when "auto-accept" is on and a courier accepts the customer's price. The price locks here.
export async function assign(q: Q, orderId: string, offerId: string, driverId: string, price: number) {
  let o;
  try {
    [o] = await q(`UPDATE orders SET status='assigned', driver_profile_id=$2, locked_da=$3, assigned_at=now()
                   WHERE id=$1 AND status='searching' AND driver_profile_id IS NULL RETURNING id, user_profile_id, ref`, [orderId, driverId, price]);
  } catch (e: any) { if (e.code === '23505') throw fail(409, 'DRIVER_BUSY', 'This courier just took another job'); throw e; }
  if (!o) throw fail(409, 'ORDER_TAKEN', 'Order already taken or cancelled');
  await q(`UPDATE offers SET status='accepted' WHERE id=$1`, [offerId]);
  // Everyone else who saw this request is told it is gone; the chosen courier's other requests leave his list.
  const others = await q(`UPDATE offers SET status='expired' WHERE order_id=$1 AND id<>$2 AND status IN ('offered','bid') RETURNING id, driver_profile_id`, [orderId, offerId]);
  for (const x of others) await notify(q, { profile: x.driver_profile_id, kind: 'offer.withdrawn', order: orderId, push: false, dedupe: `offer:${x.id}:end`, data: { offer_id: Number(x.id), reason: 'taken' } });
  const mine = await q(`UPDATE offers SET status='expired' WHERE driver_profile_id=$1 AND order_id<>$2 AND status IN ('offered','bid') RETURNING id, order_id`, [driverId, orderId]);
  for (const x of mine) await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'offer_withdrawn',$2,'{"reason":"driver_took_other_job"}')`, [x.order_id, driverId]);
  await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'assigned',$2,$3)`, [orderId, driverId, { price_da: price }]);
  await notify(q, { profile: o.user_profile_id, kind: 'order.assigned', order: orderId, dedupe: `order:${orderId}:assigned`, data: { ref: o.ref } });
  await notify(q, { profile: driverId, kind: 'bid.accepted', order: orderId, priority: 'high', dedupe: `offer:${offerId}:accepted`, data: { offer_id: Number(offerId), ref: o.ref, price_da: price } });
  return o;
}

// Every few seconds: ends what ran out of time, and shows searching orders to nearby couriers (nearest first, radius
// widening after a while). Several couriers see a request at once and answer with a price; the customer chooses.
@Injectable()
export class Matching implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Matching');
  private timer?: NodeJS.Timeout;
  constructor(private db: Db) {}

  onModuleInit() {
    if (process.env.MATCHING_TICK === 'off') return;
    this.timer = setInterval(() => this.tick().catch(e => this.log.error(e.message)), cfg.tickMs());
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // One tick; the advisory lock makes it safe if several server copies run at once.
  async tick() {
    const lock = await this.db.one(`SELECT pg_try_advisory_lock(727001) AS ok`);
    if (!lock.ok) return;
    try {
      await this.endBids();
      const rows = await this.db.query(`SELECT id FROM orders WHERE status='searching' ORDER BY created_at LIMIT 200`);
      for (const r of rows) await this.offerNext(r.id);
    } finally { await this.db.query(`SELECT pg_advisory_unlock(727001)`); }
  }

  // A courier's price the customer did not answer in time: the courier may answer again, the customer's card disappears.
  private async endBids() {
    await this.db.tx(async q => {
      const ended = await q(`UPDATE offers f SET status='offered', bid_da=NULL, bid_at=NULL, bid_expires_at=NULL
                             FROM (SELECT id, extract(epoch FROM bid_at)::bigint AS made FROM offers WHERE status='bid' AND bid_expires_at <= now() FOR UPDATE) x
                             WHERE f.id = x.id RETURNING f.id, f.order_id, f.driver_profile_id, x.made`);
      for (const e of ended) {
        const [o] = await q(`SELECT user_profile_id FROM orders WHERE id=$1`, [e.order_id]);
        await notify(q, { profile: e.driver_profile_id, kind: 'bid.expired', order: e.order_id, push: false, dedupe: `offer:${e.id}:bidend:${e.made}`, data: { offer_id: Number(e.id) } });
        await notify(q, { profile: o.user_profile_id, kind: 'order.bid_withdrawn', order: e.order_id, push: false, dedupe: `offer:${e.id}:bidgone:${e.made}`, data: { offer_id: Number(e.id) } });
      }
    });
  }

  async offerNext(orderId: string) {
    await this.db.tx(async q => {
      const [o] = await q(`SELECT id, status, user_profile_id, ref, offered_da, search_started_at, extract(epoch FROM now() - search_started_at) AS age FROM orders WHERE id=$1 FOR UPDATE`, [orderId]);
      if (!o || o.status !== 'searching') return;
      if (o.age > cfg.searchWindowS()) {
        await q(`UPDATE orders SET status='expired' WHERE id=$1`, [orderId]);
        const w = await q(`UPDATE offers SET status='expired' WHERE order_id=$1 AND status IN ('offered','bid') RETURNING id, driver_profile_id`, [orderId]);
        for (const x of w) await notify(q, { profile: x.driver_profile_id, kind: 'offer.withdrawn', order: orderId, data: { offer_id: Number(x.id), reason: 'order_expired' }, push: false, dedupe: `offer:${x.id}:end` });
        await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'expired','{"reason":"no_driver_found"}')`, [orderId]);
        await notify(q, { profile: o.user_profile_id, kind: 'order.expired', order: orderId, data: { ref: o.ref }, dedupe: `order:${orderId}:expired` });
        return;
      }
      const [{ live }] = await q(`SELECT count(*)::int live FROM offers WHERE order_id=$1 AND status IN ('offered','bid')`, [orderId]);
      const room = cfg.broadcastMax() - live;
      if (room <= 0) return;
      const radius = o.age >= cfg.widenAfterS() ? cfg.radius2() : cfg.radius1();
      // A courier who already saw it (and did not just lose it to an expiry or a reassignment) is not asked again.
      const found = await q(
        `SELECT p.id FROM driver_details d JOIN profiles p ON p.id = d.profile_id JOIN orders o ON o.id = $1
          WHERE ${ELIGIBLE_SQL('p', 'o')}
            AND ST_DWithin(d.last_location, o.pickup_point, $2)
            AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.order_id = o.id AND f.driver_profile_id = p.id AND f.status <> 'expired')
          ORDER BY ST_Distance(d.last_location, o.pickup_point) ASC
          LIMIT $3`, [orderId, radius, room]);
      const ends = new Date(new Date(o.search_started_at).getTime() + cfg.searchWindowS() * 1000);
      for (const c of found) {
        const [{ n }] = await q(`SELECT count(*)::int + 1 AS n FROM offers WHERE order_id=$1`, [orderId]);
        const [off] = await q(
          `INSERT INTO offers(order_id, driver_profile_id, rank, expires_at) VALUES ($1,$2,$3,$4)
           ON CONFLICT (order_id, driver_profile_id) DO UPDATE SET status='offered', rank=EXCLUDED.rank, offered_at=now(), expires_at=EXCLUDED.expires_at,
             bid_da=NULL, bid_at=NULL, bid_expires_at=NULL, eta_s=NULL
           WHERE offers.status='expired' RETURNING id`, [orderId, c.id, n, ends]);
        if (!off) continue;
        await notify(q, { profile: c.id, kind: 'offer.new', order: orderId, priority: 'high', expiresInS: Math.max(1, Math.round((ends.getTime() - Date.now()) / 1000)),
          dedupe: `offer:${off.id}:new:${n}`, data: { offer_id: Number(off.id), ref: o.ref, price_da: o.offered_da } });
        await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'offer_sent', jsonb_build_object('driver_profile_id', $2::text, 'rank', $3::int))`, [orderId, c.id, n]);
      }
    });
  }
}
