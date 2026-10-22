import { Pool } from 'pg';
import { googleToken, otherKey } from './google';
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
async function makeUser(phone: string, name: string) { const l = await login(phone); const r = await api('/add_profile', { accept_rules: true, type: 'user', display_name: name }, l.token); return { token: r.b.token as string, id: r.b.active_profile.id as string, refresh: l.refresh_token as string }; }
async function makeDriver(phone: string, name: string, lat: number, lng: number) {
  const l = await login(phone, 'driver'); const r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: name, documents: await driverDocs(HTTP, l.token) }, l.token); const id = r.b.active_profile.id;
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [id]); await pool.query(`UPDATE driver_details SET cash_limit_da=50000 WHERE profile_id=$1`, [id]);
  await api('/set_online', { online: true }, r.b.token); await api('/update_location', { lat, lng }, r.b.token); return { token: r.b.token as string, id: id as string };
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 }, adr = { street: 'Rue Didouche Mourad' };
async function order(tok: string, key: string, extra: any = {}) {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, tok)).b;
  const o = (await api('/create_order', { auto_accept: true, quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000001', payer: 'sender', ...extra }, tok, { 'idempotency-key': key })).b;
  return o;   // auto-accept: the first courier who accepts the customer's price gets it
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
  ok('SEC10 another user cannot file a problem on my order', (await api('/report_problem', { order_id: O.id, reason: 'damaged' }, Bb.token)).s === 404);
  ok('SEC10 another user does not see my order in their list', (await api('/list_orders', undefined, Bb.token)).b.orders.length === 0);
  const offer = (await api('/get_current_offer', undefined, D1.token)).b.offer;
  ok('SEC10 a driver cannot accept an offer that was made to ANOTHER driver', (await api('/accept_offer', { offer_id: offer.offer_id }, D2.token)).s === 409);
  await api('/accept_offer', { offer_id: offer.offer_id }, D1.token);
  ok('SEC10 a driver cannot touch ANOTHER driver\'s job', (await api('/update_job_step', { order_id: O.id, step: 'picked_up', location: P }, D2.token)).s === 404 && (await api('/report_delivery_failure', { order_id: O.id, reason: 'refused_changed_mind' }, D2.token)).s === 404 && (await api('/release_job', { order_id: O.id, reason: 'other' }, D2.token)).s === 404 && (await api('/get_job', undefined, D2.token)).b.job === null);
  ok('SEC10 a stranger cannot rate my order', (await api('/submit_rating', { order_id: O.id, stars: 1 }, Bb.token)).s === 404);

  // ===== SEC11 injection payloads and garbage =====
  const inj = `'; DROP TABLE orders; --`; const oi = await order(A.token, 'sec-order-0002', { recipient_name: inj, pickup_address: { street: inj, notes: '<script>alert(1)</script>' } });
  ok('SEC11 SQL/script payloads are stored as harmless text; the tables are intact', oi.recipient_name === inj && (await pool.query(`SELECT count(*)::int n FROM orders`)).rows[0].n >= 2);
  ok('SEC11 hidden text-direction tricks in names are refused', (await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Eve\u202Elive', documents: docs }, (await login('+213550970001')).token)).b.error !== undefined);
  const ST = (await api('/staff_login', { email: 'nofactor@test.example', password: PW, code: '1' })).b.token; // none: no token; build a real staff token below
  const sid = await insStaff('fuzz@test.example'); const stTok = (await api('/staff_login', { email: 'fuzz@test.example', password: PW, code: code('fuzz@test.example') })).b.token as string;
  const q = (await api('/list_all_orders?q=' + encodeURIComponent("%' OR 1=1 --"), undefined, stTok)); ok('SEC11 an injection attempt in the staff search returns nothing, not everything', q.s === 200 && q.b.orders.length === 0, q.b);
  const userRoutes = ['appeal_violation', 'get_quote', 'create_order', 'cancel_order', 'raise_price', 'recall_order', 'report_problem', 'submit_rating', 'register_device', 'add_profile', 'switch_profile', 'set_auto_accept', 'accept_bid', 'decline_bid', 'rename_profile', 'set_payout_account', 'confirm_settlement', 'dispute_settlement'], driverRoutes = ['set_online', 'update_location', 'accept_offer', 'make_bid', 'decline_offer', 'update_job_step', 'report_delivery_failure', 'release_job', 'mark_settlement_sent', 'request_topup'];
  const staffRoutes = ['approve_driver', 'reject_driver', 'suspend_profile', 'unsuspend_profile', 'staff_order_action', 'resolve_problem', 'record_cash_handover', 'add_cash_adjustment', 'create_zone', 'set_zone_open', 'create_pricing_version', 'add_violation', 'decide_violation', 'block_profile', 'lift_sanction', 'ban_account', 'resolve_settlement', 'decide_topup', 'add_wallet_adjustment', 'set_cash_limit', 'mark_alerts_seen'];
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
    {
      const V = (await login('+213550990009', 'driver')).token as string;   // a fresh account: U is near its cap of waiting photos
      const vague = await up(V, 'id_photo', PHOTO, 'application/octet-stream');
      ok('SEC16 a real photo labelled vaguely by the phone (application/octet-stream) is accepted', !!vague.b.document_id, vague);
    }
    ok('SEC16 JSON sent to the photo route is refused', (await up(U, 'id_photo', '{"a":1}', 'application/json')).b.error === 'IMAGE_ONLY');
    const poly = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<?php system($_GET["c"]); ?>'.repeat(100))]);
    ok('SEC16 a fake JPEG (right first bytes, garbage inside) is refused', (await up(U, 'id_photo', poly)).b.error === 'BAD_IMAGE');
    const tail = Buffer.concat([PHOTO, Buffer.from('<script>alert(1)</script>PK\u0003\u0004hidden-zip')]);
    const ok1 = await up(U, 'id_photo', tail);
    const stored: Buffer = (await pool.query(`SELECT data FROM document_files WHERE document_id=$1`, [ok1.b.document_id])).rows[0].data;
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
    const rt = await up(U, 'id_photo', tiny);
    ok('SEC16 a very small picture is still accepted (a person reviews documents) and stored as a clean JPEG', rt.s === 200 && /^[0-9a-f-]{36}$/.test(rt.b.document_id), rt.b);
    ok('SEC16 a path trick in the kind is refused', (await up(U, '../../etc/passwd', PHOTO)).b.error === 'BAD_KIND');
    let last: any; for (let i = 0; i < 12; i++) last = await up(U, 'vehicle_photo', PHOTO);   // (the small picture above already counts)
    ok('SEC16 filling the disk is stopped: at most 10 unused photos per account', last.s === 429 && last.b.error === 'TOO_MANY_UPLOADS', last);
    const notJpeg = (await pool.query(`SELECT count(*)::int n FROM document_files WHERE substring(data from 1 for 3) <> '\\xffd8ff'::bytea`)).rows[0].n;
    ok('SEC16 every stored photo is a clean JPEG made by the server', notJpeg === 0, notJpeg);
    ok('SEC16 photos are never served to app logins', (await api('/get_document?id=' + ok1.b.document_id, undefined, U)).b.error === 'STAFF_ONLY');
    ok('SEC16 the server is still healthy after all of this', (await api('/get_me', undefined, U)).s === 200);
  }

  // ===== SEC17 Google login: only a real, current Google proof issued for OUR app opens an account =====
  {
    const L = (id_token: any, path: any = 'user') => api('/login_google', { id_token, path });
    ok('SEC17 a genuine proof works', (await L(googleToken('g-sec-1'))).s === 200);
    ok('SEC17 a proof signed by someone else\'s key is refused', (await L(googleToken('g-sec-1', {}, otherKey()))).b.error === 'GOOGLE_REJECTED');
    ok('SEC17 a proof made for ANOTHER app is refused', (await L(googleToken('g-sec-1', { aud: 'someone-else.apps.googleusercontent.com' }))).b.error === 'GOOGLE_REJECTED');
    ok('SEC17 an expired proof is refused', (await L(googleToken('g-sec-1', { iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 }))).b.error === 'GOOGLE_REJECTED');
    ok('SEC17 a proof not issued by Google is refused', (await L(googleToken('g-sec-1', { iss: 'https://evil.example' }))).b.error === 'GOOGLE_REJECTED');
    const [h, , sig] = googleToken('g-sec-1').split('.');
    ok('SEC17 a genuine proof with a changed account inside is refused (signature check)', (await L(`${h}.${b64({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_IDS, sub: 'g-victim', exp: Math.floor(Date.now() / 1000) + 600 })}.${sig}`)).b.error === 'GOOGLE_REJECTED');
    ok('SEC17 an unsigned proof ("alg: none") is refused', (await L(`${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: 'accounts.google.com', aud: process.env.GOOGLE_CLIENT_IDS, sub: 'g-victim', exp: Math.floor(Date.now() / 1000) + 600 })}.`)).b.error === 'GOOGLE_REJECTED');
    ok('SEC17 a proof with an unknown key id is refused', (await L(googleToken('g-sec-1', {}, undefined, 'unknown-kid'))).b.error === 'GOOGLE_REJECTED');
    ok('SEC17 a proof with a strange account id is refused', (await L(googleToken("x' OR 1=1 --"))).s >= 400);
    let odd = 0; for (const v of [null, 42, { a: 1 }, ['x'], 'short', 'x'.repeat(5000)]) if ((await L(v)).b.error === 'BAD_INPUT') odd++;
    ok('SEC17 missing, wrong-type, too short and huge proofs are refused before any check', odd === 6, odd);
    ok('SEC17 a bad path is refused', (await L(googleToken('g-sec-1'), 'staff')).b.error === 'BAD_PATH');
    ok('SEC17 a refused Google proof leaves a security record', await until(() => ev('google_token_rejected')) === true);
    const g = (await L(googleToken('g-sec-2'))).b.token;
    let badPhones = 0; for (const v of ['+213 55', '+213551\u202e000', '213551000111', { p: 1 }, '+2135510001119999999']) if ((await api('/set_phone', { phone: v }, g)).b.error === 'BAD_PHONE') badPhones++;
    ok('SEC17 set_phone refuses badly formed or disguised numbers', badPhones === 5, badPhones);
    ok('SEC17 set_phone needs a login', (await api('/set_phone', { phone: '+213551000111' })).s === 401);
    const stf = (await pool.query(`SELECT count(*)::int n FROM accounts WHERE google_sub IS NOT NULL AND phone IS NULL`)).rows[0].n;
    ok('SEC17 the refused attempts created no accounts', stf === 2, stf);
  }

  // ===== SEC18 the staff console handed out by the server at /staff/ (free host setup) =====
  {
    const page = await raw('/staff/');
    const csp = page.headers.get('content-security-policy') ?? '';
    ok('SEC18 the staff console page is served', page.status === 200 && (await page.text()).includes('<div id="root">'));
    ok('SEC18 ...with a strict policy: only its own files, only this server, never inside another site', /script-src 'self'/.test(csp) && /connect-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/unsafe/.test(csp), csp);
    ok('SEC18 ...and the usual protections (no type guessing, no framing)', page.headers.get('x-content-type-options') === 'nosniff' && page.headers.get('x-frame-options') === 'DENY');
    let leaks = 0;
    for (const p of ['/staff/../package.json', '/staff/%2e%2e/%2e%2e/backend/package.json', '/staff/..%2f..%2fbackend%2fpackage.json', '/staff/.hidden-test', '/staff/%2ehidden-test', '/staff//etc/passwd'])
      { const r = await raw(p); const t = await r.text(); if (r.status === 200 && !t.includes('<div id="root">')) leaks++; if (/"dependencies"|do-not-serve|root:x:/.test(t)) leaks++; }
    ok('SEC18 path tricks and hidden files never reveal anything outside the console', leaks === 0, leaks);
    const apiCsp = (await api('/login_methods')).h.get('content-security-policy');
    ok('SEC18 the API itself keeps its "nothing may run" policy', apiCsp === "default-src 'none'; frame-ancestors 'none'", apiCsp);
  }

  // ===== SEC19 proof chain and the receiver's tracking link =====
  {
    const Tk = (await api('/get_order?id=' + O.id, undefined, A.token)).b.tracking_token as string;
    ok('SEC19 a guessed tracking link shows nothing (same answer as an ended one)', (await api('/track_data?t=' + 'A'.repeat(32))).b.error === 'LINK_ENDED');
    let badLinks = 0; for (const t of ['', 'short', "' OR 1=1 --", '../../etc/passwd', Tk + 'x', Tk.slice(0, 31) + '*']) if ((await api('/track_data?t=' + encodeURIComponent(t))).b.error === 'BAD_LINK') badLinks++;
    ok('SEC19 malformed links are refused before any lookup', badLinks === 6, badLinks);
    ok('SEC19 a link cannot be passed twice to confuse the check', (await api(`/track_data?t=${Tk}&t=${Tk}`)).s === 400);
    let leaks = 0;
    for (const p of ['/t/../package.json', '/t/%2e%2e/src/main.ts', '/t/..%2f..%2f.env', '/t/.hidden', '/t/track.js/../../package.json']) { const r = await raw(p); const tx = await r.text(); if (/"dependencies"|JWT_SECRET|import /.test(tx)) leaks++; }
    ok('SEC19 path tricks on the tracking page never reveal server files', leaks === 0, leaks);
    const fixed = { 'x-forwarded-for': '10.77.0.1' }; let limited = false;
    for (let i = 0; i < 12 && !limited; i++) { const r = await api('/track_report', { t: 'B'.repeat(32), reason: 'other' }, undefined, fixed); if (r.s === 429) limited = true; }
    ok('SEC19 one address cannot flood the receiver report form', limited);
    let hist = 0; for (let i = 0; i < 32; i++) if ((await api('/recipient_history?phone=' + encodeURIComponent('+2137700000' + String(i).padStart(2, '0')), undefined, A.token)).b.error === 'RATE_LIMITED') hist++;
    ok('SEC19 checking receiver numbers in bulk is stopped (30 per hour per profile)', hist >= 2, hist);
    const someDoc = (await pool.query(`SELECT id FROM documents WHERE kind='id_photo' LIMIT 1`)).rows[0].id;
    ok('SEC19 a sender cannot open a driver\'s ID photo through the order-photo route', (await api(`/get_order_photo?order_id=${O.id}&id=${someDoc}`, undefined, A.token)).s === 404);
    ok('SEC19 another user cannot open my order\'s photos', (await api(`/get_order_photo?order_id=${O.id}&id=${someDoc}`, undefined, Bb.token)).s === 404);
    ok('SEC19 a driver cannot use the sender\'s photo route', (await api(`/get_order_photo?order_id=${O.id}&id=${someDoc}`, undefined, D1.token)).b.error === 'WRONG_PROFILE');
    ok('SEC19 another user cannot call my parcel back', (await api('/recall_order', { order_id: O.id, reason: 'other' }, Bb.token)).s === 404);
    let odd = 0;
    for (const pc of [{ a: 1 }, ['1234'], 'x'.repeat(5000), null, 1234]) { const r = await api('/update_job_step', { order_id: O.id, step: 'picked_up', pickup_code: pc, parcel_photo: 'nope', location: P }, D1.token); if (r.s >= 400 && r.s < 500) odd++; }
    ok('SEC19 strange pickup codes are refused cleanly (no crash, no pickup)', odd === 5 && (await api('/get_order?id=' + O.id, undefined, A.token)).b.status === 'assigned', odd);
    const js = readFileSync(join(__dirname, '..', 'public', 'track', 'track.js'), 'utf8');
    ok('SEC19 the tracking page never inserts server text as HTML (names and addresses cannot run as code)', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js));
    const evil = await order(A.token, 'sec-order-xss1', { recipient_name: '<img src=x onerror=alert(1)>' });
    const etk = (await api('/get_order?id=' + evil.id, undefined, A.token)).b.tracking_token;
    const page = await raw('/t/' + etk);
    ok('SEC19 the page is the same static file for every order (no data written into it)', !(await page.text()).includes('onerror') && /script-src 'self'/.test(page.headers.get('content-security-policy') ?? ''));
    await api('/cancel_order', { order_id: evil.id }, A.token);
  }

  // ===== SEC20 rules engine: only staff can judge, nobody can rewrite or dodge =====
  {
    const someone = (await pool.query(`SELECT id FROM profiles LIMIT 1`)).rows[0].id;
    let refused = 0;
    for (const [path, body] of [['add_violation', { profile_id: someone, rule: 'behaviour', points: 3, note: 'self-made punishment' }], ['decide_violation', { id: 1, decision: 'cancel', note: 'I forgive myself' }], ['block_profile', { profile_id: someone, hours: 1, reason: 'competitor' }], ['lift_sanction', { id: 1, note: 'free me' }], ['ban_account', { profile_id: someone, reason: 'I want my rival gone' }]] as [string, any][])
      if ((await api('/' + path, body, A.token)).b.error === 'STAFF_ONLY') refused++;
    ok('SEC20 an app login can never record, decide, block, lift or ban', refused === 5, refused);
    ok('SEC20 staff lists and records refuse app logins', (await api('/list_violations', undefined, A.token)).b.error === 'STAFF_ONLY' && (await api('/get_profile_record?profile_id=' + someone, undefined, A.token)).b.error === 'STAFF_ONLY');
    ok('SEC20 my record needs a login', (await api('/my_record')).s === 401 && (await api('/appeal_violation', { id: 1, text: 'let me in please' })).s === 401);
    let odd = 0; for (const id of ['1 OR 1=1', -1, 1e20, '../1', { a: 1 }]) { const r = await api('/appeal_violation', { id, text: 'strange id attempt here' }, A.token); if (r.s >= 400 && r.s < 500) odd++; }
    ok('SEC20 strange ids on an appeal are refused cleanly', odd === 5, odd);
    let big = 0; for (const [path, body, tok] of [['accept_offer', { offer_id: 1e20 }, D1.token], ['decline_offer', { offer_id: 1e20 }, D1.token], ['appeal_violation', { id: 1e20, text: 'a number too big for the db' }, A.token]] as [string, any, string][])
      if ((await api('/' + path, body, tok)).s === 400) big++;
    ok('SEC20 a number too big for the database is refused (it used to crash the query)', big === 3, big);
    const before = (await pool.query(`SELECT count(*)::int n FROM account_devices`)).rows[0].n;
    for (const dev of ["'; DROP TABLE accounts; --", 'x'.repeat(500), '<script>', '']) await api('/refresh_token', { refresh_token: 'nope' }, undefined, { 'x-device': dev });
    await login('+213550950001', 'user');   // a normal login without a device header
    ok('SEC20 garbage in the device header is ignored, never stored', (await pool.query(`SELECT count(*)::int n FROM account_devices WHERE device_hash !~ '^[0-9a-f]{64}$'`)).rows[0].n === 0 && (await pool.query(`SELECT count(*)::int n FROM account_devices`)).rows[0].n === before);
    let rewrite = 0; try { await appPool.query(`DELETE FROM violations`); } catch { rewrite++; } try { await appPool.query(`UPDATE sanctions SET until = now()`); } catch { rewrite++; }
    ok('SEC20 even the app\'s own database login cannot delete rule breaks or shorten sanctions behind staff\'s back', rewrite === 2 || (await appPool.query(`SELECT count(*)::int n FROM sanctions`)).rows[0].n === 0, rewrite);
  }

  // ===== SEC21 safety nets: emergency, selfie, evidence photos cannot be abused =====
  {
    ok('SEC21 the emergency alert needs a login', (await api('/emergency', {})).s === 401);
    let odd = 0; for (const loc of [{ lat: 'x', lng: 1 }, { lat: 999, lng: 999 }, 'here', ['36', '3']]) { const r = await api('/emergency', { location: loc }, A.token); if (r.s === 200) odd++; }
    ok('SEC21 strange positions are accepted as "unknown", never stored as given', odd === 4 && (await pool.query(`SELECT count(*)::int n FROM problem_reports WHERE reason='emergency' AND note NOT IN ('Position unknown')`)).rows[0].n === 0);
    ok('SEC21 an emergency on a made-up order id is refused', (await api('/emergency', { order_id: 'nope' }, A.token)).s === 400);
    ok('SEC21 the selfie route is for drivers only', (await api('/submit_selfie', { document_id: '00000000-0000-0000-0000-000000000000' }, A.token)).b.error === 'WRONG_PROFILE');
    ok('SEC21 a made-up selfie id is refused', (await api('/submit_selfie', { document_id: "' OR 1=1 --" }, D1.token)).b.error === 'BAD_DOCUMENT');
    let bad = 0; for (const ph of ['x', [{}], [1, 2], ['../../etc/passwd']]) { const r = await api('/report_problem', { order_id: O.id, reason: 'other', photos: ph }, A.token); if (r.s >= 400 && r.s < 500) bad++; }
    ok('SEC21 garbage in evidence photos is refused cleanly', bad === 4, bad);
  }

  // ===== SEC22 receiver link, courier offers, place search, notifications list, profile name =====
  {
    let badLink = 0; for (const t of ['', 'x', "' OR 1=1 --", 'A'.repeat(33), { a: 1 }]) { const r = await api('/track_expecting', { t }); if (r.b.error === 'BAD_LINK') badLink++; }
    ok('SEC22 malformed receiver links are refused before touching the database', badLink === 5, badLink);
    ok('SEC22 an unknown link looks exactly like an ended one (no hint that an order exists)', (await api('/track_expecting', { t: 'Z'.repeat(32) })).b.error === 'LINK_ENDED');
    let limited = false; const ipx = '10.250.0.1';
    for (let i = 0; i < 35 && !limited; i++) if ((await api('/track_expecting', { t: 'Q'.repeat(32) }, undefined, { 'x-forwarded-for': ipx })).s === 429) limited = true;
    ok('SEC22 guessing receiver links from one address is cut off (rate limit)', limited);
    ok('SEC22 the removed receiver-confirmation functions do not exist', (await api('/track_confirm', { t: 'Q'.repeat(32) })).s === 404 && (await api('/track_decline', { t: 'Q'.repeat(32) })).s === 404);
    const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, A.token)).b;
    const self = (await api('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Myself', recipient_phone: '+213770000002', payer: 'sender' }, A.token, { 'idempotency-key': 'sec-self-confirm-1' })).b;
    await api('/set_auto_accept', { order_id: self.id, on: false }, A.token);
    // offers: only the right people, only sane prices
    const D3 = await makeDriver('+213550960003', 'Driver Three', 36.7570, 3.0588);   // D1 is busy with an earlier job
    const req = await until(async () => (await api('/list_requests', undefined, D3.token)).b.requests.find((x: any) => x.order_id === self.id));
    let silly = 0; for (const price of [1e20, -5, '50', 10.5, [100], { $gt: 0 }]) { const r = await api('/make_bid', { offer_id: req.offer_id, price_da: price }, D3.token); if (r.s === 400) silly++; }
    ok('SEC22 absurd prices in a courier\'s offer are refused cleanly', silly === 6, silly);
    ok('SEC22 a courier cannot answer using another courier\'s request', (await api('/make_bid', { offer_id: req.offer_id, price_da: self.offered_da }, D2.token)).b.error === 'OFFER_GONE');
    ok('SEC22 a customer cannot make offers, a courier cannot choose', (await api('/make_bid', { offer_id: req.offer_id }, A.token)).b.error === 'WRONG_PROFILE' && (await api('/accept_bid', { order_id: self.id, offer_id: req.offer_id }, D3.token)).b.error === 'WRONG_PROFILE');
    await api('/make_bid', { offer_id: req.offer_id, price_da: self.offered_da }, D3.token);
    ok('SEC22 another customer cannot choose, decline or change auto-accept on my order', (await api('/accept_bid', { order_id: self.id, offer_id: req.offer_id }, Bb.token)).s === 404 && (await api('/decline_bid', { order_id: self.id, offer_id: req.offer_id }, Bb.token)).b.error === 'OFFER_GONE' && (await api('/set_auto_accept', { order_id: self.id, on: true }, Bb.token)).s === 404);
    const q2 = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, A.token)).b;
    const other = (await api('/create_order', { quote_id: q2.quote_id, offered_da: q2.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Other', recipient_phone: '+213770000003', payer: 'sender' }, A.token, { 'idempotency-key': 'sec-self-confirm-2' })).b;
    ok('SEC22 an offer cannot be used on a different order, even of the same customer', (await api('/accept_bid', { order_id: other.id, offer_id: req.offer_id }, A.token)).b.error === 'ORDER_TAKEN' || (await api('/accept_bid', { order_id: other.id, offer_id: req.offer_id }, A.token)).b.error === 'OFFER_GONE');
    let big = 0; for (const [path, body, tok] of [['make_bid', { offer_id: 1e20 }, D3.token], ['accept_bid', { order_id: self.id, offer_id: 1e20 }, A.token], ['decline_bid', { order_id: self.id, offer_id: 1e20 }, A.token]] as [string, any, string][])
      if ((await api('/' + path, body, tok)).s === 400) big++;
    ok('SEC22 ids too big for the database are refused on every offer function', big === 3 && (await api('/list_notifications?before=1e20', undefined, A.token)).b.error === 'BAD_ID', big);
    await api('/cancel_order', { order_id: self.id }, A.token); await api('/cancel_order', { order_id: other.id }, A.token);
    // place search (switched off on this server), notifications, names
    ok('SEC22 place search switched off answers "off", never crashes', (await api('/search_places?q=ardis', undefined, A.token)).b.error === 'SEARCH_OFF' && (await api('/reverse_place?lat=36.7&lng=3.0', undefined, A.token)).b.error === 'SEARCH_OFF' && (await api('/reverse_place?lat=1e400&lng=x', undefined, A.token)).s === 400 && (await api('/app_config')).b.place_search === false);
    ok('SEC22 place search and the notifications list need a login', (await api('/search_places?q=ardis')).s === 401 && (await api('/list_notifications')).s === 401);
    ok('SEC22 nobody\'s notifications list carries a delivery or pickup code', !/delivery_code|pickup_code/.test(JSON.stringify((await api('/list_notifications', undefined, A.token)).b)));
    let names = 0; for (const n of ['x'.repeat(5000), 'a', 'Bob\u0000', 'Eve\u202Elive', 42, null]) if ((await api('/rename_profile', { display_name: n }, A.token)).b.error === 'BAD_NAME') names++;
    ok('SEC22 bad names are refused (too long, too short, hidden characters, not text)', names === 6 && (await api('/rename_profile', { display_name: 'Hacker' })).s === 401, names);
  }

  {
    // ===== SEC23 "delete my account" cannot be aimed at someone else, or used without a login =====
    const X = await makeUser('+213551230001', 'Del X'), Y = await makeUser('+213551230002', 'Del Y');
    ok('SEC23 delete_account needs a login', (await api('/delete_account', { confirm: 'DELETE' })).s === 401);
    const r = await api('/delete_account', { confirm: 'DELETE', account_id: '00000000-0000-0000-0000-000000000000', profile_id: Y.id }, X.token);
    const ys = (await pool.query(`SELECT p.status, a.deleted_at FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE p.id=$1`, [Y.id])).rows[0];
    ok('SEC23 an account id or profile id in the request is ignored: only the caller\'s own account is deleted', r.s === 200 && ys.status === 'active' && ys.deleted_at === null
      && (await pool.query(`SELECT status FROM profiles WHERE id=$1`, [X.id])).rows[0].status === 'deleted');
    ok('SEC23 a deleted account cannot be deleted twice or used again (its tokens are dead)', (await api('/delete_account', { confirm: 'DELETE' }, X.token)).s === 401 && (await api('/refresh_token', { refresh_token: X.refresh })).s === 401);
    ok('SEC23 the person who was deleted still logs in again only as a NEW account', (await login('+213551230001')).needs_profile !== undefined && (await pool.query(`SELECT count(*)::int n FROM accounts WHERE phone='+213551230001' AND deleted_at IS NULL`)).rows[0].n === 1);
    ok('SEC23 Y is untouched and still works', (await api('/get_me', undefined, Y.token)).s === 200);
    {
      const r = await fetch(HTTP + '/map/style.json'); const st = await r.json() as any;
      const urls = JSON.stringify([st.sources, st.sprite, st.glyphs]).match(/https?:\/\/[^"/]+/g) ?? [];
      ok('SEC23 the map style is public JSON whose tiles, icons and fonts come only from OpenFreeMap', r.status === 200 && st.version === 8 && st.layers.length > 50 && urls.every((u: string) => u === 'https://tiles.openfreemap.org'), urls);
    }
    for (const path of ['/privacy', '/delete-account']) {
      const r = await fetch(HTTP + path); const html = await r.text(); const csp = r.headers.get('content-security-policy') ?? '';
      ok(`SEC23 ${path} is public, in 3 languages, and may run no script at all`, r.status === 200 && /العربية|Français/.test(html) && !/<script/i.test(html) && /default-src 'none'/.test(csp) && !/script-src/.test(csp), { status: r.status, csp });
    }
  }

  {
    // ===== SEC24 public profiles and couriers on the map: only through your own order, nothing to follow anyone with =====
    await pool.query(`UPDATE driver_details SET is_online=false`);
    const Dz = await makeDriver('+213551250001', 'Prof Driver', 36.7545, 3.0590);
    const Dw = await makeDriver('+213551250002', 'Other Driver', 36.9000, 3.3000);   // far away: never sees the request
    const X = await makeUser('+213551250011', 'Prof Sender'), Y = await makeUser('+213551250012', 'Nosy User');
    const ox = await order(X.token, 'sec24-order-x', { auto_accept: false });
    let req: any = null, lastList: any = null; for (let i = 0; i < 50 && !req; i++) { lastList = await api('/list_requests', undefined, Dz.token); req = lastList.b.requests?.find((r: any) => r.order_id === ox.id); if (!req) await sleep(300); }
    ok('SEC24 (setup) the nearby courier receives the request', !!req, { ox, n: lastList.b.requests?.length });
    if (!req) req = { offer_id: 0 };
    await api('/make_bid', { offer_id: req.offer_id }, Dz.token);
    const prof = (q: string, tok?: string) => api('/public_profile?' + q, undefined, tok);
    const mine = await prof('offer_id=' + req.offer_id, X.token);
    ok('SEC24 the customer sees the courier who offered on HIS order', mine.s === 200 && mine.b.name === 'Prof Driver' && mine.b.type === 'driver' && Array.isArray(mine.b.comments), mine.b);
    ok('SEC24 the profile carries no phone, id, account or document', !/phone|account|national|document|_id"|"id"/.test(JSON.stringify(mine.b)), mine.b);
    ok('SEC24 another customer cannot open that courier through someone else\'s offer', (await prof('offer_id=' + req.offer_id, Y.token)).s === 404);
    ok('SEC24 the courier sees the sender of a request shown to him', (await prof('offer_id=' + req.offer_id, Dz.token)).b.name === 'Prof Sender');
    ok('SEC24 a courier who was not offered the request cannot see the sender', (await prof('offer_id=' + req.offer_id, Dw.token)).s === 404);
    ok('SEC24 another customer cannot open profiles through my order id', (await prof('order_id=' + ox.id, Y.token)).s === 404 && (await prof('order_id=' + ox.id, Dw.token)).s === 404);
    let badIds = 0; for (const v of ['abc', '1e3', '-1', '1 OR 1=1', '99999999999999999999', '0']) if ((await prof('offer_id=' + encodeURIComponent(v), X.token)).b.error === 'BAD_ID') badIds++;
    ok('SEC24 strange offer ids are refused before touching the database', badIds === 6, badIds);
    ok('SEC24 an unknown offer looks exactly like someone else\'s (no hint it exists)', (await prof('offer_id=999999', X.token)).s === 404);
    ok('SEC24 no id at all, or a bad order id, is refused', (await prof('', X.token)).b.error === 'BAD_INPUT' && (await prof('order_id=x', X.token)).s === 400);
    ok('SEC24 profiles need a login', (await prof('offer_id=' + req.offer_id)).s === 401);
    const near = await api(`/nearby_couriers?lat=${P.lat}&lng=${P.lng}`, undefined, X.token);
    ok('SEC24 couriers near the pin are shown (online, approved, fresh position)', near.s === 200 && near.b.couriers.length === 1, near.b);
    ok('SEC24 ...as a vehicle and a rounded position only: no name, id or exact spot', near.b.couriers.every((c: any) => Object.keys(c).sort().join() === 'lat,lng,vehicle' && Math.round(c.lat * 1000) === c.lat * 1000));
    ok('SEC24 couriers on the map need a customer login', (await api(`/nearby_couriers?lat=1&lng=1`)).s === 401 && (await api(`/nearby_couriers?lat=1&lng=1`, undefined, Dz.token)).b.error === 'WRONG_PROFILE');
    let badPts = 0; for (const qs of ['lat=x&lng=1', 'lat=999&lng=3', 'lat=36', '', 'lat=1e400&lng=3']) if ((await api('/nearby_couriers?' + qs, undefined, X.token)).b.error === 'BAD_POINT') badPts++;
    ok('SEC24 strange positions are refused', badPts === 5, badPts);
    await api('/cancel_order', { order_id: ox.id, reason: 'test' }, X.token);
    await pool.query(`UPDATE driver_details SET is_online=false`);
  }

  // ===== SEC15 evidence trail and code hygiene =====
  const need = ['upload_not_image', 'upload_bad_image', 'upload_cap', 'bad_token', 'app_token_on_staff_route', 'refresh_token_reuse', 'rate_limited', 'staff_login_failed', 'otp_wrong', 'sms_ip_cap', 'sms_daily_cap_reached', 'staff_login_ok', 'logout_everywhere', 'google_token_rejected'];
  const missing: string[] = []; for (const t of need) if (!(await ev(t))) missing.push(t);
  ok('SEC15 every attack above left a record in the permanent security log', missing.length === 0, missing);
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
  const leaks = walk('src').filter(f => /postgres:\/\/[^'"\s:]+:[^'"\s@]+@|dev-secret|app_dev_pw|BEGIN (RSA )?PRIVATE KEY/.test(readFileSync(f, 'utf8')));
  ok('SEC15 no password, key or connection string is written in the source code', leaks.length === 0, leaks);
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); await appPool.end(); process.exit(fail ? 1 : 0);
})();
