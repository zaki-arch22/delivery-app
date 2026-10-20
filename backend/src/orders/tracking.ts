import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import QRCode from 'qrcode';
import { Db } from '../db/db.service';
import { Eta } from '../geo/eta';
import { Documents } from '../documents/documents.service';
import { deriveKey } from '../security/crypto';
import { cfg } from '../common/config';
import { bad, fail } from '../common/errors';
import { notify } from '../notify/notify';

// The receiver's secret tracking link (TRUST_AND_SAFETY.md): /t/<token>. The token is made from the order id with a server
// key (128 bits; it cannot be guessed or made from the order number), only its fingerprint is stored. Whoever has the link
// sees what the receiver needs: status, the driver on the map with the time left, the amount to pay, the code and its QR.
export const trackingToken = (orderId: string) => createHmac('sha256', deriveKey('HASH_PEPPER', 'tracking')).update(orderId).digest('base64url').slice(0, 32);
export const trackingHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const TOKEN = /^[A-Za-z0-9_-]{32}$/;
export const RECIPIENT_REASONS = ['not_arrived', 'damaged', 'wrong_item', 'driver_behaviour', 'other'];
// What the QR at the door contains: the order reference and its delivery code. The driver's app reads it; the server checks the code.
export const qrPayload = (ref: string, code: string) => `DLV1:${ref}:${code}`;
const ACTIVE = ['assigned', 'picked_up'];

@Injectable()
export class Tracking {
  constructor(private db: Db, private eta: Eta, private documents: Documents) {}

  private async order(token: any) {
    if (typeof token !== 'string' || !TOKEN.test(token)) throw bad('BAD_LINK', 'This tracking link is not valid');
    const o = await this.db.one(
      `SELECT o.*, ST_Y(o.pickup_point::geometry) pickup_lat, ST_X(o.pickup_point::geometry) pickup_lng, ST_Y(o.dropoff_point::geometry) dropoff_lat, ST_X(o.dropoff_point::geometry) dropoff_lng,
         split_part(dp.display_name, ' ', 1) driver_first_name, dd.vehicle driver_vehicle, dd.vehicle_color driver_vehicle_color, dd.plate_number driver_plate,
         CASE WHEN dp.rating_count = 0 THEN NULL ELSE round(dp.rating_sum::numeric / dp.rating_count, 1) END driver_rating, da.phone driver_phone,
         ST_Y(dd.last_location::geometry) driver_lat, ST_X(dd.last_location::geometry) driver_lng, dd.last_location_at,
         split_part(sp.display_name, ' ', 1) sender_first_name
       FROM orders o JOIN profiles sp ON sp.id=o.user_profile_id LEFT JOIN profiles dp ON dp.id=o.driver_profile_id LEFT JOIN accounts da ON da.id=dp.account_id
       LEFT JOIN driver_details dd ON dd.profile_id=dp.id
       WHERE o.tracking_hash=$1`, [trackingHash(token)]);
    // An unknown link and an ended one look the same from outside (no hint that an order exists).
    if (!o || (o.ended_at && Date.now() - new Date(o.ended_at).getTime() > cfg.trackingHours() * 3600_000)) throw fail(404, 'LINK_ENDED', 'This tracking link has ended');
    return o;
  }

  async data(token: any) {
    const o = await this.order(token);
    const active = ACTIVE.includes(o.status);
    const fresh = o.last_location_at && Date.now() - new Date(o.last_location_at).getTime() < cfg.locationFreshS() * 1000;
    const eta = await this.eta.forOrder(o);
    const events = await this.db.query(`SELECT type, data, created_at FROM order_events WHERE order_id=$1 AND type = ANY($2) ORDER BY id`,
      [o.id, ['created', 'assigned', 'released_by_driver', 'reassigned', 'picked_up', 'delivered', 'delivery_failed', 'recalled_by_sender', 'cancelled', 'cancelled_by_support', 'expired', 'recipient_expecting']]);
    const toPay = o.leg === 'return' ? 0 : o.cod_amount_da + (o.payer === 'recipient' ? (o.locked_da ?? o.offered_da) : 0);
    return {
      ref: o.ref, status: o.status, leg: o.leg,
      sender_first_name: o.sender_first_name, recipient_name: o.recipient_name,
      inspection: o.inspection, amount_to_pay_da: toPay, cod_amount_da: o.cod_amount_da, delivery_fee_da: o.payer === 'recipient' ? (o.locked_da ?? o.offered_da) : 0,
      dropoff: { lat: o.dropoff_lat, lng: o.dropoff_lng, address: o.dropoff_address },
      driver: o.driver_profile_id && active ? {
        first_name: o.driver_first_name, vehicle: o.driver_vehicle, rating: o.driver_rating, vehicle_color: o.driver_vehicle_color, plate_number: o.driver_plate,   // so the receiver recognises the vehicle
        phone: o.status === 'picked_up' ? o.driver_phone : null,           // the receiver can call the driver once the parcel is on its way
        location: fresh ? { lat: o.driver_lat, lng: o.driver_lng, at: o.last_location_at } : null,
      } : null,
      eta_s: eta.s, eta_estimated: eta.estimated,
      // The code is the receiver's proof of receipt; it is shown until the parcel is delivered.
      delivery_code: active || o.status === 'searching' ? o.delivery_code : null,
      has_parcel_photo: !!o.pickup_photo_doc,
      expecting: !!o.recipient_expecting_at,
      history: events.map((e: any) => ({ type: e.type, at: e.created_at, reason: e.data?.reason ?? undefined })),
    };
  }

  async qr(token: any): Promise<string> {
    const o = await this.order(token);
    if (!['searching', ...ACTIVE].includes(o.status)) throw fail(404, 'NO_CODE', 'This order has no code to show');
    return QRCode.toString(qrPayload(o.ref, o.delivery_code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B1530', light: '#FFFFFF' } });
  }

  async photo(token: any) {
    const o = await this.order(token);
    const p = await this.documents.orderPhoto(o.id, o.pickup_photo_doc);
    if (!p) throw fail(404, 'NO_PHOTO', 'No parcel photo yet');
    return p;
  }

  // The receiver says YES before any courier is searched (owner's wish, Oct 2026). Saying yes also means "I am expecting it".
  // "I am expecting this parcel": tells the sender (and the driver) the receiver is reachable and agrees. Once.
  async expecting(token: any) {
    const o = await this.order(token);
    if (o.recipient_expecting_at) return { ok: true, expecting: true };
    if (!['searching', ...ACTIVE].includes(o.status)) throw fail(409, 'ORDER_ENDED', 'This order has ended');
    await this.db.tx(async q => {
      const [r] = await q(`UPDATE orders SET recipient_expecting_at=now() WHERE id=$1 AND recipient_expecting_at IS NULL RETURNING id`, [o.id]);
      if (!r) return;
      await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'recipient_expecting','{}')`, [o.id]);
      await notify(q, { profile: o.user_profile_id, kind: 'order.recipient_expecting', order: o.id, dedupe: `order:${o.id}:expecting`, data: { ref: o.ref } });
      if (o.driver_profile_id) await notify(q, { profile: o.driver_profile_id, kind: 'job.updated', order: o.id, push: false, dedupe: `order:${o.id}:expecting:driver`, data: { ref: o.ref } });
    });
    return { ok: true, expecting: true };
  }

  // The receiver reports a problem (no account needed). At most 3 per order, so the link cannot flood staff.
  async report(token: any, reason: any, note: any) {
    const o = await this.order(token);
    if (!RECIPIENT_REASONS.includes(reason)) throw bad('BAD_REASON', `reason must be one of ${RECIPIENT_REASONS.join(', ')}`);
    const n = typeof note === 'string' ? note.trim().slice(0, 1000) : null;
    return this.db.tx(async q => {
      const [c] = await q(`SELECT count(*)::int n FROM problem_reports WHERE order_id=$1 AND reporter_kind='recipient'`, [o.id]);
      if (c.n >= 3) throw fail(429, 'TOO_MANY_REPORTS', 'This order already has reports; our team will contact you');
      const [r] = await q(`INSERT INTO problem_reports(order_id, reporter_kind, reason, note) VALUES ($1,'recipient',$2,$3) RETURNING id, status, created_at`, [o.id, `recipient:${reason}`, n]);
      await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'recipient_reported',$2)`, [o.id, { reason }]);
      return { ...r, id: Number(r.id) };
    });
  }
}
