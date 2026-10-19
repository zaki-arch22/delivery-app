import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Db } from '../db/db.service';
import { Routing } from '../geo/routing';
import { Matching } from './matching.service';
import { priceFor, Size, vehicleFor } from './pricing';
import { notify } from '../notify/notify';
import { inOpenZone } from '../geo/zones';
import { PHONE, address, bad, fail, isInt, point, uuid } from '../common/errors';

const SIZES = ['small', 'medium', 'large'];

@Injectable()
export class OrdersService {
  constructor(private db: Db, private routing: Routing, private matching: Matching) {}

  async getQuote(userId: string, b: any) {
    const pickup = point(b?.pickup, 'pickup'), dropoff = point(b?.dropoff, 'dropoff');
    if (!SIZES.includes(b?.size)) throw bad('BAD_SIZE', 'size must be small, medium or large');
    if (!(await inOpenZone(this.db, pickup)) || !(await inOpenZone(this.db, dropoff))) throw fail(422, 'ZONE_CLOSED', 'We do not serve this area yet');
    const route = await this.routing.route(pickup, dropoff);
    const price = await priceFor(this.db, b.size as Size, route.distance_m);
    const data = { pickup, dropoff, size: b.size, distance_m: route.distance_m, duration_s: route.duration_s, distance_estimated: route.estimated, ...price };
    const q = await this.db.one(`INSERT INTO quotes(user_profile_id, data, expires_at) VALUES ($1,$2, now() + interval '5 minutes') RETURNING id, expires_at`, [userId, data]);
    return { quote_id: q.id, expires_at: q.expires_at, vehicle: price.vehicle, distance_m: route.distance_m, duration_s: route.duration_s, distance_estimated: route.estimated, recommended_da: price.recommended_da, min_da: price.min_da, max_da: price.max_da };
  }

  async createOrder(userId: string, key: string | undefined, b: any) {
    if (!key || key.length < 8 || key.length > 64) throw bad('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (8-64 chars) is required');
    const again = await this.db.one(`SELECT id FROM orders WHERE user_profile_id=$1 AND idempotency_key=$2`, [userId, key]);
    if (again) return this.viewForUser(again.id, userId);

    const quote = typeof b?.quote_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.quote_id) ? await this.db.one(`SELECT data FROM quotes WHERE id=$1 AND user_profile_id=$2 AND expires_at > now()`, [b.quote_id, userId]) : null;
    if (!quote) throw fail(410, 'QUOTE_EXPIRED', 'Price expired, request a new one');
    const d = quote.data;
    if (!isInt(b?.offered_da) || b.offered_da < d.min_da || b.offered_da > d.max_da) throw bad('PRICE_OUT_OF_RANGE', `Price must be between ${d.min_da} and ${d.max_da}`);
    const pickup_address = address(b?.pickup_address, 'pickup_address'), dropoff_address = address(b?.dropoff_address, 'dropoff_address');
    const name = (b?.recipient_name ?? '').trim();
    if (name.length < 2 || name.length > 60) throw bad('BAD_RECIPIENT', 'Recipient name must be 2 to 60 characters');
    if (!PHONE.test(b?.recipient_phone ?? '')) throw bad('BAD_RECIPIENT_PHONE', 'Recipient phone must be international format');
    if (!['sender', 'recipient'].includes(b?.payer)) throw bad('BAD_PAYER', 'payer must be sender or recipient');
    const cod = b?.cod_amount_da ?? 0;
    if (!isInt(cod) || cod < 0 || cod > 2_000_000_000) throw bad('BAD_COD', 'cod_amount_da must be a whole number of dinars, 0 or more');
    if (!(await inOpenZone(this.db, d.pickup)) || !(await inOpenZone(this.db, d.dropoff))) throw fail(422, 'ZONE_CLOSED', 'We do not serve this area yet');

    const code = String(randomInt(0, 10000)).padStart(4, '0');
    let id: string;
    try {
      id = await this.db.tx(async q => {
        const [o] = await q(
          `INSERT INTO orders(user_profile_id, pickup_point, pickup_address, dropoff_point, dropoff_address, recipient_name, recipient_phone,
             size, vehicle, payer, cod_amount_da, pricing_version, distance_m, duration_s, recommended_da, min_da, max_da, offered_da, delivery_code, idempotency_key)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, $7, $8,$9,
             $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id, ref`,
          [userId, d.pickup.lng, d.pickup.lat, pickup_address, d.dropoff.lng, d.dropoff.lat, dropoff_address, name, b.recipient_phone,
           d.size, vehicleFor(d.size), b.payer, cod, d.pricing_version, d.distance_m, d.duration_s, d.recommended_da, d.min_da, d.max_da, b.offered_da, code, key]);
        await q(`INSERT INTO order_events(order_id, type, actor_profile_id, data) VALUES ($1,'created',$2,$3)`, [o.id, userId, { offered_da: b.offered_da }]);
        // No SMS. If the recipient's phone number belongs to a registered user, that user gets a PUSH with the delivery code.
        // Everyone else gets the code from the sender, who always sees it in the app.
        const [rp] = await q(`SELECT p.id FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.type='user' AND p.status='active'
                              WHERE a.phone=$1 AND a.id <> (SELECT account_id FROM profiles WHERE id=$2)`, [b.recipient_phone, userId]);
        if (rp) await notify(q, { profile: rp.id, kind: 'order.incoming', order: o.id, dedupe: `order:${o.id}:incoming`, data: { ref: o.ref, delivery_code: code } });
        return o.id;
      });
    } catch (e: any) {
      if (e.code === '23505') { const x = await this.db.one(`SELECT id FROM orders WHERE user_profile_id=$1 AND idempotency_key=$2`, [userId, key]); if (x) return this.viewForUser(x.id, userId); }
      throw e;
    }
    await this.matching.offerNext(id);
    return this.viewForUser(id, userId);
  }

  async raisePrice(userId: string, orderId: string, newPrice: any) {
    uuid(orderId, 'order_id');
    if (!isInt(newPrice)) throw bad('BAD_PRICE', 'new_offered_da must be a whole number');
    await this.db.tx(async q => {
      const [r] = await q(`UPDATE orders SET offered_da=$3 WHERE id=$1 AND user_profile_id=$2 AND status='searching' AND $3 > offered_da AND $3 <= max_da RETURNING id`, [orderId, userId, newPrice]);
      if (!r) {
        const [o] = await q(`SELECT status, offered_da, max_da FROM orders WHERE id=$1 AND user_profile_id=$2`, [orderId, userId]);
        if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
        if (o.status !== 'searching') throw fail(409, 'PRICE_LOCKED', 'The price can be raised only while searching');
        throw bad('PRICE_NOT_ALLOWED', `Price must be higher than ${o.offered_da} and at most ${o.max_da}`);
      }
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'price_raised',$2,$3)`, [orderId, userId, { offered_da: newPrice }]);
      const open = await q(`SELECT id, driver_profile_id FROM offers WHERE order_id=$1 AND status='offered' AND expires_at > now()`, [orderId]);
      for (const f of open) await notify(q, { profile: f.driver_profile_id, kind: 'offer.updated', order: orderId, push: false, dedupe: `offer:${f.id}:price:${newPrice}`, data: { offer_id: Number(f.id), price_da: newPrice } });
    });
    return this.viewForUser(orderId, userId);
  }

  async cancel(userId: string, orderId: string, reason: any) {
    uuid(orderId, 'order_id');
    const txt = typeof reason === 'string' ? reason.slice(0, 200) : null;
    const r = await this.db.tx(async q => {
      const [o] = await q(`SELECT status, driver_profile_id, ref FROM orders WHERE id=$1 AND user_profile_id=$2 FOR UPDATE`, [orderId, userId]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
      if (!['searching', 'assigned'].includes(o.status)) throw fail(409, 'CANNOT_CANCEL', 'After pickup an order cannot be cancelled; report a problem instead');
      await q(`UPDATE orders SET status='cancelled', cancel_reason=$2 WHERE id=$1`, [orderId, txt]);
      const w = await q(`UPDATE offers SET status='expired' WHERE order_id=$1 AND status='offered' RETURNING id, driver_profile_id`, [orderId]);
      for (const x of w) await notify(q, { profile: x.driver_profile_id, kind: 'offer.withdrawn', order: orderId, push: false, dedupe: `offer:${x.id}:end`, data: { offer_id: Number(x.id), reason: 'cancelled' } });
      if (o.status === 'assigned') await notify(q, { profile: o.driver_profile_id, kind: 'job.cancelled', order: orderId, priority: 'high', dedupe: `order:${orderId}:cancelled`, data: { ref: o.ref } });
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'cancelled',$2,$3)`, [orderId, userId, { from: o.status, reason: txt }]);
      return true;
    });
    return r && this.viewForUser(orderId, userId);
  }

  async list(userId: string, page: any) {
    const p = Math.max(1, Number(page) || 1);
    const rows = await this.db.query(`SELECT id FROM orders WHERE user_profile_id=$1 ORDER BY created_at DESC LIMIT 20 OFFSET $2`, [userId, (p - 1) * 20]);
    return { page: p, orders: await Promise.all(rows.map(r => this.viewForUser(r.id, userId))) };
  }

  async reportProblem(userId: string, orderId: string, reason: any, note: any) {
    uuid(orderId, 'order_id');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 100) throw bad('BAD_REASON', 'reason is required (up to 100 characters)');
    const o = await this.db.one(`SELECT 1 FROM orders WHERE id=$1 AND user_profile_id=$2`, [orderId, userId]);
    if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
    return this.db.one(`INSERT INTO problem_reports(order_id, reporter_profile_id, reason, note) VALUES ($1,$2,$3,$4) RETURNING id, status, created_at`, [orderId, userId, reason.trim(), typeof note === 'string' ? note.slice(0, 1000) : null]);
  }

  async viewForUser(orderId: string, userId: string) {
    const o = await this.db.one(
      `SELECT o.id, o.ref, o.leg, o.parent_order_id, o.status, o.size, o.vehicle, o.payer, o.cod_amount_da, o.recommended_da, o.min_da, o.max_da, o.offered_da, o.locked_da,
         o.distance_m, o.duration_s, o.delivery_code, o.cancel_reason, o.pickup_address, o.dropoff_address, o.recipient_name, o.recipient_phone,
         ST_Y(o.pickup_point::geometry) pickup_lat, ST_X(o.pickup_point::geometry) pickup_lng, ST_Y(o.dropoff_point::geometry) dropoff_lat, ST_X(o.dropoff_point::geometry) dropoff_lng,
         o.created_at, o.assigned_at, o.picked_up_at, o.delivered_at,
         dp.id driver_id, dp.display_name driver_name, dp.photo_url driver_photo,
         CASE WHEN dp.rating_count = 0 THEN NULL ELSE round(dp.rating_sum::numeric / dp.rating_count, 2) END driver_rating, dd.vehicle driver_vehicle,
         CASE WHEN o.status IN ('assigned','picked_up') THEN ST_Y(dd.last_location::geometry) END driver_lat,
         CASE WHEN o.status IN ('assigned','picked_up') THEN ST_X(dd.last_location::geometry) END driver_lng,
         dd.last_location_at driver_location_at,
         EXISTS (SELECT 1 FROM ratings r WHERE r.order_id = o.id AND r.rater_profile_id = o.user_profile_id) AS rated
       FROM orders o LEFT JOIN profiles dp ON dp.id = o.driver_profile_id LEFT JOIN driver_details dd ON dd.profile_id = dp.id
       WHERE o.id=$1 AND o.user_profile_id=$2`, [orderId, userId]);
    if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
    const { driver_id, driver_name, driver_photo, driver_rating, driver_vehicle, driver_lat, driver_lng, driver_location_at, ...rest } = o;
    return { ...rest, driver: driver_id ? { name: driver_name, photo_url: driver_photo, rating: driver_rating, vehicle: driver_vehicle, location: driver_lat == null ? null : { lat: driver_lat, lng: driver_lng, at: driver_location_at } } : null };
  }
}
