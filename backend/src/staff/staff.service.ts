import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Q, notify } from '../notify/notify';
import { signStaff } from '../auth/tokens';
import { SecurityLog } from '../security/security-log.service';
import { unseal } from '../security/crypto';
import { verifyTotp } from '../security/totp';
import { hashPassword, verifyPassword } from '../auth/password';
import { address, bad, fail, isId, isInt, nat, point, text, uuid } from '../common/errors';
import { inOpenZone } from '../geo/zones';
import { createReturnLeg } from '../orders/return-leg';

const DUMMY = hashPassword('dummy-password-to-equalise-timing');
const audit = (q: Q, staff: string, action: string, type: string, id: string, data: any = {}) =>
  q(`INSERT INTO staff_audit(staff_id, action, target_type, target_id, data) VALUES ($1,$2,$3,$4,$5)`, [staff, action, type, id, data]);
const page = (p: any) => Math.max(1, Number(p) || 1);
// PostgreSQL returns big ids as text; the apps always receive real numbers.
const ids = (rows: any[], ...keys: string[]) => rows.map(r => { for (const k of keys) if (r[k] != null) r[k] = Number(r[k]); return r; });

@Injectable()
export class StaffService {
  constructor(private db: Db, private sec: SecurityLog) {}

  // ---------- login: password AND a one-time code from an authenticator app (both required) ----------
  async login(email: any, password: any, code: any, ip: string) {
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '', pw = typeof password === 'string' ? password : '';
    const s = await this.db.one(`SELECT * FROM staff_users WHERE email=$1 AND active`, [e]);
    if (s?.locked_until && new Date(s.locked_until) > new Date()) { this.sec.event('staff_login_locked', ip, { email: e }); throw fail(429, 'LOCKED', 'Too many failed attempts. Try again in 15 minutes.'); }
    const pwOk = verifyPassword(pw, s?.password_hash ?? DUMMY) && !!s;
    if (pwOk && !s.totp_secret_sealed) throw fail(403, 'TWO_FACTOR_NOT_SET_UP', 'Two-factor is not set up for this account. Ask the owner to run reset-2fa.');
    const step = pwOk ? verifyTotp(unseal(s.totp_secret_sealed, 'totp'), typeof code === 'string' ? code : '', Number(s.totp_last_step)) : null;
    // The same answer for a wrong password and a wrong code: an attacker never learns which factor failed.
    if (!pwOk || step === null) {
      if (s) { const [u] = await this.db.query(`UPDATE staff_users SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id=$1 RETURNING failed_attempts`, [s.id]); this.sec.event('staff_login_failed', ip, { email: e, attempts: u.failed_attempts }, { staff: s.id }); }
      else this.sec.event('staff_login_unknown_email', ip, { email: e });
      throw fail(401, 'BAD_LOGIN', 'Wrong email, password or code');
    }
    // A code works ONCE: this update only succeeds if no one used the same (or a later) code in the meantime.
    const used = await this.db.one(`UPDATE staff_users SET totp_last_step=$2, failed_attempts=0, locked_until=NULL WHERE id=$1 AND totp_last_step < $2 RETURNING token_version`, [s.id, step]);
    if (!used) throw fail(401, 'BAD_LOGIN', 'Wrong email, password or code');
    this.sec.event('staff_login_ok', ip, {}, { staff: s.id });
    return { token: signStaff(s.id, used.token_version), staff: { id: s.id, name: s.name, email: s.email } };
  }

  // Ends every staff session of this person on every device.
  async logout(staff: string) { await this.db.query(`UPDATE staff_users SET token_version = token_version + 1 WHERE id=$1`, [staff]); return { ok: true }; }

  // ---------- drivers ----------
  pendingDrivers() {
    // Everything a person needs to decide: identity and vehicle as typed, and every photo (ID card, licence, ownership,
    // all vehicle photos, the latest selfie). Nothing is approved automatically.
    return this.db.query(`SELECT p.id, p.display_name, a.phone, d.vehicle, d.first_name, d.last_name, to_char(d.birth_date, 'YYYY-MM-DD') birth_date, d.vehicle_color, d.plate_number, d.national_id_last3,
      json_build_object('id_photo', d.id_photo_doc, 'licence_photo', d.licence_photo_doc, 'ownership_photo', d.ownership_photo_doc, 'vehicle_photo', d.vehicle_photo_doc,
        'vehicle_photos', (SELECT COALESCE(json_agg(v.id ORDER BY v.created_at), '[]') FROM documents v WHERE v.profile_id=p.id AND v.kind='vehicle_photo'),
        'selfie', (SELECT s.id FROM documents s WHERE s.profile_id=p.id AND s.kind='selfie_photo' ORDER BY s.created_at DESC LIMIT 1)) AS documents, p.created_at
      FROM profiles p JOIN accounts a ON a.id=p.account_id JOIN driver_details d ON d.profile_id=p.id WHERE p.type='driver' AND p.status='pending_approval' ORDER BY p.created_at`).then(drivers => ({ drivers }));
  }

  async approveDriver(staff: string, b: any) {
    const id = uuid(b?.profile_id, 'profile_id');
    if (b?.cash_limit_da === undefined) throw bad('CASH_LIMIT_REQUIRED', 'Set the cash limit (0 = no cash-on-delivery orders)');
    const limit = nat(b.cash_limit_da, 'cash_limit_da');
    await this.db.tx(async q => {
      const [p] = await q(`SELECT status FROM profiles WHERE id=$1 AND type='driver' FOR UPDATE`, [id]);
      if (!p) throw fail(404, 'NOT_FOUND', 'Driver not found');
      if (p.status !== 'pending_approval') throw fail(409, 'NOT_PENDING', `Driver is ${p.status}`);
      await q(`UPDATE profiles SET status='active' WHERE id=$1`, [id]);
      await q(`UPDATE driver_details SET cash_limit_da=$2, approved_by=$3, approved_at=now() WHERE profile_id=$1`, [id, limit, staff]);
      await audit(q, staff, 'approve_driver', 'profile', id, { cash_limit_da: limit });
      await notify(q, { profile: id, kind: 'profile.approved', dedupe: `profile:${id}:approved` });
    });
    return { ok: true };
  }

  async rejectDriver(staff: string, b: any) {
    const id = uuid(b?.profile_id, 'profile_id'), reason = text(b?.reason, 'reason', 3, 200);
    await this.db.tx(async q => {
      const [p] = await q(`SELECT status FROM profiles WHERE id=$1 AND type='driver' FOR UPDATE`, [id]);
      if (!p) throw fail(404, 'NOT_FOUND', 'Driver not found');
      if (p.status !== 'pending_approval') throw fail(409, 'NOT_PENDING', `Driver is ${p.status}`);
      await q(`UPDATE profiles SET status='rejected' WHERE id=$1`, [id]);
      await audit(q, staff, 'reject_driver', 'profile', id, { reason });
      await notify(q, { profile: id, kind: 'profile.rejected', data: { reason }, dedupe: `profile:${id}:rejected` });
    });
    return { ok: true };
  }

  async setSuspended(staff: string, b: any, suspend: boolean) {
    const id = uuid(b?.profile_id, 'profile_id'), reason = text(b?.reason, 'reason', 3, 200);
    return this.db.tx(async q => {
      const [p] = await q(`SELECT p.type, p.status, d.approved_at FROM profiles p LEFT JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1 FOR UPDATE OF p`, [id]);
      if (!p) throw fail(404, 'NOT_FOUND', 'Profile not found');
      if (suspend && p.status !== 'active') throw fail(409, 'NOT_ACTIVE', `Profile is ${p.status}`);
      if (!suspend && p.status !== 'suspended') throw fail(409, 'NOT_SUSPENDED', `Profile is ${p.status}`);
      if (!suspend && p.type === 'driver' && !p.approved_at) throw fail(409, 'NEVER_APPROVED', 'This driver was never approved');
      await q(`UPDATE profiles SET status=$2 WHERE id=$1`, [id, suspend ? 'suspended' : 'active']);
      let activeJob = false;
      if (suspend && p.type === 'driver') {
        await q(`UPDATE driver_details SET is_online=false WHERE profile_id=$1`, [id]);
        await q(`UPDATE offers SET status='declined' WHERE driver_profile_id=$1 AND status='offered'`, [id]);
        activeJob = !!(await q(`SELECT 1 FROM orders WHERE driver_profile_id=$1 AND status IN ('assigned','picked_up')`, [id])).length;
      }
      const stamp = Date.now();
      await audit(q, staff, suspend ? 'suspend_profile' : 'unsuspend_profile', 'profile', id, { reason });
      await notify(q, { profile: id, kind: suspend ? 'profile.suspended' : 'profile.unsuspended', dedupe: `profile:${id}:${suspend ? 'susp' : 'unsusp'}:${stamp}` });
      return { ok: true, active_job: activeJob };   // staff must reassign an active job themselves
    });
  }

  async listDrivers(f: any) {
    const holding = f.holding_cash === 'true', online = f.online === undefined ? null : f.online === 'true';
    const rows = await this.db.query(
      `WITH x AS (SELECT p.id, p.display_name, p.status, a.phone, d.vehicle, d.is_online, d.cash_limit_da, p.rating_count,
                    CASE WHEN p.rating_count=0 THEN NULL ELSE round(p.rating_sum::numeric/p.rating_count,2) END rating,
                    COALESCE((SELECT sum(amount_da) FROM cash_ledger c WHERE c.driver_profile_id=p.id),0)::int cash_held_da,
                    (SELECT count(*) FROM orders o WHERE o.driver_profile_id=p.id AND o.status='delivered' AND o.leg='delivery')::int deliveries, p.created_at
                  FROM profiles p JOIN accounts a ON a.id=p.account_id JOIN driver_details d ON d.profile_id=p.id WHERE p.type='driver')
       SELECT * FROM x WHERE ($1::text IS NULL OR status::text=$1) AND ($2::boolean IS NULL OR is_online=$2) AND (NOT $3 OR cash_held_da <> 0)
       ORDER BY created_at DESC LIMIT 50 OFFSET $4`, [f.status ?? null, online, holding, (page(f.page) - 1) * 50]);
    return { page: page(f.page), drivers: rows };
  }

  // ---------- orders ----------
  async listOrders(f: any) {
    const w: string[] = [], p: any[] = [];
    const add = (sql: string, v: any) => { p.push(v); w.push(sql.split('$$').join('$' + p.length)); };   // every placeholder of this filter points at the same value
    if (f.status) add(`o.status::text = $$`, f.status);
    if (f.unassigned === 'true') w.push(`o.status = 'searching'`);
    if (f.leg) add(`o.leg::text = $$`, f.leg);
    if (f.problem === 'true') w.push(`EXISTS (SELECT 1 FROM problem_reports r WHERE r.order_id=o.id AND r.status <> 'resolved')`);
    if (f.older_than_min) add(`o.status IN ('assigned','picked_up') AND o.assigned_at < now() - make_interval(mins => $$::int)`, Number(f.older_than_min) || 0);
    if (f.q) add(`(o.ref = upper($$) OR ua.phone LIKE '%' || $$ || '%' OR o.recipient_phone LIKE '%' || $$ || '%' OR da.phone LIKE '%' || $$ || '%')`, String(f.q).trim());
    p.push((page(f.page) - 1) * 50);
    const rows = await this.db.query(
      `SELECT o.id, o.ref, o.leg, o.status, o.created_at, o.assigned_at, o.offered_da, o.locked_da, o.cod_amount_da, o.code_attempts,
         up.display_name AS user_name, ua.phone AS user_phone, dp.display_name AS driver_name,
         EXISTS (SELECT 1 FROM problem_reports r WHERE r.order_id=o.id AND r.status <> 'resolved') AS has_open_problem
       FROM orders o JOIN profiles up ON up.id=o.user_profile_id JOIN accounts ua ON ua.id=up.account_id
       LEFT JOIN profiles dp ON dp.id=o.driver_profile_id LEFT JOIN accounts da ON da.id=dp.account_id
       ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT 50 OFFSET $${p.length}`, p);
    return { page: page(f.page), orders: rows };
  }

  async timeline(id: any) {
    const oid = uuid(id, 'id');
    const order = await this.db.one(
      `SELECT o.*, ST_Y(o.pickup_point::geometry) pickup_lat, ST_X(o.pickup_point::geometry) pickup_lng, ST_Y(o.dropoff_point::geometry) dropoff_lat, ST_X(o.dropoff_point::geometry) dropoff_lng,
         up.id AS user_profile, up.display_name AS user_name, ua.phone AS user_phone, dp.display_name AS driver_name, da.phone AS driver_phone
       FROM orders o JOIN profiles up ON up.id=o.user_profile_id JOIN accounts ua ON ua.id=up.account_id
       LEFT JOIN profiles dp ON dp.id=o.driver_profile_id LEFT JOIN accounts da ON da.id=dp.account_id WHERE o.id=$1`, [oid]);
    if (!order) throw fail(404, 'NOT_FOUND', 'Order not found');
    delete order.pickup_point; delete order.dropoff_point;
    delete order.delivery_code; delete order.idempotency_key;   // staff never see the delivery code (it protects against fraud, including by insiders)
    const [events, offers, ratings, problems, ledger] = await Promise.all([
      this.db.query(`SELECT e.id, e.type, e.data, e.created_at, p.display_name AS actor, s.name AS staff FROM order_events e LEFT JOIN profiles p ON p.id=e.actor_profile_id LEFT JOIN staff_users s ON s.id=e.actor_staff_id WHERE e.order_id=$1 ORDER BY e.id`, [oid]),
      this.db.query(`SELECT f.id, f.rank, f.status, f.offered_at, f.expires_at, f.bid_da, p.display_name AS driver FROM offers f JOIN profiles p ON p.id=f.driver_profile_id WHERE f.order_id=$1 ORDER BY f.id`, [oid]),
      this.db.query(`SELECT r.stars, r.comment, r.created_at, a.display_name AS rater, b.display_name AS rated FROM ratings r JOIN profiles a ON a.id=r.rater_profile_id JOIN profiles b ON b.id=r.rated_profile_id WHERE r.order_id=$1`, [oid]),
      this.db.query(`SELECT id, reason, note, status, resolution, created_at, resolved_at, reporter_kind, photos FROM problem_reports WHERE order_id=$1 ORDER BY id`, [oid]),
      this.db.query(`SELECT id, type, amount_da, note, created_at FROM cash_ledger WHERE order_id=$1 ORDER BY id`, [oid]),
    ]);
    const photos = await this.db.query(`SELECT id, kind, created_at FROM documents WHERE order_id=$1 ORDER BY created_at`, [oid]);
    return { order, events: ids(events, 'id'), offers: ids(offers, 'id'), ratings, problems: ids(problems, 'id'), cash: ids(ledger, 'id'), photos };
  }

  async orderAction(staff: string, b: any) {
    const oid = uuid(b?.order_id, 'order_id');
    const action = b?.action;
    if (!['cancel', 'reassign', 'correct_address', 'reset_code_attempts', 'start_return'].includes(action)) throw bad('BAD_ACTION', 'action must be cancel, reassign, correct_address, reset_code_attempts or start_return');
    const reason = action === 'correct_address' ? null : text(b?.reason, 'reason', 3, 200);
    await this.db.tx(async q => {
      const [o] = await q(`SELECT o.*, sp.display_name AS sender_name, sa.phone AS sender_phone FROM orders o JOIN profiles sp ON sp.id=o.user_profile_id JOIN accounts sa ON sa.id=sp.account_id WHERE o.id=$1 FOR UPDATE OF o`, [oid]);
      if (!o) throw fail(404, 'NOT_FOUND', 'Order not found');
      const ev = (type: string, data: any) => q(`INSERT INTO order_events(order_id,type,actor_staff_id,data) VALUES ($1,$2,$3,$4)`, [oid, type, staff, data]);
      const withdraw = async () => { for (const x of await q(`UPDATE offers SET status='expired' WHERE order_id=$1 AND status IN ('offered','bid') RETURNING id, driver_profile_id`, [oid]))
        await notify(q, { profile: x.driver_profile_id, kind: 'offer.withdrawn', order: oid, push: false, dedupe: `offer:${x.id}:end`, data: { offer_id: Number(x.id), reason: 'support' } }); };
      const stamp = Date.now();
      if (action === 'cancel') {
        if (!['searching', 'assigned'].includes(o.status)) throw fail(409, 'CANNOT_CANCEL', `Order is ${o.status}. After pickup use start_return.`);
        await q(`UPDATE orders SET status='cancelled', cancel_reason=$2 WHERE id=$1`, [oid, `support: ${reason}`]); await withdraw();
        if (o.status === 'assigned') await notify(q, { profile: o.driver_profile_id, kind: 'job.cancelled', order: oid, priority: 'high', dedupe: `order:${oid}:cancelled`, data: { ref: o.ref } });
        await notify(q, { profile: o.user_profile_id, kind: 'order.cancelled', order: oid, dedupe: `order:${oid}:cancelled_by_support`, data: { ref: o.ref } });
        await ev('cancelled_by_support', { reason, from: o.status });
      } else if (action === 'reassign') {
        if (o.status !== 'assigned') throw fail(409, 'CANNOT_REASSIGN', `Only an assigned order can be reassigned (it is ${o.status})`);
        await q(`UPDATE orders SET status='searching', driver_profile_id=NULL, locked_da=NULL, assigned_at=NULL, search_started_at=now() WHERE id=$1`, [oid]);
        await notify(q, { profile: o.driver_profile_id, kind: 'job.cancelled', order: oid, priority: 'high', dedupe: `order:${oid}:reassigned_from:${stamp}`, data: { ref: o.ref } });
        await notify(q, { profile: o.user_profile_id, kind: 'order.reassigned', order: oid, dedupe: `order:${oid}:reassigned:${stamp}`, data: { ref: o.ref } });
        await ev('reassigned', { reason, old_driver: o.driver_profile_id });
      } else if (action === 'reset_code_attempts') {
        if (o.status !== 'picked_up') throw fail(409, 'WRONG_STATE', 'Only a picked-up order has a delivery code to unlock');
        await q(`UPDATE orders SET code_attempts=0 WHERE id=$1`, [oid]); await ev('code_attempts_reset', { reason });
      } else if (action === 'start_return') {
        if (o.status !== 'picked_up' || o.leg !== 'delivery') throw fail(409, 'WRONG_STATE', 'Only a picked-up delivery can be returned');
        await q(`UPDATE orders SET status='failed' WHERE id=$1`, [oid]); await ev('returned_by_support', { reason });
        const rid = await createReturnLeg(q, o, { staff });
        await notify(q, { profile: o.user_profile_id, kind: 'order.failed', order: oid, dedupe: `order:${oid}:failed`, data: { ref: o.ref, reason: 'support' } });
        await q(`UPDATE problem_reports SET status='in_progress', handled_by=$2 WHERE order_id=$1 AND status='open'`, [oid, staff]);
        await audit(q, staff, 'order_start_return', 'order', oid, { reason, return_order: rid }); return;
      } else {   // correct_address
        const which = b?.which; if (!['pickup', 'dropoff'].includes(which)) throw bad('BAD_WHICH', 'which must be pickup or dropoff');
        if (!['searching', 'assigned', 'picked_up'].includes(o.status)) throw fail(409, 'WRONG_STATE', `Order is ${o.status}`);
        if (which === 'pickup' && o.status === 'picked_up') throw fail(409, 'ALREADY_PICKED_UP', 'The pickup address cannot change after pickup');
        const addr = address(b?.address, 'address'), pt = b?.point ? point(b.point, 'point') : null;
        if (pt && !(await inOpenZone(this.db, pt))) throw fail(422, 'ZONE_CLOSED', 'That point is outside the open zones');
        const col = which === 'pickup' ? 'pickup' : 'dropoff';
        await q(`UPDATE orders SET ${col}_address=$2 ${pt ? `, ${col}_point=ST_SetSRID(ST_MakePoint($3,$4),4326)::geography` : ''} WHERE id=$1`, pt ? [oid, addr, pt.lng, pt.lat] : [oid, addr]);
        await ev('address_corrected', { which, before: o[`${col}_address`], after: addr, point_changed: !!pt });
        if (o.driver_profile_id) await notify(q, { profile: o.driver_profile_id, kind: 'job.updated', order: oid, dedupe: `order:${oid}:updated:${stamp}`, data: { ref: o.ref } });
      }
      await audit(q, staff, `order_${action}`, 'order', oid, { reason });
    });
    return this.timeline(oid);
  }

  // ---------- problems and ratings ----------
  async listProblems(f: any) {
    const rows = await this.db.query(
      `SELECT r.id, r.reason, r.note, r.status, r.resolution, r.created_at, o.id AS order_id, o.ref, p.display_name AS reporter, COALESCE(p.type::text, r.reporter_kind) AS reporter_type, a.phone AS reporter_phone
       FROM problem_reports r LEFT JOIN orders o ON o.id=r.order_id LEFT JOIN profiles p ON p.id=r.reporter_profile_id LEFT JOIN accounts a ON a.id=p.account_id
       WHERE ($1::text IS NULL OR r.status::text=$1) ORDER BY r.id DESC LIMIT 50 OFFSET $2`, [f.status ?? null, (page(f.page) - 1) * 50]);
    return { page: page(f.page), problems: ids(rows, 'id') };
  }

  async resolveProblem(staff: string, b: any) {
    if (!isId(b?.id)) throw bad('BAD_ID', 'id is required');
    if (!['in_progress', 'resolved'].includes(b?.status)) throw bad('BAD_STATUS', 'status must be in_progress or resolved');
    const resolution = b.status === 'resolved' ? text(b?.resolution, 'resolution', 3, 1000) : null;
    await this.db.tx(async q => {
      const [r] = await q(`UPDATE problem_reports SET status=$2::problem_status, handled_by=$3, resolution=COALESCE($4::text, resolution), resolved_at = CASE WHEN $2::problem_status='resolved' THEN now() ELSE NULL END WHERE id=$1 AND status <> 'resolved' RETURNING reporter_profile_id, order_id`, [b.id, b.status, staff, resolution]);
      if (!r) throw fail(404, 'NOT_FOUND', 'Problem not found or already resolved');
      await audit(q, staff, `problem_${b.status}`, 'problem', String(b.id), { resolution });
      if (b.status === 'resolved') await notify(q, { profile: r.reporter_profile_id, kind: 'problem.resolved', order: r.order_id, dedupe: `problem:${b.id}:resolved`, data: { problem_id: b.id } });
    });
    return { ok: true };
  }

  async listRatings(f: any) {
    const rows = await this.db.query(
      `SELECT r.id, r.stars, r.comment, r.created_at, o.ref, a.display_name AS rater, a.type AS rater_type, b.display_name AS rated, b.type AS rated_type, b.id AS rated_profile_id
       FROM ratings r JOIN orders o ON o.id=r.order_id JOIN profiles a ON a.id=r.rater_profile_id JOIN profiles b ON b.id=r.rated_profile_id
       WHERE ($1::uuid IS NULL OR r.rated_profile_id=$1) AND ($2::int IS NULL OR r.stars <= $2) AND (NOT $3 OR r.comment IS NOT NULL)
       ORDER BY r.id DESC LIMIT 50 OFFSET $4`, [f.profile_id ? uuid(f.profile_id, 'profile_id') : null, f.max_stars ? Number(f.max_stars) : null, f.with_comment === 'true', (page(f.page) - 1) * 50]);
    return { page: page(f.page), ratings: ids(rows, 'id') };
  }

  // ---------- cash ----------
  async driverCash(id: any) {
    const pid = uuid(id, 'profile_id');
    const d = await this.db.one(`SELECT p.display_name, d.cash_limit_da FROM profiles p JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1`, [pid]);
    if (!d) throw fail(404, 'NOT_FOUND', 'Driver not found');
    const [b] = await this.db.query(`SELECT COALESCE(sum(amount_da),0)::int balance FROM cash_ledger WHERE driver_profile_id=$1`, [pid]);
    const entries = await this.db.query(`SELECT c.id, c.type, c.amount_da, c.note, c.reverses_id, c.created_at, o.ref, s.name AS staff FROM cash_ledger c LEFT JOIN orders o ON o.id=c.order_id LEFT JOIN staff_users s ON s.id=c.staff_id WHERE c.driver_profile_id=$1 ORDER BY c.id DESC LIMIT 100`, [pid]);
    return { driver: d.display_name, cash_limit_da: d.cash_limit_da, balance_da: b.balance, entries: ids(entries, 'id', 'reverses_id') };
  }

  async handover(staff: string, b: any) {
    const pid = uuid(b?.driver_profile_id, 'driver_profile_id');
    if (!isInt(b?.amount_da) || b.amount_da <= 0) throw bad('BAD_AMOUNT', 'amount_da must be a positive whole number');
    return this.db.tx(async q => {
      const [d] = await q(`SELECT profile_id FROM driver_details WHERE profile_id=$1 FOR UPDATE`, [pid]);   // serialises concurrent handovers for this driver
      if (!d) throw fail(404, 'NOT_FOUND', 'Driver not found');
      const [bal] = await q(`SELECT COALESCE(sum(amount_da),0)::int balance FROM cash_ledger WHERE driver_profile_id=$1`, [pid]);
      if (b.amount_da > bal.balance) throw fail(409, 'EXCEEDS_BALANCE', `The driver holds ${bal.balance} DA, not ${b.amount_da}`);
      const [e] = await q(`INSERT INTO cash_ledger(driver_profile_id, type, amount_da, note, staff_id) VALUES ($1,'handover',$2,$3,$4) RETURNING id, created_at`, [pid, -b.amount_da, typeof b.note === 'string' ? b.note.slice(0, 300) : null, staff]);
      await audit(q, staff, 'cash_handover', 'profile', pid, { receipt: Number(e.id), amount_da: b.amount_da });
      await notify(q, { profile: pid, kind: 'cash.handover', dedupe: `cash:${e.id}`, data: { amount_da: b.amount_da, receipt: Number(e.id) } });
      return { receipt: Number(e.id), amount_da: b.amount_da, balance_da: bal.balance - b.amount_da, created_at: e.created_at };
    });
  }

  async adjustment(staff: string, b: any) {
    const pid = uuid(b?.driver_profile_id, 'driver_profile_id'), note = text(b?.note, 'note', 3, 300);
    return this.db.tx(async q => {
      const [d] = await q(`SELECT profile_id FROM driver_details WHERE profile_id=$1 FOR UPDATE`, [pid]);
      if (!d) throw fail(404, 'NOT_FOUND', 'Driver not found');
      let amount = b?.amount_da, reverses: number | null = null;
      if (b?.reverses_id !== undefined) {
        if (!isInt(b.reverses_id)) throw bad('BAD_ID', 'reverses_id must be an entry number');
        const [orig] = await q(`SELECT id, amount_da FROM cash_ledger WHERE id=$1 AND driver_profile_id=$2`, [b.reverses_id, pid]);
        if (!orig) throw fail(404, 'NOT_FOUND', 'That entry does not belong to this driver');
        reverses = Number(orig.id); amount = -orig.amount_da;                      // a reversal is always the exact opposite
      }
      if (!isInt(amount) || amount === 0) throw bad('BAD_AMOUNT', 'amount_da must be a non-zero whole number');
      let e;
      try { [e] = await q(`INSERT INTO cash_ledger(driver_profile_id, type, amount_da, note, staff_id, reverses_id) VALUES ($1,'adjustment',$2,$3,$4,$5) RETURNING id`, [pid, amount, note, staff, reverses]); }
      catch (x: any) { if (x.code === '23505') throw fail(409, 'ALREADY_REVERSED', 'That entry was already reversed'); throw x; }
      await audit(q, staff, 'cash_adjustment', 'profile', pid, { entry: Number(e.id), amount_da: amount, reverses, note });
      await notify(q, { profile: pid, kind: 'cash.adjusted', dedupe: `cash:${e.id}`, data: { entry: Number(e.id) } });
      const [bal] = await q(`SELECT COALESCE(sum(amount_da),0)::int balance FROM cash_ledger WHERE driver_profile_id=$1`, [pid]);
      return { entry: Number(e.id), balance_da: bal.balance };
    });
  }

  // ---------- zones ----------
  async createZone(staff: string, b: any) {
    const name = text(b?.name, 'name', 2, 80), g = b?.polygon;
    const ring = g?.type === 'Polygon' && Array.isArray(g.coordinates) ? g.coordinates[0] : null;
    if (!Array.isArray(ring) || ring.length < 4 || ring.some((c: any) => !Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number' || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)
        || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) throw bad('BAD_POLYGON', 'polygon must be a closed GeoJSON Polygon with at least 4 points: [lng, lat]');
    const valid = await this.db.one(`SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1),4326)) ok`, [JSON.stringify(g)]);
    if (!valid.ok) throw bad('BAD_POLYGON', 'The polygon is invalid (lines cross each other)');
    return this.db.tx(async q => {
      let z; try { [z] = await q(`INSERT INTO zones(name, area, is_open) VALUES ($1, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($2),4326))::geography, false) RETURNING id, name, is_open`, [name, JSON.stringify(g)]); }
      catch (x: any) { if (x.code === '23505') throw fail(409, 'ZONE_EXISTS', 'A zone with this name exists'); throw x; }
      await audit(q, staff, 'create_zone', 'zone', String(z.id), { name }); return z;   // zones start CLOSED; opening is a separate, deliberate step
    });
  }
  listZones() { return this.db.query(`SELECT id, name, is_open, round(ST_Area(area)/1000000)::int AS area_km2 FROM zones ORDER BY id`).then(zones => ({ zones })); }
  async setZoneOpen(staff: string, b: any) {
    if (!isInt(b?.zone_id) || typeof b?.open !== 'boolean') throw bad('BAD_INPUT', 'zone_id and open (true/false) are required');
    return this.db.tx(async q => {
      const [z] = await q(`UPDATE zones SET is_open=$2 WHERE id=$1 RETURNING id, name, is_open`, [b.zone_id, b.open]);
      if (!z) throw fail(404, 'NOT_FOUND', 'Zone not found');
      await audit(q, staff, b.open ? 'open_zone' : 'close_zone', 'zone', String(z.id), { name: z.name }); return z;
    });
  }

  // ---------- prices ----------
  getPricing() { return this.db.query(`SELECT * FROM pricing_rules ORDER BY version DESC LIMIT 20`).then(rules => ({ active: rules.find(r => r.active) ?? null, history: rules })); }
  async createPricing(staff: string, b: any) {
    const v = { base_da: nat(b?.base_da, 'base_da'), per_km_da: nat(b?.per_km_da, 'per_km_da'), medium_extra_da: nat(b?.medium_extra_da ?? 0, 'medium_extra_da'), large_extra_da: nat(b?.large_extra_da ?? 0, 'large_extra_da'), car_extra_da: nat(b?.car_extra_da ?? 0, 'car_extra_da') };
    if (!isInt(b?.min_percent) || b.min_percent < 1 || b.min_percent > 100) throw bad('BAD_PERCENT', 'min_percent must be 1 to 100');
    if (!isInt(b?.max_percent) || b.max_percent < 100) throw bad('BAD_PERCENT', 'max_percent must be 100 or more');
    const maxKm = b?.max_km ?? 50;
    if (!isInt(maxKm) || maxKm < 1 || maxKm > 1000) throw bad('BAD_MAX_KM', 'max_km must be 1 to 1000');
    return this.db.tx(async q => {
      await q(`UPDATE pricing_rules SET active=false WHERE active`);   // only one price table is active; old orders keep their own version
      const [r] = await q(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, max_km, active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING version`,
        [v.base_da, v.per_km_da, v.medium_extra_da, v.large_extra_da, v.car_extra_da, b.min_percent, b.max_percent, maxKm, staff]);
      await audit(q, staff, 'create_pricing', 'pricing', String(r.version), { ...v, min_percent: b.min_percent, max_percent: b.max_percent, max_km: maxKm }); return { version: r.version };
    });
  }
}
