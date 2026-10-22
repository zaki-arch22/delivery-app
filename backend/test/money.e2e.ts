// The money system against the real server and the TEST database: payout accounts (BaridiMob RIP), cash-on-delivery money
// sent by the courier straight to the seller within 24 hours and confirmed (or disputed) by the seller, the overdue watchdog,
// staff decisions, the courier's prepaid wallet and 10% commission, the growing cash limit, and attacks on all of it.
import { Pool } from 'pg';
import { driverDocs, upload, setPayout, DRIVER_INFO } from './docs';
import { proof } from './proof';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/security/crypto';
import { codeAt, newSecret, stepNow } from '../src/security/totp';
import { ELIGIBLE_SQL } from '../src/orders/matching.service';
const HTTP = process.env.API ?? 'http://localhost:3399';
process.env.PLATFORM_RIP ??= '00799999009999999999';   // the same platform account as the server (eligibility is checked here too)
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('test database only');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const appPool = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL });
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 10000): Promise<T | null> { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v as T; await sleep(200); } return null; }
async function api(path: string, body?: any, token?: string, headers: any = {}) {
  const r = await fetch(HTTP + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') ?? '';
  return { s: r.status, type, b: (type.includes('json') ? await r.json().catch(() => ({})) : {}) as any };
}
async function login(phone: string, path: 'user' | 'driver') {
  await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).b.code;
  return (await api('/verify_code', { phone, code: c, path })).b;
}
const nid = () => String(1e11 + Math.floor(Math.random() * 9e11));
async function makeUser(phone: string, name: string, payout = true) {
  const l = await login(phone, 'user'); const r = await api('/add_profile', { accept_rules: true, type: 'user', display_name: name }, l.token);
  if (payout) await setPayout(HTTP, r.b.token);
  return { token: r.b.token as string, id: r.b.active_profile.id as string };
}
async function makeDriver(phone: string, name: string, at = { lat: 36.7585, lng: 3.0588 }) {
  const l = await login(phone, 'driver'); const r = await api('/add_profile', { accept_rules: true, national_id: nid(), type: 'driver', display_name: name, documents: await driverDocs(HTTP, l.token) }, l.token);
  const id = r.b.active_profile.id; await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [id]); await pool.query(`UPDATE driver_details SET cash_limit_da=50000 WHERE profile_id=$1`, [id]);
  await api('/set_online', { online: true }, r.b.token); await api('/update_location', at, r.b.token);
  return { token: r.b.token as string, id: id as string, at };
}
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.765, lng: 3.07 }, adr = { street: 'Rue Didouche Mourad' };
async function order(tok: string, key: string, extra: any = {}) {
  const q = (await api('/get_quote', { pickup: P, dropoff: D, size: 'small' }, tok)).b;
  return api('/create_order', { auto_accept: true, quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: adr, dropoff_address: adr, recipient_name: 'Amine', recipient_phone: '+213770000001', payer: 'sender', ...extra }, tok, { 'idempotency-key': key });
}
const offerFor = (t: string, ms = 8000) => until(async () => (await api('/get_current_offer', undefined, t)).b.offer, ms);
const eligible = async (driverId: string, orderId: string) => (await pool.query(`SELECT 1 FROM driver_details d JOIN profiles p ON p.id=d.profile_id JOIN orders o ON o.id=$2 WHERE d.profile_id=$1 AND ${ELIGIBLE_SQL('p', 'o')}`, [driverId, orderId])).rowCount === 1;
const notified = async (pid: string, kind: string) => (await pool.query(`SELECT 1 FROM notifications WHERE profile_id=$1 AND type=$2`, [pid, kind])).rowCount! > 0;
const cashHeld = async (pid: string) => (await pool.query(`SELECT COALESCE(sum(amount_da),0)::int n FROM cash_ledger WHERE driver_profile_id=$1`, [pid])).rows[0].n;

(async () => {
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, wallet_ledger, wallet_topups, cod_settlements, payout_accounts, problem_reports, notifications, device_tokens, orders, driver_details, document_files, documents, profiles, accounts, zones, pricing_rules, staff_audit, staff_users, security_events, violations, sanctions RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('test', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, min_percent, max_percent, active) VALUES (100, 30, 80, 150, true)`);   // TEST numbers only; commission 10% by default
  const secret = newSecret(); await pool.query(`INSERT INTO staff_users(email,name,password_hash,totp_secret_sealed) VALUES ('money@test.example','Money Boss',$1,$2)`, [hashPassword('correct-horse-battery-1'), seal(secret, 'totp')]);
  const ST = (await api('/staff_login', { email: 'money@test.example', password: 'correct-horse-battery-1', code: codeAt(secret, stepNow()) })).b.token as string;
  const S = (path: string, body?: any) => api(path, body, ST);
  const PR = proof(api, async t => (await upload(HTTP, t, 'parcel_photo')).b.document_id);
  const receipt = async (t: string) => (await upload(HTTP, t, 'transfer_receipt')).b.document_id as string;

  // ===== M1 payout account (where a person receives money) =====
  const A = await makeUser('+213552000001', 'Amel Seller', false);
  ok('M1 no payout account at first', (await api('/get_payout_account', undefined, A.token)).b.payout === null);
  for (const [why, rip] of [['wrong bank code', '00800000001234567890'], ['19 digits', '0079999900123456789'], ['letters', '0079999900123456789X'], ['empty', ''], ['a number', 799999]] as const)
    ok(`M1 a bad RIP is refused (${why})`, (await api('/set_payout_account', { rip, holder_name: 'Amel B' }, A.token)).b.error === 'BAD_RIP');
  ok('M1 the holder name is required (3-80)', (await api('/set_payout_account', { rip: '00799999001111111111', holder_name: 'A' }, A.token)).b.error === 'BAD_TEXT');
  ok('M1 hidden text-direction tricks in the holder name are refused', (await api('/set_payout_account', { rip: '00799999001111111111', holder_name: 'Amel‮live' }, A.token)).b.error === 'BAD_TEXT');
  let r: any = await api('/set_payout_account', { rip: '007 99999 0011111111 22', holder_name: 'Amel Benali' }, A.token);
  ok('M1 a RIP with spaces is accepted and stored as 20 digits', r.s === 200 && r.b.payout.rip === '00799999001111111122', r.b);
  ok('M1 the account is shown in get_me', (await api('/get_me', undefined, A.token)).b.payout?.holder_name === 'Amel Benali');
  ok('M1 the first setting is logged, without the full number', (await pool.query(`SELECT detail FROM security_events WHERE type='payout_set'`)).rows[0]?.detail?.last4 === '1122');

  // ===== M2 cash-on-delivery orders need the seller's account; at most 30,000 DA =====
  const NP = await makeUser('+213552000002', 'No Payout', false);
  r = await order(NP.token, 'money-key-np', { cod_amount_da: 2000 });
  ok('M2 a cash-on-delivery order without a payout account is refused (428)', r.s === 428 && r.b.error === 'PAYOUT_ACCOUNT_REQUIRED', r.b);
  ok('M2 an order without cash on delivery needs no account', (await order(NP.token, 'money-key-np2')).s === 200);
  ok('M2 more than 30,000 DA of goods money is refused', (await order(A.token, 'money-key-big', { cod_amount_da: 30001 })).b.error === 'COD_TOO_HIGH');
  // A courier needs an account to sign up.
  let l = await login('+213552000003', 'driver'); const docs: any = { vehicle: 'motorbike', ...DRIVER_INFO };
  for (const k of ['id_photo', 'licence_photo', 'ownership_photo', 'vehicle_photo']) docs[k] = (await upload(HTTP, l.token, k)).b.document_id;
  r = await api('/add_profile', { accept_rules: true, national_id: nid(), type: 'driver', display_name: 'No Rip Driver', documents: docs }, l.token);
  ok('M2 a courier cannot sign up without a payout account', r.s === 428 && r.b.error === 'PAYOUT_ACCOUNT_REQUIRED', r.b);
  await api('/cancel_order', { order_id: (await pool.query(`SELECT id FROM orders WHERE status='searching' LIMIT 1`)).rows[0].id }, NP.token);

  // ===== M3 the cash limit starts at 5,000 DA and grows with experience =====
  const D1 = await makeDriver('+213552000010', 'Driver One');
  let w = (await api('/get_wallet', undefined, D1.token)).b;
  ok('M3 a new courier\'s cash limit is 5,000 DA (under the 50,000 ceiling staff set)', w.cash_limit_da === 5000, w);
  r = await order(A.token, 'money-key-6000', { cod_amount_da: 6000 }); const big = r.b;
  ok('M3 a 6,000 DA cash order is not shown to a new courier', !(await eligible(D1.id, big.id)) && !(await offerFor(D1.token, 2500)));
  await api('/cancel_order', { order_id: big.id }, A.token);

  // ===== M4 delivery: commission from the wallet, goods money owed to the seller within 24 h =====
  r = await order(A.token, 'money-key-01', { cod_amount_da: 3000 }); const o1 = r.b;
  ok('M4 the seller\'s account is copied onto the order', (await pool.query(`SELECT cod_rip, cod_holder FROM orders WHERE id=$1`, [o1.id])).rows[0].cod_rip === '00799999001111111122');
  await api('/set_payout_account', { rip: '00799999002222222233', holder_name: 'Amel Benali' }, A.token);
  ok('M4 changing the account later never redirects money already on its way', (await pool.query(`SELECT cod_rip FROM orders WHERE id=$1`, [o1.id])).rows[0].cod_rip === '00799999001111111122');
  ok('M4 changing the account is announced to the person', await notified(A.id, 'payout.changed'));
  let f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
  await PR.pickup(o1.id, A.token, D1.token); r = await PR.deliver(o1.id, A.token, D1.token, { cash_collected_da: 3000 });
  ok('M4 delivered', r.s === 200 && r.b.order_status === 'delivered', r.b);
  const locked = (await pool.query(`SELECT locked_da, commission_da FROM orders WHERE id=$1`, [o1.id])).rows[0];
  w = (await api('/get_wallet', undefined, D1.token)).b;
  ok('M4 10% commission is taken from the courier\'s wallet', locked.commission_da === Math.round(locked.locked_da / 10) && w.balance_da === -locked.commission_da && w.entries[0].type === 'commission', { locked, w });
  ok('M4 the wallet shows the platform account to top up', w.active === true && w.platform_account?.rip === '00799999009999999999' && w.commission_percent === 10);
  let st = (await api('/list_settlements', undefined, D1.token)).b;
  ok('M4 the courier owes the seller 3,000 DA, due in 24 hours, with the seller\'s account', st.to_send_da === 3000 && st.settlements[0].seller_rip === '00799999001111111122' && st.settlements[0].seller_holder === 'Amel Benali'
    && Math.abs(new Date(st.settlements[0].due_at).getTime() - Date.now() - 24 * 3600_000) < 120_000, st);
  ok('M4 the courier and the seller are told', await notified(D1.id, 'settlement.due') && await notified(A.id, 'sale.collected'));
  ok('M4 the goods money is on the courier\'s cash account until the seller confirms', await cashHeld(D1.id) === 3000);
  let sales = (await api('/list_sales', undefined, A.token)).b;
  ok('M4 the seller sees the money waiting', sales.waiting_da === 3000 && sales.sales[0].status === 'pending' && sales.sales[0].driver_name === 'Driver One', sales);

  // ===== M5 the courier sends it by BaridiMob (reference + receipt photo), the seller sees it =====
  ok('M5 the seller cannot dispute while the courier still has time', (await api('/dispute_settlement', { order_id: o1.id, note: 'not yet' }, A.token)).b.error === 'CANNOT_DISPUTE');
  ok('M5 BaridiMob needs a receipt photo', (await api('/mark_settlement_sent', { order_id: o1.id, method: 'baridimob', reference: 'BM123456' }, D1.token)).b.error === 'PHOTO_REQUIRED');
  ok('M5 BaridiMob needs the transfer reference', (await api('/mark_settlement_sent', { order_id: o1.id, method: 'baridimob', receipt_photo: await receipt(D1.token) }, D1.token)).b.error === 'BAD_TEXT');
  ok('M5 a reference with strange characters is refused', (await api('/mark_settlement_sent', { order_id: o1.id, method: 'baridimob', reference: '<script>1', receipt_photo: await receipt(D1.token) }, D1.token)).b.error === 'BAD_REFERENCE');
  ok('M5 a parcel photo cannot stand in for a receipt', (await api('/mark_settlement_sent', { order_id: o1.id, method: 'baridimob', reference: 'BM123456', receipt_photo: (await upload(HTTP, D1.token, 'parcel_photo')).b.document_id }, D1.token)).b.error === 'BAD_DOCUMENT');
  ok('M5 an unknown method is refused', (await api('/mark_settlement_sent', { order_id: o1.id, method: 'paypal' }, D1.token)).b.error === 'BAD_METHOD');
  const D2 = await makeDriver('+213552000011', 'Driver Two', { lat: 36.70, lng: 3.20 }); await api('/set_online', { online: false }, D2.token);
  ok('M5 another courier cannot mark this payment', (await api('/mark_settlement_sent', { order_id: o1.id, method: 'cash' }, D2.token)).s === 404);
  r = await api('/mark_settlement_sent', { order_id: o1.id, method: 'baridimob', reference: 'BM-2026/0001', receipt_photo: await receipt(D1.token) }, D1.token);
  ok('M5 sent with the reference and the receipt', r.s === 200 && r.b.settlements[0].status === 'sent' && r.b.waiting_confirmation_da === 3000, r.b);
  ok('M5 sending twice is refused', (await api('/mark_settlement_sent', { order_id: o1.id, method: 'cash' }, D1.token)).b.error === 'ALREADY_SENT');
  ok('M5 the seller is told', await notified(A.id, 'sale.sent'));
  r = await api('/get_settlement_receipt?order_id=' + o1.id, undefined, A.token);
  ok('M5 the seller can see the receipt photo', r.s === 200 && r.type.startsWith('image/jpeg'));
  const B = await makeUser('+213552000004', 'Other Seller');
  ok('M5 nobody else can see the receipt', (await api('/get_settlement_receipt?order_id=' + o1.id, undefined, B.token)).s === 404 && (await api('/get_settlement_receipt?order_id=' + o1.id, undefined, D2.token)).s === 404);
  ok('M5 every step is in the order\'s history', (await pool.query(`SELECT 1 FROM order_events WHERE order_id=$1 AND type='settlement_sent' AND data->>'reference'='BM-2026/0001'`, [o1.id])).rowCount === 1);

  // ===== M6 dispute, then confirmation =====
  ok('M6 another seller cannot dispute or confirm it', (await api('/dispute_settlement', { order_id: o1.id, note: 'mine' }, B.token)).s === 404 && (await api('/confirm_settlement', { order_id: o1.id }, B.token)).s === 404);
  ok('M6 a dispute needs a reason', (await api('/dispute_settlement', { order_id: o1.id }, A.token)).b.error === 'BAD_TEXT');
  r = await api('/dispute_settlement', { order_id: o1.id, note: 'Nothing arrived on my account' }, A.token);
  ok('M6 the seller disputes: staff get a case, the courier is told', r.s === 200 && r.b.sales[0].status === 'disputed' && await notified(D1.id, 'settlement.disputed')
    && (await pool.query(`SELECT 1 FROM problem_reports WHERE order_id=$1 AND reason='cod_not_received'`, [o1.id])).rowCount === 1);
  r = await order(A.token, 'money-key-02'); const o2 = r.b;
  ok('M6 a courier with a disputed payment gets no new requests', !(await eligible(D1.id, o2.id)));
  r = await api('/confirm_settlement', { order_id: o1.id }, A.token);
  ok('M6 the seller confirms (the money arrived after all)', r.s === 200 && r.b.received_da === 3000 && r.b.waiting_da === 0);
  ok('M6 the courier\'s cash account goes back to 0 and he is told', await cashHeld(D1.id) === 0 && await notified(D1.id, 'settlement.confirmed'));
  ok('M6 confirming twice is refused', (await api('/confirm_settlement', { order_id: o1.id }, A.token)).b.error === 'ALREADY_CLOSED');
  ok('M6 he gets requests again', await eligible(D1.id, o2.id));
  await api('/cancel_order', { order_id: o2.id }, A.token);

  // ===== M7 the 24 hours pass: points, no new work, staff decide =====
  r = await order(A.token, 'money-key-03', { cod_amount_da: 2500 }); const o3 = r.b;
  f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
  await PR.pickup(o3.id, A.token, D1.token); await PR.deliver(o3.id, A.token, D1.token, { cash_collected_da: 2500 });
  await pool.query(`UPDATE cod_settlements SET due_at = now() - interval '1 minute' WHERE order_id=$1`, [o3.id]);
  const late = await until(async () => (await pool.query(`SELECT overdue_at FROM cod_settlements WHERE order_id=$1 AND overdue_at IS NOT NULL`, [o3.id])).rows[0], 8000);
  ok('M7 the watchdog marks the payment late', !!late);
  ok('M7 a late payment costs the courier 3 points, once', (await pool.query(`SELECT points FROM violations WHERE profile_id=$1 AND rule='cod_late'`, [D1.id])).rows.map(x => x.points).join() === '3');
  ok('M7 both are told, staff get a case', await notified(D1.id, 'settlement.overdue') && await notified(A.id, 'sale.overdue')
    && (await pool.query(`SELECT 1 FROM problem_reports WHERE order_id=$1 AND reason='check:cod_overdue'`, [o3.id])).rowCount === 1);
  r = await order(A.token, 'money-key-04'); const o4 = r.b;
  ok('M7 a courier with a late payment gets no new requests', !(await eligible(D1.id, o4.id)));
  ok('M7 now the seller may dispute', (await api('/dispute_settlement', { order_id: o3.id, note: 'Late and nothing came' }, A.token)).s === 200);
  ok('M7 staff see the dispute first', (await S('/list_settlements_staff?status=disputed')).b.settlements[0]?.order_id === o3.id);
  ok('M7 staff must give an outcome and a note', (await S('/resolve_settlement', { order_id: o3.id, outcome: 'maybe', note: 'x' })).b.error === 'BAD_OUTCOME' && (await S('/resolve_settlement', { order_id: o3.id, outcome: 'paid' })).b.error === 'BAD_TEXT');
  r = await S('/resolve_settlement', { order_id: o3.id, outcome: 'paid', note: 'Courier showed the BaridiMob history: paid on time to the right RIP' });
  ok('M7 staff decide "paid": the debt closes, both are told, the case closes', r.s === 200 && await cashHeld(D1.id) === 0
    && (await pool.query(`SELECT status FROM cod_settlements WHERE order_id=$1`, [o3.id])).rows[0].status === 'resolved_paid'
    && (await pool.query(`SELECT count(*)::int n FROM notifications WHERE type='settlement.resolved' AND order_id=$1`, [o3.id])).rows[0].n === 2
    && (await pool.query(`SELECT count(*)::int n FROM problem_reports WHERE order_id=$1 AND status <> 'resolved'`, [o3.id])).rows[0].n === 0);
  ok('M7 a closed payment cannot be decided again', (await S('/resolve_settlement', { order_id: o3.id, outcome: 'unpaid', note: 'again' })).b.error === 'ALREADY_CLOSED');
  ok('M7 the decision is in the audit log', (await S('/list_audit_log?action=resolve_settlement')).b.entries[0]?.target_id === o3.id);
  await api('/cancel_order', { order_id: o4.id }, A.token);

  // ===== M8 attacks =====
  ok('M8 a sender cannot use courier money routes', (await api('/list_settlements', undefined, A.token)).s === 403 && (await api('/mark_settlement_sent', { order_id: o1.id, method: 'cash' }, A.token)).s === 403 && (await api('/get_wallet', undefined, A.token)).s === 403);
  ok('M8 a courier cannot use seller routes', (await api('/list_sales', undefined, D1.token)).s === 403 && (await api('/confirm_settlement', { order_id: o1.id }, D1.token)).s === 403);
  ok('M8 money routes need a login', (await api('/set_payout_account', { rip: '00799999001111111122', holder_name: 'Evil' })).s === 401 && (await api('/get_payout_account')).s === 401);
  for (const p of ['/list_settlements_staff', '/list_topups', '/get_dashboard', '/get_staff_alerts', '/get_live_operations', '/get_day_log', '/staff_search?q=Amel', '/list_audit_log', '/list_users', '/get_driver_wallet?profile_id=' + D1.id])
    ok(`M8 ${p} is for staff only`, (await api(p, undefined, A.token)).b.error === 'STAFF_ONLY');
  for (const p of ['/resolve_settlement', '/decide_topup', '/add_wallet_adjustment', '/set_cash_limit', '/mark_alerts_seen'])
    ok(`M8 ${p} is for staff only`, (await api(p, { order_id: o1.id }, D1.token)).b.error === 'STAFF_ONLY');
  ok('M8 bad ids are refused cleanly', (await api('/confirm_settlement', { order_id: "1' OR '1'='1" }, A.token)).b.error === 'BAD_ID' && (await S('/decide_topup', { id: 1e20, decision: 'approve' })).b.error === 'BAD_ID');
  const denied = async (sql: string) => { try { await appPool.query(sql); return false; } catch { return true; } };
  ok('M8 the app\'s own database role cannot rewrite the wallet history', await denied(`UPDATE wallet_ledger SET amount_da = 1000000`) && await denied(`DELETE FROM wallet_ledger`));
  ok('M8 nor pay a seller twice in the cash account', await denied(`INSERT INTO cash_ledger(driver_profile_id, order_id, type, amount_da) VALUES ('${D1.id}', '${o1.id}', 'paid_to_seller', -3000)`));
  ok('M8 nor delete a seller payment', await denied(`DELETE FROM cod_settlements`));

  // ===== M9 the prepaid wallet: top-ups checked by staff, commission credit =====
  const start = (await api('/get_wallet', undefined, D1.token)).b.balance_da;
  ok('M9 a top-up needs an amount of 100 to 200,000 DA', (await api('/request_topup', { amount_da: 50, reference: 'TOPUP001', receipt_photo: await receipt(D1.token) }, D1.token)).b.error === 'BAD_AMOUNT');
  ok('M9 a top-up needs the receipt photo', (await api('/request_topup', { amount_da: 1000, reference: 'TOPUP001' }, D1.token)).b.error === 'PHOTO_REQUIRED');
  r = await api('/request_topup', { amount_da: 1000, reference: 'TOPUP001', receipt_photo: await receipt(D1.token) }, D1.token);
  ok('M9 top-up requested: nothing is added until staff check it', r.s === 200 && r.b.topups[0].status === 'pending' && r.b.balance_da === start, r.b);
  ok('M9 the same transfer reference cannot be used twice', (await api('/request_topup', { amount_da: 1000, reference: 'TOPUP001', receipt_photo: await receipt(D1.token) }, D1.token)).b.error === 'REFERENCE_USED');
  const t2 = (await api('/request_topup', { amount_da: 500, reference: 'TOPUP002', receipt_photo: await receipt(D1.token) }, D1.token)).b.topup_id;
  let tl = (await S('/list_topups')).b;
  ok('M9 staff see waiting top-ups with the platform account', tl.topups.length === 2 && tl.platform_account?.holder_name === 'Test Platform' && !!tl.topups[0].receipt_doc);
  ok('M9 a rejection needs a reason', (await S('/decide_topup', { id: t2, decision: 'reject' })).b.error === 'BAD_TEXT');
  const before = (await api('/get_wallet', undefined, D1.token)).b.balance_da;
  ok('M9 approve one', (await S('/decide_topup', { id: tl.topups[0].id, decision: 'approve' })).s === 200 && (await api('/get_wallet', undefined, D1.token)).b.balance_da === before + 1000);
  ok('M9 reject the other', (await S('/decide_topup', { id: t2, decision: 'reject', reason: 'No transfer with this reference on the account' })).s === 200 && await notified(D1.id, 'wallet.topup_rejected') && await notified(D1.id, 'wallet.topup_approved'));
  ok('M9 a top-up is decided once', (await S('/decide_topup', { id: t2, decision: 'approve' })).b.error === 'ALREADY_DECIDED');
  ok('M9 staff can view the receipt photo (audited)', (await api('/get_document?id=' + tl.topups[0].receipt_doc, undefined, ST)).s === 200);
  r = await order(A.token, 'money-key-05'); const o5 = r.b;
  ok('M9 a courier inside the commission credit gets requests', await eligible(D1.id, o5.id));
  ok('M9 a wallet adjustment needs a note', (await S('/add_wallet_adjustment', { driver_profile_id: D1.id, amount_da: -5000 })).b.error === 'BAD_TEXT');
  r = await S('/add_wallet_adjustment', { driver_profile_id: D1.id, amount_da: -5000, note: 'Test: commission owed from an older period' });
  ok('M9 staff correct a wallet (a new entry, never an edit)', r.s === 200 && r.b.balance_da === before + 1000 - 5000);
  ok('M9 a courier owing more than the credit gets no new requests', !(await eligible(D1.id, o5.id)));
  await S('/add_wallet_adjustment', { driver_profile_id: D1.id, amount_da: 5000, note: 'Test: undo' });
  ok('M9 paid back, he gets requests again', await eligible(D1.id, o5.id));
  const sw = (await S('/get_driver_wallet?profile_id=' + D1.id)).b;
  ok('M9 staff see the wallet history and the cash limit', sw.entries.length >= 4 && sw.effective_limit_da === 5000 && sw.credit_da === 1000, sw);
  await api('/cancel_order', { order_id: o5.id }, A.token);

  // ===== M10 staff overview: dashboard, alerts, live operations, operations log, search, customers, cash limit, commission =====
  const dash = (await S('/get_dashboard')).b;
  ok('M10 the dashboard counts orders, people and money', dash.orders.delivered_total === 2 && dash.people.drivers >= 2 && dash.money.commission_30d_da === (await pool.query(`SELECT COALESCE(sum(commission_da),0)::int n FROM orders`)).rows[0].n
    && dash.week.length === 7 && dash.week[0].delivered === 2 && dash.wallet_active === true && typeof dash.cases.problems_open === 'number', dash);
  // Alerts: only the important things, and opening them marks them seen (for this staff member).
  let al = (await S('/get_staff_alerts')).b;
  ok('M10 alerts: money disputes and late payments are urgent, top-ups are work to do', al.alerts.some((a: any) => a.kind === 'money' && a.level === 'danger' && a.reason === 'cod_not_received')
    && al.alerts.some((a: any) => a.kind === 'money' && a.reason === 'check:cod_overdue') && al.alerts.some((a: any) => a.kind === 'topup' && a.level === 'info'), al.alerts.slice(0, 4));
  ok('M10 alerts: ordinary events (orders created, delivered) are NOT alerts', !al.alerts.some((a: any) => ['created', 'delivered', 'assigned'].includes(a.kind)));
  ok('M10 alerts: new ones are counted until seen', al.unseen > 0 && al.unseen === al.alerts.filter((a: any) => a.unseen).length);
  ok('M10 alerts: already handled ones say so', al.alerts.filter((a: any) => a.reason === 'cod_not_received').every((a: any) => a.handled === true));
  await S('/mark_alerts_seen', {});
  al = (await S('/get_staff_alerts')).b;
  ok('M10 alerts: once opened, the counter is 0 (kept on the server)', al.unseen === 0 && al.alerts.length > 0);
  // Live operations: an order in progress appears with its courier.
  r = await order(A.token, 'money-key-live'); const live1 = r.b;
  let lv = (await S('/get_live_operations')).b;
  ok('M10 live operations: the searching order is there, with how many couriers saw it', lv.orders.some((o: any) => o.id === live1.id && o.status === 'searching' && typeof o.couriers_notified === 'number' && Array.isArray(o.flags))
    && lv.couriers.some((c: any) => c.id === D1.id), lv.orders.map((o: any) => o.ref));
  await api('/cancel_order', { order_id: live1.id }, A.token);
  lv = (await S('/get_live_operations')).b;
  ok('M10 live operations: a cancelled order leaves the live board', !lv.orders.some((o: any) => o.id === live1.id));
  // The operations log: finished orders, day by day.
  const lg = (await S('/get_day_log')).b;
  ok('M10 operations log: today, with its numbers and the finished orders', lg.summary.delivered === 2 && lg.orders.some((o: any) => o.id === live1.id && o.status === 'cancelled') && lg.days.length === 30 && lg.days[0].day === lg.day, lg.summary);
  ok('M10 operations log: filter by outcome', (await S('/get_day_log?outcome=delivered')).b.orders.every((o: any) => o.status === 'delivered') && (await S('/get_day_log?outcome=bogus')).b.error === 'BAD_OUTCOME');
  ok('M10 operations log: another day has its own list (empty here)', (await S('/get_day_log?day=2020-01-01')).b.orders.length === 0 && (await S("/get_day_log?day=2020-01-01'%20OR%201=1")).b.day !== "2020-01-01' OR 1=1");
  // One search box: reference, phone or name.
  const sr = async (q: string) => (await S('/staff_search?q=' + encodeURIComponent(q))).b.results;
  ok('M10 search: by order reference, name and phone', (await sr(o1.ref)).some((x: any) => x.type === 'order' && x.id === o1.id) && (await sr('Amel')).some((x: any) => x.type === 'user')
    && (await sr('552000010')).some((x: any) => x.type === 'driver' && x.id === D1.id));
  ok('M10 search: an injection attempt finds nothing', (await sr("%' OR 1=1 --")).length === 0 && (await sr('x')).length === 0);
  const users = (await S('/list_users?q=Amel')).b.users;
  ok('M10 customers list: orders and payout account', users.length === 1 && users[0].orders >= 5 && users[0].has_payout === true, users);
  ok('M10 the cash-limit ceiling can be changed (audited)', (await S('/set_cash_limit', { driver_profile_id: D1.id, cash_limit_da: 3000 })).s === 200 && (await api('/get_wallet', undefined, D1.token)).b.cash_limit_da === 3000
    && (await S('/list_audit_log?target=' + D1.id)).b.entries.some((e: any) => e.action === 'set_cash_limit'));
  ok('M10 a negative cash limit is refused', (await S('/set_cash_limit', { driver_profile_id: D1.id, cash_limit_da: -1 })).b.error === 'BAD_NUMBER');
  ok('M10 the commission rate is 0 to 50%', (await S('/create_pricing_version', { base_da: 100, per_km_da: 30, min_percent: 80, max_percent: 150, commission_percent: 51 })).b.error === 'BAD_COMMISSION'
    && (await S('/create_pricing_version', { base_da: 100, per_km_da: 30, min_percent: 80, max_percent: 150, commission_percent: 12 })).s === 200 && (await api('/get_wallet', undefined, D1.token)).b.commission_percent === 12);

  // ===== M11 an account with an open payment cannot be deleted =====
  r = await order(A.token, 'money-key-06', { cod_amount_da: 1000 }); const o6 = r.b;
  await S('/set_cash_limit', { driver_profile_id: D1.id, cash_limit_da: 50000 });
  f = await offerFor(D1.token); await api('/accept_offer', { offer_id: f.offer_id }, D1.token);
  await PR.pickup(o6.id, A.token, D1.token); await PR.deliver(o6.id, A.token, D1.token, { cash_collected_da: 1000 });
  ok('M11 the seller cannot delete the account while money is on its way', (await api('/delete_account', { confirm: 'DELETE' }, A.token)).b.error === 'PAYMENTS_OPEN');
  ok('M11 nor the courier while he holds it', (await api('/delete_account', { confirm: 'DELETE' }, D1.token)).b.error === 'CASH_HELD');
  await api('/mark_settlement_sent', { order_id: o6.id, method: 'cash' }, D1.token);
  ok('M11 paid by hand: no receipt needed, the seller confirms', (await api('/confirm_settlement', { order_id: o6.id }, A.token)).s === 200 && await cashHeld(D1.id) === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end(); await appPool.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
