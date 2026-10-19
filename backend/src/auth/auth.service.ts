import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Db } from '../db/db.service';
import { Sms } from './sms.service';
import { Realtime } from '../notify/realtime.service';
import { SecurityLog } from '../security/security-log.service';
import { notify } from '../notify/notify';
import { newCode, newRefresh, safeEq, sha, signAccess } from './tokens';
import { Documents, KINDS } from '../documents/documents.service';
import { UUID } from '../common/errors';

type PType = 'user' | 'driver';
const PHONE = /^\+[0-9]{8,15}$/;
const CONTROL = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]/;   // control characters and hidden text-direction tricks
const MAX_SESSIONS = 5;                                          // devices logged in at once per account
const smsDailyCap = () => Number(process.env.SMS_DAILY_CAP ?? 2000); // tunable; protects against SMS-pumping fraud bills
const bad = (error: string, message: string) => new BadRequestException({ error, message });
const PUBLIC_PROFILE = `id, type, display_name, photo_url, status,
  CASE WHEN rating_count = 0 THEN NULL ELSE round(rating_sum::numeric / rating_count, 2) END AS rating, rating_count`;

@Injectable()
export class AuthService {
  constructor(private db: Db, private sms: Sms, private rt: Realtime, private sec: SecurityLog, private documents: Documents) {}

  // Whenever a session changes its active profile: the live connection of the old profile is closed, the phone's push token
  // follows the new profile, and a driver who leaves the driver profile goes offline (offers could not reach them anyway).
  private async profileChanged(sid: string, newProfileId: string) {
    const [prev] = await this.db.query(`SELECT p.id, p.type FROM sessions s JOIN profiles p ON p.id=s.active_profile_id WHERE s.id=$1`, [sid]);
    await this.db.query(`UPDATE sessions SET active_profile_id=$2 WHERE id=$1`, [sid, newProfileId]);
    await this.db.query(`UPDATE device_tokens SET profile_id=$2, updated_at=now() WHERE session_id=$1`, [sid, newProfileId]);
    if (prev && prev.type === 'driver' && prev.id !== newProfileId) {
      await this.db.query(`UPDATE driver_details SET is_online=false WHERE profile_id=$1`, [prev.id]);
      await this.db.query(`UPDATE offers SET status='declined' WHERE driver_profile_id=$1 AND status='offered'`, [prev.id]);
    }
    this.rt.closeSession(sid);
  }

  async sendCode(phone: string, ip: string) {
    if (!PHONE.test(phone ?? '')) throw bad('BAD_PHONE', 'Phone must be in international format, e.g. +213...');
    const recent = await this.db.one(`SELECT count(*)::int n FROM otp_codes WHERE phone=$1 AND created_at > now() - interval '1 hour'`, [phone]);
    if (recent.n >= 5) throw new HttpException({ error: 'TOO_MANY_CODES', message: 'Try again later' }, 429);
    // SMS costs money, so attackers abuse it ("SMS pumping"). Caps survive restarts because they are counted in the database.
    const byIp = await this.db.one(`SELECT count(*)::int n FROM otp_codes WHERE ip=$1 AND created_at > now() - interval '1 hour'`, [ip]);
    if (byIp.n >= 20) { this.sec.event('sms_ip_cap', ip); throw new HttpException({ error: 'TOO_MANY_CODES', message: 'Try again later' }, 429); }
    const today = await this.db.one(`SELECT count(*)::int n FROM otp_codes WHERE created_at > now() - interval '24 hours'`);
    if (today.n >= smsDailyCap()) { this.sec.event('sms_daily_cap_reached', ip, { cap: smsDailyCap() }); throw new HttpException({ error: 'SERVICE_BUSY', message: 'Please try again later' }, 429); }
    const code = newCode();
    // Saved and sent as one unit: if the SMS cannot be sent, nothing is left behind and the person is told clearly.
    try {
      await this.db.tx(async q => {
        await q(`INSERT INTO otp_codes(phone, code_hash, expires_at, ip) VALUES ($1,$2, now() + interval '5 minutes', $3)`, [phone, sha(`${phone}:${code}`), ip]);
        await this.sms.send(phone, `Your code is ${code}`);
      });
    } catch { throw new HttpException({ error: 'SMS_UNAVAILABLE', message: 'We could not send the code. Please try again in a moment.' }, 503); }
    return { ok: true };
  }

  async verifyCode(phone: string, code: string, path: PType, ip: string) {
    if (!PHONE.test(phone ?? '') || !/^\d{6}$/.test(code ?? '')) throw bad('BAD_INPUT', 'Phone or code format is wrong');
    if (path !== 'user' && path !== 'driver') throw bad('BAD_PATH', 'path must be user or driver');
    const otp = await this.db.one(`SELECT id, code_hash FROM otp_codes WHERE phone=$1 AND NOT consumed AND expires_at > now() ORDER BY id DESC LIMIT 1`, [phone]);
    if (!otp) throw new UnauthorizedException({ error: 'CODE_EXPIRED', message: 'Request a new code' });
    // ATOMIC attempt counting: the database itself allows at most 5 guesses per code, even if an attacker fires them all at the same instant.
    const used = await this.db.one(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1 AND attempts < 5 AND NOT consumed RETURNING attempts`, [otp.id]);
    if (!used) throw new UnauthorizedException({ error: 'CODE_LOCKED', message: 'Request a new code' });
    if (!safeEq(otp.code_hash, sha(`${phone}:${code}`))) { this.sec.event('otp_wrong', ip, { attempts: used.attempts }); throw new UnauthorizedException({ error: 'CODE_WRONG', message: 'Wrong code' }); }
    // ATOMIC single use: of two simultaneous correct submissions only one wins.
    const won = await this.db.one(`UPDATE otp_codes SET consumed = true WHERE id=$1 AND NOT consumed RETURNING id`, [otp.id]);
    if (!won) throw new UnauthorizedException({ error: 'CODE_EXPIRED', message: 'Request a new code' });

    const acc = await this.db.one(`INSERT INTO accounts(phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`, [phone]);
    const profiles = await this.profiles(acc.id);
    const chosen = profiles.find(p => p.type === path) ?? null;
    // New number (no profile at all): the chosen path gets its first profile (created next by add_profile).
    // Number that already has a profile but not the chosen one: NEVER open a second profile here.
    // The person lands in the profile they have; the other one can only be added later from Settings.
    const start = chosen ?? (profiles.length ? profiles[0] : null);
    const out = await this.newSession(acc.id, start?.id ?? null, ip, profiles);
    return {
      ...out, profiles, active_profile: start,
      needs_profile: profiles.length === 0 ? path : null,
      notice: !chosen && profiles.length ? { code: 'NO_PROFILE_FOR_PATH', missing: path, message: `You have no ${path} profile. You can add one from Settings.` } : null,
    };
  }

  // Refresh tokens ROTATE on every use. Presenting an OLD one means it was copied: the whole session is killed at once.
  async refresh(refreshToken: string, ip: string) {
    const old = sha(typeof refreshToken === 'string' ? refreshToken : ''), next = newRefresh();
    const s = await this.db.one(
      `UPDATE sessions SET prev_refresh_hash = refresh_hash, refresh_hash=$2, last_ip=$3, expires_at = now() + interval '60 days'
       WHERE refresh_hash=$1 AND NOT revoked AND expires_at > now() RETURNING id, account_id, active_profile_id`, [old, sha(next), ip]);
    if (!s) {
      const stolen = await this.db.one(`UPDATE sessions SET revoked=true WHERE prev_refresh_hash=$1 AND NOT revoked RETURNING id, account_id`, [old]);
      if (stolen) {
        await this.db.query(`DELETE FROM device_tokens WHERE session_id=$1`, [stolen.id]); this.rt.closeSession(stolen.id);
        this.sec.event('refresh_token_reuse', ip, { session: stolen.id }, { account: stolen.account_id });
      }
      throw new UnauthorizedException({ error: 'SESSION_ENDED', message: 'Login again' });
    }
    return { token: signAccess({ sid: s.id, acc: s.account_id, pid: s.active_profile_id, typ: null }), refresh_token: next };
  }

  async getMe(accountId: string, activeId: string | null) {
    const acc = await this.db.one(`SELECT id, phone FROM accounts WHERE id=$1`, [accountId]);
    const profiles = await this.profiles(accountId);
    return { account: acc, profiles, active_profile: profiles.find(p => p.id === activeId) ?? null };
  }

  async addProfile(accountId: string, sid: string, activeProfileId: string | null, type: PType, displayName: string, docs?: any) {
    if (type !== 'user' && type !== 'driver') throw bad('BAD_TYPE', 'type must be user or driver');
    const name = (displayName ?? '').trim();
    if (name.length < 2 || name.length > 60 || CONTROL.test(name)) throw bad('BAD_NAME', 'Name must be 2 to 60 characters, without control characters');
    if (type === 'driver') {
      // The three photos are uploaded first (upload_document); here the app sends their ids.
      const d = docs ?? {};
      if (!KINDS.every(k => typeof d[k] === 'string' && UUID.test(d[k])) || !['motorbike', 'car'].includes(d.vehicle))
        throw bad('DRIVER_DOCS_MISSING', 'ID photo, licence photo, vehicle photo and vehicle type are required');
    }
    // The 2nd profile is created only from inside the first one (Settings). A session with no profile may create only the FIRST.
    const have = await this.db.one(`SELECT count(*)::int n FROM profiles WHERE account_id=$1`, [accountId]);
    if (have.n > 0 && !activeProfileId) throw new ForbiddenException({ error: 'USE_SETTINGS', message: 'Log in to your profile and add the second one from Settings' });
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const ex = await client.query(`SELECT 1 FROM profiles WHERE account_id=$1 AND type=$2`, [accountId, type]);
      if (ex.rowCount) throw new ConflictException({ error: 'PROFILE_EXISTS', message: `You already have a ${type} profile` });
      const status = type === 'user' ? 'active' : 'pending_approval';
      const p = await client.query(`INSERT INTO profiles(account_id,type,display_name,status) VALUES ($1,$2,$3,$4) RETURNING id`, [accountId, type, name, status]);
      if (type === 'driver') {
        await this.documents.attach((s, v = []) => client.query(s, v).then(x => x.rows), accountId, p.rows[0].id, docs);
        await client.query(`INSERT INTO driver_details(profile_id,id_photo_doc,licence_photo_doc,vehicle,vehicle_photo_doc) VALUES ($1,$2,$3,$4,$5)`,
          [p.rows[0].id, docs.id_photo, docs.licence_photo, docs.vehicle, docs.vehicle_photo]);
      }
      await client.query('COMMIT');
      await this.profileChanged(sid, p.rows[0].id);
      const profiles = await this.profiles(accountId);
      return { token: signAccess({ sid, acc: accountId, pid: p.rows[0].id, typ: null }), profiles, active_profile: profiles.find(x => x.id === p.rows[0].id) };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }

  async switchProfile(accountId: string, sid: string, type: PType) {
    const p = (await this.profiles(accountId)).find(x => x.type === type);
    if (!p) throw new NotFoundException({ error: 'NO_SUCH_PROFILE', message: `No ${type} profile yet. Create it first.` });
    await this.profileChanged(sid, p.id);
    return { token: signAccess({ sid, acc: accountId, pid: p.id, typ: null }), active_profile: p };
  }

  async logout(sid: string) { await this.db.query(`DELETE FROM device_tokens WHERE session_id=$1`, [sid]); await this.db.query(`UPDATE sessions SET revoked = true WHERE id=$1`, [sid]); this.rt.closeSession(sid); return { ok: true }; }

  // "My phone was stolen": ends EVERY session of the account, on every device, and closes every live connection.
  async logoutEverywhere(accountId: string, ip: string) {
    const ended = await this.db.query(`UPDATE sessions SET revoked=true WHERE account_id=$1 AND NOT revoked RETURNING id`, [accountId]);
    for (const e of ended) { await this.db.query(`DELETE FROM device_tokens WHERE session_id=$1`, [e.id]); this.rt.closeSession(e.id); }
    this.sec.event('logout_everywhere', ip, { sessions: ended.length }, { account: accountId });
    return { ok: true, sessions_ended: ended.length };
  }

  private profiles(accountId: string) { return this.db.query(`SELECT ${PUBLIC_PROFILE} FROM profiles WHERE account_id=$1 ORDER BY type`, [accountId]); }

  private async newSession(accountId: string, profileId: string | null, ip: string, profiles: any[] = []) {
    const sid = randomUUID(); const refresh = newRefresh();
    const live = await this.db.query(`SELECT id FROM sessions WHERE account_id=$1 AND NOT revoked AND expires_at > now() ORDER BY created_at`, [accountId]);
    // At most MAX_SESSIONS devices at once: the oldest are logged out.
    for (const old of live.slice(0, Math.max(0, live.length - (MAX_SESSIONS - 1)))) { await this.db.query(`UPDATE sessions SET revoked=true WHERE id=$1`, [old.id]); await this.db.query(`DELETE FROM device_tokens WHERE session_id=$1`, [old.id]); this.rt.closeSession(old.id); }
    await this.db.tx(async q => {
      await q(`INSERT INTO sessions(id,account_id,active_profile_id,refresh_hash,expires_at,last_ip) VALUES ($1,$2,$3,$4, now() + interval '60 days', $5)`, [sid, accountId, profileId, sha(refresh), ip]);
      // A login to an account that is already in use on another device is announced to that account (stops silent SIM-swap takeovers).
      if (live.length) for (const p of profiles) await notify(q, { profile: p.id, kind: 'security.new_login', dedupe: `login:${sid}`, data: {} });
    });
    return { token: signAccess({ sid, acc: accountId, pid: profileId, typ: null }), refresh_token: refresh };
  }
}
