import { createHmac } from 'crypto';
import { HttpException } from '@nestjs/common';
import { deriveKey } from '../security/crypto';
import { notify, Q } from '../notify/notify';

// The platform rules (backend/docs/TRUST_AND_SAFETY.md). Points count for 90 days per profile; crossing a level applies its
// sanction once. Automatic sanctions are TEMPORARY; only a staff member can ban, always with a written reason.
export const RULES_VERSION = 1;
export const RULE_POINTS: Record<string, number> = {
  driver_released: 1, late_cancel: 1, not_ordered_refusal: 2, far_confirmation: 3, wrong_item: 4, damaged_by_driver: 4, behaviour: 3, prohibited_goods: 6, other: 1,
};
export const STAFF_RULES = ['far_confirmation', 'wrong_item', 'damaged_by_driver', 'behaviour', 'prohibited_goods', 'other'];
export const LEVELS = [
  { at: 12, kind: 'block', hours: null },   // blocked until staff decide (and a staff review)
  { at: 8, kind: 'block', hours: 168 },     // 7 days
  { at: 5, kind: 'block', hours: 24 },
  { at: 3, kind: 'warning', hours: null },
] as const;
const WINDOW = `interval '90 days'`;

// One-way fingerprint of an identifier (Google account, phone device, ID-card number, phone number), with a server key.
export const idHash = (kind: string, value: string) => createHmac('sha256', deriveKey('HASH_PEPPER', 'identity')).update(`${kind}:${value}`).digest('hex');

export async function pointsOf(q: Q, profileId: string): Promise<number> {
  const [r] = await q(`SELECT COALESCE(sum(points),0)::int n FROM violations WHERE profile_id=$1 AND status <> 'cancelled' AND created_at > now() - ${WINDOW}`, [profileId]);
  return r.n;
}

// Records a rule break (once per rule and order), tells the person, and applies the level it reaches.
export async function recordViolation(q: Q, v: { profile: string; rule: string; points?: number; order?: string | null; note?: string | null; source: 'system' | 'staff'; staff?: string | null }) {
  const points = v.points ?? RULE_POINTS[v.rule];
  const [r] = await q(
    `INSERT INTO violations(profile_id, rule, points, order_id, note, source, staff_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (profile_id, rule, order_id) WHERE order_id IS NOT NULL DO NOTHING RETURNING id`,
    [v.profile, v.rule, points, v.order ?? null, v.note ?? null, v.source, v.staff ?? null]);
  if (!r) return null;
  await notify(q, { profile: v.profile, kind: 'trust.violation', order: v.order ?? undefined, dedupe: `violation:${r.id}`, data: { rule: v.rule, points } });
  await applyLevels(q, v.profile);
  return Number(r.id);
}

// The highest level reached in the last 90 days is applied once (a level already applied and not lifted is not repeated).
export async function applyLevels(q: Q, profileId: string) {
  const pts = await pointsOf(q, profileId);
  const level = LEVELS.find(l => pts >= l.at);
  if (!level) return;
  const [done] = await q(`SELECT 1 FROM sanctions WHERE profile_id=$1 AND source='system' AND level >= $2 AND lifted_at IS NULL AND created_at > now() - ${WINDOW}`, [profileId, level.at]);
  if (done) return;
  const [s] = await q(
    `INSERT INTO sanctions(profile_id, kind, level, until, reason, source) VALUES ($1,$2,$3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(hours => $4::int) END, $5, 'system') RETURNING id, until`,
    [profileId, level.kind, level.at, level.hours, `${pts} points in 90 days`]);
  await notify(q, { profile: profileId, kind: level.kind === 'warning' ? 'trust.warning' : 'trust.blocked', priority: 'high', dedupe: `sanction:${s.id}`, data: { points: pts, until: s.until } });
  if (level.kind === 'block') await stopNewWork(q, profileId);
}

// A blocked driver gets no more offers and is taken offline, unless he is carrying a parcel (he finishes it first).
export async function stopNewWork(q: Q, profileId: string) {
  await q(`UPDATE offers SET status='declined' WHERE driver_profile_id=$1 AND status='offered'`, [profileId]);
  await q(`UPDATE driver_details SET is_online=false WHERE profile_id=$1 AND NOT EXISTS (SELECT 1 FROM orders WHERE driver_profile_id=$1 AND status IN ('assigned','picked_up'))`, [profileId]);
}

// The block or ban in force for a profile (its own block, or a ban of its whole account), or null.
export async function activeBlock(q: Q, profileId: string): Promise<{ kind: 'block' | 'ban'; until: string | null; reason: string } | null> {
  const [b] = await q(
    `SELECT kind, until, reason FROM sanctions WHERE lifted_at IS NULL AND kind IN ('block','ban') AND (until IS NULL OR until > now())
       AND (profile_id=$1 OR account_id=(SELECT account_id FROM profiles WHERE id=$1))
     ORDER BY (kind='ban') DESC, until DESC NULLS FIRST LIMIT 1`, [profileId]);
  return b ?? null;
}
export async function assertCanWork(q: Q, profileId: string) {
  const b = await activeBlock(q, profileId);
  if (!b) return;
  throw new HttpException({ error: b.kind === 'ban' ? 'ACCOUNT_BANNED' : 'PROFILE_BLOCKED', message: b.kind === 'ban' ? 'This account is closed.' : 'This profile is blocked for now.', until: b.until, reason: b.reason }, 403);
}
// For SQL: drivers who may receive offers right now.
export const NOT_BLOCKED_SQL = (col: string) => `NOT EXISTS (SELECT 1 FROM sanctions sx WHERE sx.lifted_at IS NULL AND sx.kind IN ('block','ban') AND (sx.until IS NULL OR sx.until > now())
  AND (sx.profile_id = ${col} OR sx.account_id = (SELECT account_id FROM profiles px WHERE px.id = ${col})))`;
