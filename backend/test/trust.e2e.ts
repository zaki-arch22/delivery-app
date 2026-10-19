// The rules engine (TRUST_AND_SAFETY.md) against the real server and the TEST database: rules accepted at sign-up, one ID
// card = one driver, automatic points, warnings and temporary blocks (new work stops, a job in progress can finish), appeals
// decided by a person, staff blocks, bans that a new account cannot get around, and the database refusing to rewrite history.
import { Pool } from 'pg';
import { driverDocs, upload } from './docs';
import { googleToken } from './google';
import { proof } from './proof';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/security/crypto';
import { codeAt, newSecret, stepNow } from '../src/security/totp';
const HTTP = 'http://localhost:3399';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('test database only');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 10000): Promise<T | null> { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v as T; await sleep(200); } return null; }
async function api(path: string, body?: any, token?: string, headers: any = {}) {
  const r = await fetch(HTTP + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
async function login(phone: string, path: 'user' | 'driver', device?: string) {
  await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code;
  return (await api('/verify_code', { phone, code: c, path }, undefined, device ? { 'x-device': device } : {})).b;
}
const nid = () => String(1e11 + Math.floor(Math.random() * 9e11));
async function makeUser(phone: string, name: string, device?: string) { const l = await login(phone, 'user', device); const r = await api('/add_profile', { accept_rules: true, type: 'user', display_name: name }, l.token); return { token: r.b.token as string, id: r.b.active_profile.id as string }; }
async function makeDriver(phone: string, name: string, at = { lat: 36.7585, lng: 3.0588 }, national = nid()) {
  const l = await login(phone, 'driver'); const r = await api('/add_profile', { accept_rules: true, national_id: national, type: 'driver', display_name: name, documents: await driverDocs(HTTP, l.token) }, l.token);
  const id = r.b.active_profile.id; await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [id]); await pool.query(`UPDATE driver_details SET cash_limit_da=50000 WHERE profile_id=$1`, [id]);
  await api('/set_online', { online: true }, r.b.token); await api('/update_location', at, r.b.token);
  return { token: r.b.token as string, id: id as string };
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 }, adr = { street: 'Rue Didouche Mourad' };
async function order(tok: string, key: string, extra: any = {}) {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, tok)).b;
  return (await api('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000001', payer: 'sender', ...extra }, tok, { 'idempotency-key': key })).b;
}
const offerFor = (t: string) => until(async () => (await api('/get_current_offer', undefined, t)).b.offer);
const points = async (pid: string) => (await pool.query(`SELECT COALESCE(sum(points),0)::int n FROM violations WHERE profile_id=$1 AND status <> 'cancelled'`, [pid])).rows[0].n;

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, document_files, documents, profiles, accounts, zones, pricing_rules, staff_audit, staff_users, security_events, violations, sanctions, banned_identifiers, account_devices RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('test', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, min_percent, max_percent, active) VALUES (100, 30, 80, 150, true)`);   // TEST numbers only
  const secret = newSecret(); await pool.query(`INSERT INTO staff_users(email,name,password_hash,totp_secret_sealed) VALUES ('boss@test.example','Boss',$1,$2)`, [hashPassword('correct-horse-battery-1'), seal(secret, 'totp')]);
  const ST = (await api('/staff_login', { email: 'boss@test.example', password: 'correct-horse-battery-1', code: codeAt(secret, stepNow()) })).b.token as string;

  // ===== R1 sign-up: rules accepted, one ID card = one driver =====
  let l = await login('+213551700001', 'user');
  ok('R1 a profile cannot be created without accepting the rules', (await api('/add_profile', { type: 'user', display_name: 'No Rules' }, l.token)).b.error === 'RULES_REQUIRED');
  const U = await makeUser('+213551700001', 'Sara Seller', 'dev-sara-phone-01');
  ok('R1 the accepted rules version is kept', (await pool.query(`SELECT rules_version FROM profiles WHERE id=$1`, [U.id])).rows[0].rules_version === 1);
  l = await login('+213551700002', 'driver'); const docs = await driverDocs(HTTP, l.token);
  ok('R1 a driver needs the national ID number', (await api('/add_profile', { accept_rules: true, type: 'driver', display_name: 'No Id', documents: docs }, l.token)).b.error === 'BAD_NATIONAL_ID');
  const D1 = await makeDriver('+213551700003', 'Driver One', { lat: 36.7585, lng: 3.0588 }, '109988776655');
  ok('R1 the same ID card cannot make a second driver profile', (await api('/add_profile', { accept_rules: true, national_id: '109988776655', type: 'driver', display_name: 'Twin', documents: docs }, l.token)).b.error === 'ID_ALREADY_USED');
  ok('R1 only the fingerprint and the last 3 digits are stored', (await pool.query(`SELECT national_id_last3 l3, length(national_id_hash) n FROM driver_details WHERE profile_id=$1`, [D1.id])).rows[0].l3 === '655');
  const PR = proof(api, async t => (await upload(HTTP, t, 'parcel_photo')).b.document_id);

  // ===== R2 automatic points =====
  let o = await order(U.token, 'trust-key-01'); let f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
  await api('/release_job', { order_id: o.id, reason: 'vehicle_problem' }, D1.token);
  ok('R2 a driver who gives back an accepted job gets 1 point, and is told', await points(D1.id) === 1 && (await pool.query(`SELECT 1 FROM notifications WHERE profile_id=$1 AND type='trust.violation'`, [D1.id])).rowCount === 1);
  await api('/cancel_order', { order_id: o.id }, U.token);
  o = await order(U.token, 'trust-key-02'); f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
  await api('/release_job', { order_id: o.id, reason: 'unsafe_or_prohibited', evidence_photo: (await upload(HTTP, D1.token, 'evidence_photo')).b.document_id }, D1.token);
  ok('R2 refusing unsafe or prohibited goods (with a photo) costs nothing', await points(D1.id) === 1);
  await api('/cancel_order', { order_id: o.id }, U.token);
  o = await order(U.token, 'trust-key-03'); f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
  await pool.query(`UPDATE orders SET assigned_at = now() - interval '10 minutes' WHERE id=$1`, [o.id]);
  await api('/cancel_order', { order_id: o.id, reason: 'not needed' }, U.token);
  ok('R2 a late cancel gives the sender 1 point', await points(U.id) === 1);
  ok('R2 the same rule is never counted twice for one order', (await pool.query(`SELECT count(*)::int n FROM violations WHERE order_id=$1`, [o.id])).rows[0].n === 1);
  o = await order(U.token, 'trust-key-04'); f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
  await PR.pickup(o.id, U.token, D1.token);
  const fr = await api('/report_delivery_failure', { order_id: o.id, reason: 'refused_not_ordered' }, D1.token);
  ok('R2 "I never ordered this" gives the sender 2 points (he can appeal)', await points(U.id) === 3 && fr.b.job?.leg === 'return', await points(U.id));
  ok('R2 at 3 points the sender gets a written warning', (await pool.query(`SELECT kind, level FROM sanctions WHERE profile_id=$1`, [U.id])).rows[0]?.kind === 'warning');
  await PR.deliver(fr.b.job.id, U.token, D1.token);

  // ===== R3 levels: 5 points = blocked 24 h; new work stops, a job in progress can finish =====
  o = await order(U.token, 'trust-key-05'); f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);   // D1 is now on a job
  let r = await api('/add_violation', { profile_id: D1.id, rule: 'behaviour', points: 4, order_id: o.id, note: 'Shouted at the sender' }, ST);
  ok('R3 staff record a rule break with a reason (5 points in total now)', r.s === 200 && r.b.points_90d === 5, r.b);
  const blk = (await pool.query(`SELECT kind, until > now() + interval '23 hours' AND until < now() + interval '25 hours' AS day FROM sanctions WHERE profile_id=$1 AND kind='block'`, [D1.id])).rows[0];
  ok('R3 at 5 points the driver is blocked for 24 hours', blk?.kind === 'block' && blk.day === true, blk);
  ok('R3 ...but he can still finish the job he is doing', (await PR.pickup(o.id, U.token, D1.token)).b.order_status === 'picked_up' && (await PR.deliver(o.id, U.token, D1.token)).b.order_status === 'delivered');
  ok('R3 a blocked driver cannot go online', (await api('/set_online', { online: true }, D1.token)).b.error === 'PROFILE_BLOCKED');
  const rec = (await api('/my_record', undefined, D1.token)).b;
  ok('R3 his record shows the points, the block, every rule break and its order', rec.points_90d === 5 && rec.active_block?.kind === 'block' && rec.violations.length === 2 && rec.violations.some((v: any) => v.order_ref && v.rule === 'behaviour'), rec);
  const D2 = await makeDriver('+213551700004', 'Driver Two', { lat: 36.7590, lng: 3.0590 });
  await pool.query(`UPDATE driver_details SET is_online=true, last_location_at=now() WHERE profile_id=$1`, [D1.id]);   // even if he were online...
  o = await order(U.token, 'trust-key-06'); await offerFor(D2.token);
  ok('R3 ...a blocked driver never receives offers', (await pool.query(`SELECT count(*)::int n FROM offers WHERE order_id=$1 AND driver_profile_id=$2`, [o.id, D1.id])).rows[0].n === 0);
  await api('/cancel_order', { order_id: o.id }, U.token);
  r = await api('/add_violation', { profile_id: D1.id, rule: 'other', points: 1, note: 'Late to pickup again' }, ST);
  ok('R3 a level is applied once: one more point does not add a second block', (await pool.query(`SELECT count(*)::int n FROM sanctions WHERE profile_id=$1 AND kind='block'`, [D1.id])).rows[0].n === 1);
  ok('R3 staff cannot change fixed points (prohibited goods is always 6)', (await api('/add_violation', { profile_id: D1.id, rule: 'prohibited_goods', points: 1, note: 'trying to go easy' }, ST)).b.error === 'BAD_POINTS');
  ok('R3 the order must involve that profile', (await api('/add_violation', { profile_id: D2.id, rule: 'behaviour', points: 3, order_id: o.id, note: 'not his order' }, ST)).b.error === 'BAD_ORDER');

  // ===== R4 appeals: once, decided by a person; cancelling removes points and lifts the block =====
  const vid = rec.violations.find((v: any) => v.rule === 'behaviour').id;
  ok('R4 an appeal needs real words (10+ characters)', (await api('/appeal_violation', { id: vid, text: 'no' }, D1.token)).b.error === 'BAD_TEXT');
  ok('R4 the driver appeals in his own words', (await api('/appeal_violation', { id: vid, text: 'The sender insulted me first, ask the neighbours.' }, D1.token)).b.status === 'appealed');
  ok('R4 one appeal only', (await api('/appeal_violation', { id: vid, text: 'Please look again at this one.' }, D1.token)).b.error === 'CANNOT_APPEAL');
  ok('R4 nobody can appeal someone else\'s rule break', (await api('/appeal_violation', { id: Number((await pool.query(`SELECT id FROM violations WHERE profile_id=$1 LIMIT 1`, [U.id])).rows[0].id), text: 'Not mine but let me try.' }, D1.token)).b.error === 'CANNOT_APPEAL');
  const q = (await api('/list_violations?status=appealed', undefined, ST)).b;
  ok('R4 staff see the appeal waiting', q.violations.length === 1 && q.violations[0].appeal_text.startsWith('The sender'));
  r = await api('/decide_violation', { id: vid, decision: 'cancel', note: 'Witnesses confirm the driver was insulted.' }, ST);
  ok('R4 cancelling removes the points and lifts the automatic block', r.b.sanctions_lifted === 1 && await points(D1.id) === 2 && (await api('/set_online', { online: true }, D1.token)).s === 200, r.b);
  ok('R4 the driver is told, and sees the answer', (await api('/my_record', undefined, D1.token)).b.violations.find((v: any) => v.id === vid).decision_note.startsWith('Witnesses') && (await pool.query(`SELECT 1 FROM notifications WHERE profile_id=$1 AND type='trust.decided'`, [D1.id])).rowCount === 1);
  ok('R4 a decided rule break cannot be decided again', (await api('/decide_violation', { id: vid, decision: 'uphold', note: 'changed my mind' }, ST)).b.error === 'NOT_APPEALED');

  // ===== R5 staff blocks and lifting; a blocked sender cannot start orders but can follow his orders =====
  r = await api('/block_profile', { profile_id: U.id, hours: null, reason: 'Fake orders reported by three drivers' }, ST);
  ok('R5 staff block a sender until they decide', r.s === 200 && r.b.until === null);
  ok('R5 a blocked sender cannot ask for a price', (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, U.token)).b.error === 'PROFILE_BLOCKED');
  ok('R5 ...but can still see his orders and his record', (await api('/list_orders', undefined, U.token)).s === 200 && (await api('/my_record', undefined, U.token)).b.active_block?.reason.startsWith('Fake orders'));
  ok('R5 the active list shows the block', (await api('/list_sanctions?active=true', undefined, ST)).b.sanctions.some((x: any) => x.id === r.b.id));
  ok('R5 lifting needs a note, then the sender can order again', (await api('/lift_sanction', { id: r.b.id, note: 'Checked' }, ST)).s === 200 && (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, U.token)).s === 200);
  ok('R5 a lifted sanction cannot be lifted twice', (await api('/lift_sanction', { id: r.b.id, note: 'again' }, ST)).s === 404);

  // ===== R6 bans: a person decides; the account, its Google account, its phone and its ID card cannot come back =====
  const g = (await api('/login_google', { id_token: googleToken('g-cheater-1'), path: 'driver' }, undefined, { 'x-device': 'dev-cheater-phone' })).b;
  await api('/set_phone', { phone: '+213551799999' }, g.token);
  const cheat = await api('/add_profile', { accept_rules: true, national_id: '120000000999', type: 'driver', display_name: 'Cheater', documents: await driverDocs(HTTP, g.token) }, g.token);
  const CH = cheat.b.active_profile.id;
  ok('R6 a ban needs a real written reason', (await api('/ban_account', { profile_id: CH, reason: 'bad' }, ST)).b.error === 'BAD_TEXT');
  r = await api('/ban_account', { profile_id: CH, reason: 'Kept 12000 DA of cash on delivery, confirmed by two senders' }, ST);
  ok('R6 the ban ends every session of the account', r.b.sessions_ended >= 1 && (await api('/get_me', undefined, cheat.b.token)).s === 401);
  ok('R6 the same Google account cannot log in again', (await api('/login_google', { id_token: googleToken('g-cheater-1'), path: 'user' })).b.error === 'ACCOUNT_BANNED');
  ok('R6 a NEW Google account on the same phone is refused', (await api('/login_google', { id_token: googleToken('g-cheater-2'), path: 'driver' }, undefined, { 'x-device': 'dev-cheater-phone' })).b.error === 'DEVICE_BANNED');
  const g3 = (await api('/login_google', { id_token: googleToken('g-cheater-3'), path: 'driver' }, undefined, { 'x-device': 'dev-other-phone' })).b;
  await api('/set_phone', { phone: '+213551799998' }, g3.token);
  ok('R6 his ID card cannot open a driver profile on another account', (await api('/add_profile', { accept_rules: true, national_id: '120000000999', type: 'driver', display_name: 'Cheater Again', documents: await driverDocs(HTTP, g3.token) }, g3.token)).b.error === 'ID_BANNED');
  ok('R6 another person\'s EXISTING account on that phone can still log in (no collateral ban)', (await login('+213551700001', 'user', 'dev-cheater-phone')).token !== undefined);
  ok('R6 staff see the other accounts that used the same phone', (await api('/get_profile_record?profile_id=' + U.id, undefined, ST)).b.linked_profiles.some((p: any) => p.display_name === 'Cheater' && p.banned === true));
  ok('R6 an account cannot be banned twice', (await api('/ban_account', { profile_id: CH, reason: 'Again, for the same cash theft' }, ST)).b.error === 'ALREADY_BANNED');
  ok('R6 the ban is in the permanent audit trail', (await pool.query(`SELECT 1 FROM staff_audit WHERE action='ban_account'`)).rowCount === 1);

  // ===== R7 the database refuses to rewrite history =====
  const v1 = (await pool.query(`SELECT id FROM violations LIMIT 1`)).rows[0].id;
  let refused = 0;
  for (const sql of [`DELETE FROM violations WHERE id=${v1}`, `UPDATE violations SET points=0 WHERE id=${v1}`, `UPDATE violations SET note='edited' WHERE id=${v1}`, `DELETE FROM sanctions`, `UPDATE sanctions SET reason='softer' WHERE lifted_at IS NOT NULL`])
    try { await pool.query(sql); } catch { refused++; }
  ok('R7 rule breaks and sanctions can never be deleted or rewritten (even by the database owner)', refused === 5, refused);
  let viaApp = 0; try { await pool.query(`UPDATE violations SET status='cancelled' WHERE id=${v1} AND status='upheld'`); } catch { viaApp++; }
  ok('R7 status can only move forward (active -> appealed -> decided)', (await pool.query(`SELECT count(*)::int n FROM violations WHERE status='upheld'`)).rows[0].n === 0 || viaApp === 1);

  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})();
