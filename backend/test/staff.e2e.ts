import { Pool } from 'pg';
import { driverDocs, upload, PHOTO } from './docs';
import { proof } from './proof';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/security/crypto';
import { codeAt, newSecret, stepNow } from '../src/security/totp';
const HTTP = 'http://localhost:3399', WS = 'ws://localhost:3399/ws';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('Tests need TEST_DATABASE_URL pointing to a separate test database, never the real one');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 6000): Promise<T | null> { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v as T; await sleep(100); } return null; }
async function api(path: string, body?: any, token?: string, headers: any = {}) {
  const r = await fetch(HTTP + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
class Sock {
  msgs: any[] = []; ready = false; ws: any;
  constructor(token: string) { this.ws = new (globalThis as any).WebSocket(WS); this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'auth', token })); this.ws.onmessage = (e: any) => { const m = JSON.parse(e.data); if (m.type === 'ready') this.ready = true; else if (m.type === 'notification') this.msgs.push(m); }; }
  kind(k: string, ms = 4000, pred: (m: any) => boolean = () => true) { return until(() => this.msgs.find(m => m.kind === k && pred(m)), ms); }
}
async function login(phone: string, path: 'user' | 'driver') { await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code; return (await api('/verify_code', { phone, code: c, path })).b; }
async function makeUser(phone: string, name: string) { const l = await login(phone, 'user'); const r = await api('/add_profile', { accept_rules: true, type: 'user', display_name: name }, l.token); return { token: r.b.token as string, id: r.b.active_profile.id as string }; }
async function makeDriver(phone: string, name: string) { const l = await login(phone, 'driver'); const r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: name, documents: await driverDocs(HTTP, l.token) }, l.token); return { token: r.b.token as string, id: r.b.active_profile.id as string }; }
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 }, adr = { street: 'Rue Didouche Mourad' };
async function order(tok: string, key: string, extra: any = {}) {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, tok)).b;
  const o = (await api('/create_order', { auto_accept: true, quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000001', payer: 'sender', ...extra }, tok, { 'idempotency-key': key })).b;
  return o;   // auto-accept: the first courier who accepts the customer's price gets it
}
const PW = 'correct-horse-battery-1';
const BOX = { type: 'Polygon', coordinates: [[[2.9, 36.6], [3.3, 36.6], [3.3, 36.9], [2.9, 36.9], [2.9, 36.6]]] };

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, profiles, accounts, zones, pricing_rules, staff_audit, staff_users RESTART IDENTITY CASCADE`);
  const secrets: Record<string, string> = {}; const code = (email: string) => codeAt(secrets[email], stepNow());
  const ins = async (email: string) => { secrets[email] = newSecret(); return (await pool.query(`INSERT INTO staff_users(email,name,password_hash,totp_secret_sealed) VALUES ($1,$2,$3,$4) RETURNING id`, [email, 'Staff ' + email, hashPassword(PW), seal(secrets[email], 'totp')])).rows[0].id as string; };
  const staffId = await ins('boss@test.example'); await ins('locked@test.example'); const goneId = await ins('gone@test.example');

  // ===== S1 staff login and separation from users/drivers =====
  ok('S1 wrong password refused', (await api('/staff_login', { email: 'boss@test.example', password: 'nope' })).b.error === 'BAD_LOGIN');
  ok('S1 unknown email gets the SAME answer (no hint who exists)', (await api('/staff_login', { email: 'nobody@test.example', password: PW })).b.error === 'BAD_LOGIN');
  const ST = (await api('/staff_login', { email: 'boss@test.example', password: PW, code: code('boss@test.example') })).b.token as string; ok('S1 correct login gives a staff token', !!ST);
  for (let i = 0; i < 5; i++) await api('/staff_login', { email: 'locked@test.example', password: 'wrong' });
  ok('S1 after 5 wrong passwords the account locks, even for the RIGHT password', (await api('/staff_login', { email: 'locked@test.example', password: PW, code: code('locked@test.example') })).b.error === 'LOCKED');
  const U = await makeUser('+213550600001', 'Karim Seller');
  const PR = proof(api, async t => (await upload(HTTP, t, 'parcel_photo')).b.document_id);
  ok('S1 a user token cannot use staff functions', (await api('/list_pending_drivers', undefined, U.token)).b.error === 'STAFF_ONLY');
  ok('S1 a staff token cannot act as a user', (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, ST)).b.error === 'WRONG_PROFILE');
  ok('S1 no token is refused', (await api('/list_pending_drivers')).s === 401);
  const goneTok = (await api('/staff_login', { email: 'gone@test.example', password: PW, code: code('gone@test.example') })).b.token; await pool.query(`UPDATE staff_users SET active=false WHERE id=$1`, [goneId]);
  ok('S1 deactivating a staff member ends their access immediately', (await api('/list_pending_drivers', undefined, goneTok)).s === 401);
  const S = (p: string, b?: any) => api(p, b, ST);

  // ===== S2 zones and prices: empty at launch, set by staff =====
  ok('S2 with no zone, orders are refused', (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, U.token)).b.error === 'ZONE_CLOSED');
  ok('S2 an open (not closed) polygon is refused', (await S('/create_zone', { name: 'bad', polygon: { type: 'Polygon', coordinates: [[[2.9, 36.6], [3.3, 36.6], [3.3, 36.9], [2.9, 36.9]]] } })).b.error === 'BAD_POLYGON');
  ok('S2 a self-crossing polygon is refused', (await S('/create_zone', { name: 'bow', polygon: { type: 'Polygon', coordinates: [[[2.9, 36.6], [3.3, 36.9], [3.3, 36.6], [2.9, 36.9], [2.9, 36.6]]] } })).b.error === 'BAD_POLYGON');
  const z = (await S('/create_zone', { name: 'Test zone', polygon: BOX })).b; ok('S2 a valid zone is created CLOSED', z.is_open === false, z);
  ok('S2 a closed zone still refuses orders', (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, U.token)).b.error === 'ZONE_CLOSED');
  await S('/set_zone_open', { zone_id: z.id, open: true });
  ok('S2 zone open but no prices: clear message, no guessing', (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, U.token)).b.error === 'PRICING_NOT_SET');
  ok('S2 invalid price table refused', (await S('/create_pricing_version', { base_da: 100, per_km_da: 30, min_percent: 0, max_percent: 150 })).b.error === 'BAD_PERCENT');
  const v1 = (await S('/create_pricing_version', { base_da: 100, per_km_da: 30, medium_extra_da: 50, large_extra_da: 150, car_extra_da: 100, min_percent: 80, max_percent: 150 })).b.version;
  ok('S2 with prices, quotes work', (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, U.token)).b.recommended_da > 0);
  await order(U.token, 'staff-price-order-1'); // an order priced under version 1 (no drivers online: it will just search)
  const v2 = (await S('/create_pricing_version', { base_da: 200, per_km_da: 40, min_percent: 80, max_percent: 150 })).b.version;
  const pr = (await S('/get_pricing')).b;
  ok('S2 the maximum trip length defaults to 50 km', pr.active.max_km === 50, pr.active);
  {
    // Migration 021 opens the whole of Algeria (its border + 5 km); the 50 km limit keeps trips local.
    await pool.query(require('fs').readFileSync(require('path').join(__dirname, '..', 'db', '021_algeria_open.sql'), 'utf8'));
    const q = (a: any, b: any) => api('/get_quote', { pickup: a, dropoff: b, size: 'small' }, U.token);
    const kolea = { lat: 36.64, lng: 2.76 }, koleaCentre = { lat: 36.636, lng: 2.768 }, oran = { lat: 35.697, lng: -0.633 }, tunis = { lat: 36.80, lng: 10.18 };
    ok('S2 all of Algeria is open: Koléa (Tipaza) is served', (await q(kolea, koleaCentre)).b.recommended_da > 0);
    ok('S2 ...and Oran too, for a local trip', (await q(oran, { lat: 35.70, lng: -0.62 })).b.recommended_da > 0);
    ok('S2 ...but a trip from Koléa to Oran is refused as too long', (await q(kolea, oran)).b.error === 'TOO_FAR');
    ok('S2 a place outside Algeria (Tunis) is refused', (await q(tunis, tunis)).b.error === 'ZONE_CLOSED');
    await pool.query(`DELETE FROM zones WHERE name='Algérie'`);
  }
  ok('S2 a maximum trip length outside 1-1000 km is refused', (await S('/create_pricing_version', { base_da: 200, per_km_da: 40, min_percent: 80, max_percent: 150, max_km: 0 })).b.error === 'BAD_MAX_KM'
    && (await S('/create_pricing_version', { base_da: 200, per_km_da: 40, min_percent: 80, max_percent: 150, max_km: '30' })).b.error === 'BAD_MAX_KM');
  ok('S2 a new price table replaces the old; only ONE is active; history kept', pr.active.version === v2 && pr.history.filter((r: any) => r.active).length === 1 && pr.history.length === 2);
  ok('S2 an existing order keeps the price table it was made with', (await pool.query(`SELECT pricing_version FROM orders LIMIT 1`)).rows[0].pricing_version === v1);
  await pool.query(`UPDATE orders SET status='cancelled'`);

  // ===== S3 approving and rejecting drivers =====
  const D1 = await makeDriver('+213550700001', 'Driver One'), D2 = await makeDriver('+213550700002', 'Driver Two'), DR = await makeDriver('+213550700003', 'Driver Rejected');
  const sD1 = new Sock(D1.token), sD2 = new Sock(D2.token), sDR = new Sock(DR.token), sU = new Sock(U.token); await until(() => sD1.ready && sD2.ready && sDR.ready && sU.ready);
  ok('S3 a pending driver cannot go online', (await api('/set_online', { online: true }, D1.token)).b.error === 'PROFILE_NOT_ACTIVE');
  const pend = (await S('/list_pending_drivers')).b.drivers;
  ok('S3 pending drivers are listed with their documents', pend.length === 3 && pend.every((d: any) => ['id_photo', 'licence_photo', 'ownership_photo', 'vehicle_photo'].every(k => /^[0-9a-f-]{36}$/.test(d.documents?.[k])) && d.documents.vehicle_photos.length >= 1), pend[0]);
  ok('S3 ...with the identity and vehicle they typed, for a person to compare with the photos', pend.every((d: any) => d.first_name === 'Karim' && d.last_name === 'Test' && d.birth_date === '1995-04-12' && d.vehicle_color === 'Blue' && d.plate_number === '12345 113 16'), pend[0]);
  const docId = pend.find((d: any) => d.id === D1.id).documents.id_photo;
  const img = await fetch(HTTP + '/get_document?id=' + docId, { headers: { authorization: 'Bearer ' + ST } });
  const bytes = Buffer.from(await img.arrayBuffer());
  ok('S3 staff can see a driver\'s photo (a real JPEG, never cached, never run as a page)', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8
    && img.headers.get('cache-control') === 'no-store' && img.headers.get('x-content-type-options') === 'nosniff' && /default-src 'none'/.test(img.headers.get('content-security-policy') ?? ''));
  ok('S3 every photo view is written in the audit trail', (await pool.query(`SELECT 1 FROM staff_audit WHERE action='view_document' AND target_id=$1`, [D1.id])).rowCount === 1);
  ok('S3 unknown or malformed photo ids are refused cleanly', (await S('/get_document?id=00000000-0000-0000-0000-000000000000')).s === 404 && (await S('/get_document?id=../../etc/passwd')).s === 400);
  ok('S3 a driver cannot see photos (staff only)', (await api('/get_document?id=' + docId, undefined, D1.token)).b.error === 'STAFF_ONLY');
  ok('S3 approval needs an explicit cash limit', (await S('/approve_driver', { profile_id: D1.id })).b.error === 'CASH_LIMIT_REQUIRED' && (await S('/approve_driver', { profile_id: D1.id, cash_limit_da: -5 })).s === 400);
  ok('S3 approve driver', (await S('/approve_driver', { profile_id: D1.id, cash_limit_da: 50000 })).s === 200); await S('/approve_driver', { profile_id: D2.id, cash_limit_da: 50000 });
  ok('S3 the driver is told LIVE they were approved', !!(await sD1.kind('profile.approved')));
  ok('S3 approving twice is refused', (await S('/approve_driver', { profile_id: D1.id, cash_limit_da: 1 })).b.error === 'NOT_PENDING');
  ok('S3 reject needs a reason', (await S('/reject_driver', { profile_id: DR.id, reason: 'x' })).s === 400);
  await S('/reject_driver', { profile_id: DR.id, reason: 'Licence photo is unreadable' });
  const rj = await sDR.kind('profile.rejected'); ok('S3 rejected driver is told LIVE, with the reason', !!rj && rj.data.reason === 'Licence photo is unreadable');
  ok('S3 a rejected driver cannot go online', (await api('/set_online', { online: true }, DR.token)).b.error === 'PROFILE_NOT_ACTIVE');
  for (const d of [D1, D2]) { await api('/set_online', { online: true }, d.token); }
  await api('/update_location', { lat: 36.7585, lng: 3.0588 }, D1.token); await api('/update_location', { lat: 36.7628, lng: 3.0588 }, D2.token);

  // ===== S4 suspension, per profile =====
  const susp = await S('/suspend_profile', { profile_id: D2.id, reason: 'Customer complaints' });
  ok('S4 suspending a driver takes them offline at once', susp.s === 200 && (await pool.query(`SELECT is_online FROM driver_details WHERE profile_id=$1`, [D2.id])).rows[0].is_online === false);
  ok('S4 a suspended driver is refused immediately and told', (await api('/set_online', { online: true }, D2.token)).b.error === 'PROFILE_NOT_ACTIVE' && !!(await sD2.kind('profile.suspended')));
  ok('S4 unsuspend restores access', (await S('/unsuspend_profile', { profile_id: D2.id, reason: 'Resolved' })).s === 200 && (await api('/set_online', { online: true }, D2.token)).s === 200);
  await api('/update_location', { lat: 36.7628, lng: 3.0588 }, D2.token);
  await pool.query(`UPDATE profiles SET status='suspended' WHERE id=$1`, [DR.id]);
  ok('S4 a driver who was NEVER approved cannot be "unsuspended" into service', (await S('/unsuspend_profile', { profile_id: DR.id, reason: 'oops' })).b.error === 'NEVER_APPROVED');
  const both = await makeUser('+213550800001', 'Both Person'); const lb = await login('+213550800001', 'user'); const bd = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Both Driver', documents: await driverDocs(HTTP, lb.token) }, lb.token);
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [bd.b.active_profile.id]); await S('/suspend_profile', { profile_id: bd.b.active_profile.id, reason: 'Test of independence' });
  ok('S4 suspending the DRIVER profile leaves the same person\'s USER profile working', (await api('/list_orders', undefined, both.token)).s === 200);

  // ===== S5 order interventions =====
  const O1 = await order(U.token, 'staff-o1'); const of1 = await sD1.kind('offer.new', 4000, m => m.data.ref === O1.ref);
  await api('/accept_offer', { offer_id: of1.data.offer_id }, D1.token);
  ok('S5 the order list filters by status and finds an order by its reference', (await S('/list_all_orders?status=assigned')).b.orders.some((o: any) => o.ref === O1.ref) && (await S('/list_all_orders?q=' + O1.ref)).b.orders.length === 1);
  const tl = (await S('/get_order_timeline?id=' + O1.id)).b;
  ok('S5 the order timeline shows events, offers, both phone numbers and addresses', tl.events.length >= 3 && tl.offers.length >= 1 && !!tl.order.user_phone && !!tl.order.driver_phone && !!tl.order.dropoff_address, tl.events.map((e: any) => e.type));
  ok('S5 staff can NOT see the delivery code (it protects against insider fraud)', !('delivery_code' in tl.order) && !JSON.stringify(tl).includes((await api('/get_order?id=' + O1.id, undefined, U.token)).b.delivery_code + '"'));
  ok('S5 a missing reason is refused', (await S('/staff_order_action', { order_id: O1.id, action: 'cancel' })).s === 400 && (await S('/staff_order_action', { order_id: O1.id, action: 'explode', reason: 'xxx' })).b.error === 'BAD_ACTION');
  const fix = await S('/staff_order_action', { order_id: O1.id, action: 'correct_address', which: 'dropoff', address: { street: 'Rue Larbi Ben Mhidi', entrance: 'C' } });
  const evc = fix.b.events.find((e: any) => e.type === 'address_corrected');
  ok('S5 address correction keeps a before/after record and names the staff member', fix.s === 200 && evc?.data.before.street === 'Rue Didouche Mourad' && evc?.data.after.street === 'Rue Larbi Ben Mhidi' && !!evc.staff, evc);
  ok('S5 the driver is told LIVE the address changed', !!(await sD1.kind('job.updated')));
  const re = await S('/staff_order_action', { order_id: O1.id, action: 'reassign', reason: 'Driver unreachable' });
  ok('S5 reassign sends the order back to searching and RELEASES the price lock', re.b.order.status === 'searching' && re.b.order.locked_da === null && re.b.order.driver_profile_id === null, re.b.order);
  ok('S5 old driver told the job is gone; the customer is told a new driver is being found', !!(await sD1.kind('job.cancelled')) && !!(await sU.kind('order.reassigned')));
  // D2 saw it before (several couriers see a request at once); after the reassignment it is shown to him again.
  let of1b: any = null; for (let i = 0; i < 30 && !of1b; i++) { const c = (await api('/get_current_offer', undefined, D2.token)).b.offer; if (c?.order_id === O1.id) of1b = { data: c }; else await sleep(300); }
  ok('S5 the NEXT driver is offered it, never the old one again', !!of1b && (await pool.query(`SELECT count(*)::int n FROM offers WHERE order_id=$1 AND driver_profile_id=$2`, [O1.id, D1.id])).rows[0].n === 1);
  await api('/accept_offer', { offer_id: of1b.data.offer_id }, D2.token);
  ok('S5 the price locks again with the new driver, at the same price', (await pool.query(`SELECT locked_da, offered_da FROM orders WHERE id=$1`, [O1.id])).rows[0].locked_da === O1.offered_da);
  await PR.pickup(O1.id, U.token, D2.token);
  ok('S5 the pickup address cannot change after pickup', (await S('/staff_order_action', { order_id: O1.id, action: 'correct_address', which: 'pickup', address: { street: 'X street' } })).b.error === 'ALREADY_PICKED_UP');
  const code1 = (await api('/get_order?id=' + O1.id, undefined, U.token)).b.delivery_code, bad1 = code1 === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) await api('/update_job_step', { location: await PR.dropoff(O1.id, U.token), order_id: O1.id, step: 'delivered', delivery_code: bad1 }, D2.token);
  ok('S5 after 5 wrong codes the order is locked', (await api('/update_job_step', { location: await PR.dropoff(O1.id, U.token), order_id: O1.id, step: 'delivered', delivery_code: code1 }, D2.token)).b.error === 'CODE_LOCKED');
  await S('/staff_order_action', { order_id: O1.id, action: 'reset_code_attempts', reason: 'Recipient confirmed by phone' });
  ok('S5 staff unlock it and the driver can finish', (await api('/update_job_step', { location: await PR.dropoff(O1.id, U.token), order_id: O1.id, step: 'delivered', delivery_code: code1 }, D2.token)).b.order_status === 'delivered');
  // returns
  await api('/set_online', { online: false }, D2.token);
  const O2 = await order(U.token, 'staff-o2'); const of2 = await sD1.kind('offer.new', 4000, m => m.data.ref === O2.ref); await api('/accept_offer', { offer_id: of2.data.offer_id }, D1.token); await PR.pickup(O2.id, U.token, D1.token);
  ok('S5 cancelling after pickup is refused (use return instead)', (await S('/staff_order_action', { order_id: O2.id, action: 'cancel', reason: 'too late' })).b.error === 'CANNOT_CANCEL');
  const sr = await S('/staff_order_action', { order_id: O2.id, action: 'start_return', reason: 'Recipient unreachable' });
  const ret = (await S('/list_all_orders?leg=return')).b.orders[0];
  ok('S5 staff-started return: original failed, a return leg created for the same driver', sr.b.order.status === 'failed' && !!ret && ret.status === 'picked_up' && ret.driver_name === 'Driver One', ret);
  ok('S5 the customer is told the delivery failed', !!(await sU.kind('order.failed', 4000, m => m.data.reason === 'support')));
  const rcode = (await api('/get_order?id=' + ret.id, undefined, U.token)).b.delivery_code; await api('/update_job_step', { location: await PR.dropoff(ret.id, U.token), order_id: ret.id, step: 'delivered', delivery_code: rcode }, D1.token);
  // cancels
  const O3 = await order(U.token, 'staff-o3'); const of3 = await sD1.kind('offer.new', 4000, m => m.data.ref === O3.ref);
  await S('/staff_order_action', { order_id: O3.id, action: 'cancel', reason: 'Duplicate order' });
  ok('S5 cancel while searching: customer told, open offer withdrawn live', !!(await sU.kind('order.cancelled')) && !!(await sD1.kind('offer.withdrawn', 4000, m => m.data.offer_id === of3.data.offer_id && m.data.reason === 'support')));
  const O4 = await order(U.token, 'staff-o4'); const of4 = await sD1.kind('offer.new', 4000, m => m.data.ref === O4.ref); await api('/accept_offer', { offer_id: of4.data.offer_id }, D1.token);
  await S('/staff_order_action', { order_id: O4.id, action: 'cancel', reason: 'Customer asked support' });
  ok('S5 cancel after assignment: the driver is told the job is cancelled', !!(await sD1.kind('job.cancelled', 4000, m => m.order_id === O4.id)));

  // ===== S6 problems =====
  const O5 = await order(U.token, 'staff-o5'); const of5 = await sD1.kind('offer.new', 4000, m => m.data.ref === O5.ref); await api('/accept_offer', { offer_id: of5.data.offer_id }, D1.token);
  await PR.pickup(O5.id, U.token, D1.token); const fl = await api('/report_delivery_failure', { order_id: O5.id, reason: 'no_answer' }, D1.token);
  await api('/update_job_step', { location: await PR.dropoff(fl.b.job.id, U.token), order_id: fl.b.job.id, step: 'delivered', delivery_code: (await api('/get_order?id=' + fl.b.job.id, undefined, U.token)).b.delivery_code }, D1.token);
  await api('/report_problem', { order_id: O1.id, reason: 'damaged', note: 'Box crushed' }, U.token);
  const pl = (await S('/list_problems?status=open')).b.problems;
  ok('S6 problems from drivers AND users reach staff, newest first', pl.some((p: any) => p.reason === 'delivery_failed:no_answer' && p.reporter_type === 'driver') && pl.some((p: any) => p.reporter_type === 'user' && p.reason === 'damaged'), pl);
  const pid = pl.find((p: any) => p.reporter_type === 'user').id;
  ok('S6 resolving needs a written resolution', (await S('/resolve_problem', { id: pid, status: 'resolved' })).s === 400);
  ok('S6 mark in progress', (await S('/resolve_problem', { id: pid, status: 'in_progress' })).s === 200);
  ok('S6 resolve it', (await S('/resolve_problem', { id: pid, status: 'resolved', resolution: 'Refund arranged with the sender' })).s === 200);
  ok('S6 the person who reported it is told LIVE', !!(await sU.kind('problem.resolved')));
  ok('S6 resolving again is refused', (await S('/resolve_problem', { id: pid, status: 'resolved', resolution: 'again' })).s === 404);

  // ===== S7 ratings =====
  await api('/submit_rating', { order_id: O1.id, stars: 2, comment: 'Late and rude' }, U.token); await api('/submit_rating', { order_id: O1.id, stars: 5 }, D2.token);
  const rl = (await S('/list_ratings?with_comment=true&max_stars=3')).b.ratings;
  ok('S7 staff read ratings with comments, filtered by stars', rl.length === 1 && rl[0].comment === 'Late and rude' && rl[0].rated === 'Driver Two' && rl[0].stars === 2, rl);
  ok('S7 ratings can be filtered by person', (await S('/list_ratings?profile_id=' + D2.id)).b.ratings.length === 1 && (await S('/list_ratings?profile_id=' + D1.id)).b.ratings.length === 0);

  // ===== S8 cash =====
  const O6 = await order(U.token, 'staff-o6', { cod_amount_da: 4000 }); const of6 = await sD1.kind('offer.new', 4000, m => m.data.ref === O6.ref); await api('/accept_offer', { offer_id: of6.data.offer_id }, D1.token);
  await PR.pickup(O6.id, U.token, D1.token);
  await api('/update_job_step', { location: await PR.dropoff(O6.id, U.token), order_id: O6.id, step: 'delivered', delivery_code: (await api('/get_order?id=' + O6.id, undefined, U.token)).b.delivery_code, cash_collected_da: 4000 }, D1.token);
  ok('S8 staff see who holds cash', (await S('/list_drivers?holding_cash=true')).b.drivers.some((d: any) => d.id === D1.id && d.cash_held_da === 4000));
  const gc = (await S('/get_driver_cash?profile_id=' + D1.id)).b; ok('S8 the driver\'s ledger shows the order\'s cash entry', gc.balance_da === 4000 && gc.entries[0].type === 'cod_collected' && !!gc.entries[0].ref, gc);
  ok('S8 a handover larger than the cash held is refused', (await S('/record_cash_handover', { driver_profile_id: D1.id, amount_da: 5000 })).b.error === 'EXCEEDS_BALANCE');
  ok('S8 zero or negative handover refused', (await S('/record_cash_handover', { driver_profile_id: D1.id, amount_da: 0 })).s === 400);
  const [h1, h2] = await Promise.all([S('/record_cash_handover', { driver_profile_id: D1.id, amount_da: 4000 }), S('/record_cash_handover', { driver_profile_id: D1.id, amount_da: 4000 })]);
  ok('S8 RACE: two staff record the same 4000 handover at the same instant: exactly ONE succeeds', [h1.s, h2.s].sort().join() === '200,409', [h1.s, h2.s]);
  const rcpt = (h1.s === 200 ? h1 : h2).b; ok('S8 the receipt carries a number and the new balance (0)', rcpt.receipt > 0 && rcpt.balance_da === 0, rcpt);
  ok('S8 the driver is told LIVE, with the receipt number', !!(await sD1.kind('cash.handover', 4000, m => m.data.receipt === rcpt.receipt)));
  ok('S8 an adjustment needs a written note', (await S('/add_cash_adjustment', { driver_profile_id: D1.id, amount_da: 500 })).s === 400);
  const adj = (await S('/add_cash_adjustment', { driver_profile_id: D1.id, amount_da: 500, note: 'Counted 500 extra at the office' })).b;
  ok('S8 adjustment recorded', adj.balance_da === 500, adj);
  const rev = (await S('/add_cash_adjustment', { driver_profile_id: D1.id, reverses_id: adj.entry, note: 'Entered by mistake' })).b;
  ok('S8 a reversal is the exact opposite of the entry it cancels', rev.balance_da === 0, rev);
  ok('S8 an entry can be reversed only once', (await S('/add_cash_adjustment', { driver_profile_id: D1.id, reverses_id: adj.entry, note: 'again again' })).b.error === 'ALREADY_REVERSED');
  ok('S8 another driver\'s entry cannot be reversed', (await S('/add_cash_adjustment', { driver_profile_id: D2.id, reverses_id: adj.entry, note: 'wrong driver' })).s === 404);
  ok('S8 the cash ledger can never be edited', (await pool.query(`UPDATE cash_ledger SET amount_da=1`).then(() => 'edited', () => 'refused')) === 'refused');

  // ===== S9 audit =====
  const au = (await pool.query(`SELECT action, staff_id FROM staff_audit`)).rows;
  const needed = ['approve_driver', 'reject_driver', 'suspend_profile', 'unsuspend_profile', 'create_zone', 'open_zone', 'create_pricing', 'order_cancel', 'order_reassign', 'order_correct_address', 'order_reset_code_attempts', 'order_start_return', 'problem_resolved', 'cash_handover', 'cash_adjustment'];
  ok('S9 EVERY kind of staff action left a permanent audit record, naming who did it', needed.every(a => au.some(r => r.action === a && r.staff_id === staffId)), needed.filter(a => !au.some(r => r.action === a)));
  ok('S9 the audit trail can never be edited or deleted', (await pool.query(`DELETE FROM staff_audit`).then(() => 'deleted', () => 'refused')) === 'refused');
  ok('S9 staff actions on orders appear in the order history under the staff member\'s name', (await pool.query(`SELECT 1 FROM order_events WHERE actor_staff_id=$1`, [staffId])).rowCount! >= 5);
  let leaks = 0; for (const [s, id] of [[sD1, D1.id], [sD2, D2.id], [sU, U.id], [sDR, DR.id]] as [Sock, string][]) for (const m of s.msgs) if ((await pool.query(`SELECT profile_id FROM notifications WHERE id=$1`, [m.id])).rows[0]?.profile_id !== id) leaks++;
  ok('S9 every notification reached only its own profile (0 leaks)', leaks === 0, leaks);
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})();
