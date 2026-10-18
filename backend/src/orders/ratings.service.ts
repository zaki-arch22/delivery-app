import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { bad, fail, isInt, uuid } from '../common/errors';

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
}
