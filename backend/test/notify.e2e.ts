import { Pool } from 'pg';
import { driverDocs, upload, PHOTO } from './docs';
const HTTP = 'http://localhost:3399', WS = 'ws://localhost:3399/ws';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('Tests need TEST_DATABASE_URL pointing to a separate test database, never the real one');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 6000): Promise<T | null> { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v as T; await sleep(100); } return null; }
async function api(path: string, body?: any, token?: string, headers: any = {}) {
  const r = await fetch(HTTP + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
class Sock {
  msgs: any[] = []; closeCode: number | null = null; ws: any; ready = false;
  constructor(token: string, since?: number) {
    this.ws = new (globalThis as any).WebSocket(WS);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'auth', token, since }));
    this.ws.onmessage = (e: any) => { const m = JSON.parse(e.data); if (m.type === 'ready') this.ready = true; else if (m.type === 'notification') this.msgs.push(m); };
    this.ws.onclose = (e: any) => (this.closeCode = e.code);
  }
  waitKind(kind: string, ms = 4000, from = 0) { return until(() => this.msgs.slice(from).find(m => m.kind === kind), ms); }
  close() { this.ws.close(); }
}
async function login(phone: string, path: 'user' | 'driver') { await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code; return (await api('/verify_code', { phone, code: c, path })).b; }
async function makeUser(phone: string, name: string) { const l = await login(phone, 'user'); const r = await api('/add_profile', { type: 'user', display_name: name }, l.token); return { token: r.b.token as string, id: r.b.active_profile.id as string }; }
async function makeDriver(phone: string, name: string, lat: number, lng: number, online = true) {
  const l = await login(phone, 'driver'); const r = await api('/add_profile', { type: 'driver', display_name: name, documents: await driverDocs(HTTP, l.token) }, l.token); const id = r.b.active_profile.id;
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [id]);
  if (online) { await api('/set_online', { online: true }, r.b.token); await api('/update_location', { lat, lng }, r.b.token); }
  return { token: r.b.token as string, id: id as string };
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 }, adr = { street: 'Rue Didouche Mourad' };
async function order(tok: string, key: string, phone = '+213770000001') {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, tok)).b;
  return (await api('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: phone, payer: 'sender' }, tok, { 'idempotency-key': key })).b;
}
const profileOf = async (id: number) => (await pool.query(`SELECT profile_id FROM notifications WHERE id=$1`, [id])).rows[0]?.profile_id;

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, profiles, accounts, zones, pricing_rules RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('t', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`);
  const U1 = await makeUser('+213550300001', 'Sara User');
  const D1 = await makeDriver('+213550400001', 'Driver One', 36.7585, 3.0588);
  const D2 = await makeDriver('+213550400002', 'Driver Two', 36.7628, 3.0588);
  await api('/register_device', { token: 'tok-driver-one-0001', platform: 'android', language: 'fr' }, D1.token);
  await api('/register_device', { token: 'tok-sara-user-0001', platform: 'ios', language: 'ar' }, U1.token);

  // N1 connection security
  const bad = new Sock('not-a-token'); ok('N1 live connection with a bad token is closed', !!(await until(() => bad.closeCode === 4401)));
  const sD1 = new Sock(D1.token), sU1 = new Sock(U1.token);
  ok('N1 valid tokens connect', !!(await until(() => sD1.ready && sU1.ready)));

  // N2 offer arrives live, without polling
  const t0 = Date.now(); const O1 = await order(U1.token, 'notify-order-001');
  const offer = await sD1.waitKind('offer.new');
  ok('N2 driver gets the offer LIVE (no polling), high priority, with expiry', !!offer && offer.priority === 'high' && !!offer.expires_at && offer.data.price_da === O1.offered_da, offer);
  ok('N2 delivered fast', !!offer && Date.now() - t0 < 2500, Date.now() - t0);
  const pushD1 = await until(async () => (await api('/dev/pushes?token=tok-driver-one-0001')).b.sent?.find((x: any) => x.m.data.kind === 'offer.new'));
  ok('N3 phone push for the offer: French text, high priority, carries notification id', !!pushD1 && pushD1.m.title === 'Nouvelle course' && pushD1.m.priority === 'high' && pushD1.m.data.id === String(offer.id), pushD1);

  // N4 ATOMIC: a rolled-back transaction produces NO notification; a committed one produces exactly one
  const c = await pool.connect(); await c.query('BEGIN');
  await c.query(`INSERT INTO notifications(profile_id,type,dedupe_key) VALUES ($1,'test.rollback','rb-1')`, [D1.id]); await sleep(1200); await c.query('ROLLBACK'); c.release();
  await sleep(800);
  ok('N4 ATOMIC: rolled-back change sent nothing and left no row', !sD1.msgs.some(m => m.kind === 'test.rollback') && (await pool.query(`SELECT 1 FROM notifications WHERE type='test.rollback'`)).rowCount === 0);
  await pool.query(`INSERT INTO notifications(profile_id,type,dedupe_key,push_state) VALUES ($1,'test.commit','cm-1','skipped')`, [D1.id]);
  ok('N4 ATOMIC: committed change is delivered immediately', !!(await sD1.waitKind('test.commit', 2000)));
  ok('N5 the same event can never notify twice (dedupe)', (await pool.query(`INSERT INTO notifications(profile_id,type,dedupe_key) VALUES ($1,'test.commit','cm-1') ON CONFLICT (profile_id,dedupe_key) DO NOTHING`, [D1.id])).rowCount === 0);

  // N6 order progress reaches the user live, in order, in Arabic push
  await api('/accept_offer', { offer_id: offer.data.offer_id }, D1.token);
  ok('N6 user is told LIVE that a driver accepted', !!(await sU1.waitKind('order.assigned')));
  const pushU = await until(async () => (await api('/dev/pushes?token=tok-sara-user-0001')).b.sent?.find((x: any) => x.m.data.kind === 'order.assigned'));
  ok('N6 user gets an ARABIC phone push', !!pushU && pushU.m.title === 'تم العثور على مندوب', pushU);
  const step = (oid: string, body: any) => api('/update_job_step', { order_id: oid, ...body }, D1.token);
  await step(O1.id, { step: 'picked_up' }); ok('N6 "picked up" arrives live', !!(await sU1.waitKind('order.picked_up')));
  const code1 = (await api('/get_order?id=' + O1.id, undefined, U1.token)).b.delivery_code;
  await step(O1.id, { step: 'delivered', delivery_code: code1 }); ok('N6 "delivered" arrives live', !!(await sU1.waitKind('order.delivered')));
  const seq = sU1.msgs.filter(m => m.kind.startsWith('order.')).map(m => m.id);
  ok('N6 notifications arrive in order (ids ascending, no duplicates)', seq.every((v, i) => i === 0 || v > seq[i - 1]), seq);

  // N7 resume: user offline while the order progresses, then reconnects and misses nothing
  const lastSeen = Math.max(...sU1.msgs.map(m => m.id)); sU1.close(); await sleep(300);
  const O2 = await order(U1.token, 'notify-order-002'); const off2 = await sD1.waitKind('offer.new', 4000, sD1.msgs.findIndex(m => m.data?.ref === O1.ref) + 1 || 0);
  const off2b = sD1.msgs.filter(m => m.kind === 'offer.new').pop();
  await api('/accept_offer', { offer_id: off2b.data.offer_id }, D1.token); await step(O2.id, { step: 'picked_up' });
  const code2 = (await api('/get_order?id=' + O2.id, undefined, U1.token)).b.delivery_code; await step(O2.id, { step: 'delivered', delivery_code: code2 });
  const sU1b = new Sock(U1.token, lastSeen); await until(() => sU1b.msgs.length >= 3, 3000);
  ok('N7 reconnect replays exactly what was missed, in order', sU1b.msgs.map(m => m.kind).join() === 'order.assigned,order.picked_up,order.delivered' && sU1b.msgs.every(m => m.id > lastSeen), sU1b.msgs.map(m => m.kind));
  const last2 = Math.max(...sU1b.msgs.map(m => m.id)); sU1b.close(); await sleep(200);
  const sU1c = new Sock(U1.token, last2); await sleep(900);
  ok('N7 reconnecting again replays nothing (no duplicates)', sU1c.msgs.length === 0, sU1c.msgs);

  // N8 offer withdrawn when the sender cancels
  const O3 = await order(U1.token, 'notify-order-003'); const off3 = await until(() => sD1.msgs.filter(m => m.kind === 'offer.new' && m.data.ref === O3.ref)[0]);
  await api('/cancel_order', { order_id: O3.id, reason: 'x' }, U1.token);
  const w3 = await until(() => sD1.msgs.find(m => m.kind === 'offer.withdrawn' && m.data.offer_id === off3?.data.offer_id));
  ok('N8 open offer is withdrawn LIVE when the sender cancels', !!w3 && w3.data.reason === 'cancelled', w3);
  // N9 job cancelled after assignment
  const O4 = await order(U1.token, 'notify-order-004'); const off4 = await until(() => sD1.msgs.filter(m => m.kind === 'offer.new' && m.data.ref === O4.ref)[0]);
  await api('/accept_offer', { offer_id: off4.data.offer_id }, D1.token); await api('/cancel_order', { order_id: O4.id }, U1.token);
  const jc = await sD1.waitKind('job.cancelled'); ok('N9 driver is told LIVE the job was cancelled (high priority)', !!jc && jc.priority === 'high');
  // N10 offer expires on its own
  const O5 = await order(U1.token, 'notify-order-005'); const off5 = await until(() => sD1.msgs.filter(m => m.kind === 'offer.new' && m.data.ref === O5.ref)[0]);
  const w5 = await until(() => sD1.msgs.find(m => m.kind === 'offer.withdrawn' && m.data.offer_id === off5?.data.offer_id), 7000);
  ok('N10 unanswered offer is withdrawn LIVE when it expires, so the screen clears itself', !!w5 && w5.data.reason === 'expired', w5);
  await api('/cancel_order', { order_id: O5.id }, U1.token);

  // N11 two profiles on ONE phone number never see each other's notifications
  const A = await makeUser('+213550500001', 'Adam Seller'); const l2 = await login('+213550500001', 'user');
  const addD = await api('/add_profile', { type: 'driver', display_name: 'Adam Driver', documents: await driverDocs(HTTP, l2.token) }, l2.token); const AD = { token: addD.b.token as string, id: addD.b.active_profile.id as string };
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [AD.id]); await api('/set_online', { online: true }, AD.token); await api('/update_location', P, AD.token);
  const sAU = new Sock(A.token), sAD = new Sock(AD.token); await until(() => sAU.ready && sAD.ready);
  const O6 = await order(U1.token, 'notify-order-006');
  const adOffer = await sAD.waitKind('offer.new'); ok('N11 the DRIVER profile gets the offer', !!adOffer);
  await sleep(500); ok('N11 the USER profile of the same phone gets NOTHING of it', sAU.msgs.length === 0, sAU.msgs);
  await api('/cancel_order', { order_id: O6.id }, U1.token);
  const O7 = await order(A.token, 'notify-order-007'); const d1o = await until(() => sD1.msgs.filter(m => m.kind === 'offer.new' && m.data.ref === O7.ref)[0]);
  ok('N11 Adam\'s own order is offered to Driver One, never to Adam\'s driver profile', !!d1o && !sAD.msgs.some(m => m.data?.ref === O7.ref));
  await api('/accept_offer', { offer_id: d1o.data.offer_id }, D1.token); const asg = await sAU.waitKind('order.assigned');
  ok('N11 Adam\'s USER profile is told; his DRIVER profile socket is not', !!asg && !sAD.msgs.some(m => m.kind === 'order.assigned'));
  await api('/cancel_order', { order_id: O7.id }, A.token);

  // N12 switching profile on a phone: socket closes, push token follows, driver goes offline
  await api('/register_device', { token: 'tok-adam-phone-0001', platform: 'android', language: 'fr' }, AD.token);
  const before = (await pool.query(`SELECT profile_id FROM device_tokens WHERE token='tok-adam-phone-0001'`)).rows[0].profile_id;
  await api('/switch_profile', { type: 'user' }, AD.token);
  ok('N12 live connection of the old profile is closed on switch', !!(await until(() => sAD.closeCode === 4403)));
  const after = (await pool.query(`SELECT profile_id FROM device_tokens WHERE token='tok-adam-phone-0001'`)).rows[0].profile_id;
  ok('N12 the phone\'s push token moved from the driver profile to the user profile', before === AD.id && after === A.id, { before, after });
  ok('N12 a driver who switches away goes OFFLINE', (await pool.query(`SELECT is_online FROM driver_details WHERE profile_id=$1`, [AD.id])).rows[0].is_online === false);
  await pool.query(`INSERT INTO notifications(profile_id,type,dedupe_key) VALUES ($1,'job.cancelled','x-1')`, [AD.id]); await sleep(1500);
  ok('N12 a driver notification is NOT pushed to the phone now showing the user profile', !(await api('/dev/pushes?token=tok-adam-phone-0001')).b.sent.some((x: any) => x.m.data.kind === 'job.cancelled'));
  await api('/logout', {}, (await api('/switch_profile', { type: 'user' }, A.token)).b.token ?? A.token);

  // N13 push retries until it works
  await api('/dev/fail_next', { push: 2 }); const O8 = await order(U1.token, 'notify-order-008');
  const off8 = await until(() => sD1.msgs.filter(m => m.kind === 'offer.new' && m.data.ref === O8.ref)[0]);
  const row8 = await until(async () => { const r = (await pool.query(`SELECT push_state, push_attempts FROM notifications WHERE id=$1`, [off8.id])).rows[0]; return r.push_state === 'sent' ? r : null; }, 6000);
  ok('N13 push failed twice, was retried, and finally sent (3 attempts)', !!row8 && row8.push_attempts === 2, row8);
  await api('/cancel_order', { order_id: O8.id }, U1.token);

  // N14 NO SMS to recipients. A registered recipient gets a PUSH with the code; others get it from the sender.
  ok('N14 the SMS outbox no longer exists (SMS is only for login verification)', (await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='sms_outbox'`)).rowCount === 0);
  const R = await makeUser('+213770000009', 'Rim Recipient'); await api('/register_device', { token: 'tok-recipient-0001', platform: 'android', language: 'fr' }, R.token);
  const sR = new Sock(R.token); await until(() => sR.ready);
  const O9 = await order(U1.token, 'notify-order-009', '+213770000009'); const code9 = (await api('/get_order?id=' + O9.id, undefined, U1.token)).b.delivery_code;
  const inc = await sR.waitKind('order.incoming');
  ok('N14 a recipient who is a registered user is told LIVE, with the delivery code', !!inc && inc.data.delivery_code === code9, inc);
  const pr = await until(async () => (await api('/dev/pushes?token=tok-recipient-0001')).b.sent?.find((x: any) => x.m.data.kind === 'order.incoming'));
  ok('N14 ...and gets a PUSH in French with the code', !!pr && pr.m.title === 'Un colis arrive' && pr.m.body.includes(code9), pr);
  ok('N14 the sender always sees the code in the app (the way to give it to anyone)', /^\d{4}$/.test(code9));
  await api('/cancel_order', { order_id: O9.id }, U1.token);
  const O10 = await order(U1.token, 'notify-order-010', '+213770099999'); await sleep(800);
  ok('N14 a recipient with NO account gets nothing sent (no SMS, no email)', (await pool.query(`SELECT 1 FROM notifications WHERE type='order.incoming' AND order_id=$1`, [O10.id])).rowCount === 0);
  await api('/cancel_order', { order_id: O10.id }, U1.token);
  const O11 = await order(A.token, 'notify-order-011', '+213550500001'); await sleep(800);
  ok('N14 a sender who names their OWN number as recipient is not notified twice', (await pool.query(`SELECT 1 FROM notifications WHERE type='order.incoming' AND order_id=$1`, [O11.id])).rowCount === 0);
  await api('/cancel_order', { order_id: O11.id }, A.token);
  // N16 English
  ok('N16 an unsupported language is refused', (await api('/register_device', { token: 'tok-recipient-0001', platform: 'android', language: 'de' }, R.token)).b.error === 'BAD_LANGUAGE');
  ok('N16 English is accepted', (await api('/register_device', { token: 'tok-recipient-0001', platform: 'android', language: 'en' }, R.token)).s === 200);
  const O12 = await order(U1.token, 'notify-order-012', '+213770000009'); const code12 = (await api('/get_order?id=' + O12.id, undefined, U1.token)).b.delivery_code;
  const pe = await until(async () => (await api('/dev/pushes?token=tok-recipient-0001')).b.sent?.find((x: any) => x.m.body.includes(code12)));
  ok('N16 the same device now gets the push in ENGLISH', !!pe && pe.m.title === 'A parcel is on its way to you' && pe.m.body === `Delivery code: ${code12}`, pe);
  await api('/cancel_order', { order_id: O12.id }, U1.token);
  // N15 isolation of every message, by database proof
  let leaks = 0; for (const [s, id] of [[sD1, D1.id], [sU1, U1.id], [sU1b, U1.id], [sAU, A.id], [sAD, AD.id], [sR, R.id]] as [Sock, string][]) for (const m of s.msgs) if ((await profileOf(m.id)) !== id) leaks++;
  ok('N15 EVERY message on EVERY socket belongs to that socket\'s own profile (0 leaks)', leaks === 0, leaks);
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})();
