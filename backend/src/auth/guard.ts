import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Db } from '../db/db.service';
import { readToken } from './tokens';
import { SecurityLog } from '../security/security-log.service';
import { limiter, limitsOff } from '../security/limiter';

// @Public()            no token
// @Access('account')    any logged-in app token, even before a profile exists
// @Access('user')       active USER profile only
// @Access('driver')     active DRIVER profile only
// @Access('staff')      staff token only (a different key and audience: app tokens never work here, and staff tokens never work elsewhere)
export const Public = () => SetMetadata('public', true);
export const Access = (kind: 'account' | 'user' | 'driver' | 'staff') => SetMetadata('access', kind);

export interface Who { sid: string; accountId: string; profileId: string | null; type: 'user' | 'driver' | null; status: string | null }
// A banned account may still read its record, appeal, and log out.
const BANNED_ALLOWED = new Set(['/get_me', '/my_record', '/appeal_violation', '/logout', '/logout_everywhere']);
const tooMany = () => new HttpException({ error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' }, 429);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: Db, private sec: SecurityLog) {}
  async canActivate(ctx: ExecutionContext) {
    const h = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride('public', h)) return true;
    const req = ctx.switchToHttp().getRequest(), ip: string = req.ip, path: string = req.path;
    const raw = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    let t; try { t = readToken(raw); } catch { this.sec.event('bad_token', ip, { path }); throw new UnauthorizedException({ error: 'BAD_TOKEN', message: 'Login again' }); }
    const need = this.reflector.getAllAndOverride<string>('access', h) ?? 'account';

    if (t.kind === 'staff') {   // valid ONLY on staff routes; the account must still be active and the token not revoked by a logout
      const st = await this.db.one(`SELECT id, token_version FROM staff_users WHERE id=$1 AND active`, [t.c.stf]);
      if (!st || st.token_version !== t.c.tv) throw new UnauthorizedException({ error: 'SESSION_ENDED', message: 'Login again' });
      if (need !== 'staff') { this.sec.event('staff_token_on_app_route', ip, { path }, { staff: st.id }); throw new ForbiddenException({ error: 'WRONG_PROFILE', message: 'Staff accounts cannot use this' }); }
      if (!limitsOff() && !limiter.hit('staff:' + st.id, 300, 60_000).ok) throw tooMany();
      req.staff = { id: st.id }; return true;
    }

    const c = t.c;
    if (need === 'staff') { this.sec.event('app_token_on_staff_route', ip, { path }, { account: c.acc }); throw new ForbiddenException({ error: 'STAFF_ONLY', message: 'Staff only' }); }
    if (!limitsOff() && !limiter.hit('sess:' + c.sid, 120, 60_000).ok) { this.sec.event('session_rate_limited', ip, { path }, { account: c.acc }); throw tooMany(); }
    // One query: the session must be alive, and the profile's CURRENT type/status is read from the database,
    // so a suspension or approval takes effect immediately, never from stale token data.
    const row = await this.db.one(
      `SELECT s.account_id, s.active_profile_id, p.type, p.status,
              EXISTS (SELECT 1 FROM sanctions b WHERE b.account_id = s.account_id AND b.kind='ban' AND b.lifted_at IS NULL) AS banned FROM sessions s
       LEFT JOIN profiles p ON p.id = s.active_profile_id
       WHERE s.id=$1 AND NOT s.revoked AND s.expires_at > now()`, [c.sid]);
    if (!row || row.account_id !== c.acc) throw new UnauthorizedException({ error: 'SESSION_ENDED', message: 'Login again' });
    // A token is valid only for the profile it was issued for. After a switch, the old token is dead.
    if ((c.pid ?? null) !== (row.active_profile_id ?? null)) { this.sec.event('stale_profile_token', ip, { path }, { account: c.acc }); throw new UnauthorizedException({ error: 'PROFILE_CHANGED', message: 'Profile was switched; use the newest token' }); }
    const who: Who = { sid: c.sid, accountId: row.account_id, profileId: row.active_profile_id, type: row.type, status: row.status };
    req.who = who;
    if (row.banned && !BANNED_ALLOWED.has(path)) throw new ForbiddenException({ error: 'ACCOUNT_BANNED', message: 'This account is closed.' });
    if (need === 'account') return true;
    if (who.type !== need) { this.sec.event('wrong_profile_type', ip, { need, have: who.type, path }, { account: who.accountId }); throw new ForbiddenException({ error: 'WRONG_PROFILE', message: `This needs the ${need} profile active` }); }
    if (who.status !== 'active') throw new ForbiddenException({ error: 'PROFILE_NOT_ACTIVE', message: `Profile is ${who.status}` });
    return true;
  }
}
