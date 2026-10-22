import { Pool } from 'pg';
import { driverDocs } from './docs';
// Server started with BROADCAST_MAX=1: a request is shown to one courier at a time, so we can see who holds the place.
const B = process.env.API ?? 'http://localhost:3399';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('Tests need TEST_DATABASE_URL pointing to a separate test database, never the real one');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
async function api(path: string, body?: any, token?: string, headers: any = {}) {
  const r = await fetch(B + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 10000): Promise<T | null> { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v as T; await sleep(300); } return null; }
async function login(phone: string, path: 'user' | 'driver') { await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code; return (await api('/verify_code', { phone, code: c, path })).b; }
async function makeDriver(phone: string, name: string, lat: number, lng: number) {
  const l = await login(phone, 'driver');
  const r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: name, documents: await driverDocs(B, l.token, 'motorbike') }, l.token);
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [r.b.active_profile.id]);
  await api('/set_online', { online: true }, r.b.token); await api('/update_location', { lat, lng }, r.b.token);
  return r.b.token as string;
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 }, adr = { street: 'Rue Didouche Mourad' };
const offer = (t: string) => api('/get_current_offer', undefined, t).then(r => r.b.offer);

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, notifications, orders, driver_details, profiles, accounts, zones, pricing_rules RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-algiers', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
  const l = await login('+213550900001', 'user');
  const A = (await api('/add_profile', { accept_rules: true, type: 'user', display_name: 'Sender' }, l.token)).b.token;
  const near = await makeDriver('+213550900002', 'Near', 36.7545, 3.0588);
  const far = await makeDriver('+213550900003', 'Farther', 36.7600, 3.0588);
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, A)).b;
  const o = (await api('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000000', payer: 'sender' }, A, { 'idempotency-key': 'room-test-0001' })).b;
  ok('R1 the nearest courier gets the request first', !!(await until(() => offer(near))), o);
  await sleep(1500);
  ok('R1 with one place, the farther courier does not get it while the nearest one is online', (await offer(far)) === null);
  await pool.query(`UPDATE driver_details SET last_location_at = now() - interval '10 minutes' WHERE profile_id = (SELECT p.id FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE p.display_name='Near')`);
  ok('R2 a courier who stopped sending his position frees his place: the next courier gets the request', !!(await until(() => offer(far))));
  const v = (await api('/get_order?id=' + o.id, undefined, A)).b;
  ok('R2 the order is still searching', v.status === 'searching', v.status);
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
