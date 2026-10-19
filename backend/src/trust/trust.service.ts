import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { bad, fail, isId, isInt, text, uuid } from '../common/errors';
import { notify } from '../notify/notify';
import { Realtime } from '../notify/realtime.service';
import { activeBlock, applyLevels, idHash, LEVELS, pointsOf, recordViolation, RULE_POINTS, STAFF_RULES, stopNewWork } from './rules';

const APPEAL_DAYS = 30;
const page = (p: any) => Math.max(1, Number(p) || 1);
const audit = (q: any, staff: string, action: string, type: string, target: string, data: any) =>
  q(`INSERT INTO staff_audit(staff_id, action, target_type, target_id, data) VALUES ($1,$2,$3,$4,$5)`, [staff, action, type, target, data]);

@Injectable()
export class TrustService {
  constructor(private db: Db, private rt: Realtime) {}

  // ---------- the person's own record (works even while blocked, so they can always see why and appeal) ----------
  async myRecord(profileId: string | null) {
    if (!profileId) throw fail(403, 'NO_PROFILE', 'Create your profile first');
    const q = (s: string, p: any[] = []) => this.db.query(s, p);
    const points = await pointsOf(q, profileId);
    const violations = await q(
      `SELECT v.id, v.rule, v.points, o.ref order_ref, v.note, v.status, v.appeal_text, v.decision_note, v.created_at,
              (v.status = 'active' AND v.created_at > now() - interval '${APPEAL_DAYS} days') can_appeal,
              (v.created_at > now() - interval '90 days' AND v.status <> 'cancelled') counts
       FROM violations v LEFT JOIN orders o ON o.id = v.order_id WHERE v.profile_id=$1 ORDER BY v.id DESC LIMIT 100`, [profileId]);
    const sanctions = await q(
      `SELECT id, kind, until, reason, source, lifted_at, lift_note, created_at FROM sanctions
       WHERE profile_id=$1 OR account_id=(SELECT account_id FROM profiles WHERE id=$1) ORDER BY id DESC LIMIT 50`, [profileId]);
    return {
      points_90d: points, levels: LEVELS.map(l => ({ at: l.at, kind: l.kind, hours: l.hours })), rule_points: RULE_POINTS,
      active_block: await activeBlock(q, profileId),
      violations: violations.map((v: any) => ({ ...v, id: Number(v.id) })), sanctions: sanctions.map((s: any) => ({ ...s, id: Number(s.id) })),
    };
  }

  // One appeal per rule break, within 30 days, in the person's own words. A staff member decides.
  async appeal(profileId: string | null, b: any) {
    if (!profileId) throw fail(403, 'NO_PROFILE', 'Create your profile first');
    if (!isId(b?.id)) throw bad('BAD_ID', 'id is required');
    const t = text(b?.text, 'text', 10, 1000);
    const [r] = await this.db.query(
      `UPDATE violations SET status='appealed', appeal_text=$3, appealed_at=now()
       WHERE id=$1 AND profile_id=$2 AND status='active' AND created_at > now() - interval '${APPEAL_DAYS} days' RETURNING id`, [b.id, profileId, t]);
    if (!r) throw fail(409, 'CANNOT_APPEAL', 'This cannot be appealed (already appealed, decided, or older than 30 days)');
    return { ok: true, status: 'appealed' };
  }

  // Emergency (the button on the job screen): a case at the top of staff's list, with where the phone was. The person is
  // also offered the public emergency numbers on the phone itself. At most 5 per hour per profile.
  async emergency(profileId: string | null, b: any) {
    if (!profileId) throw fail(403, 'NO_PROFILE', 'Create your profile first');
    const oid = b?.order_id ? uuid(b.order_id, 'order_id') : null;
    const loc = b?.location && typeof b.location.lat === 'number' && typeof b.location.lng === 'number' && Math.abs(b.location.lat) <= 90 && Math.abs(b.location.lng) <= 180 ? b.location : null;
    return this.db.tx(async q => {
      const [c] = await q(`SELECT count(*)::int n FROM problem_reports WHERE reporter_profile_id=$1 AND reason='emergency' AND created_at > now() - interval '1 hour'`, [profileId]);
      if (c.n >= 5) throw fail(429, 'TOO_MANY_ALERTS', 'Our team already has your alerts. Call the emergency numbers if you are in danger.');
      if (oid) { const [o] = await q(`SELECT 1 FROM orders WHERE id=$1 AND (user_profile_id=$2 OR driver_profile_id=$2)`, [oid, profileId]); if (!o) throw fail(404, 'NOT_FOUND', 'Order not found'); }
      const [r] = await q(`INSERT INTO problem_reports(order_id, reporter_profile_id, reason, note) VALUES ($1,$2,'emergency',$3) RETURNING id`, [oid, profileId, loc ? `Position: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'Position unknown']);
      if (oid) await q(`INSERT INTO order_events(order_id,type,actor_profile_id,data) VALUES ($1,'emergency',$2,$3)`, [oid, profileId, { location: loc }]);
      return { ok: true, id: Number(r.id) };
    });
  }

  // ---------- staff ----------
  async listViolations(f: any) {
    const status = ['active', 'appealed', 'upheld', 'cancelled'].includes(f?.status) ? f.status : null;
    const pid = f?.profile_id ? uuid(f.profile_id, 'profile_id') : null;
    const rows = await this.db.query(
      `SELECT v.id, v.profile_id, p.display_name, p.type profile_type, v.rule, v.points, v.order_id, o.ref order_ref, v.note, v.source, v.status,
              v.appeal_text, v.appealed_at, v.decision_note, v.decided_at, v.created_at
       FROM violations v JOIN profiles p ON p.id=v.profile_id LEFT JOIN orders o ON o.id=v.order_id
       WHERE ($1::text IS NULL OR v.status=$1) AND ($2::uuid IS NULL OR v.profile_id=$2)
       ORDER BY CASE WHEN v.status='appealed' THEN 0 ELSE 1 END, v.id DESC LIMIT 50 OFFSET $3`, [status, pid, (page(f?.page) - 1) * 50]);
    return { page: page(f?.page), violations: rows.map((v: any) => ({ ...v, id: Number(v.id) })) };
  }

  async addViolation(staff: string, b: any) {
    const pid = uuid(b?.profile_id, 'profile_id');
    if (!STAFF_RULES.includes(b?.rule)) throw bad('BAD_RULE', `rule must be one of ${STAFF_RULES.join(', ')}`);
    const points = b.points ?? RULE_POINTS[b.rule];
    if (!isInt(points) || points < 1 || points > 12) throw bad('BAD_POINTS', 'points must be 1 to 12');
    if (!['behaviour', 'other'].includes(b.rule) && points !== RULE_POINTS[b.rule]) throw bad('BAD_POINTS', `${b.rule} is always ${RULE_POINTS[b.rule]} points`);
    const note = text(b?.note, 'note', 5, 500);
    const oid = b?.order_id ? uuid(b.order_id, 'order_id') : null;
    return this.db.tx(async q => {
      const [p] = await q(`SELECT id FROM profiles WHERE id=$1`, [pid]);
      if (!p) throw fail(404, 'NOT_FOUND', 'Profile not found');
      if (oid) { const [o] = await q(`SELECT 1 FROM orders WHERE id=$1 AND (user_profile_id=$2 OR driver_profile_id=$2)`, [oid, pid]); if (!o) throw bad('BAD_ORDER', 'That order does not involve this profile'); }
      const id = await recordViolation(q, { profile: pid, rule: b.rule, points, order: oid, note, source: 'staff', staff });
      if (!id) throw fail(409, 'ALREADY_RECORDED', 'This rule break is already recorded for this order');
      await audit(q, staff, 'add_violation', 'profile', pid, { violation: id, rule: b.rule, points, order: oid });
      return { id, points_90d: await pointsOf(q, pid) };
    });
  }

  // Uphold or cancel a rule break (after an appeal, or on staff's own review). Cancelling removes its points and lifts
  // automatic sanctions the person no longer deserves.
  async decide(staff: string, b: any) {
    if (!isId(b?.id)) throw bad('BAD_ID', 'id is required');
    if (!['uphold', 'cancel'].includes(b?.decision)) throw bad('BAD_DECISION', 'decision must be uphold or cancel');
    const note = text(b?.note, 'note', 5, 1000);
    return this.db.tx(async q => {
      const [v] = await q(`SELECT id, profile_id, status FROM violations WHERE id=$1 FOR UPDATE`, [b.id]);
      if (!v) throw fail(404, 'NOT_FOUND', 'Not found');
      if (b.decision === 'uphold' && v.status !== 'appealed') throw fail(409, 'NOT_APPEALED', 'Only an appealed rule break can be upheld');
      if (b.decision === 'cancel' && !['active', 'appealed'].includes(v.status)) throw fail(409, 'ALREADY_DECIDED', 'Already decided');
      await q(`UPDATE violations SET status=$2, decided_by=$3, decision_note=$4, decided_at=now() WHERE id=$1`, [v.id, b.decision === 'uphold' ? 'upheld' : 'cancelled', staff, note]);
      let lifted = 0;
      if (b.decision === 'cancel') {
        const pts = await pointsOf(q, v.profile_id);
        const r = await q(`UPDATE sanctions SET lifted_at=now(), lifted_by=$2, lift_note='points cancelled after review' WHERE profile_id=$1 AND source='system' AND lifted_at IS NULL AND level > $3 RETURNING id`, [v.profile_id, staff, pts]);
        lifted = r.length;
      }
      await notify(q, { profile: v.profile_id, kind: 'trust.decided', dedupe: `violation:${v.id}:decided`, data: { decision: b.decision } });
      await audit(q, staff, `violation_${b.decision}`, 'violation', String(v.id), { note, lifted });
      return { ok: true, sanctions_lifted: lifted };
    });
  }

  async listSanctions(f: any) {
    const active = f?.active === 'true';
    const rows = await this.db.query(
      `SELECT s.id, s.kind, s.level, s.until, s.reason, s.source, s.lifted_at, s.lift_note, s.created_at, s.profile_id, s.account_id,
              COALESCE(p.display_name, (SELECT string_agg(display_name, ' / ') FROM profiles WHERE account_id=s.account_id)) who
       FROM sanctions s LEFT JOIN profiles p ON p.id=s.profile_id
       WHERE NOT $1 OR (s.lifted_at IS NULL AND (s.until IS NULL OR s.until > now()) AND s.kind <> 'warning')
       ORDER BY s.id DESC LIMIT 50 OFFSET $2`, [active, (page(f?.page) - 1) * 50]);
    return { page: page(f?.page), sanctions: rows.map((s: any) => ({ ...s, id: Number(s.id) })) };
  }

  async block(staff: string, b: any) {
    const pid = uuid(b?.profile_id, 'profile_id');
    const hours = b?.hours ?? null;
    if (hours !== null && (!isInt(hours) || hours < 1 || hours > 2160)) throw bad('BAD_HOURS', 'hours must be 1 to 2160, or null (until staff decide)');
    const reason = text(b?.reason, 'reason', 5, 500);
    return this.db.tx(async q => {
      const [p] = await q(`SELECT id FROM profiles WHERE id=$1`, [pid]);
      if (!p) throw fail(404, 'NOT_FOUND', 'Profile not found');
      const [s] = await q(`INSERT INTO sanctions(profile_id, kind, until, reason, source, staff_id) VALUES ($1,'block', CASE WHEN $2::int IS NULL THEN NULL ELSE now() + make_interval(hours => $2::int) END, $3, 'staff', $4) RETURNING id, until`, [pid, hours, reason, staff]);
      await stopNewWork(q, pid);
      await notify(q, { profile: pid, kind: 'trust.blocked', priority: 'high', dedupe: `sanction:${s.id}`, data: { until: s.until } });
      await audit(q, staff, 'block_profile', 'profile', pid, { hours, reason });
      return { id: Number(s.id), until: s.until };
    });
  }

  async lift(staff: string, b: any) {
    if (!isId(b?.id)) throw bad('BAD_ID', 'id is required');
    const note = text(b?.note, 'note', 5, 500);
    return this.db.tx(async q => {
      const [s] = await q(`UPDATE sanctions SET lifted_at=now(), lifted_by=$2, lift_note=$3 WHERE id=$1 AND lifted_at IS NULL RETURNING profile_id, account_id, kind`, [b.id, staff, note]);
      if (!s) throw fail(404, 'NOT_FOUND', 'Not found or already lifted');
      // Lifting a ban frees its identifiers again (the account may be used again).
      if (s.kind === 'ban') await q(`DELETE FROM banned_identifiers WHERE sanction_id=$1`, [b.id]);
      for (const p of s.profile_id ? [{ id: s.profile_id }] : await q(`SELECT id FROM profiles WHERE account_id=$1`, [s.account_id]))
        await notify(q, { profile: p.id, kind: 'trust.lifted', dedupe: `sanction:${b.id}:lifted:${p.id}`, data: {} });
      await audit(q, staff, 'lift_sanction', 'sanction', String(b.id), { note });
      return { ok: true };
    });
  }

  // A permanent ban (a person's decision, written reason): every profile of the account stops, every session ends, and
  // its Google account, phones, driver ID-card number and verified phone number cannot make a new account.
  async ban(staff: string, b: any) {
    const pid = uuid(b?.profile_id, 'profile_id');
    const reason = text(b?.reason, 'reason', 10, 500);
    const sessions: string[] = await this.db.tx(async q => {
      const [a] = await q(`SELECT a.id, a.google_sub, a.phone, a.phone_verified FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE p.id=$1`, [pid]);
      if (!a) throw fail(404, 'NOT_FOUND', 'Profile not found');
      const [already] = await q(`SELECT 1 FROM sanctions WHERE account_id=$1 AND kind='ban' AND lifted_at IS NULL`, [a.id]);
      if (already) throw fail(409, 'ALREADY_BANNED', 'This account is already banned');
      const [s] = await q(`INSERT INTO sanctions(account_id, kind, reason, source, staff_id) VALUES ($1,'ban',$2,'staff',$3) RETURNING id`, [a.id, reason, staff]);
      const ids: [string, string][] = [];
      if (a.google_sub) ids.push(['google', idHash('google', a.google_sub)]);
      if (a.phone && a.phone_verified) ids.push(['phone', idHash('phone', a.phone)]);
      for (const d of await q(`SELECT device_hash FROM account_devices WHERE account_id=$1`, [a.id])) ids.push(['device', d.device_hash]);
      for (const d of await q(`SELECT d.national_id_hash h FROM driver_details d JOIN profiles p ON p.id=d.profile_id WHERE p.account_id=$1 AND d.national_id_hash IS NOT NULL`, [a.id])) ids.push(['national_id', d.h]);
      for (const [kind, h] of ids) await q(`INSERT INTO banned_identifiers(kind, value_hash, account_id, sanction_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [kind, h, a.id, s.id]);
      for (const p of await q(`SELECT id FROM profiles WHERE account_id=$1`, [a.id])) await stopNewWork(q, p.id);
      const ended = await q(`UPDATE sessions SET revoked=true WHERE account_id=$1 AND NOT revoked RETURNING id`, [a.id]);
      await q(`DELETE FROM device_tokens WHERE session_id = ANY($1::uuid[])`, [ended.map((e: any) => e.id)]);
      await audit(q, staff, 'ban_account', 'account', a.id, { reason, identifiers: ids.map(i => i[0]) });
      return ended.map((e: any) => e.id);
    });
    for (const sid of sessions) this.rt.closeSession(sid);
    return { ok: true, sessions_ended: sessions.length };
  }

  // Everything staff need to judge a profile: points, history, sanctions, and other accounts that used the same phones
  // (a strong sign of someone coming back under a new name).
  async profileRecord(id: any) {
    const pid = uuid(id, 'profile_id');
    const q = (s: string, p: any[] = []) => this.db.query(s, p);
    const [p] = await q(`SELECT p.id, p.type, p.display_name, p.status, p.account_id, p.created_at, a.phone, a.phone_verified, a.google_sub IS NOT NULL google, d.national_id_last3
                         FROM profiles p JOIN accounts a ON a.id=p.account_id LEFT JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1`, [pid]);
    if (!p) throw fail(404, 'NOT_FOUND', 'Profile not found');
    const linked = await q(
      `SELECT DISTINCT p2.id profile_id, p2.display_name, p2.type, EXISTS (SELECT 1 FROM sanctions s WHERE s.account_id=p2.account_id AND s.kind='ban' AND s.lifted_at IS NULL) banned
       FROM account_devices d1 JOIN account_devices d2 ON d2.device_hash=d1.device_hash AND d2.account_id <> d1.account_id
       JOIN profiles p2 ON p2.account_id=d2.account_id WHERE d1.account_id=$1 LIMIT 20`, [p.account_id]);
    const { account_id, ...profile } = p; void account_id;
    const [docs] = await q(`SELECT d.id_photo_doc id_photo, (SELECT s.id FROM documents s WHERE s.profile_id=$1 AND s.kind='selfie_photo' ORDER BY s.created_at DESC LIMIT 1) selfie,
        (SELECT s.created_at FROM documents s WHERE s.profile_id=$1 AND s.kind='selfie_photo' ORDER BY s.created_at DESC LIMIT 1) selfie_at FROM profiles p LEFT JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1`, [pid]);
    return {
      profile, documents: docs, points_90d: await pointsOf(q, pid), active_block: await activeBlock(q, pid),
      devices: (await q(`SELECT count(*)::int n FROM account_devices WHERE account_id=$1`, [p.account_id]))[0].n,
      linked_profiles: linked, violations: (await this.listViolations({ profile_id: pid })).violations,
      sanctions: (await q(`SELECT id, kind, level, until, reason, source, lifted_at, lift_note, created_at FROM sanctions WHERE profile_id=$1 OR account_id=$2 ORDER BY id DESC LIMIT 50`, [pid, p.account_id])).map((s: any) => ({ ...s, id: Number(s.id) })),
    };
  }
}
export { applyLevels };
