import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db.service';
import { cfg } from '../common/config';
import { notify } from '../notify/notify';

// Offers an order to ONE driver at a time (nearest eligible first). If the driver declines or does not answer,
// the next one is offered. The radius widens after a while. The order expires if nobody takes it in time.
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
      await this.db.tx(async q => {     // offers that ran out of time: the driver's screen is told in the same transaction
        const ended = await q(`UPDATE offers SET status='expired' WHERE status='offered' AND expires_at <= now() RETURNING id, order_id, driver_profile_id`);
        for (const e of ended) await notify(q, { profile: e.driver_profile_id, kind: 'offer.withdrawn', order: e.order_id, data: { offer_id: Number(e.id), reason: 'expired' }, push: false, dedupe: `offer:${e.id}:end` });
      });
      const rows = await this.db.query(`SELECT id FROM orders WHERE status='searching' ORDER BY created_at LIMIT 200`);
      for (const r of rows) await this.offerNext(r.id);
    } finally { await this.db.query(`SELECT pg_advisory_unlock(727001)`); }
  }

  async offerNext(orderId: string) {
    await this.db.tx(async q => {
      const [o] = await q(`SELECT id, status, user_profile_id, ref, created_at, extract(epoch FROM now() - search_started_at) AS age FROM orders WHERE id=$1 FOR UPDATE`, [orderId]);
      if (!o || o.status !== 'searching') return;
      if (o.age > cfg.searchWindowS()) {
        await q(`UPDATE orders SET status='expired' WHERE id=$1`, [orderId]);
        const w = await q(`UPDATE offers SET status='expired' WHERE order_id=$1 AND status='offered' RETURNING id, driver_profile_id`, [orderId]);
        for (const x of w) await notify(q, { profile: x.driver_profile_id, kind: 'offer.withdrawn', order: orderId, data: { offer_id: Number(x.id), reason: 'order_expired' }, push: false, dedupe: `offer:${x.id}:end` });
        await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'expired','{"reason":"no_driver_found"}')`, [orderId]);
        await notify(q, { profile: o.user_profile_id, kind: 'order.expired', order: orderId, data: { ref: o.ref }, dedupe: `order:${orderId}:expired` });
        return;
      }
      const [live] = await q(`SELECT 1 FROM offers WHERE order_id=$1 AND status='offered' AND expires_at > now()`, [orderId]);
      if (live) return;
      const radius = o.age >= cfg.widenAfterS() ? cfg.radius2() : cfg.radius1();
      const [c] = await q(
        `SELECT p.id FROM driver_details d
           JOIN profiles p ON p.id = d.profile_id AND p.type='driver' AND p.status='active'
           JOIN orders o ON o.id = $1
          WHERE d.is_online AND d.vehicle = o.vehicle
            AND d.last_location_at > now() - make_interval(secs => $3)
            AND ST_DWithin(d.last_location, o.pickup_point, $2)
            AND p.account_id <> (SELECT account_id FROM profiles WHERE id = o.user_profile_id)
            AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.order_id = o.id AND f.driver_profile_id = p.id)
            AND NOT EXISTS (SELECT 1 FROM orders j WHERE j.driver_profile_id = p.id AND j.status IN ('assigned','picked_up'))
            AND NOT EXISTS (SELECT 1 FROM offers g WHERE g.driver_profile_id = p.id AND g.status='offered' AND g.expires_at > now())
            AND (o.cod_amount_da = 0 OR (d.cash_limit_da IS NOT NULL AND
                 COALESCE((SELECT sum(amount_da) FROM cash_ledger c WHERE c.driver_profile_id = p.id), 0) + o.cod_amount_da <= d.cash_limit_da))
          ORDER BY ST_Distance(d.last_location, o.pickup_point) ASC
          LIMIT 1`, [orderId, radius, cfg.locationFreshS()]);
      if (!c) return;
      const [{ n }] = await q(`SELECT count(*)::int + 1 AS n FROM offers WHERE order_id=$1`, [orderId]);
      const [off] = await q(`INSERT INTO offers(order_id, driver_profile_id, rank, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4)) RETURNING id`, [orderId, c.id, n, cfg.offerTtlS()]);
      const [ord] = await q(`SELECT ref, offered_da FROM orders WHERE id=$1`, [orderId]);
      await notify(q, { profile: c.id, kind: 'offer.new', order: orderId, priority: 'high', expiresInS: cfg.offerTtlS(), dedupe: `offer:${off.id}:new`, data: { offer_id: Number(off.id), ref: ord.ref, price_da: ord.offered_da } });
      await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'offer_sent', jsonb_build_object('driver_profile_id', $2::text, 'rank', $3::int))`, [orderId, c.id, n]);
    });
  }
}
