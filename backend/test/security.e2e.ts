import { Pool } from 'pg';
import { driverDocs, upload, PHOTO } from './docs';
import * as jwt from 'jsonwebtoken';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { hashPassword } from '../src/auth/password';
import { deriveKey, seal } from '../src/security/crypto';
import { codeAt, newSecret, stepNow } from '../src/security/totp';
const HTTP = 'http://localhost:3398', WS = 'ws://localhost:3398/ws';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL) || !process.env.TEST_APP_DATABASE_URL) throw new Error('Needs TEST_DATABASE_URL (owner, separate test db) and TEST_APP_DATABASE_URL (the limited role)');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }), appPool = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 6000): Promise<T | null> { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v as T; await sleep(100); } return null; }
let ipc = 0; const fresh = () => `10.9.${(ipc >> 8) & 255}.${ipc++ & 255}`;
async function raw(path: string, init: any = {}) { return fetch(HTTP + path, { ...init, headers: { 'x-forwarded-for': fresh(), ...(init.headers ?? {}) } }); }
async function api(path: string, body?: any, token?: string, headers: any = {}) {
  const r = await raw(path, { method: body !== undefined ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any, h: r.headers };
}
async function login(phone: string, path: 'user' | 'driver' = 'user') { await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code; return (await api('/verify_code', { phone, code: c, path })).b; }
const docs = { id_photo_url: 'a', licence_photo_url: 'b', vehicle_photo_url: 'c', vehicle: 'motorbike' };
async function makeUser(phone: string, name: string) { const l = await login(phone); const r = await api('/add_profile', { type: 'user', display_name: name }, l.token); return { token: r.b.token as string, id: r.b.active_profile.id as string, refresh: l.refresh_token as string }; }
async function makeDriver(phone: string, name: string, lat: number, lng: number) {
  const l = await login(phone, 'driver'); const r = await api('/add_profile', { type: 'driver', display_name: name, documents: await driverDocs(HTTP, l.token) }, l.token); const id = r.b.active_profile.id;
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [id]); await pool.query(`UPDATE driver_details SET cash_limit_da=50000 WHERE profile_id=$1`, [id]);
  await api('/set_online', { online: true }, r.b.token); await api('/update_location', { lat, lng }, r.b.token); return { token: r.b.token as string, id: id as string };
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 }, adr = { street: 'Rue Didouche Mourad' };
async function order(tok: string, key: string, extra: any = {}) {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, tok)).b;
  return (await api('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000001', payer: 'sender', ...extra }, tok, { 'idempotency-key': key })).b;
}
const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
const PW = 'correct-horse-battery-1'; const secrets: Record<string, string> = {};
const insStaff = async (email: string, withTotp = true) => { secrets[email] = newSecret(); return (await pool.query(`INSERT INTO staff_users(email,name,password_hash,totp_secret_sealed) VALUES ($1,$2,$3,$4) RETURNING id`, [email, 'S ' + email, hashPassword(PW), withTotp ? seal(secrets[email], 'totp') : null])).rows[0].id as string; };
const code = (email: string, off = 0) => codeAt(secrets[email], stepNow() + off);
const ev = async (type: string) => (await pool.query(`SELECT count(*)::int n FROM security_events WHERE type=$1`, [type])).rows[0].n > 0;

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, profiles, accounts, zones, pricing_rules, staff_audit, staff_users, security_events RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('t', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`);

  // ===== SEC1 headers =====
  const h = (await raw('/get_me')).headers;
  ok('SEC1 security headers are on every response', h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY' && h.get('cache-control') === 'no-store' && /max-age/.test(h.get('strict-transport-security') ?? '') && /default-src 'none'/.test(h.get('content-security-policy') ?? '') && h.get('referrer-policy') === 'no-referrer', [...h.entries()]);
  ok('SEC1 the server does not announce what it runs on', !h.get('x-powered-by'));
  // ===== SEC2 CORS =====
  const evil = await raw('/get_me', { headers: { origin: 'https://evil.example' } }); const good = await raw('/get_me', { headers: { origin: 'https://staff.example.test' } });
  ok('SEC2 an unknown website gets NO cross-origin permission; the staff console address does', !evil.headers.get('access-control-allow-origin') && good.headers.get('access-control-allow-origin') === 'https://staff.example.test');
  const pre = await raw('/staff_login', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  ok('SEC2 a preflight from an unknown website is not approved', !pre.headers.get('access-control-allow-origin'));
  // ===== SEC3 input shape =====
  ok('SEC3 a 70 KB body is refused (413)', (await raw('/send_code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: 'x'.repeat(70000) }) })).status === 413);
  ok('SEC3 non-JSON POST is refused (415)', (await raw('/send_code', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'phone=+213550000000' })).status === 415);
  ok('SEC3 a prototype-pollution key is refused', (await raw('/send_code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"phone":"+213550000000","__proto__":{"admin":true}}' })).status === 400);
  ok('SEC3 repeated query parameters (arrays) are refused', (await raw('/dev/last_code?phone=a&phone=b')).status === 400);
  ok('SEC3 TOTP implementation matches the official RFC 6238 test vector', codeAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1) === '287082');

  // ===== SEC4 token attacks =====
  const U = await makeUser('+213550900001', 'Alice Sender'); const claims = jwt.decode(U.token) as any;
  const forged = (t: string) => api('/get_me', undefined, t);
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sid: claims.sid, acc: claims.acc, pid: claims.pid, iss: 'delivery', aud: 'delivery-app', exp: Math.floor(Date.now() / 1000) + 600 })}.`;
  ok('SEC4 a token with "alg: none" (no signature) is refused', (await forged(none)).b.error === 'BAD_TOKEN');
  ok('SEC4 a token signed with a guessed secret is refused', (await forged(jwt.sign({ sid: claims.sid, acc: claims.acc, pid: claims.pid }, 'guessed-secret', { audience: 'delivery-app', issuer: 'delivery' }))).b.error === 'BAD_TOKEN');
  const parts = U.token.split('.'); const pay = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); pay.pid = '00000000-0000-0000-0000-000000000000';
  ok('SEC4 a real token with its contents edited is refused', (await forged(`${parts[0]}.${b64(pay)}.${parts[2]}`)).b.error === 'BAD_TOKEN');
  ok('SEC4 an expired token is refused', (await forged(jwt.sign({ sid: claims.sid, acc: claims.acc, pid: claims.pid }, deriveKey('JWT_SECRET', 'jwt-app'), { algorithm: 'HS256', expiresIn: -10, issuer: 'delivery', audience: 'delivery-app' }))).b.error === 'BAD_TOKEN');
  ok('SEC4 KEY CONFUSION: an app token signed with the STAFF key is refused', (await forged(jwt.sign({ sid: claims.sid, acc: claims.acc, pid: claims.pid }, deriveKey('JWT_SECRET', 'jwt-staff'), { algorithm: 'HS256', issuer: 'delivery', audience: 'delivery-app' }))).b.error === 'BAD_TOKEN');
  const sid0 = await insStaff('victim@test.example');
  ok('SEC4 KEY CONFUSION: a staff token signed with the APP key is refused', (await api('/list_zones', undefined, jwt.sign({ stf: sid0, tv: 0 }, deriveKey('JWT_SECRET', 'jwt-app'), { algorithm: 'HS256', issuer: 'delivery', audience: 'delivery-staff' }))).b.error === 'BAD_TOKEN');
  ok('SEC4 an app token cannot reach staff functions', (await api('/list_zones', undefined, U.token)).b.error === 'STAFF_ONLY');

  // ===== SEC5 stolen refresh token =====
  const l5 = await login('+213550900005'); const r1 = (await api('/refresh_token', { refresh_token: l5.refresh_token })).b;
  ok('SEC5 refresh works and gives a NEW refresh token', !!r1.token && r1.refresh_token !== l5.refresh_token);
  ok('SEC5 the OLD refresh token (a thief\'s copy) is refused', (await api('/refresh_token', { refresh_token: l5.refresh_token })).s === 401);
  ok('SEC5 ...and that kills the WHOLE session, even the rightful newest token', (await api('/refresh_token', { refresh_token: r1.refresh_token })).s === 401 && (await api('/get_me', undefined, r1.token)).s === 401);

  // ===== SEC6 rate limits (each uses its own address) =====
  const ipA = '172.16.0.1'; let last: any; for (let i = 0; i < 11; i++) last = await api('/send_code', { phone: `+2135509100${String(i).padStart(2, '0')}` }, undefined, { 'x-forwarded-for': ipA });
  ok('SEC6 the 11th login-code request from one address in an hour is refused, with Retry-After', last.s === 429 && last.b.error === 'RATE_LIMITED' && Number(last.h.get('retry-after')) > 0, last.b);
  const ipB = '172.16.0.2'; for (let i = 0; i < 11; i++) last = await api('/staff_login', { email: 'nobody@test.example', password: 'x', code: '000000' }, undefined, { 'x-forwarded-for': ipB });
  ok('SEC6 the 11th staff login attempt from one address is refused', last.s === 429);
  const ipC = '172.16.0.3'; const res = await Promise.all(Array.from({ length: 330 }, () => api('/get_me', undefined, 'x', { 'x-forwarded-for': ipC })));
  ok('SEC6 flooding from ONE address is cut off at 300 per minute', res.some(r => r.s === 429) && res.filter(r => r.s === 429).length >= 20, res.filter(r => r.s === 429).length);
  ok('SEC6 ...while a different address is not affected', (await api('/get_me', undefined, 'x', { 'x-forwarded-for': '172.16.0.4' })).s === 401);
  const Ls = await makeUser('+213550900006', 'Rate Test'); let limited = 0; for (let i = 0; i < 125; i++) if ((await api('/get_me', undefined, Ls.token)).s === 429) limited++;
  ok('SEC6 one logged-in session is limited to 120 requests a minute (a stolen token cannot hammer the system)', limited >= 1, limited);

  // ===== SEC7 SMS fraud caps =====
  await pool.query(`INSERT INTO otp_codes(phone, code_hash, expires_at, ip) SELECT '+21355099' || g, 'x', now() + interval '5 minutes', 'cap-test-ip' FROM generate_series(1, 20) g`);
  const ipcap = await api('/send_code', { phone: '+213550920001' }); // different forwarded IP, so craft the same stored ip via header below
  const ipcap2 = await api('/send_code', { phone: '+213550920002' }, undefined, { 'x-forwarded-for': 'cap-test-ip' });
  ok('SEC7 one address can request at most 20 codes an hour (database-counted, survives restarts)', ipcap2.b.error === 'TOO_MANY_CODES', ipcap2.b);
  const have = (await pool.query(`SELECT count(*)::int n FROM otp_codes WHERE created_at > now() - interval '24 hours'`)).rows[0].n; const cap = Number(process.env.SMS_DAILY_CAP ?? 100);
  await pool.query(`INSERT INTO otp_codes(phone, code_hash, expires_at, ip) SELECT '+21355088' || g, 'x', now() + interval '5 minutes', 'daily-' || g FROM generate_series(1, $1::int) g`, [Math.max(0, cap - have)]);
  ok('SEC7 a daily cap stops an SMS-pumping fraud bill, whoever is asking', (await api('/send_code', { phone: '+213550930001' })).b.error === 'SERVICE_BUSY');
  await pool.query(`DELETE FROM otp_codes WHERE code_hash='x'`);

  // ===== SEC8 simultaneous guessing =====
  const ph8 = '+213550900008'; await api('/send_code', { phone: ph8 }); const c8 = (await api('/dev/last_code?phone=' + encodeURIComponent(ph8))).b.code; const wrong8 = c8 === '000000' ? '111111' : '000000';
  const g = await Promise.all(Array.from({ length: 25 }, () => api('/verify_code', { phone: ph8, code: wrong8, path: 'user' })));
  const wrongCount = g.filter(r => r.b.error === 'CODE_WRONG').length;
  ok('SEC8 25 guesses fired at the SAME INSTANT: the database allows only 5 of them', wrongCount <= 5 && g.filter(r => r.b.error === 'CODE_LOCKED').length >= 20, { wrongCount });
  ok('SEC8 after that the code is dead, even the correct one', (await api('/verify_code', { phone: ph8, code: c8, path: 'user' })).b.error === 'CODE_LOCKED');
  const ph8b = '+213550900018'; await api('/send_code', { phone: ph8b }); const c8b = (await api('/dev/last_code?phone=' + encodeURIComponent(ph8b))).b.code;
  const dbl = await Promise.all(Array.from({ length: 10 }, () => api('/verify_code', { phone: ph8b, code: c8b, path: 'user' })));
  ok('SEC8 10 simultaneous submissions of the RIGHT code: exactly ONE login is created', dbl.filter(r => r.s === 200).length === 1 && (await pool.query(`SELECT count(*)::int n FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE a.phone=$1`, [ph8b])).rows[0].n === 1, dbl.map(r => r.s));

  // ===== SEC9 staff two-factor =====
  const e = 'boss2@test.example'; const bid = await insStaff(e); await insStaff('nofactor@test.example', false);
  const bad1 = await api('/staff_login', { email: e, password: PW }); const bad2 = await api('/staff_login', { email: e, password: PW, code: '000000' }); const bad3 = await api('/staff_login', { email: e, password: 'wrong-password-123', code: code(e) });
  ok('SEC9 the correct password ALONE is not enough', bad1.s === 401 && bad2.s === 401);
  ok('SEC9 a wrong password and a wrong code give the IDENTICAL answer (no hint which failed)', bad1.b.error === 'BAD_LOGIN' && bad2.b.error === 'BAD_LOGIN' && bad3.b.error === 'BAD_LOGIN' && bad1.b.message === bad3.b.message);
  const okLogin = await api('/staff_login', { email: e, password: PW, code: code(e) }); ok('SEC9 password + current code works', okLogin.s === 200 && !!okLogin.b.token);
  ok('SEC9 the login answer contains no password hash or authenticator secret', !/password|totp|secret|hash/i.test(JSON.stringify(okLogin.b)));
  ok('SEC9 the SAME code used again is refused (a code works once, stops shoulder-surfing)', (await api('/staff_login', { email: e, password: PW, code: code(e) })).b.error === 'BAD_LOGIN');
  ok('SEC9 a staff account without two-factor cannot log in at all', (await api('/staff_login', { email: 'nofactor@test.example', password: PW, code: '123456' })).b.error === 'TWO_FACTOR_NOT_SET_UP');
  ok('SEC9 the authenticator secret is stored ENCRYPTED, not readable from the database', !(await pool.query(`SELECT totp_secret_sealed s FROM staff_users WHERE email=$1`, [e])).rows[0].s.includes(secrets[e]));
  await api('/staff_logout', {}, okLogin.b.token); ok('SEC9 staff logout kills that login everywhere at once', (await api('/list_zones', undefined, okLogin.b.token)).s === 401);

  // ===== SEC10 reaching other people's data =====
  const A = await makeUser('+213550950001', 'Anna Owner'), Bb = await makeUser('+213550950002', 'Bob Other'); const D1 = await makeDriver('+213550960001', 'Driver One', 36.7585, 3.0588), D2 = await makeDriver('+213550960002', 'Driver Two', 36.7628, 3.0588);
  const O = await order(A.token, 'sec-order-0001'); await until(async () => (await api('/get_current_offer', undefined, D1.token)).b.offer);
  ok('SEC10 another user cannot READ my order', (await api('/get_order?id=' + O.id, undefined, Bb.token)).s === 404);
  ok('SEC10 another user cannot CANCEL my order', (await api('/cancel_order', { order_id: O.id }, Bb.token)).s === 404);
  ok('SEC10 another user cannot RAISE my order\'s price', (await api('/raise_price', { order_id: O.id, new_offered_da: O.max_da }, Bb.token)).s === 404);
  ok('SEC10 another user cannot file a problem on my order', (await api('/report_problem', { order_id: O.id, reason: 'x' }, Bb.token)).s === 404);
  ok('SEC10 another user does not see my order in their list', (await api('/list_orders', undefined, Bb.token)).b.orders.length === 0);
  const offer = (await api('/get_current_offer', undefined, D1.token)).b.offer;
  ok('SEC10 a driver cannot accept an offer that was made to ANOTHER driver', (await api('/accept_offer', { offer_id: offer.offer_id }, D2.token)).s === 409);
  await api('/accept_offer', { offer_id: offer.offer_id }, D1.token);
  ok('SEC10 a driver cannot touch ANOTHER driver\'s job', (await api('/update_job_step', { order_id: O.id, step: 'picked_up' }, D2.token)).s === 404 && (await api('/report_delivery_failure', { order_id: O.id, reason: 'refused' }, D2.token)).s === 404 && (await api('/get_job', undefined, D2.token)).b.job === null);
  ok('SEC10 a stranger cannot rate my order', (await api('/submit_rating', { order_id: O.id, stars: 1 }, Bb.token)).s === 404);

  // ===== SEC11 injection payloads and garbage =====
  const inj = `'; DROP TABLE orders; --`; const oi = await order(A.token, 'sec-order-0002', { recipient_name: inj, pickup_address: { street: inj, notes: '<script>alert(1)</script>' } });
  ok('SEC11 SQL/script payloads are stored as harmless text; the tables are intact', oi.recipient_name === inj && (await pool.query(`SELECT count(*)::int n FROM orders`)).rows[0].n >= 2);
  ok('SEC11 hidden text-direction tricks in names are refused', (await api('/add_profile', { type: 'driver', display_name: 'Eve\u202Elive', documents: docs }, (await login('+213550970001')).token)).b.error !== undefined);
  const ST = (await api('/staff_login', { email: 'nofactor@test.example', password: PW, code: '1' })).b.token; // none: no token; build a real staff token below
  const sid = await insStaff('fuzz@test.example'); const stTok = (await api('/staff_login', { email: 'fuzz@test.example', password: PW, code: code('fuzz@test.example') })).b.token as string;
  const q = (await api('/list_all_orders?q=' + encodeURIComponent("%' OR 1=1 --"), undefined, stTok)); ok('SEC11 an injection attempt in the staff search returns nothing, not everything', q.s === 200 && q.b.orders.length === 0, q.b);
  const userRoutes = ['get_quote', 'create_order', 'cancel_order', 'raise_price', 'report_problem', 'submit_rating', 'register_device', 'add_profile', 'switch_profile'], driverRoutes = ['set_online', 'update_location', 'accept_offer', 'decline_offer', 'update_job_step', 'report_delivery_failure'];
  const staffRoutes = ['approve_driver', 'reject_driver', 'suspend_profile', 'unsuspend_profile', 'staff_order_action', 'resolve_problem', 'record_cash_handover', 'add_cash_adjustment', 'create_zone', 'set_zone_open', 'create_pricing_version'];
  const junk: any[] = [{}, { a: [1, 2] }, { order_id: { $ne: null } }, { order_id: "' OR 1=1", offer_id: 'abc', id: -1, quote_id: 'x', profile_id: 5, amount_da: 1e30, offered_da: 'NaN', lat: 'a', lng: [], online: 'yes', stars: 99, type: [], name: 'x'.repeat(5000), polygon: 'x', email: {}, which: 1 }, { order_id: '00000000-0000-0000-0000-000000000000', step: 'delivered', delivery_code: 12, cash_collected_da: 'x' }];
  const sweep = async (routes: string[], tok: string) => { let five = 0, n = 0; const bad: string[] = []; for (const r of routes) for (const bdy of junk) { const x = await api('/' + r, bdy, tok, { 'x-forwarded-for': fresh() }); n++; if (x.s >= 500) { five++; bad.push(r + ' ' + JSON.stringify(bdy).slice(0, 40)); } } return { five, n, bad }; };
  const fu = await sweep(userRoutes, (await makeUser('+213550980001', 'Fuzz User')).token), fd = await sweep(driverRoutes, D2.token), fs = await sweep(staffRoutes, stTok);
  ok(`SEC11 FUZZ: ${fu.n + fd.n + fs.n} malformed requests across every user, driver and staff function: ZERO server errors`, fu.five + fd.five + fs.five === 0, [...fu.bad, ...fd.bad, ...fs.bad].slice(0, 6));

  // ===== SEC12 sessions =====
  const X = await makeUser('+213550990001', 'Xavier'); await login('+213550990001');   // second device
  ok('SEC12 logging in on a second device warns the account (new-login alert)', (await pool.query(`SELECT 1 FROM notifications WHERE profile_id=$1 AND type='security.new_login'`, [X.id])).rowCount === 1);
  const acc = (await pool.query(`SELECT id FROM accounts WHERE phone='+213550990001'`)).rows[0].id;
  for (let i = 0; i < 3; i++) await pool.query(`INSERT INTO sessions(id,account_id,active_profile_id,refresh_hash,expires_at,created_at) VALUES (gen_random_uuid(),$1,$2,$3, now()+interval '1 day', now() - ($4 || ' minutes')::interval)`, [acc, X.id, 'filler' + i, String(100 + i)]);
  const oldest = (await pool.query(`SELECT id FROM sessions WHERE account_id=$1 AND NOT revoked ORDER BY created_at LIMIT 1`, [acc])).rows[0].id;
  await login('+213550990001');
  ok('SEC12 at most 5 devices stay logged in: the oldest is logged out', (await pool.query(`SELECT count(*)::int n FROM sessions WHERE account_id=$1 AND NOT revoked`, [acc])).rows[0].n <= 5 && (await pool.query(`SELECT revoked FROM sessions WHERE id=$1`, [oldest])).rows[0].revoked === true);
  const Y = await makeUser('+213550990002', 'Yara'); const Y2 = await login('+213550990002');
  const sy = new (globalThis as any).WebSocket(WS); let ready = false; sy.onopen = () => sy.send(JSON.stringify({ type: 'auth', token: Y.token })); sy.onmessage = (m: any) => { if (JSON.parse(m.data).type === 'ready') ready = true; }; let closed: number | null = null; sy.onclose = (c: any) => (closed = c.code); await until(() => ready);
  const ev1 = await api('/logout_everywhere', {}, Y.token);
  ok('SEC12 "logout everywhere" ends every session on every device and closes live connections', ev1.b.sessions_ended >= 2 && (await api('/get_me', undefined, Y.token)).s === 401 && (await api('/get_me', undefined, Y2.token)).s === 401 && !!(await until(() => closed !== null)));

  // ===== SEC13 live connection =====
  const W = await makeUser('+213550990003', 'Wendy'); const socks: any[] = [];
  for (let i = 0; i < 6; i++) { const s: any = new (globalThis as any).WebSocket(WS); s.ok = false; s.code = null; s.onopen = () => s.send(JSON.stringify({ type: 'auth', token: W.token })); s.onmessage = (m: any) => { if (JSON.parse(m.data).type === 'ready') s.ok = true; }; s.onclose = (c: any) => (s.code = c.code); socks.push(s); await sleep(250); }
  await sleep(700); ok('SEC13 a profile can hold at most 5 live connections; the 6th is refused', socks.filter(s => s.ok).length === 5 && socks[5].code === 4401, socks.map(s => s.ok));
  socks[0].send('x'.repeat(20000)); ok('SEC13 an oversized message closes just that connection', !!(await until(() => socks[0].code === 1009)));
  ok('SEC13 ...and the server is STILL ALIVE for everyone else (this once crashed it)', (await api('/get_me')).s === 401 && (await api('/get_me', undefined, W.token)).s === 200);
  for (const s of socks) s.close();
  const sst: any = new (globalThis as any).WebSocket(WS); let sc: number | null = null; sst.onopen = () => sst.send(JSON.stringify({ type: 'auth', token: stTok })); sst.onclose = (c: any) => (sc = c.code); ok('SEC13 a STAFF token cannot open a live connection', !!(await until(() => sc === 4401)));

  // ===== SEC14 a taken-over app, attacking the database as the limited role =====
  const tries: [string, string][] = [['edit a cash ledger entry', `UPDATE cash_ledger SET amount_da = 1`], ['delete order history', `DELETE FROM order_events`], ['delete ratings', `DELETE FROM ratings`], ['edit the staff audit trail', `UPDATE staff_audit SET action='x'`], ['delete the security log', `DELETE FROM security_events`],
    ['empty the orders table', `TRUNCATE orders CASCADE`], ['drop a table', `DROP TABLE orders CASCADE`], ['switch off the rules (triggers)', `ALTER TABLE orders DISABLE TRIGGER ALL`], ['create a table', `CREATE TABLE evil(x int)`], ['add a staff member', `INSERT INTO staff_users(email,name,password_hash) VALUES ('evil@x.co','e','x')`],
    ['change a staff password', `UPDATE staff_users SET password_hash='x'`], ['reactivate a staff member', `UPDATE staff_users SET active=true`], ['read the migration table', `SELECT * FROM schema_migrations`], ['become superuser', `ALTER ROLE delivery_app SUPERUSER`]];
  for (const [what, sql] of tries) ok(`SEC14 the database refuses the app role to ${what}`, await appPool.query(sql).then(() => false, () => true));
  ok('SEC14 ...but the app can still do its normal work (read staff, record a failed login)', await appPool.query(`UPDATE staff_users SET failed_attempts = failed_attempts WHERE false`).then(() => true, () => false) && await appPool.query(`SELECT count(*) FROM orders`).then(() => true, () => false));

  // ===== SEC16 driver document photos: fake images, bombs, oversized files, disk filling =====
  {
    const { crc32 } = await import('zlib'); const sharp = (await import('sharp')).default;
    const up = async (tok: string | null, kind: string, body: Buffer | string, type = 'image/jpeg') => {
      const r = await raw(`/upload_document?kind=${encodeURIComponent(kind)}`, { method: 'POST', headers: { 'content-type': type, ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body });
      return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
    };
    const U = (await login('+213550990001', 'driver')).token as string;
    ok('SEC16 no login: refused before the photo is even read', (await up(null, 'id_photo', PHOTO)).s === 401);
    ok('SEC16 a staff token cannot upload', (await up(stTok, 'id_photo', PHOTO)).b.error === 'WRONG_PROFILE');
    const fakes: [string, Buffer, string][] = [
      ['an HTML page', Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg'],
      ['an SVG with a script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/png'],
      ['a program (.exe)', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2000)]), 'image/jpeg'],
      ['a PDF', Buffer.from('%PDF-1.7\n' + 'x'.repeat(2000)), 'image/jpeg'],
      ['a GIF (not allowed)', Buffer.from('GIF89a' + 'x'.repeat(2000)), 'image/png'],
    ];
    for (const [what, body, type] of fakes) { const r = await up(U, 'id_photo', body, type); ok(`SEC16 ${what} disguised as a photo is refused`, r.s === 415 && r.b.error === 'IMAGE_ONLY', r); }
    ok('SEC16 a declared non-image type is refused', (await up(U, 'id_photo', PHOTO, 'text/html')).b.error === 'IMAGE_ONLY');
    ok('SEC16 JSON sent to the photo route is refused', (await up(U, 'id_photo', '{"a":1}', 'application/json')).b.error === 'IMAGE_ONLY');
    const poly = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<?php system($_GET["c"]); ?>'.repeat(100))]);
    ok('SEC16 a fake JPEG (right first bytes, garbage inside) is refused', (await up(U, 'id_photo', poly)).b.error === 'BAD_IMAGE');
    const tail = Buffer.concat([PHOTO, Buffer.from('<script>alert(1)</script>PK\u0003\u0004hidden-zip')]);
    const ok1 = await up(U, 'id_photo', tail);
    const stored = readFileSync(`${process.env.UPLOAD_DIR}/${ok1.b.document_id}.jpg`);
    ok('SEC16 data hidden after a real photo is thrown away (the picture is redrawn)', ok1.s === 200 && !stored.includes(Buffer.from('hidden-zip')) && !stored.includes(Buffer.from('<script>')));
    // A "decompression bomb": a tiny PNG claiming to be 30000 x 30000 pixels.
    const small = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
    const bomb = Buffer.from(small); bomb.writeUInt32BE(30000, 16); bomb.writeUInt32BE(30000, 20); bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
    const t0 = Date.now(), rb = await up(U, 'id_photo', bomb, 'image/png');
    ok('SEC16 an image "bomb" (tiny file, 900 million pixels) is refused quickly', rb.b.error === 'BAD_IMAGE' && Date.now() - t0 < 5000, rb);
    const big = Buffer.concat([PHOTO, Buffer.alloc(7 * 1024 * 1024)]);
    const rbig = await up(U, 'id_photo', big);
    ok('SEC16 a file over 6 MB is refused with a clear error', rbig.s === 413 && rbig.b.error === 'TOO_LARGE', rbig);
    const tiny = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    ok('SEC16 a picture too small to read is refused', (await up(U, 'id_photo', tiny)).b.error === 'IMAGE_TOO_SMALL');
    ok('SEC16 a path trick in the kind is refused', (await up(U, '../../etc/passwd', PHOTO)).b.error === 'BAD_KIND');
    let last: any; for (let i = 0; i < 12; i++) last = await up(U, 'vehicle_photo', PHOTO);
    ok('SEC16 filling the disk is stopped: at most 10 unused photos per account', last.s === 429 && last.b.error === 'TOO_MANY_UPLOADS', last);
    const files = readdirSync(process.env.UPLOAD_DIR!);
    ok('SEC16 stored files have server-made names only (random id + .jpg)', files.every(f => /^[0-9a-f-]{36}\.jpg$/.test(f)), files.slice(0, 3));
    ok('SEC16 photos are never served to app logins', (await api('/get_document?id=' + ok1.b.document_id, undefined, U)).b.error === 'STAFF_ONLY');
    ok('SEC16 the server is still healthy after all of this', (await api('/get_me', undefined, U)).s === 200);
  }

  // ===== SEC15 evidence trail and code hygiene =====
  const need = ['upload_not_image', 'upload_bad_image', 'upload_cap', 'bad_token', 'app_token_on_staff_route', 'refresh_token_reuse', 'rate_limited', 'staff_login_failed', 'otp_wrong', 'sms_ip_cap', 'sms_daily_cap_reached', 'staff_login_ok', 'logout_everywhere'];
  const missing: string[] = []; for (const t of need) if (!(await ev(t))) missing.push(t);
  ok('SEC15 every attack above left a record in the permanent security log', missing.length === 0, missing);
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
  const leaks = walk('src').filter(f => /postgres:\/\/[^'"\s:]+:[^'"\s@]+@|dev-secret|app_dev_pw|BEGIN (RSA )?PRIVATE KEY/.test(readFileSync(f, 'utf8')));
  ok('SEC15 no password, key or connection string is written in the source code', leaks.length === 0, leaks);
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); await appPool.end(); process.exit(fail ? 1 : 0);
})();
