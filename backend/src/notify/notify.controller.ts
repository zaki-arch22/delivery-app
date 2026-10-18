import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Access } from '../auth/guard';
import { Db } from '../db/db.service';
import { bad, fail } from '../common/errors';

@Controller()
export class NotifyController {
  constructor(private db: Db) {}

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
