import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Access } from '../auth/guard';
import { Db } from '../db/db.service';
import { bad, fail } from '../common/errors';

@Controller()
export class NotifyController {
  constructor(private db: Db) {}

  // The notifications list of the ACTIVE profile (newest first, 30 per page). Only what was worth a phone notification;
  // internal signals (a request withdrawn, a price updated) stay out.
  @Access('account') @Get('list_notifications')
  async list(@Req() r: any, @Query('before') before: string) {
    const w = r.who;
    if (!w.profileId) throw fail(409, 'NO_PROFILE', 'Create your profile first');
    const b = before === undefined ? null : Number(before);
    if (b !== null && (!Number.isSafeInteger(b) || b < 1)) throw bad('BAD_ID', 'before must be a notification id');
    const rows = await this.db.query(
      `SELECT id, type, order_id, data, created_at FROM notifications WHERE profile_id=$1 AND type <> ALL($3) AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT 30`, [w.profileId, b, INTERNAL]);
    return { notifications: rows.map((n: any) => ({ ...n, id: Number(n.id), data: pick(n.data) })) };
  }

  // The app calls this after login, after every profile switch, and whenever the phone's push token changes.
  @Access('account') @Post('register_device') @HttpCode(200)
  async register(@Req() r: any, @Body() b: any) {
    const w = r.who;
    if (!w.profileId) throw fail(409, 'NO_PROFILE', 'Create your profile first');
    if (typeof b?.token !== 'string' || b.token.length < 10 || b.token.length > 4096) throw bad('BAD_TOKEN_VALUE', 'token is required');
    if (!['android', 'ios'].includes(b?.platform)) throw bad('BAD_PLATFORM', 'platform must be android or ios');
    if (!['ar', 'fr', 'en'].includes(b?.language)) throw bad('BAD_LANGUAGE', 'language must be ar, fr or en');
    await this.db.query(
      `INSERT INTO device_tokens(session_id, profile_id, platform, language, token) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (token) DO UPDATE SET session_id=EXCLUDED.session_id, profile_id=EXCLUDED.profile_id, platform=EXCLUDED.platform, language=EXCLUDED.language, updated_at=now()`,
      [w.sid, w.profileId, b.platform, b.language, b.token]);
    return { ok: true };
  }
}

// Signals for the screens only (a request withdrawn, a price updated...), never shown in the list.
const INTERNAL = ['offer.withdrawn', 'offer.updated', 'order.bid_withdrawn', 'bid.expired', 'job.updated'];
// A delivery code is never listed (it was shown once, where it belongs); only harmless fields go out.
const pick = (d: any) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => ['ref', 'price_da', 'reason', 'name', 'amount_da', 'receipt', 'offer_id'].includes(k)));
