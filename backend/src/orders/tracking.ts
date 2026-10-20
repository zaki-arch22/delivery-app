import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import QRCode from 'qrcode';
import { Db } from '../db/db.service';
import { Eta } from '../geo/eta';
import { Matching } from './matching.service';
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
  constructor(private db: Db, private eta: Eta, private documents: Documents, private matching: Matching) {}

  private async order(token: any) {
    if (typeof token !== 'string' || !TOKEN.test(token)) throw bad('BAD_LINK', 'This tracking link is not valid');
    const o = await this.db.one(
      `SELECT o.*, ST_Y(o.pickup_point::geometry) pickup_lat, ST_X(o.pickup_point::geometry) pickup_lng, ST_Y(o.dropoff_point::geometry) dropoff_lat, ST_X(o.dropoff_point::geometry) dropoff_lng,
         split_part(dp.display_name, ' ', 1) driver_first_name, dd.vehicle driver_vehicle,
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
      [o.id, ['created', 'recipient_confirmed', 'recipient_declined', 'assigned', 'released_by_driver', 'reassigned', 'picked_up', 'delivered', 'delivery_failed', 'recalled_by_sender', 'cancelled', 'cancelled_by_support', 'expired', 'recipient_expecting']]);
    const toPay = o.leg === 'return' ? 0 : o.cod_amount_da + (o.payer === 'recipient' ? (o.locked_da ?? o.offered_da) : 0);
    return {
      ref: o.ref, status: o.status, leg: o.leg, recipient_answer: o.recipient_answer,
      size: o.size, pickup_area: o.status === 'awaiting_recipient' ? (o.pickup_address?.landmark || o.pickup_address?.street || null) : null,
      sender_first_name: o.sender_first_name, recipient_name: o.recipient_name,
      inspection: o.inspection, amount_to_pay_da: toPay, cod_amount_da: o.cod_amount_da, delivery_fee_da: o.payer === 'recipient' ? (o.locked_da ?? o.offered_da) : 0,
      dropoff: { lat: o.dropoff_lat, lng: o.dropoff_lng, address: o.dropoff_address },
      driver: o.driver_profile_id && active ? {
        first_name: o.driver_first_name, vehicle: o.driver_vehicle, rating: o.driver_rating,
        phone: o.status === 'picked_up' ? o.driver_phone : null,           // the receiver can call the driver once the parcel is on its way
        location: fresh ? { lat: o.driver_lat, lng: o.driver_lng, at: o.last_location_at } : null,
      } : null,
      eta_s: eta.s, eta_estimated: eta.estimated,
      // The code is the receiver's proof of receipt; it is shown until the parcel is delivered.
      delivery_code: active || o.status === 'searching' ? o.delivery_code : null,   // not before the receiver said yes
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
  // Honest limit: the sender holds the link too, so he could press "yes" himself. It cannot be prevented without verifying
  // the receiver's phone (paid SMS); a "yes" from the sender's own internet address is recorded for staff (families share Wi-Fi,
  // so it is evidence, never a block).
  async confirm(token: any, ip?: string) {
    const o = await this.order(token);
    if (o.recipient_answer === 'confirmed') return { ok: true, status: o.status };
    if (o.status !== 'awaiting_recipient') throw fail(409, 'ORDER_ENDED', 'This request is no longer waiting for an answer');
    const done = await this.db.tx(async q => {
      const [r] = await q(`UPDATE orders SET status='searching', search_started_at=now(), recipient_answer='confirmed', recipient_answered_at=now(), recipient_expecting_at=COALESCE(recipient_expecting_at, now())
                           WHERE id=$1 AND status='awaiting_recipient' RETURNING id`, [o.id]);
      if (!r) return false;
      await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'recipient_confirmed','{}')`, [o.id]);
      const [same] = ip ? await q(`SELECT 1 FROM sessions s JOIN profiles p ON p.account_id=s.account_id WHERE p.id=$1 AND NOT s.revoked AND s.last_ip=$2 LIMIT 1`, [o.user_profile_id, ip]) : [];
      if (same) await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'flag_same_network',$2)`, [o.id, { note: 'The receiver confirmed from the sender\'s own internet address' }]);
      await notify(q, { profile: o.user_profile_id, kind: 'order.recipient_confirmed', order: o.id, priority: 'high', dedupe: `order:${o.id}:recipient_confirmed`, data: { ref: o.ref, name: o.recipient_name } });
      return true;
    });
    if (!done) throw fail(409, 'ORDER_ENDED', 'This request is no longer waiting for an answer');
    await this.matching.offerNext(o.id);   // couriers see it at once, not at the next tick
    return { ok: true, status: 'searching' };
  }

  // "No, I do not expect this parcel": the request ends before any courier moves. Nothing is held against anyone.
  async decline(token: any, reason: any) {
    const o = await this.order(token);
    if (o.recipient_answer === 'declined') return { ok: true, status: o.status };
    const why = ['not_ordered', 'not_available', 'wrong_person', 'other'].includes(reason) ? reason : 'other';
    if (o.status !== 'awaiting_recipient') throw fail(409, 'ORDER_ENDED', 'This request is no longer waiting for an answer');
    await this.db.tx(async q => {
      const [r] = await q(`UPDATE orders SET status='cancelled', cancel_reason='recipient_declined', recipient_answer='declined', recipient_answered_at=now()
                           WHERE id=$1 AND status='awaiting_recipient' RETURNING id`, [o.id]);
      if (!r) throw fail(409, 'ORDER_ENDED', 'This request is no longer waiting for an answer');
      await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'recipient_declined',$2)`, [o.id, { reason: why }]);
      await notify(q, { profile: o.user_profile_id, kind: 'order.recipient_declined', order: o.id, priority: 'high', dedupe: `order:${o.id}:recipient_declined`, data: { ref: o.ref, name: o.recipient_name, reason: why } });
    });
    return { ok: true, status: 'cancelled' };
  }

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
