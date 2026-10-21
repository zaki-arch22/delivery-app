import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { bad, fail, isId, isInt, uuid } from '../common/errors';
import { cfg } from '../common/config';
import { NOT_BLOCKED_SQL } from '../trust/rules';

@Injectable()
export class RatingsService {
  constructor(private db: Db) {}
  // Used by BOTH paths: the user rates the driver, the driver rates the user. The database re-checks the pair.
  async submit(profileId: string, b: any) {
    if (!isInt(b?.stars) || b.stars < 1 || b.stars > 5) throw bad('BAD_STARS', 'stars must be 1 to 5');
    const comment = typeof b.comment === 'string' && b.comment.trim() ? b.comment.trim() : null;
    if (comment && comment.length > 500) throw bad('BAD_COMMENT', 'comment is limited to 500 characters');
    const o = await this.db.one(`SELECT id, leg, status, user_profile_id, driver_profile_id FROM orders WHERE id=$1 AND (user_profile_id=$2 OR driver_profile_id=$2)`, [uuid(b?.order_id, 'order_id'), profileId]);
    if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
    if (o.leg !== 'delivery') throw bad('NOT_RATEABLE', 'Return legs are not rated');
    if (o.status !== 'delivered') throw fail(409, 'NOT_DELIVERED', 'Only delivered orders can be rated');
    const rated = o.user_profile_id === profileId ? o.driver_profile_id : o.user_profile_id;
    try { await this.db.query(`INSERT INTO ratings(order_id, rater_profile_id, rated_profile_id, stars, comment) VALUES ($1,$2,$3,$4,$5)`, [o.id, profileId, rated, b.stars, comment]); }
    catch (e: any) { if (e.code === '23505') throw fail(409, 'ALREADY_RATED', 'You already rated this order'); throw e; }
    return { ok: true };
  }

  // The other side's public profile (owner's wish, Oct 2026): a customer sees the courier who offered a price on HIS order
  // or who carries it; a courier sees the sender of a request shown to HIM or of his job. Name, photo, vehicle (couriers),
  // star average, finished deliveries/parcels sent, member since, and the latest comments WITHOUT who wrote them.
  // Reached only through an offer or order the caller is part of (no profile ids: nobody can browse other people).
  async publicProfile(me: { profileId: string | null; type: string | null }, q: { offer_id?: string; order_id?: string }) {
    if (!me.profileId) throw fail(403, 'PROFILE_REQUIRED', 'Create a profile first');
    let target: string | undefined;
    if (q.offer_id !== undefined) {
      const id = Number(q.offer_id); if (!isId(id) || String(id) !== q.offer_id) throw bad('BAD_ID', 'offer_id must be a number');
      const r = me.type === 'user'
        ? await this.db.one(`SELECT f.driver_profile_id t FROM offers f JOIN orders o ON o.id=f.order_id WHERE f.id=$1 AND o.user_profile_id=$2 AND f.status IN ('bid','accepted')`, [id, me.profileId])
        : await this.db.one(`SELECT o.user_profile_id t FROM offers f JOIN orders o ON o.id=f.order_id WHERE f.id=$1 AND f.driver_profile_id=$2`, [id, me.profileId]);
      target = r?.t;
    } else if (q.order_id !== undefined) {
      const oid = uuid(q.order_id, 'order_id');
      const r = me.type === 'user'
        ? await this.db.one(`SELECT driver_profile_id t FROM orders WHERE id=$1 AND user_profile_id=$2`, [oid, me.profileId])
        : await this.db.one(`SELECT user_profile_id t FROM orders WHERE id=$1 AND driver_profile_id=$2`, [oid, me.profileId]);
      target = r?.t;
    } else throw bad('BAD_INPUT', 'offer_id or order_id is required');
    if (!target) throw fail(404, 'NOT_FOUND', 'Profile not found');
    const p = await this.db.one(
      `SELECT p.type, p.display_name name, p.photo_url, p.status, p.created_at, p.rating_count,
              CASE WHEN p.rating_count=0 THEN NULL ELSE round(p.rating_sum::numeric/p.rating_count,2) END rating, d.vehicle,
              CASE WHEN p.type='driver' THEN (SELECT count(*)::int FROM orders x WHERE x.driver_profile_id=p.id AND x.status='delivered' AND x.leg='delivery')
                   ELSE (SELECT count(*)::int FROM orders x WHERE x.user_profile_id=p.id AND x.status='delivered' AND x.leg='delivery') END completed
       FROM profiles p LEFT JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1`, [target]);
    if (!p || p.status === 'deleted') throw fail(404, 'NOT_FOUND', 'Profile not found');
    const comments = await this.db.query(`SELECT stars, comment, created_at at FROM ratings WHERE rated_profile_id=$1 AND comment IS NOT NULL ORDER BY id DESC LIMIT 20`, [target]);
    return { type: p.type, name: p.name, photo_url: p.photo_url, vehicle: p.type === 'driver' ? p.vehicle : null, rating: p.rating, rating_count: p.rating_count,
      completed: p.completed, member_since: p.created_at, comments };
  }

  // Couriers online around a point, for the customer's map (inDrive-style cars around the pin). Positions are rounded to
  // about 100 m and carry no name or id, so nobody can follow a courier; only what a passer-by could see on the street.
  async nearbyCouriers(userId: string, lat: number, lng: number) {
    const rows = await this.db.query(
      `SELECT d.vehicle, round(ST_Y(d.last_location::geometry)::numeric, 3)::float lat, round(ST_X(d.last_location::geometry)::numeric, 3)::float lng
       FROM driver_details d JOIN profiles p ON p.id=d.profile_id
       WHERE d.is_online AND p.status='active' AND d.last_location_at > now() - make_interval(secs => $4)
         AND p.account_id <> (SELECT account_id FROM profiles WHERE id=$3) AND ${NOT_BLOCKED_SQL('p.id')}
         AND ST_DWithin(d.last_location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $5)
       ORDER BY d.last_location <-> ST_SetSRID(ST_MakePoint($2,$1),4326)::geography LIMIT 30`, [lat, lng, userId, cfg.locationFreshS(), cfg.searchMaxM()]);
    return { couriers: rows };
  }
}
