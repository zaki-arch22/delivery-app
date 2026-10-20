// Road distances from our own OSRM server (run by scripts/test-all.sh on a made-up test grid, test/fixtures/test-grid.osm).
// MODE=osrm  : OSRM is up -> quotes use the real road distance, not marked estimated.
// MODE=down  : nothing listens on ROUTING_URL -> quotes still work, marked estimated.
// MODE=hang  : ROUTING_URL accepts the connection but never answers -> quotes still answer quickly, marked estimated.
import { Pool } from 'pg';
const B = 'http://localhost:3399', OSRM = process.env.OSRM_DIRECT ?? 'http://127.0.0.1:5055', MODE = process.env.MODE ?? 'osrm';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('Tests need TEST_DATABASE_URL pointing to a separate test database, never the real one');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
async function api(path: string, body?: any, token?: string) {
  const r = await fetch(B + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
async function user(phone: string) {
  await api('/send_code', { phone }); const code = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code;
  const l = (await api('/verify_code', { phone, code, path: 'user' })).b;
  return (await api('/add_profile', { accept_rules: true, type: 'user', display_name: 'Routing Test' }, l.token)).b.token as string;
}
// Two corners of the test grid: the shortest road path is 4 blocks east + 4 blocks north.
const A = { lat: 36.74, lng: 3.04 }, Z = { lat: 36.76, lng: 3.06 };

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, orders, driver_details, profiles, accounts, zones, pricing_rules RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-grid', ST_GeogFromText('MULTIPOLYGON(((3.0 36.7, 3.1 36.7, 3.1 36.8, 3.0 36.8, 3.0 36.7)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
  const U = await user('+213550900001');

  if (MODE === 'osrm') {
    const direct = await (await fetch(`${OSRM}/route/v1/driving/${A.lng},${A.lat};${Z.lng},${Z.lat}?overview=false`)).json() as any;
    const road = direct.routes[0];
    const q = (await api('/get_quote', { pickup: A, dropoff: Z, size: 'small' }, U)).b;
    ok('R1 quote uses the OSRM road distance', q.distance_m === Math.round(road.distance) && q.duration_s === Math.round(road.duration), { q, road });
    ok('R1 road distance is not marked estimated', q.distance_estimated === false, q);
    ok('R1 road distance is longer than the straight line (about 2.8 km)', q.distance_m > 3500 && q.distance_m < 5000, q);
    ok('R1 price follows the road distance (100 + 30 per started km, rounded up to 10)', q.recommended_da === Math.ceil((100 + 30 * Math.ceil(q.distance_m / 1000)) / 10) * 10, q);
    const back = (await api('/get_quote', { pickup: Z, dropoff: A, size: 'large' }, U)).b;
    ok('R2 large parcel on roads: car, same road distance back', back.vehicle === 'car' && back.distance_estimated === false && Math.abs(back.distance_m - q.distance_m) < 50, back);
    const stored = (await pool.query(`SELECT data FROM quotes WHERE id=$1`, [q.quote_id])).rows[0].data;
    ok('R3 the stored quote keeps the road distance used for the price', stored.distance_m === q.distance_m && stored.distance_estimated === false, stored);
    const line = q.route as [number, number][];
    ok('R5 the quote carries the road\'s shape for the map: starts near A, ends near Z, follows the grid', Array.isArray(line) && line.length >= 3 && Math.abs(line[0][0] - A.lng) < 0.002 && Math.abs(line[0][1] - A.lat) < 0.002 && Math.abs(line[line.length - 1][1] - Z.lat) < 0.002, line);
  } else {
    const t = Date.now();
    const q = (await api('/get_quote', { pickup: A, dropoff: Z, size: 'small' }, U)).b;
    const ms = Date.now() - t;
    ok(`R4 (${MODE}) quote still works when the routing server is ${MODE === 'down' ? 'down' : 'not answering'}`, typeof q.quote_id === 'string' && q.recommended_da > 0, q);
    ok(`R4 (${MODE}) the distance is marked estimated`, q.distance_estimated === true, q);
    ok(`R4 (${MODE}) the quote answers quickly (under 3 s) instead of hanging`, ms < 3000, ms);
    ok(`R4 (${MODE}) without a road shape the map draws a straight line (route is null)`, q.route === null, q.route);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
