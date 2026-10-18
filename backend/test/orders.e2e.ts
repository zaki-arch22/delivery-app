import { Pool } from 'pg';
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
const docs = { id_photo_url: 'a', licence_photo_url: 'b', vehicle_photo_url: 'c', vehicle: 'motorbike' };

async function login(phone: string, path: 'user' | 'driver') { await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code; return (await api('/verify_code', { phone, code: c, path })).b; }
async function makeUser(phone: string, name: string) { const l = await login(phone, 'user'); return (await api('/add_profile', { type: 'user', display_name: name }, l.token)).b.token as string; }
async function makeDriver(phone: string, name: string, lat: number, lng: number, vehicle = 'motorbike', limit: number | null = null) {
  const l = await login(phone, 'driver');
  const r = await api('/add_profile', { type: 'driver', display_name: name, documents: { ...docs, vehicle } }, l.token);
  const id = r.b.active_profile.id;
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [id]);
  await pool.query(`UPDATE driver_details SET cash_limit_da=$2 WHERE profile_id=$1`, [id, limit]);
  await api('/set_online', { online: true }, r.b.token); await api('/update_location', { lat, lng }, r.b.token);
  return { token: r.b.token as string, id };
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 };
const adr = { street: 'Rue Didouche Mourad', entrance: 'B', floor: '2' };
async function order(tok: string, key: string, extra: any = {}, size = 'small', offered?: number) {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size }, tok)).b;
  return api('/create_order', { quote_id: q.quote_id, offered_da: offered ?? q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000000', payer: 'sender', ...extra }, tok, { 'idempotency-key': key });
}
const offerFor = (t: string) => until(async () => (await api('/get_current_offer', undefined, t)).b.offer);

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, orders, driver_details, profiles, accounts, zones, pricing_rules RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-algiers', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
  const A = await makeUser('+213550100001', 'Amina Seller');
  const D1 = await makeDriver('+213550200001', 'Driver One', 36.7585, 3.0588, 'motorbike', 100000);   // ~0.5 km
  const D2 = await makeDriver('+213550200002', 'Driver Two', 36.7628, 3.0588, 'motorbike', null);     // ~1 km
  const D3 = await makeDriver('+213550200003', 'Driver Three', 36.7990, 3.0588, 'motorbike', null);   // ~5 km (outside first radius)
  // Amina is ALSO a driver (second profile on the same number), online right at the pickup point
  const lA = await login('+213550100001', 'user'); const selfD = await api('/add_profile', { type: 'driver', display_name: 'Amina Driver', documents: docs }, lA.token);
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
  ok('T5 order created, searching, 4-digit code', r.s === 200 && o1.status === 'searching' && /^\d{4}$/.test(o1.delivery_code), r.b);
  ok('T5 same key again returns the SAME order, no duplicate', (await order(A, 'test-key-001')).b.id === o1.id && (await pool.query(`SELECT 1 FROM orders`)).rowCount === 1);
  // T6/T7 matching chain: nearest first, decline -> next, expiry -> widen radius, never the same account
  const of1 = await offerFor(D1.token); ok('T6 nearest driver (D1) is offered first', !!of1 && of1.price_da === o1.offered_da && of1.pickup_distance_m < 1000, of1);
  ok('T6 offer hides recipient details until accepted', !!of1 && !('recipient_phone' in of1));
  ok('T6 other drivers have no offer yet', (await api('/get_current_offer', undefined, D2.token)).b.offer === null);
  await api('/decline_offer', { offer_id: of1.offer_id }, D1.token);
  const of2 = await offerFor(D2.token); ok('T7 after decline, D2 is offered', !!of2);
  ok('T7 D3 (5 km away) not offered while radius is small', (await api('/get_current_offer', undefined, D3.token)).b.offer === null);
  // D2 ignores the offer -> expires -> radius widens -> D3
  const of3 = await offerFor(D3.token); ok('T7 offer expired on D2, radius widened, D3 offered', !!of3);
  const selfOffers = await pool.query(`SELECT 1 FROM offers WHERE driver_profile_id=$1`, [selfD.b.active_profile.id]);
  ok('T7 the seller\'s own driver profile (same phone, at the pickup point) was NEVER offered the order', selfOffers.rowCount === 0);
  // T8 accept
  const acc = await api('/accept_offer', { offer_id: of3.offer_id }, D3.token);
  ok('T8 D3 accepts; job returned with recipient details', acc.s === 200 && acc.b.job?.status === 'assigned' && acc.b.job.recipient_phone === '+213770000000', acc.b);
  ok('T8 second accept of same offer refused', (await api('/accept_offer', { offer_id: of3.offer_id }, D3.token)).s === 409);
  const g = (await api('/get_order?id=' + o1.id, undefined, A)).b;
  ok('T8 user sees driver, price LOCKED at the offered price', g.status === 'assigned' && g.locked_da === o1.offered_da && g.driver?.name === 'Driver Three', g);
  ok('T8 price can no longer be raised', (await api('/raise_price', { order_id: o1.id, new_offered_da: o1.max_da }, A)).b.error === 'PRICE_LOCKED');
  // T9 steps
  const step = (t: string, body: any) => api('/update_job_step', { order_id: o1.id, ...body }, t);
  ok('T9 delivering before pickup refused', (await step(D3.token, { step: 'delivered', delivery_code: g.delivery_code })).b.error === 'WRONG_STEP');
  ok('T9 picked_up works', (await step(D3.token, { step: 'picked_up' })).b.order_status === 'picked_up');
  ok('T9 resending picked_up (offline retry) is a harmless success', (await step(D3.token, { step: 'picked_up' })).b.again === true);
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
  const st2 = (t: string, body: any) => api('/update_job_step', { order_id: o2.id, ...body }, t);
  await st2(D1.token, { step: 'picked_up' });
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
  await api('/update_job_step', { order_id: o4.id, step: 'picked_up' }, D1.token);
  ok('T13 user cannot cancel after pickup', (await api('/cancel_order', { order_id: o4.id }, A)).b.error === 'CANNOT_CANCEL');
  const fr = await api('/report_delivery_failure', { order_id: o4.id, reason: 'refused' }, D1.token);
  ok('T13 failure creates a RETURN leg, already picked up', fr.b.job?.leg === 'return' && fr.b.job.status === 'picked_up' && fr.b.job.cash_to_collect_da === 0, fr.b);
  ok('T13 original is failed and staff got a problem report', (await api('/get_order?id=' + o4.id, undefined, A)).b.status === 'failed' && (await pool.query(`SELECT 1 FROM problem_reports WHERE order_id=$1 AND reason='delivery_failed:refused'`, [o4.id])).rowCount === 1);
  const retId = fr.b.job.id, retCode = (await api('/get_order?id=' + retId, undefined, A)).b.delivery_code;
  ok('T13 sender sees the return leg and its code', /^\d{4}$/.test(retCode));
  ok('T13 return delivered with the sender\'s code, no cash entry', (await api('/update_job_step', { order_id: retId, step: 'delivered', delivery_code: retCode }, D1.token)).b.order_status === 'delivered' && (await api('/get_cash_balance', undefined, D1.token)).b.balance_da === 5000);
  ok('T13 return legs are not rated', (await api('/submit_rating', { order_id: retId, stars: 5 }, A)).s === 400);
  // T14 guessing the delivery code is blocked
  r = await order(A, 'test-key-lock'); const o5 = r.b; const l1 = await offerFor(D1.token); await api('/accept_offer', { offer_id: l1.offer_id }, D1.token);
  await api('/update_job_step', { order_id: o5.id, step: 'picked_up' }, D1.token);
  const realCode = (await api('/get_order?id=' + o5.id, undefined, A)).b.delivery_code; const wrong = realCode === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) await api('/update_job_step', { order_id: o5.id, step: 'delivered', delivery_code: wrong }, D1.token);
  ok('T14 after 5 wrong codes even the RIGHT code is refused (locked for staff)', (await api('/update_job_step', { order_id: o5.id, step: 'delivered', delivery_code: realCode }, D1.token)).b.error === 'CODE_LOCKED');
  ok('T14 a driver cannot go offline while on a job', (await api('/set_online', { online: false }, D1.token)).b.error === 'ON_JOB');
  // T15 nobody available -> order expires
  await pool.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [o5.id]);
  for (const d of [D1, D2, D3]) await api('/set_online', { online: false }, d.token);
  await api('/set_online', { online: false }, selfD.b.token);
  r = await order(A, 'test-key-expire'); const o6 = r.b;
  const ex = await until(async () => (await api('/get_order?id=' + o6.id, undefined, A)).b.status === 'expired', 25000);
  ok('T15 with no driver available the order expires', !!ex);
  const ev = await pool.query(`SELECT type FROM order_events WHERE order_id=$1 ORDER BY id`, [o1.id]);
  ok('T16 every step was recorded in the order history', ['created', 'offer_sent', 'offer_declined', 'assigned', 'picked_up', 'delivered'].every(t => ev.rows.some(x => x.type === t)), ev.rows.map(x => x.type));
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})();
