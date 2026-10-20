import { Pool } from 'pg';
import { driverDocs, upload, PHOTO } from './docs';
import { proof } from './proof';
const B = 'http://localhost:3399';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('Tests need TEST_DATABASE_URL pointing to a separate test database, never the real one');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
async function api(path: string, body?: any, token?: string, headers: any = {}) {
  const r = await fetch(B + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 15000): Promise<T | null> { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v as T; await sleep(300); } return null; }

async function login(phone: string, path: 'user' | 'driver') { await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code; return (await api('/verify_code', { phone, code: c, path })).b; }
async function makeUser(phone: string, name: string) { const l = await login(phone, 'user'); return (await api('/add_profile', { accept_rules: true, type: 'user', display_name: name }, l.token)).b.token as string; }
async function makeDriver(phone: string, name: string, lat: number, lng: number, vehicle = 'motorbike', limit: number | null = null) {
  const l = await login(phone, 'driver');
  const r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: name, documents: await driverDocs(B, l.token, vehicle) }, l.token);
  const id = r.b.active_profile.id;
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [id]);
  await pool.query(`UPDATE driver_details SET cash_limit_da=$2 WHERE profile_id=$1`, [id, limit]);
  await api('/set_online', { online: true }, r.b.token); await api('/update_location', { lat, lng }, r.b.token);
  return { token: r.b.token as string, id };
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 };
const adr = { street: 'Rue Didouche Mourad', entrance: 'B', floor: '2' };
// Creates an order and (unless confirm=false) lets the receiver say yes through the tracking link, as in real life.
// auto_accept is on by default here: the first courier who accepts the customer's price gets the job (the offers flow has its own tests).
async function order(tok: string, key: string, extra: any = {}, size = 'small', offered?: number, confirm = true) {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size }, tok)).b;
  const r = await api('/create_order', { quote_id: q.quote_id, offered_da: offered ?? q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000000', payer: 'sender', auto_accept: true, ...extra }, tok, { 'idempotency-key': key });
  if (r.s !== 200 || !confirm || r.b.status !== 'awaiting_recipient') return r;
  await api('/track_confirm', { t: r.b.tracking_token });
  return api('/get_order?id=' + r.b.id, undefined, tok);
}
const offerFor = (t: string) => until(async () => (await api('/get_current_offer', undefined, t)).b.offer);

// A stand-in for the place search service (Photon-compatible), so the test does not depend on the internet.
let lastSearch: any = null;
require('http').createServer((req: any, res: any) => {
  const u = new URL(req.url, 'http://x'); const q = u.searchParams.get('q'); lastSearch = u.searchParams;
  if (u.pathname === '/reverse') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ features: u.searchParams.get('lat') === '1' ? [] : [{ geometry: { coordinates: [3.0588, 36.7538] }, properties: { name: 'Rue Didouche Mourad', city: 'Alger' } }] })); return; }
  if (q === 'fail') { res.writeHead(500); res.end('down'); return; }
  const features = q === 'broken' ? [{ geometry: { coordinates: ['x', 1] }, properties: { name: 'Bad' } }, { geometry: { coordinates: [3, 36] }, properties: {} }]
    : [{ geometry: { coordinates: [3.0617, 36.7856] }, properties: { name: 'Place des Martyrs', street: 'Rue Bab Azoun', district: 'Casbah', city: 'Alger' } }];
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'FeatureCollection', features }));
}).listen(5056, '127.0.0.1');

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, orders, driver_details, profiles, accounts, zones, pricing_rules RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-algiers', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
  const A = await makeUser('+213550100001', 'Amina Seller');
  const D1 = await makeDriver('+213550200001', 'Driver One', 36.7585, 3.0588, 'motorbike', 100000);   // ~0.5 km
  const D2 = await makeDriver('+213550200002', 'Driver Two', 36.7628, 3.0588, 'motorbike', null);     // ~1 km
  const D3 = await makeDriver('+213550200003', 'Driver Three', 36.7990, 3.0588, 'motorbike', null);   // ~5 km (outside first radius)
  // Amina is ALSO a driver (second profile on the same number), online right at the pickup point
  const lA = await login('+213550100001', 'user'); const selfD = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Amina Driver', documents: await driverDocs(B, lA.token) }, lA.token);
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [selfD.b.active_profile.id]);
  await api('/set_online', { online: true }, selfD.b.token); await api('/update_location', P, selfD.b.token);

  // T1 roles
  ok('T1 driver token refused on a user function', (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, D1.token)).b.error === 'WRONG_PROFILE');
  ok('T1 user token refused on a driver function', (await api('/get_job', undefined, A)).b.error === 'WRONG_PROFILE');
  // T2 quote
  ok('T2 outside the open zone is refused', (await api('/get_quote', { pickup: { lat: 35.69, lng: -0.63 }, dropoff: D, size: 'small' }, A)).b.error === 'ZONE_CLOSED');
  const q1 = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, A)).b, q2 = (await api('/get_quote', { pickup: P, dropoff: D, size: 'large' }, A)).b;
  ok('T2 small parcel -> motorbike, large -> car', q1.vehicle === 'motorbike' && q2.vehicle === 'car', [q1, q2]);
  ok('T3 price range is consistent and in round 10s', q1.min_da <= q1.recommended_da && q1.recommended_da <= q1.max_da && q1.recommended_da % 10 === 0 && q2.recommended_da > q1.recommended_da, q1);
  // T4 validation
  let r = await order(A, 'k', {}); ok('T4 missing/short idempotency key refused', r.b.error === 'IDEMPOTENCY_KEY_REQUIRED');
  r = await order(A, 'test-key-bad1', {}, 'small', 5); ok('T4 price below the allowed minimum refused', r.b.error === 'PRICE_OUT_OF_RANGE');
  r = await order(A, 'test-key-bad2', { recipient_phone: '0770' }); ok('T4 bad recipient phone refused', r.b.error === 'BAD_RECIPIENT_PHONE');
  r = await order(A, 'test-key-bad3', { pickup_address: { floor: '2' } }); ok('T4 address without street or landmark refused', r.b.error === 'BAD_ADDRESS');
  // T5 create + idempotency
  r = await order(A, 'test-key-001'); const o1 = r.b;
  ok('T5 order created; after the receiver\'s yes it is searching; 4-digit code', r.s === 200 && o1.status === 'searching' && /^\d{4}$/.test(o1.delivery_code), r.b);
  ok('T5 same key again returns the SAME order, no duplicate', (await order(A, 'test-key-001')).b.id === o1.id && (await pool.query(`SELECT 1 FROM orders`)).rowCount === 1);
  // T6/T7 matching chain: nearest first, decline -> next, expiry -> widen radius, never the same account
  const of1 = await offerFor(D1.token); ok('T6 the nearest couriers (D1) see the request', !!of1 && of1.price_da === o1.offered_da && of1.pickup_distance_m < 1000, of1);
  ok('T6 a request hides the receiver\'s details and the drop-off address until the job is taken', !!of1 && !('recipient_phone' in of1) && of1.dropoff_address === undefined);
  const of2 = await offerFor(D2.token); ok('T6 several nearby couriers see it AT ONCE (inDrive style): D2 too', !!of2 && of2.order_id === o1.id);
  ok('T7 D3 (5 km away) does not see it while the radius is small', (await api('/get_current_offer', undefined, D3.token)).b.offer === null);
  ok('T7 "not for me" removes it from D1\'s list', (await api('/decline_offer', { offer_id: of1.offer_id }, D1.token)).s === 200 && (await api('/list_requests', undefined, D1.token)).b.requests.length === 0);
  const of3 = await offerFor(D3.token); ok('T7 after a while the radius widens and D3 sees it', !!of3);
  const selfOffers = await pool.query(`SELECT 1 FROM offers WHERE driver_profile_id=$1`, [selfD.b.active_profile.id]);
  ok('T7 the seller\'s own driver profile (same phone, at the pickup point) NEVER sees the order', selfOffers.rowCount === 0);
  // T8 accept
  const acc = await api('/accept_offer', { offer_id: of3.offer_id }, D3.token);
  ok('T8 D3 accepts the customer\'s price (auto-accept on): the job is his, with the receiver\'s details', acc.s === 200 && acc.b.job?.status === 'assigned' && acc.b.job.recipient_phone === '+213770000000', acc.b);
  ok('T8 second accept of same offer refused', (await api('/accept_offer', { offer_id: of3.offer_id }, D3.token)).s === 409);
  ok('T8 the other couriers lose the request at once', (await api('/list_requests', undefined, D2.token)).b.requests.length === 0);
  const g = (await api('/get_order?id=' + o1.id, undefined, A)).b;
  ok('T8 user sees driver, price LOCKED at the offered price', g.status === 'assigned' && g.locked_da === o1.offered_da && g.driver?.name === 'Driver Three', g);
  ok('T8 price can no longer be raised', (await api('/raise_price', { order_id: o1.id, new_offered_da: o1.max_da }, A)).b.error === 'PRICE_LOCKED');
  // T9 steps
  const PR = proof(api, async t => (await upload(B, t, 'parcel_photo')).b.document_id);
  const L1 = await PR.dropoff(o1.id, A);
  const step = (t: string, body: any) => api('/update_job_step', { order_id: o1.id, location: L1, ...body }, t);
  ok('T9 delivering before pickup refused', (await step(D3.token, { step: 'delivered', delivery_code: g.delivery_code })).b.error === 'WRONG_STEP');
  ok('T9 picked_up works with the sender\'s pickup code, a parcel photo and the position', (await PR.pickup(o1.id, A, D3.token)).b.order_status === 'picked_up');
  ok('T9 resending picked_up (offline retry) is a harmless success', (await PR.pickup(o1.id, A, D3.token)).b.again === true);
  ok('T9 wrong delivery code refused', (await step(D3.token, { step: 'delivered', delivery_code: g.delivery_code === '0000' ? '1111' : '0000' })).b.error === 'CODE_WRONG');
  ok('T9 correct code delivers', (await step(D3.token, { step: 'delivered', delivery_code: g.delivery_code })).b.order_status === 'delivered');
  // T10 ratings
  ok('T10 driver rates the user', (await api('/submit_rating', { order_id: o1.id, stars: 5, comment: 'clear instructions' }, D3.token)).s === 200);
  ok('T10 user rates the driver', (await api('/submit_rating', { order_id: o1.id, stars: 4 }, A)).s === 200);
  ok('T10 rating twice refused', (await api('/submit_rating', { order_id: o1.id, stars: 1 }, A)).s === 409);
  ok('T10 stranger cannot rate this order', (await api('/submit_rating', { order_id: o1.id, stars: 1 }, D1.token)).s === 404);
  ok('T10 driver sees own average and earnings', (await api('/get_driver_home', undefined, D3.token)).b.rating === '4.00' && (await api('/get_driver_home', undefined, D3.token)).b.earnings_today_da === o1.offered_da);
  // T11 cash on delivery: only D1 qualifies (D2/D3 have no cash limit)
  r = await order(A, 'test-key-cod1', { cod_amount_da: 5000, payer: 'recipient' }); const o2 = r.b;
  const c1 = await offerFor(D1.token); ok('T11 COD order goes only to the driver with a cash limit', !!c1 && (await api('/get_current_offer', undefined, D2.token)).b.offer === null);
  const acc2 = await api('/accept_offer', { offer_id: c1.offer_id }, D1.token);
  ok('T11 job shows cash to collect = goods + fee (recipient pays fee)', acc2.b.job?.cash_to_collect_da === 5000 + o2.offered_da, acc2.b.job);
  const L2 = await PR.dropoff(o2.id, A);
  const st2 = (t: string, body: any) => api('/update_job_step', { order_id: o2.id, location: L2, ...body }, t);
  await PR.pickup(o2.id, A, D1.token);
  const code2 = (await api('/get_order?id=' + o2.id, undefined, A)).b.delivery_code;
  ok('T11 wrong cash amount refused', (await st2(D1.token, { step: 'delivered', delivery_code: code2, cash_collected_da: 5000 })).b.error === 'CASH_MISMATCH');
  ok('T11 correct cash delivers', (await st2(D1.token, { step: 'delivered', delivery_code: code2, cash_collected_da: 5000 + o2.offered_da })).b.order_status === 'delivered');
  const cb = (await api('/get_cash_balance', undefined, D1.token)).b;
  ok('T11 ledger holds ONLY the goods money (5000), one entry', cb.balance_da === 5000 && cb.entries.length === 1 && cb.entries[0].type === 'cod_collected', cb);
  // T12 cash limit exceeded -> nobody offered; price negotiation while searching; cancel
  await pool.query(`UPDATE driver_details SET cash_limit_da=6000 WHERE profile_id=$1`, [D1.id]);
  r = await order(A, 'test-key-cod2', { cod_amount_da: 5000 }); const o3 = r.b; await sleep(1500);
  ok('T12 driver whose cash would exceed the limit is not offered', (await api('/get_current_offer', undefined, D1.token)).b.offer === null && (await pool.query(`SELECT 1 FROM offers WHERE order_id=$1 AND driver_profile_id=$2`, [o3.id, D1.id])).rowCount === 0);
  const up = await api('/raise_price', { order_id: o3.id, new_offered_da: o3.offered_da + 10 }, A);
  ok('T12 user raises the price while searching', up.s === 200 && up.b.offered_da === o3.offered_da + 10, up.b);
  ok('T12 lowering or exceeding the maximum is refused', (await api('/raise_price', { order_id: o3.id, new_offered_da: o3.offered_da }, A)).s === 400 && (await api('/raise_price', { order_id: o3.id, new_offered_da: o3.max_da + 10 }, A)).s === 400);
  ok('T12 user cancels while searching', (await api('/cancel_order', { order_id: o3.id, reason: 'changed my mind' }, A)).b.status === 'cancelled');
  // T13 failed delivery -> return leg
  r = await order(A, 'test-key-fail'); const o4 = r.b; await pool.query(`UPDATE driver_details SET cash_limit_da=100000 WHERE profile_id=$1`, [D1.id]);
  const f1 = await offerFor(D1.token); await api('/accept_offer', { offer_id: f1.offer_id }, D1.token);
  await PR.pickup(o4.id, A, D1.token);
  ok('T13 user cannot cancel after pickup', (await api('/cancel_order', { order_id: o4.id }, A)).b.error === 'CANNOT_CANCEL');
  const fr = await api('/report_delivery_failure', { order_id: o4.id, reason: 'refused_changed_mind' }, D1.token);
  ok('T13 failure creates a RETURN leg, already picked up', fr.b.job?.leg === 'return' && fr.b.job.status === 'picked_up' && fr.b.job.cash_to_collect_da === 0, fr.b);
  ok('T13 original is failed and staff got a problem report', (await api('/get_order?id=' + o4.id, undefined, A)).b.status === 'failed' && (await pool.query(`SELECT 1 FROM problem_reports WHERE order_id=$1 AND reason='delivery_failed:refused_changed_mind'`, [o4.id])).rowCount === 1);
  const retId = fr.b.job.id, retCode = (await api('/get_order?id=' + retId, undefined, A)).b.delivery_code;
  ok('T13 sender sees the return leg and its code', /^\d{4}$/.test(retCode));
  ok('T13 return delivered with the sender\'s code, no cash entry', (await PR.deliver(retId, A, D1.token)).b.order_status === 'delivered' && (await api('/get_cash_balance', undefined, D1.token)).b.balance_da === 5000);
  ok('T13 return legs are not rated', (await api('/submit_rating', { order_id: retId, stars: 5 }, A)).s === 400);
  // T14 guessing the delivery code is blocked
  r = await order(A, 'test-key-lock'); const o5 = r.b; const l1 = await offerFor(D1.token); await api('/accept_offer', { offer_id: l1.offer_id }, D1.token);
  await PR.pickup(o5.id, A, D1.token); const L5 = await PR.dropoff(o5.id, A);
  const realCode = (await api('/get_order?id=' + o5.id, undefined, A)).b.delivery_code; const wrong = realCode === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) await api('/update_job_step', { order_id: o5.id, step: 'delivered', delivery_code: wrong, location: L5 }, D1.token);
  ok('T14 after 5 wrong codes even the RIGHT code is refused (locked for staff)', (await api('/update_job_step', { order_id: o5.id, step: 'delivered', delivery_code: realCode, location: L5 }, D1.token)).b.error === 'CODE_LOCKED');
  ok('T14 a driver cannot go offline while on a job', (await api('/set_online', { online: false }, D1.token)).b.error === 'ON_JOB');
  // T15 nobody available -> order expires
  await pool.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [o5.id]);
  // ===== P: proof chain (TRUST_AND_SAFETY.md): pickup code + parcel photo + positions, refusals, give-back, call-back, tracking link =====
  {
    const photo = async (t: string, kind = 'parcel_photo') => (await upload(B, t, kind)).b.document_id as string;
    const take = async (key: string, extra: any = {}) => { const o = (await order(A, key, extra)).b; const f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token); return o; };
    let o = (await order(A, 'proof-key-a', { inspection: 'open' })).b;
    ok('P1 the sender sees a pickup code (different from the delivery code) and a tracking link', /^\d{4}$/.test(o.pickup_code) && o.pickup_code !== o.delivery_code && /^[A-Za-z0-9_-]{32}$/.test(o.tracking_token), o);
    ok('P1 the inspection choice is kept ("may open before paying")', o.inspection === 'open');
    ok('P1 an unknown inspection choice is refused', (await order(A, 'proof-key-bad', { inspection: 'x' })).b.error === 'BAD_INSPECTION');
    const f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
    const job = (await api('/get_job', undefined, D1.token)).b.job;
    ok('P2 the driver never sees the pickup code or the delivery code', !('pickup_code' in job) && !('delivery_code' in job) && job.needs_pickup_code === true && job.inspection === 'open', job);
    const sv = (await api('/get_order?id=' + o.id, undefined, A)).b, at = { lat: sv.pickup_lat, lng: sv.pickup_lng };
    const st = (body: any) => api('/update_job_step', { order_id: o.id, step: 'picked_up', ...body }, D1.token);
    ok('P3 pickup without the phone\'s position is refused', (await st({ pickup_code: sv.pickup_code, parcel_photo: await photo(D1.token) })).b.error === 'BAD_POINT');
    ok('P3 pickup with a wrong pickup code is refused', (await st({ pickup_code: sv.pickup_code === '0000' ? '1111' : '0000', parcel_photo: await photo(D1.token), location: at })).b.error === 'PICKUP_CODE_WRONG');
    ok('P3 pickup without a parcel photo is refused', (await st({ pickup_code: sv.pickup_code, location: at })).b.error === 'PHOTO_REQUIRED');
    ok('P3 a photo taken by someone else is refused', (await st({ pickup_code: sv.pickup_code, location: at, parcel_photo: await photo(D2.token) })).b.error === 'BAD_DOCUMENT');
    ok('P3 a photo of another kind (ID card) is refused', (await st({ pickup_code: sv.pickup_code, location: at, parcel_photo: await photo(D1.token, 'id_photo') })).b.error === 'BAD_DOCUMENT');
    const ph = await photo(D1.token);
    ok('P3 with the sender\'s code, a parcel photo and the position, the parcel is picked up', (await st({ pickup_code: sv.pickup_code, location: at, parcel_photo: ph })).b.order_status === 'picked_up');
    let v = (await api('/get_order?id=' + o.id, undefined, A)).b;
    ok('P3 the sender sees the parcel photo id and the pickup position check (0 m)', v.pickup_photo_doc === ph && v.pickup_distance_m === 0 && v.history.some((e: any) => e.type === 'picked_up'), v);
    const pr = await fetch(`${B}/get_order_photo?order_id=${o.id}&id=${ph}`, { headers: { authorization: 'Bearer ' + A } });
    ok('P3 the sender can look at the parcel photo', pr.status === 200 && pr.headers.get('content-type') === 'image/jpeg' && (await pr.arrayBuffer()).byteLength > 1000);
    ok('P3 the photo is attached for good (it cannot be reused for another order)', (await pool.query(`SELECT order_id FROM documents WHERE id=$1`, [ph])).rows[0].order_id === o.id);
    // tracking page data while on the way
    const T = sv.tracking_token;
    await api('/update_location', { lat: 36.756, lng: 3.06 }, D1.token);
    let td = (await api('/track_data?t=' + T)).b;
    ok('P10 the receiver\'s link shows status, amount, code, driver first name and phone (on the way), time left', td.status === 'picked_up' && td.delivery_code === sv.delivery_code && td.driver?.first_name === 'Driver' && /^\+213/.test(td.driver.phone) && typeof td.eta_s === 'number' && td.has_parcel_photo === true && td.inspection === 'open', td);
    ok('P10 the link never shows the pickup code, the sender\'s phone or internal ids', !('pickup_code' in td) && !JSON.stringify(td).includes('+213550100001') && !('id' in td) && !JSON.stringify(td).includes(o.id), td);
    const qr = await fetch(`${B}/track_qr?t=${T}`);
    ok('P10 the QR code is an image (SVG) that cannot run scripts', qr.status === 200 && qr.headers.get('content-type') === 'image/svg+xml' && (await qr.text()).startsWith('<svg') && /default-src 'none'/.test(qr.headers.get('content-security-policy') ?? ''));
    ok('P10 the parcel photo is visible on the link', (await fetch(`${B}/track_photo?t=${T}`)).headers.get('content-type') === 'image/jpeg');
    ok('P10 the receiver\'s yes already counts as "I am expecting it"; pressing it again records nothing new', (await api('/track_expecting', { t: T })).b.expecting === true && (await pool.query(`SELECT count(*)::int n FROM order_events WHERE order_id=$1 AND type IN ('recipient_expecting','recipient_confirmed')`, [o.id])).rows[0].n === 1);
    ok('P10 ...and the sender was told when the receiver said yes', (await pool.query(`SELECT 1 FROM notifications WHERE type='order.recipient_confirmed' AND order_id=$1`, [o.id])).rowCount === 1);
    const rp = await api('/track_report', { t: T, reason: 'damaged', note: 'box is wet' });
    ok('P10 the receiver can report a problem without an account', rp.s === 200 && (await pool.query(`SELECT reporter_kind FROM problem_reports WHERE id=$1`, [rp.b.id])).rows[0].reporter_kind === 'recipient');
    await api('/track_report', { t: T, reason: 'other' }); await api('/track_report', { t: T, reason: 'other' });
    ok('P10 at most 3 reports per order from the link', (await api('/track_report', { t: T, reason: 'other' })).b.error === 'TOO_MANY_REPORTS');
    ok('P10 an unknown reason is refused', (await api('/track_report', { t: T, reason: 'refund_me' })).b.error === 'BAD_REASON');
    const page = await fetch(`${B}/t/${T}`);
    ok('P10 the tracking page opens, with a strict content policy', page.status === 200 && (await page.text()).includes('track.js') && /script-src 'self'/.test(page.headers.get('content-security-policy') ?? ''));
    // delivered far from the drop-off: allowed (GPS can be wrong) but flagged for staff
    const far = await api('/update_job_step', { order_id: o.id, step: 'delivered', delivery_code: sv.delivery_code, location: { lat: 36.7990, lng: 3.0588 } }, D1.token);
    ok('P5 a delivery confirmed far away still completes...', far.b.order_status === 'delivered');
    ok('P5 ...but staff get a case and the history shows the distance', (await pool.query(`SELECT 1 FROM problem_reports WHERE order_id=$1 AND reporter_kind='system' AND reason='check:far_from_dropoff'`, [o.id])).rowCount === 1 && (await api('/get_order?id=' + o.id, undefined, A)).b.history.some((e: any) => e.type === 'flag_far_away' && e.data.distance_m > 1000));
    td = (await api('/track_data?t=' + T)).b;
    ok('P10 after delivery the code is no longer shown on the link', td.status === 'delivered' && td.delivery_code === null && td.driver === null, td);
    await pool.query(`UPDATE orders SET ended_at = now() - interval '25 hours' WHERE id=$1`, [o.id]);
    ok('P10 the link ends 24 hours after the order ends', (await api('/track_data?t=' + T)).b.error === 'LINK_ENDED' && (await fetch(`${B}/track_photo?t=${T}`)).status === 404);
    // P4: guessing the pickup code is blocked
    o = await take('proof-key-lock'); const sv4 = (await api('/get_order?id=' + o.id, undefined, A)).b; const w4 = sv4.pickup_code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) await api('/update_job_step', { order_id: o.id, step: 'picked_up', pickup_code: w4, parcel_photo: await photo(D1.token), location: { lat: sv4.pickup_lat, lng: sv4.pickup_lng } }, D1.token);
    ok('P4 after 5 wrong pickup codes even the right one is refused (staff only)', (await api('/update_job_step', { order_id: o.id, step: 'picked_up', pickup_code: sv4.pickup_code, parcel_photo: await photo(D1.token), location: { lat: sv4.pickup_lat, lng: sv4.pickup_lng } }, D1.token)).b.error === 'PICKUP_LOCKED');
    // P7: the driver gives the job back before pickup -> searching again, never offered to him again
    ok('P7 a reason is required to give a job back', (await api('/release_job', { order_id: o.id, reason: 'bored' }, D1.token)).b.error === 'BAD_REASON');
    ok('P7 refusing "unsafe or prohibited" goods needs a photo', (await api('/release_job', { order_id: o.id, reason: 'unsafe_or_prohibited' }, D1.token)).b.error === 'PHOTO_REQUIRED');
    const rel = await api('/release_job', { order_id: o.id, reason: 'vehicle_problem', note: 'flat tyre' }, D1.token);
    v = (await api('/get_order?id=' + o.id, undefined, A)).b;
    ok('P7 the job goes back to searching at the same offered price, price lock released', rel.s === 200 && v.status === 'searching' && v.locked_da === null && v.driver === null && v.history.some((e: any) => e.type === 'released_by_driver' && e.data.reason === 'vehicle_problem'), v);
    ok('P7 the sender is told', (await pool.query(`SELECT 1 FROM notifications WHERE type='order.driver_released' AND order_id=$1`, [o.id])).rowCount === 1);
    const next = await offerFor(D2.token);
    ok('P7 the next driver is offered it, never the one who gave it back', !!next && next.order_id === o.id && (await pool.query(`SELECT count(*)::int n FROM offers WHERE order_id=$1 AND driver_profile_id=$2`, [o.id, D1.id])).rows[0].n === 1, next);
    await api('/cancel_order', { order_id: o.id }, A);
    // P9: a late cancel is recorded as late
    o = await take('proof-key-late'); await pool.query(`UPDATE orders SET assigned_at = now() - interval '10 minutes' WHERE id=$1`, [o.id]);
    await api('/cancel_order', { order_id: o.id, reason: 'not needed' }, A);
    ok('P9 a cancel long after a driver accepted is recorded as "late"', (await api('/get_order?id=' + o.id, undefined, A)).b.history.some((e: any) => e.type === 'cancelled' && e.data.late === true));
    // P8: the sender calls a parcel back after pickup
    o = await take('proof-key-recall');
    ok('P8 before pickup, calling back is refused (cancel instead)', (await api('/recall_order', { order_id: o.id, reason: 'buyer_cancelled' }, A)).b.error === 'CANNOT_RECALL');
    await PR.pickup(o.id, A, D1.token);
    const rc = await api('/recall_order', { order_id: o.id, reason: 'buyer_cancelled' }, A);
    const back = (await api('/get_job', undefined, D1.token)).b.job;
    ok('P8 after pickup the sender calls it back: the order fails and a return leg goes to the driver at once', rc.b.status === 'failed' && back?.leg === 'return' && back.status === 'picked_up', { rc: rc.b.status, back });
    ok('P8 the driver is alerted (high priority)', (await pool.query(`SELECT priority FROM notifications WHERE type='job.recalled' AND profile_id=$1 ORDER BY id DESC LIMIT 1`, [D1.id])).rows[0]?.priority === 'high');
    await PR.deliver(back.id, A, D1.token);
    // P6: refusal at the door, with evidence
    o = await take('proof-key-refuse'); await PR.pickup(o.id, A, D1.token);
    ok('P6 an unknown refusal reason is refused', (await api('/report_delivery_failure', { order_id: o.id, reason: 'refused' }, D1.token)).b.error === 'BAD_REASON');
    ok('P6 "refused: damaged" needs an evidence photo', (await api('/report_delivery_failure', { order_id: o.id, reason: 'refused_damaged' }, D1.token)).b.error === 'PHOTO_REQUIRED');
    const fr6 = await api('/report_delivery_failure', { order_id: o.id, reason: 'refused_damaged', evidence_photo: await photo(D1.token, 'evidence_photo'), note: 'corner crushed' }, D1.token);
    v = (await api('/get_order?id=' + o.id, undefined, A)).b;
    ok('P6 with the photo: the parcel goes back to the sender, he sees the reason and the photo', fr6.b.job?.leg === 'return' && v.status === 'failed' && v.evidence_photos.length === 1 && v.history.some((e: any) => e.type === 'delivery_failed' && e.data.reason === 'refused_damaged'), v);
    await PR.deliver(fr6.b.job.id, A, D1.token);
    // P11: what the sender learns about a receiver number
    const h = (await api('/recipient_history?phone=' + encodeURIComponent('+213770000000'), undefined, A)).b;
    ok('P11 the sender sees how parcels to a number ended (counts only)', h.delivered >= 1 && h.refused >= 2 && Object.keys(h).sort().join() === 'delivered,no_answer,refused', h);
    ok('P11 a badly written number is refused', (await api('/recipient_history?phone=0550', undefined, A)).b.error === 'BAD_PHONE');
  }
  // ===== R: the receiver says yes BEFORE any courier is searched (owner's wish, Oct 2026) =====
  {
    const R = await makeUser('+213770000000', 'Amine Receiver');   // the receiver also has the app, with a VERIFIED number
    let r = await order(A, 'recv-key-1', {}, 'small', undefined, false); const o = r.b;
    ok('R1 a new order waits for the receiver: status awaiting_recipient, a deadline, no courier told', o.status === 'awaiting_recipient' && !!o.recipient_deadline_at && o.couriers_notified === 0, o);
    await sleep(1500);
    ok('R1 no courier sees it while the receiver has not answered', (await pool.query(`SELECT 1 FROM offers WHERE order_id=$1`, [o.id])).rowCount === 0);
    const inc = (await pool.query(`SELECT data FROM notifications WHERE type='order.incoming' AND order_id=$1`, [o.id])).rows[0]?.data;
    ok('R2 a receiver whose VERIFIED number matches gets an in-app request with the link key and the sender\'s first name', inc?.t === o.tracking_token && inc?.sender === 'Amina', inc);
    let td = (await api('/track_data?t=' + o.tracking_token)).b;
    ok('R3 the receiver\'s page shows the request, the size and pickup area, but NOT the delivery code yet', td.status === 'awaiting_recipient' && td.delivery_code === null && td.size === 'small' && td.pickup_area === 'Rue Didouche Mourad', td);
    ok('R4 a bad link key is refused', (await api('/track_confirm', { t: 'x' })).b.error === 'BAD_LINK' && (await api('/track_confirm', { t: 'A'.repeat(32) })).b.error === 'LINK_ENDED');
    const c = await api('/track_confirm', { t: o.tracking_token });
    ok('R5 the receiver confirms: the order starts searching', c.s === 200 && c.b.status === 'searching' && (await api('/get_order?id=' + o.id, undefined, A)).b.status === 'searching', c.b);
    ok('R5 confirming twice is harmless', (await api('/track_confirm', { t: o.tracking_token })).b.ok === true);
    ok('R5 the sender is told at once (high priority)', (await pool.query(`SELECT priority FROM notifications WHERE type='order.recipient_confirmed' AND order_id=$1`, [o.id])).rows[0]?.priority === 'high');
    ok('R5 couriers see it right away', !!(await until(async () => (await pool.query(`SELECT 1 FROM offers WHERE order_id=$1`, [o.id])).rowCount)));
    td = (await api('/track_data?t=' + o.tracking_token)).b;
    ok('R5 now the receiver sees the code; "expecting" is recorded too', /^\d{4}$/.test(td.delivery_code) && td.expecting === true && td.recipient_answer === 'confirmed', td);
    ok('R5 declining after saying yes is refused', (await api('/track_decline', { t: o.tracking_token })).b.error === 'ORDER_ENDED');
    await api('/cancel_order', { order_id: o.id }, A);
    r = await order(A, 'recv-key-2', {}, 'small', undefined, false); const o2 = r.b;
    const d = await api('/track_decline', { t: o2.tracking_token, reason: 'not_ordered' });
    const v2 = (await api('/get_order?id=' + o2.id, undefined, A)).b;
    ok('R6 the receiver declines: the request is cancelled before any courier moves', d.b.status === 'cancelled' && v2.status === 'cancelled' && v2.cancel_reason === 'recipient_declined' && v2.history.some((e: any) => e.type === 'recipient_declined' && e.data.reason === 'not_ordered'), v2);
    ok('R6 the sender is told; nobody gets rule points for it', (await pool.query(`SELECT 1 FROM notifications WHERE type='order.recipient_declined' AND order_id=$1`, [o2.id])).rowCount === 1 && (await pool.query(`SELECT 1 FROM violations WHERE order_id=$1`, [o2.id])).rowCount === 0);
    ok('R6 confirming after declining is refused', (await api('/track_confirm', { t: o2.tracking_token })).b.error === 'ORDER_ENDED');
    r = await order(A, 'recv-key-3', {}, 'small', undefined, false);
    ok('R7 the sender may cancel while waiting for the receiver', (await api('/cancel_order', { order_id: r.b.id }, A)).b.status === 'cancelled');
    r = await order(A, 'recv-key-4', {}, 'small', undefined, false);
    await pool.query(`UPDATE orders SET created_at = now() - interval '2 hours' WHERE id=$1`, [r.b.id]);
    const gone = await until(async () => { const x = (await api('/get_order?id=' + r.b.id, undefined, A)).b; return x.status === 'expired' ? x : null; });
    ok('R8 no answer in time: the request expires and the sender is told why', !!gone && gone.history.some((e: any) => e.type === 'expired') && (await pool.query(`SELECT data->>'reason' r FROM notifications WHERE type='order.expired' AND order_id=$1`, [r.b.id])).rows[0]?.r === 'recipient_no_answer', gone);
    ok('R9 the receiver\'s notifications list never shows the delivery code', !JSON.stringify((await api('/list_notifications', undefined, R)).b).includes('delivery_code'));
  }
  // ===== M: couriers answer with a price, the customer chooses (inDrive style) =====
  {
    let r = await order(A, 'bid-key-1', { auto_accept: false }); const o = r.b;
    const seen1 = await until(async () => (await api('/list_requests', undefined, D1.token)).b.requests.find((x: any) => x.order_id === o.id));
    const seen2 = await until(async () => (await api('/list_requests', undefined, D2.token)).b.requests.find((x: any) => x.order_id === o.id));
    ok('M1 both nearby couriers list the request with price, maximum, distances and the sender\'s rating', !!seen1 && !!seen2 && seen1.price_da === o.offered_da && seen1.max_da === o.max_da && typeof seen1.trip_distance_m === 'number' && 'sender_rating' in seen1, seen1);
    ok('M1 the list never shows the receiver nor the codes', !JSON.stringify(seen1).includes('+21377') && !('delivery_code' in seen1) && !('pickup_code' in seen1));
    const bid = (price: any, t = D1.token, id = seen1.offer_id) => api('/make_bid', { offer_id: id, price_da: price }, t);
    ok('M2 a price below the customer\'s is refused', (await bid(o.offered_da - 10)).b.error === 'PRICE_NOT_ALLOWED');
    ok('M2 a price above the allowed maximum is refused', (await bid(o.max_da + 10)).b.error === 'PRICE_NOT_ALLOWED');
    ok('M2 a price that is not a whole number is refused', (await bid('100')).b.error === 'BAD_PRICE' && (await bid(10.5)).b.error === 'BAD_PRICE');
    ok('M2 a courier cannot answer a request shown to another courier', (await bid(o.offered_da, D3.token)).b.error === 'OFFER_GONE');
    const b1 = await bid(o.offered_da + 50);
    ok('M3 D1 proposes a higher price: no job yet, the customer decides', b1.s === 200 && b1.b.job === null && b1.b.bid.price_da === o.offered_da + 50 && typeof b1.b.bid.eta_s === 'number', b1.b);
    const b2 = await bid(o.offered_da, D2.token, seen2.offer_id);
    ok('M3 D2 accepts the customer\'s price: with auto-accept off it is an offer too', b2.s === 200 && b2.b.job === null && b2.b.bid.price_da === o.offered_da, b2.b);
    let v = (await api('/get_order?id=' + o.id, undefined, A)).b;
    ok('M4 the customer sees both offers, cheapest first, with name, rating, deliveries, vehicle and time to arrive', v.bids.length === 2 && v.bids[0].price_da === o.offered_da && v.bids[1].price_da === o.offered_da + 50 && v.bids[0].driver.name === 'Driver Two' && typeof v.bids[0].driver.deliveries === 'number' && v.bids[0].driver.vehicle === 'motorbike' && typeof v.bids[0].eta_s === 'number', v.bids);
    ok('M4 the customer was notified of each offer', (await pool.query(`SELECT count(*)::int n FROM notifications WHERE type='order.bid' AND order_id=$1`, [o.id])).rows[0].n === 2);
    ok('M4 "couriers told" is shown while searching', v.couriers_notified >= 2 && !!v.search_ends_at, v);
    const B = await makeUser('+213550100099', 'Other Customer');
    ok('M5 another customer cannot choose a courier for this order', (await api('/accept_bid', { order_id: o.id, offer_id: v.bids[0].offer_id }, B)).b.error === 'NOT_FOUND');
    ok('M5 a courier cannot choose for the customer', (await api('/accept_bid', { order_id: o.id, offer_id: v.bids[0].offer_id }, D1.token)).b.error === 'WRONG_PROFILE');
    const dec = await api('/decline_bid', { order_id: o.id, offer_id: v.bids[1].offer_id }, A);
    ok('M6 the customer says no to D1\'s price: the offer disappears and D1 is told', dec.s === 200 && dec.b.bids.length === 1 && (await pool.query(`SELECT 1 FROM notifications WHERE type='bid.declined' AND profile_id=$1 AND order_id=$2`, [D1.id, o.id])).rowCount === 1, dec.b);
    ok('M6 D1 cannot answer this request again', (await bid(o.offered_da + 20)).b.error === 'OFFER_GONE');
    const acc = await api('/accept_bid', { order_id: o.id, offer_id: v.bids[0].offer_id }, A);
    ok('M7 the customer chooses D2: assigned, price LOCKED at D2\'s price', acc.s === 200 && acc.b.status === 'assigned' && acc.b.locked_da === o.offered_da && acc.b.driver?.name === 'Driver Two' && acc.b.bids.length === 0, acc.b);
    ok('M7 D2 is told (high priority) and has the job', (await pool.query(`SELECT priority FROM notifications WHERE type='bid.accepted' AND profile_id=$1 AND order_id=$2`, [D2.id, o.id])).rows[0]?.priority === 'high' && (await api('/get_job', undefined, D2.token)).b.job?.id === o.id);
    ok('M7 choosing again is refused', (await api('/accept_bid', { order_id: o.id, offer_id: v.bids[0].offer_id }, A)).b.error === 'ORDER_TAKEN');
    await api('/cancel_order', { order_id: o.id }, A);
    // a higher price chosen by the customer locks at that price
    r = await order(A, 'bid-key-2', { auto_accept: false }); const o2 = r.b;
    const s1 = await until(async () => (await api('/list_requests', undefined, D1.token)).b.requests.find((x: any) => x.order_id === o2.id));
    await bid(o2.offered_da + 30, D1.token, s1.offer_id);
    r = await order(A, 'bid-key-3', { auto_accept: false }); const o3 = r.b;
    const s3 = await until(async () => (await api('/list_requests', undefined, D1.token)).b.requests.find((x: any) => x.order_id === o3.id));
    ok('M8 a courier waits for ONE customer\'s answer at a time', (await bid(o3.offered_da, D1.token, s3.offer_id)).b.error === 'BID_PENDING');
    v = (await api('/get_order?id=' + o2.id, undefined, A)).b;
    const acc2 = await api('/accept_bid', { order_id: o2.id, offer_id: v.bids[0].offer_id }, A);
    ok('M8 the customer takes the higher offer: locked at that price; the courier\'s other requests leave his list', acc2.b.locked_da === o2.offered_da + 30 && !(await api('/list_requests', undefined, D1.token)).b.requests.some((x: any) => x.order_id === o3.id), acc2.b);
    ok('M8 the price cannot change after that', (await api('/raise_price', { order_id: o2.id, new_offered_da: o2.max_da }, A)).b.error === 'PRICE_LOCKED');
    await api('/cancel_order', { order_id: o2.id }, A); await api('/cancel_order', { order_id: o3.id }, A);
    // an unanswered offer runs out; the courier can answer again
    r = await order(A, 'bid-key-4', { auto_accept: false }); const o4 = r.b;
    const s4 = await until(async () => (await api('/list_requests', undefined, D1.token)).b.requests.find((x: any) => x.order_id === o4.id));
    await bid(o4.offered_da, D1.token, s4.offer_id);
    const off = await until(async () => (await api('/get_order?id=' + o4.id, undefined, A)).b.bids.length === 0 ? true : null, 12000);
    ok('M9 an offer the customer does not answer in time disappears; the courier may answer again', !!off && (await bid(o4.offered_da, D1.token, s4.offer_id)).s === 200);
    // auto-accept switched on while searching: the next courier who accepts the price gets the job
    ok('M10 auto-accept can be switched on while searching', (await api('/set_auto_accept', { order_id: o4.id, on: true }, A)).b.auto_accept === true);
    const s4b = await until(async () => (await api('/list_requests', undefined, D2.token)).b.requests.find((x: any) => x.order_id === o4.id));
    const j = await api('/make_bid', { offer_id: s4b.offer_id, price_da: o4.offered_da }, D2.token);
    ok('M10 with auto-accept, accepting the customer\'s price gives the job at once', j.b.job?.id === o4.id && (await api('/get_order?id=' + o4.id, undefined, A)).b.status === 'assigned', j.b);
    ok('M10 auto-accept cannot be changed after that', (await api('/set_auto_accept', { order_id: o4.id, on: false }, A)).b.error === 'WRONG_STATE');
    ok('M10 ...and D1\'s pending offer on it is withdrawn', (await pool.query(`SELECT status FROM offers WHERE id=$1`, [s4.offer_id])).rows[0].status === 'expired');
    await api('/cancel_order', { order_id: o4.id }, A);
    // a courier who goes offline takes his offer back
    r = await order(A, 'bid-key-5', { auto_accept: false }); const o5 = r.b;
    const s5 = await until(async () => (await api('/list_requests', undefined, D1.token)).b.requests.find((x: any) => x.order_id === o5.id));
    await bid(o5.offered_da, D1.token, s5.offer_id);
    await api('/set_online', { online: false }, D1.token);
    ok('M11 a courier going offline withdraws his offer (the customer is told)', (await api('/get_order?id=' + o5.id, undefined, A)).b.bids.length === 0 && (await pool.query(`SELECT 1 FROM notifications WHERE type='order.bid_withdrawn' AND order_id=$1`, [o5.id])).rowCount! >= 1);
    await api('/set_online', { online: true }, D1.token); await api('/update_location', { lat: 36.7585, lng: 3.0588 }, D1.token);
    await api('/cancel_order', { order_id: o5.id }, A);
    ok('M12 a cancelled order leaves every courier\'s list', (await api('/list_requests', undefined, D2.token)).b.requests.every((x: any) => x.order_id !== o5.id));
  }
  // ===== S: place search through our server (the search service is a test stand-in on port 5056) =====
  {
    ok('S1 the app is told place search is on', (await api('/app_config')).b.place_search === true);
    const s = await api('/search_places?q=' + encodeURIComponent('Place des Martyrs') + '&lang=fr&lat=36.75&lng=3.06', undefined, A);
    ok('S2 results come back clean: name, detail, position', s.s === 200 && s.b.places.length === 1 && s.b.places[0].name === 'Place des Martyrs' && s.b.places[0].detail === 'Rue Bab Azoun, Casbah, Alger' && s.b.places[0].lat === 36.7856, s.b);
    ok('S2 our server asked the service for the Algiers area only, in French, near the person', !!lastSearch && lastSearch.get('bbox') === '2.75,36.55,3.40,36.85' && lastSearch.get('lang') === 'fr' && lastSearch.get('lat') === '36.75' && lastSearch.get('q') === 'Place des Martyrs', lastSearch && Object.fromEntries(lastSearch));
    ok('S3 broken entries from the service are dropped', (await api('/search_places?q=broken', undefined, A)).b.places.length === 0);
    ok('S3 the service failing gives an empty list marked "unavailable", never an error page', (await api('/search_places?q=fail', undefined, A)).b.unavailable === true);
    ok('S4 a query of 1 or more than 80 characters is refused', (await api('/search_places?q=a', undefined, A)).b.error === 'BAD_QUERY' && (await api('/search_places?q=' + 'x'.repeat(81), undefined, A)).b.error === 'BAD_QUERY');
    const rv = await api('/reverse_place?lat=36.75381&lng=3.05882&lang=fr', undefined, A);
    ok('S5 the name under the pin comes back (position rounded for the cache)', rv.b.place?.name === 'Rue Didouche Mourad' && lastSearch.get('lat') === '36.7538' && lastSearch.get('lon') === '3.0588', rv.b);
    ok('S5 a bad position is refused', (await api('/reverse_place?lat=abc&lng=3', undefined, A)).b.error === 'BAD_POINT');
    ok('S4 couriers and strangers cannot use it', (await api('/search_places?q=ardis', undefined, D1.token)).b.error === 'WRONG_PROFILE' && (await api('/search_places?q=ardis')).s === 401);
  }
  // ===== N: notifications list, profile name =====
  {
    const n = (await api('/list_notifications', undefined, A)).b.notifications;
    ok('N1 the sender\'s list holds his notifications, newest first', n.length > 5 && n[0].id > n[1].id && n.some((x: any) => x.type === 'order.recipient_confirmed'), { len: n.length, first: n.slice(0, 2) });
    ok('N1 internal signals stay out of the list', !n.some((x: any) => x.type === 'offer.withdrawn' || x.type === 'order.bid_withdrawn'));
    const page2 = (await api('/list_notifications?before=' + n[n.length - 1].id, undefined, A)).b.notifications;
    ok('N2 older ones come page by page', Array.isArray(page2) && page2.every((x: any) => x.id < n[n.length - 1].id));
    ok('N2 a bad page id is refused', (await api('/list_notifications?before=abc', undefined, A)).b.error === 'BAD_ID');
    ok('N3 each profile sees only its own list', (await api('/list_notifications', undefined, D2.token)).b.notifications.every((x: any) => x.type !== 'order.recipient_confirmed'));
    ok('N4 a customer can change his name', (await api('/rename_profile', { display_name: 'Amina S.' }, A)).b.display_name === 'Amina S.');
    ok('N4 a courier\'s name (checked against his ID) cannot be changed by him', (await api('/rename_profile', { display_name: 'Someone Else' }, D1.token)).b.error === 'NAME_LOCKED');
    ok('N4 an empty or hidden-character name is refused', (await api('/rename_profile', { display_name: ' ' }, A)).b.error === 'BAD_NAME' && (await api('/rename_profile', { display_name: 'Ami\u202Ena' }, A)).b.error === 'BAD_NAME');
    await api('/rename_profile', { display_name: 'Amina Seller' }, A);
  }
  for (const d of [D1, D2, D3]) await api('/set_online', { online: false }, d.token);
  await api('/set_online', { online: false }, selfD.b.token);
  r = await order(A, 'test-key-expire'); const o6 = r.b;
  const ex = await until(async () => (await api('/get_order?id=' + o6.id, undefined, A)).b.status === 'expired', 25000);
  ok('T15 with no driver available the order expires', !!ex);
  const ev = await pool.query(`SELECT type FROM order_events WHERE order_id=$1 ORDER BY id`, [o1.id]);
  ok('T16 every step was recorded in the order history', ['created', 'recipient_confirmed', 'offer_sent', 'offer_declined', 'assigned', 'picked_up', 'delivered'].every(t => ev.rows.some(x => x.type === t)), ev.rows.map(x => x.type));
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})();
