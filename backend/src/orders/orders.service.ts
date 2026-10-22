import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Db } from '../db/db.service';
import { Routing } from '../geo/routing';
import { Matching } from './matching.service';
import { priceFor, Size, vehicleFor } from './pricing';
import { notify } from '../notify/notify';
import { inOpenZone } from '../geo/zones';
import { PHONE, address, bad, fail, isId, isInt, point, uuid } from '../common/errors';
import { assign } from './matching.service';
import { NOT_BLOCKED_SQL } from '../trust/rules';
import { Eta } from '../geo/eta';
import { trackingHash, trackingToken } from './tracking';
import { createReturnLeg } from './return-leg';
import { cfg } from '../common/config';
import { limiter, limitsOff } from '../security/limiter';
import { Documents } from '../documents/documents.service';
import { assertCanWork, recordViolation } from '../trust/rules';

const code4 = () => String(randomInt(0, 10000)).padStart(4, '0');
export const RECALL_REASONS = ['buyer_cancelled', 'wrong_parcel', 'wrong_address', 'other'];
export const PROBLEM_REASONS = ['driver_late', 'damaged', 'not_delivered', 'wrong_item', 'missing_item', 'driver_behaviour', 'price', 'other'];
// What the sender sees in the order's history (everything that happened, without internal ids).
const USER_EVENTS = ['created', 'bid_made', 'bid_declined', 'price_raised', 'assigned', 'released_by_driver', 'reassigned', 'pickup_code_wrong', 'picked_up', 'flag_far_away', 'code_wrong',
  'delivered', 'delivery_failed', 'recalled_by_sender', 'returned_by_support', 'cancelled', 'cancelled_by_support', 'expired', 'recipient_expecting', 'recipient_reported', 'address_corrected', 'return_created', 'flag_check', 'emergency'];

const SIZES = ['small', 'medium', 'large'];

@Injectable()
export class OrdersService {
  constructor(private db: Db, private routing: Routing, private matching: Matching, private documents: Documents, private eta: Eta) {}

  async getQuote(userId: string, b: any) {
    await assertCanWork((s, p) => this.db.query(s, p), userId);   // a blocked profile cannot start new orders
    const pickup = point(b?.pickup, 'pickup'), dropoff = point(b?.dropoff, 'dropoff');
    if (!SIZES.includes(b?.size)) throw bad('BAD_SIZE', 'size must be small, medium or large');
    if (!(await inOpenZone(this.db, pickup)) || !(await inOpenZone(this.db, dropoff))) throw fail(422, 'ZONE_CLOSED', 'We do not serve this area yet');
    const route = await this.routing.route(pickup, dropoff, true);
    const price = await priceFor(this.db, b.size as Size, route.distance_m);
    if (route.distance_m > price.max_km * 1000) throw fail(422, 'TOO_FAR', `Deliveries go up to ${price.max_km} km`);
    const data = { pickup, dropoff, size: b.size, distance_m: route.distance_m, duration_s: route.duration_s, distance_estimated: route.estimated, line: route.line ?? null, ...price };
    const q = await this.db.one(`INSERT INTO quotes(user_profile_id, data, expires_at) VALUES ($1,$2, now() + interval '5 minutes') RETURNING id, expires_at`, [userId, data]);
    return { quote_id: q.id, expires_at: q.expires_at, vehicle: price.vehicle, distance_m: route.distance_m, duration_s: route.duration_s, distance_estimated: route.estimated, recommended_da: price.recommended_da, min_da: price.min_da, max_da: price.max_da, route: route.line ?? null };
  }

  async createOrder(userId: string, key: string | undefined, b: any) {
    if (!key || key.length < 8 || key.length > 64) throw bad('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (8-64 chars) is required');
    const again = await this.db.one(`SELECT id FROM orders WHERE user_profile_id=$1 AND idempotency_key=$2`, [userId, key]);
    if (again) return this.viewForUser(again.id, userId);
    await assertCanWork((s, p) => this.db.query(s, p), userId);

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
    if (cod > cfg.maxCodDa()) throw bad('COD_TOO_HIGH', `Cash on delivery is limited to ${cfg.maxCodDa()} DA per order`);
    // Goods money goes straight to the seller's Algérie Poste account: it must be known before the order (copied onto it).
    const payout = cod > 0 ? await this.db.one(`SELECT pa.rip, pa.holder_name FROM payout_accounts pa JOIN profiles p ON p.account_id=pa.account_id WHERE p.id=$1`, [userId]) : null;
    if (cod > 0 && !payout) throw fail(428, 'PAYOUT_ACCOUNT_REQUIRED', 'Add your BaridiMob (RIP) account in Settings to receive cash-on-delivery money');
    const inspection = b?.inspection ?? 'outside';
    if (!['outside', 'open'].includes(inspection)) throw bad('BAD_INSPECTION', 'inspection must be outside or open');
    const autoAccept = b?.auto_accept ?? false;
    if (typeof autoAccept !== 'boolean') throw bad('BAD_INPUT', 'auto_accept must be true or false');
    if (!(await inOpenZone(this.db, d.pickup)) || !(await inOpenZone(this.db, d.dropoff))) throw fail(422, 'ZONE_CLOSED', 'We do not serve this area yet');

    const code = code4();
    let pickupCode = code4(); while (pickupCode === code) pickupCode = code4();   // two different codes: one cannot stand in for the other
    let id: string;
    try {
      id = await this.db.tx(async q => {
        const [o] = await q(
          `INSERT INTO orders(user_profile_id, pickup_point, pickup_address, dropoff_point, dropoff_address, recipient_name, recipient_phone,
             size, vehicle, payer, cod_amount_da, pricing_version, distance_m, duration_s, recommended_da, min_da, max_da, offered_da, delivery_code, idempotency_key,
             pickup_code, inspection, status, auto_accept, route_line, cod_rip, cod_holder)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, $7, $8,$9,
             $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'searching',$25,$26,$27,$28) RETURNING id, ref`,
          [userId, d.pickup.lng, d.pickup.lat, pickup_address, d.dropoff.lng, d.dropoff.lat, dropoff_address, name, b.recipient_phone,
           d.size, vehicleFor(d.size), b.payer, cod, d.pricing_version, d.distance_m, d.duration_s, d.recommended_da, d.min_da, d.max_da, b.offered_da, code, key,
           pickupCode, inspection, autoAccept, d.line ? JSON.stringify(d.line) : null, payout?.rip ?? null, payout?.holder_name ?? null]);
        await q(`UPDATE orders SET tracking_hash=$2 WHERE id=$1`, [o.id, trackingHash(trackingToken(o.id))]);
        await q(`INSERT INTO order_events(order_id, type, actor_profile_id, data) VALUES ($1,'created',$2,$3)`, [o.id, userId, { offered_da: b.offered_da, inspection, auto_accept: autoAccept }]);
        // No SMS from us. If the receiver's number is the VERIFIED number of a registered user, that user gets a PUSH with the
        // delivery code. Typed, unverified numbers never do (anyone could type someone else's number). Everyone else gets the
        // code (and the tracking link) from the sender.
        const [rp] = await q(`SELECT p.id FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.type='user' AND p.status='active'
                              WHERE a.phone=$1 AND a.phone_verified AND a.id <> (SELECT account_id FROM profiles WHERE id=$2)`, [b.recipient_phone, userId]);
        if (rp) await notify(q, { profile: rp.id, kind: 'order.incoming', order: o.id, dedupe: `order:${o.id}:incoming`, data: { ref: o.ref, delivery_code: code, sender: (await q(`SELECT split_part(display_name, ' ', 1) n FROM profiles WHERE id=$1`, [userId]))[0].n } });
        return o.id;
      });
    } catch (e: any) {
      if (e.code === '23505') { const x = await this.db.one(`SELECT id FROM orders WHERE user_profile_id=$1 AND idempotency_key=$2`, [userId, key]); if (x) return this.viewForUser(x.id, userId); }
      throw e;
    }
    await this.matching.offerNext(id);   // nearby couriers see it at once, not at the next tick
    return this.viewForUser(id, userId);
  }

  // "Take the first courier who accepts my price" (inDrive's auto-accept), on or off while the order searches.
  async setAutoAccept(userId: string, orderId: any, on: any) {
    uuid(orderId, 'order_id');
    if (typeof on !== 'boolean') throw bad('BAD_INPUT', 'on must be true or false');
    const r = await this.db.one(`UPDATE orders SET auto_accept=$3 WHERE id=$1 AND user_profile_id=$2 AND status='searching' RETURNING id`, [orderId, userId, on]);
    if (!r) { await this.viewForUser(orderId, userId); throw fail(409, 'WRONG_STATE', 'Only while searching'); }
    return this.viewForUser(orderId, userId);
  }

  // The customer chooses one courier's offer: the job is his at that price, which locks (it never changes after).
  async acceptBid(userId: string, orderId: any, offerId: any) {
    uuid(orderId, 'order_id');
    if (!isId(offerId)) throw bad('BAD_ID', 'offer_id must be a number');
    await this.db.tx(async q => {
      const [o] = await q(`SELECT id, status FROM orders WHERE id=$1 AND user_profile_id=$2 FOR UPDATE`, [orderId, userId]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
      if (o.status !== 'searching') throw fail(409, 'ORDER_TAKEN', 'This order is no longer searching');
      const [f] = await q(`SELECT f.id, f.driver_profile_id, f.bid_da FROM offers f JOIN driver_details d ON d.profile_id=f.driver_profile_id JOIN profiles p ON p.id=f.driver_profile_id JOIN orders o ON o.id=f.order_id
                           WHERE f.id=$1 AND f.order_id=$2 AND f.status='bid' AND f.bid_expires_at > now() AND ${NOT_BLOCKED_SQL('p.id')} FOR UPDATE OF f`, [offerId, orderId]);
      if (!f) throw fail(409, 'OFFER_GONE', 'This courier\'s offer is no longer available');
      await assign(q, orderId, f.id, f.driver_profile_id, f.bid_da);
    });
    return this.viewForUser(orderId, userId);
  }

  // The customer says no to one courier's price: that courier is told, and is not shown this request again.
  async declineBid(userId: string, orderId: any, offerId: any) {
    uuid(orderId, 'order_id');
    if (!isId(offerId)) throw bad('BAD_ID', 'offer_id must be a number');
    await this.db.tx(async q => {
      const [f] = await q(`UPDATE offers f SET status='rejected' FROM orders o WHERE o.id=f.order_id AND f.id=$1 AND f.order_id=$2 AND o.user_profile_id=$3 AND f.status='bid'
                           RETURNING f.id, f.driver_profile_id, o.ref`, [offerId, orderId, userId]);
      if (!f) throw fail(409, 'OFFER_GONE', 'This courier\'s offer is no longer available');
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'bid_declined',$2,$3)`, [orderId, userId, { driver_profile_id: f.driver_profile_id }]);
      await notify(q, { profile: f.driver_profile_id, kind: 'bid.declined', order: orderId, push: false, dedupe: `offer:${f.id}:declined`, data: { offer_id: Number(f.id), ref: f.ref } });
    });
    return this.viewForUser(orderId, userId);
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
      const open = await q(`SELECT id, driver_profile_id FROM offers WHERE order_id=$1 AND status IN ('offered','bid') AND expires_at > now()`, [orderId]);
      for (const f of open) await notify(q, { profile: f.driver_profile_id, kind: 'offer.updated', order: orderId, push: false, dedupe: `offer:${f.id}:price:${newPrice}`, data: { offer_id: Number(f.id), price_da: newPrice } });
    });
    return this.viewForUser(orderId, userId);
  }

  async cancel(userId: string, orderId: string, reason: any) {
    uuid(orderId, 'order_id');
    const txt = typeof reason === 'string' ? reason.slice(0, 200) : null;
    const r = await this.db.tx(async q => {
      const [o] = await q(`SELECT status, driver_profile_id, ref, extract(epoch FROM now() - assigned_at)::int AS since_assigned FROM orders WHERE id=$1 AND user_profile_id=$2 FOR UPDATE`, [orderId, userId]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
      if (!['searching', 'assigned'].includes(o.status)) throw fail(409, 'CANNOT_CANCEL', 'After pickup an order cannot be cancelled; report a problem instead');
      await q(`UPDATE orders SET status='cancelled', cancel_reason=$2 WHERE id=$1`, [orderId, txt]);
      const w = await q(`UPDATE offers SET status='expired' WHERE order_id=$1 AND status IN ('offered','bid') RETURNING id, driver_profile_id`, [orderId]);
      for (const x of w) await notify(q, { profile: x.driver_profile_id, kind: 'offer.withdrawn', order: orderId, push: false, dedupe: `offer:${x.id}:end`, data: { offer_id: Number(x.id), reason: 'cancelled' } });
      if (o.status === 'assigned') await notify(q, { profile: o.driver_profile_id, kind: 'job.cancelled', order: orderId, priority: 'high', dedupe: `order:${orderId}:cancelled`, data: { ref: o.ref } });
      // "Late" = a driver had accepted more than LATE_CANCEL_S ago (he may already be on his way). The rules count it.
      const late = o.status === 'assigned' && o.since_assigned > cfg.lateCancelS();
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'cancelled',$2,$3)`, [orderId, userId, { from: o.status, reason: txt, late }]);
      if (late) await recordViolation(q, { profile: userId, rule: 'late_cancel', order: orderId, note: 'Cancelled after a driver had accepted and was on his way', source: 'system' });
      return true;
    });
    return r && this.viewForUser(orderId, userId);
  }

  // After pickup the sender may call his parcel back (e.g. the buyer cancelled): it returns to him, the driver is told at once.
  async recall(userId: string, orderId: any, reason: any) {
    uuid(orderId, 'order_id');
    if (!RECALL_REASONS.includes(reason)) throw bad('BAD_REASON', `reason must be one of ${RECALL_REASONS.join(', ')}`);
    await this.db.tx(async q => {
      const [o] = await q(`SELECT o.*, sp.display_name sender_name, sa.phone sender_phone FROM orders o JOIN profiles sp ON sp.id=o.user_profile_id JOIN accounts sa ON sa.id=sp.account_id
                           WHERE o.id=$1 AND o.user_profile_id=$2 FOR UPDATE OF o`, [orderId, userId]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
      if (o.status !== 'picked_up' || o.leg !== 'delivery') throw fail(409, 'CANNOT_RECALL', o.status === 'searching' || o.status === 'assigned' ? 'Before pickup, cancel the order instead' : `Order is ${o.status}`);
      await q(`UPDATE orders SET status='failed' WHERE id=$1`, [o.id]);
      await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'recalled_by_sender',$2,$3)`, [o.id, userId, { reason }]);
      const rid = await createReturnLeg(q, o, { profile: userId });
      await notify(q, { profile: o.driver_profile_id, kind: 'job.recalled', order: rid, priority: 'high', dedupe: `order:${o.id}:recalled`, data: { ref: o.ref } });
    });
    return this.viewForUser(orderId, userId);
  }

  // How past parcels to this receiver number ended (counts only, all senders, 180 days). Helps sellers avoid serial refusers.
  async recipientHistory(userId: string, phone: any) {
    if (!PHONE.test(phone ?? '')) throw bad('BAD_PHONE', 'phone must be in international format');
    if (!limitsOff() && !limiter.hit('rh:' + userId, 30, 3600_000).ok) throw fail(429, 'RATE_LIMITED', 'Too many checks. Try again later.');
    const [r] = await this.db.query(
      `SELECT count(*) FILTER (WHERE o.status='delivered')::int delivered,
              count(*) FILTER (WHERE o.status='failed' AND EXISTS (SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.type='delivery_failed' AND e.data->>'reason' LIKE 'refused%'))::int refused,
              count(*) FILTER (WHERE o.status='failed' AND EXISTS (SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.type='delivery_failed' AND e.data->>'reason' = 'no_answer'))::int no_answer
       FROM orders o WHERE o.recipient_phone=$1 AND o.leg='delivery' AND o.created_at > now() - interval '180 days'`, [phone]);
    return r;
  }

  // A photo of the sender's own order (the parcel at pickup, or evidence of a refusal).
  async photo(userId: string, orderId: any, docId: any) {
    uuid(orderId, 'order_id'); uuid(docId, 'id');
    const o = await this.db.one(`SELECT 1 FROM orders WHERE id=$1 AND user_profile_id=$2`, [orderId, userId]);
    const p = o ? await this.documents.orderPhoto(orderId, docId) : null;
    if (!p) throw fail(404, 'NOT_FOUND', 'Photo not found');
    return p;
  }

  async list(userId: string, page: any) {
    const p = Math.max(1, Number(page) || 1);
    const rows = await this.db.query(`SELECT id FROM orders WHERE user_profile_id=$1 ORDER BY created_at DESC LIMIT 20 OFFSET $2`, [userId, (p - 1) * 20]);
    return { page: p, orders: await Promise.all(rows.map(r => this.viewForUser(r.id, userId))) };
  }

  // A problem with up to 3 evidence photos, until 24 h after the order ended (TRUST_AND_SAFETY.md, step 7).
  async reportProblem(userId: string, orderId: string, reason: any, note: any, photos: any = []) {
    uuid(orderId, 'order_id');
    if (!PROBLEM_REASONS.includes(reason)) throw bad('BAD_REASON', `reason must be one of ${PROBLEM_REASONS.join(', ')}`);
    if (!Array.isArray(photos) || photos.length > 3) throw bad('BAD_PHOTOS', 'photos must be a list of up to 3 photo ids');
    return this.db.tx(async q => {
      const [o] = await q(`SELECT o.id, p.account_id, o.ended_at < now() - make_interval(hours => $3) AS too_late FROM orders o JOIN profiles p ON p.id=o.user_profile_id WHERE o.id=$1 AND o.user_profile_id=$2`, [orderId, userId, cfg.reportHours()]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
      if (o.too_late) throw fail(409, 'REPORT_TOO_LATE', `Problems can be reported until ${cfg.reportHours()} hours after the order ends`);
      const [c] = await q(`SELECT count(*)::int n FROM problem_reports WHERE order_id=$1 AND reporter_profile_id=$2`, [orderId, userId]);
      if (c.n >= 5) throw fail(429, 'TOO_MANY_REPORTS', 'This order already has several reports; our team will contact you');
      const ids: string[] = [];
      for (const p of photos) ids.push(await this.documents.attachToOrder(q, o.account_id, orderId, p, 'evidence_photo'));
      const [r] = await q(`INSERT INTO problem_reports(order_id, reporter_profile_id, reason, note, photos) VALUES ($1,$2,$3,$4,$5) RETURNING id, status, created_at`, [orderId, userId, reason, typeof note === 'string' ? note.slice(0, 1000) : null, ids]);
      return { ...r, id: Number(r.id), photos: ids.length };
    });
  }

  async viewForUser(orderId: string, userId: string) {
    const o = await this.db.one(
      `SELECT o.id, o.ref, o.leg, o.parent_order_id, o.status, o.size, o.vehicle, o.payer, o.cod_amount_da, o.recommended_da, o.min_da, o.max_da, o.offered_da, o.locked_da,
         o.distance_m, o.duration_s, o.delivery_code, o.pickup_code, o.inspection, o.recipient_expecting_at, o.pickup_photo_doc, o.pickup_distance_m, o.delivery_distance_m, o.tracking_hash IS NOT NULL has_tracking, o.cancel_reason, o.pickup_address, o.dropoff_address, o.recipient_name, o.recipient_phone,
         ST_Y(o.pickup_point::geometry) pickup_lat, ST_X(o.pickup_point::geometry) pickup_lng, ST_Y(o.dropoff_point::geometry) dropoff_lat, ST_X(o.dropoff_point::geometry) dropoff_lng,
         o.created_at, o.assigned_at, o.picked_up_at, o.delivered_at, o.auto_accept, o.route_line route, o.search_started_at,
         CASE WHEN o.status='searching' AND $3 > 0 THEN o.search_started_at + make_interval(secs => $3) END search_ends_at,
         (SELECT count(*)::int FROM offers f WHERE f.order_id=o.id AND f.status IN ('offered','bid')) couriers_notified,
         (SELECT count(*)::int FROM orders x WHERE x.driver_profile_id=o.driver_profile_id AND x.status='delivered' AND x.leg='delivery') driver_deliveries,
         dp.id driver_id, dp.display_name driver_name, dp.photo_url driver_photo,
         CASE WHEN dp.rating_count = 0 THEN NULL ELSE round(dp.rating_sum::numeric / dp.rating_count, 2) END driver_rating, dd.vehicle driver_vehicle,
         CASE WHEN o.status IN ('assigned','picked_up') THEN dd.vehicle_color END driver_vehicle_color, CASE WHEN o.status IN ('assigned','picked_up') THEN dd.plate_number END driver_plate,
         CASE WHEN o.status IN ('assigned','picked_up') THEN ST_Y(dd.last_location::geometry) END driver_lat,
         CASE WHEN o.status IN ('assigned','picked_up') THEN ST_X(dd.last_location::geometry) END driver_lng,
         dd.last_location_at driver_location_at,
         EXISTS (SELECT 1 FROM ratings r WHERE r.order_id = o.id AND r.rater_profile_id = o.user_profile_id) AS rated
       FROM orders o LEFT JOIN profiles dp ON dp.id = o.driver_profile_id LEFT JOIN driver_details dd ON dd.profile_id = dp.id
       WHERE o.id=$1 AND o.user_profile_id=$2`, [orderId, userId, cfg.searchWindowS()]);
    if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
    const { driver_id, driver_name, driver_photo, driver_rating, driver_vehicle, driver_vehicle_color, driver_plate, driver_lat, driver_lng, driver_location_at, driver_deliveries, has_tracking, ...rest } = o;
    // Couriers' offers waiting for the customer's choice (price, time to reach the pickup, who they are). Only while searching.
    const bids = o.status !== 'searching' ? [] : await this.db.query(
      `SELECT f.id offer_id, f.bid_da price_da, f.eta_s, f.bid_expires_at expires_at, p.display_name name, p.photo_url,
              CASE WHEN p.rating_count=0 THEN NULL ELSE round(p.rating_sum::numeric/p.rating_count,2) END rating, p.rating_count, d.vehicle,
              (SELECT count(*)::int FROM orders x WHERE x.driver_profile_id=p.id AND x.status='delivered' AND x.leg='delivery') deliveries
       FROM offers f JOIN profiles p ON p.id=f.driver_profile_id JOIN driver_details d ON d.profile_id=p.id
       WHERE f.order_id=$1 AND f.status='bid' AND f.bid_expires_at > now() ORDER BY f.bid_da ASC, f.eta_s ASC NULLS LAST`, [orderId]);
    const eta = await this.eta.forOrder({ ...o, driver_lat, driver_lng, last_location_at: driver_location_at });
    const events = await this.db.query(`SELECT type, data, created_at FROM order_events WHERE order_id=$1 AND type = ANY($2) ORDER BY id`, [orderId, USER_EVENTS]);
    const evidence = await this.db.query(`SELECT id FROM documents WHERE order_id=$1 AND kind='evidence_photo' ORDER BY created_at`, [orderId]);
    return { ...rest, tracking_token: has_tracking ? trackingToken(o.id) : null, evidence_photos: evidence.map((e: any) => e.id),
      bids: bids.map((x: any) => ({ offer_id: Number(x.offer_id), price_da: x.price_da, eta_s: x.eta_s, expires_at: x.expires_at, driver: { name: x.name, photo_url: x.photo_url, rating: x.rating, rating_count: x.rating_count, vehicle: x.vehicle, deliveries: x.deliveries } })),
      eta_s: eta.s, eta_estimated: eta.estimated,
      history: events.map((e: any) => ({ type: e.type, at: e.created_at, data: e.data })),
      driver: driver_id ? { name: driver_name, photo_url: driver_photo, rating: driver_rating, vehicle: driver_vehicle, vehicle_color: driver_vehicle_color, plate_number: driver_plate, deliveries: driver_deliveries, location: driver_lat == null ? null : { lat: driver_lat, lng: driver_lng, at: driver_location_at } } : null };
  }
}
