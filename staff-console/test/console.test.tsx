// The console, driven like a staff member would use it, against the REAL backend (test database only).
import { render, screen, within, waitFor, cleanup } from '@testing-library/react/pure';   // one continuous staff session: do not wipe the screen between steps
import userEvent from '@testing-library/user-event';
import { Pool } from 'pg';
import { App } from '../src/App';
import { allKeys, dictionaries, setLang } from '../src/i18n';
import { example } from '../src/pages/Prices';
import { extractPolygon } from '../src/pages/Zones';
import { seal } from '../../backend/src/security/crypto';
import { codeAt, newSecret, stepNow } from '../../backend/src/security/totp';
import { hashPassword } from '../../backend/src/auth/password';

const API = process.env.VITE_API_URL!; const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
if (!/_test$/.test(process.env.TEST_DATABASE_URL ?? '')) throw new Error('test database only');
const call = async (path: string, body?: any, tok?: string) => { const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json() as any; };
const login = async (phone: string, path: 'user' | 'driver') => { await call('/send_code', { phone }); const c = (await call('/dev/last_code?phone=' + encodeURIComponent(phone))).code; return call('/verify_code', { phone, code: c, path }); };
import { readFileSync } from 'fs';
import { resolve } from 'path';
const PHOTO = readFileSync(resolve(process.cwd(), '../backend/test/fixtures/photo.jpg'));   // made-up test picture
const upload = async (kind: string, tok: string) => (await (await fetch(API + '/upload_document?kind=' + kind, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/jpeg' }, body: PHOTO })).json() as any).document_id as string;
const driverDocs = async (tok: string) => ({ vehicle: 'motorbike', id_photo: await upload('id_photo', tok), licence_photo: await upload('licence_photo', tok), vehicle_photo: await upload('vehicle_photo', tok) });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nav = () => within(screen.getByRole('navigation', { name: 'Main' }));
const dialog = () => screen.findByRole('dialog');
const PW = 'console-test-password-1', EMAIL = 'console@test.example', SECRET = newSecret();
let user: any, driver: any, orderId = '', ref = '';
const u = userEvent.setup();

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, documents, profiles, accounts, zones, pricing_rules, staff_audit, staff_users, security_events RESTART IDENTITY CASCADE`);
  await db.query(`INSERT INTO staff_users(email,name,password_hash,totp_secret_sealed) VALUES ($1,'Console Tester',$2,$3)`, [EMAIL, hashPassword(PW), seal(SECRET, 'totp')]);
  setLang('en'); render(<App />);
});
afterAll(async () => { cleanup(); await db.end(); });

test('1. dictionaries: every text exists in English, French and Arabic', () => {
  for (const k of allKeys) for (const l of ['en', 'fr', 'ar'] as const) expect(dictionaries[l][k]?.trim().length, `${l}:${k}`).toBeGreaterThan(0);
  expect(allKeys.length).toBeGreaterThan(150);
});

test('2. login needs the authenticator code; a wrong code is refused with a clear message', async () => {
  await u.type(screen.getByLabelText('Email'), EMAIL); await u.type(screen.getByLabelText('Password'), PW);
  await u.type(screen.getByLabelText(/^Authenticator code/), '000000'); await u.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email, password or code.');
  expect(screen.getByLabelText('Password')).toHaveValue(PW);                            // the password stays typed after a failed code
  await u.type(screen.getByLabelText(/^Authenticator code/), codeAt(SECRET, stepNow()));
  await u.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();          // empty database: designed empty state, no mock data
  expect(localStorage.length + sessionStorage.length).toBe(0);                        // the token is never stored in the browser
});

test('3. zones: create a rectangle (starts CLOSED), then open it', async () => {
  await u.click(nav().getByRole('button', { name: 'Zones' }));
  await u.type(await screen.findByLabelText('Zone name'), 'Algiers centre');
  await u.type(screen.getByLabelText('South latitude'), '36.6'); await u.type(screen.getByLabelText('North latitude'), '36.9');
  await u.type(screen.getByLabelText('West longitude'), '2.9'); await u.type(screen.getByLabelText('East longitude'), '3.3');
  await u.click(screen.getAllByRole('button', { name: 'New zone' }).at(-1)!);
  expect(await screen.findByRole('status')).toHaveTextContent('starts CLOSED');
  const row = (await screen.findByText('Algiers centre')).closest('tr')!; expect(within(row).getByText('Closed')).toBeInTheDocument();
  await u.click(within(row).getByRole('button', { name: 'Open zone' })); await u.click(within(await dialog()).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(within(screen.getByText('Algiers centre').closest('tr')!).getByText('Open')).toBeInTheDocument());
  expect((await db.query(`SELECT is_open FROM zones`)).rows[0].is_open).toBe(true);
});

test('4. prices: empty warning, live example, save', async () => {
  await u.click(nav().getByRole('button', { name: 'Prices' }));
  expect(await screen.findByText('No prices are set yet, so nobody can order.')).toBeInTheDocument();
  await u.type(screen.getByLabelText('Starting price (DA)'), '100'); await u.type(screen.getByLabelText('Price per km (DA)'), '30');
  expect(screen.getByText('190 DA')).toBeInTheDocument();                                // 100 + 3 km × 30, rounded up to 10
  await u.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Version 1');
  expect(example({ base_da: 100, per_km_da: 30, min_percent: 80, max_percent: 150 } as any, 3)).toEqual({ rec: 190, min: 160, max: 280 });
});

test('5. drivers: a new driver waits; staff approve with a cash limit', async () => {
  const l = await login('+213551010001', 'user'); user = await call('/add_profile', { accept_rules: true, type: 'user', display_name: '<img src=x onerror=alert(1)>' }, l.token);
  const ld = await login('+213551020001', 'driver'); driver = await call('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Driver Console', documents: await driverDocs(ld.token) }, ld.token);
  await u.click(nav().getByRole('button', { name: 'Drivers' }));
  const row = (await screen.findByText('Driver Console')).closest('tr')!;
  await u.click(within(row).getByRole('button', { name: 'ID card: Show photo' }));
  const img = await within(row).findByRole('img', { name: 'ID card' });
  expect(img.getAttribute('src')).toMatch(/^blob:/);                                     // shown from memory, never a shareable link
  expect((await db.query(`SELECT count(*)::int n FROM staff_audit WHERE action='view_document'`)).rows[0].n).toBe(1);   // the view is audited
  await u.click(within(row).getByRole('button', { name: 'Approve' }));
  const d = await dialog(); await u.type(within(d).getByLabelText(/^Cash limit/), '50000'); await u.click(within(d).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.queryByText('Driver Console')).not.toBeInTheDocument());
  expect((await db.query(`SELECT p.status, d.cash_limit_da FROM profiles p JOIN driver_details d ON d.profile_id=p.id WHERE p.id=$1`, [driver.active_profile.id])).rows[0]).toEqual({ status: 'active', cash_limit_da: 50000 });
  await call('/set_online', { online: true }, driver.token); await call('/update_location', { lat: 36.7585, lng: 3.0588 }, driver.token);
});

test('6. orders: find an order, act on it only when allowed, and the server agrees', async () => {
  const q = await call('/get_quote', { pickup: { lat: 36.7538, lng: 3.0588 }, dropoff: { lat: 36.765, lng: 3.07 }, size: 'small' }, user.token);
  const o = await fetch(API + '/create_order', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + user.token, 'idempotency-key': 'console-order-1' }, body: JSON.stringify({ quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue Didouche Mourad' }, dropoff_address: { street: 'Rue Larbi Ben Mhidi' }, recipient_name: 'Amine', recipient_phone: '+213770000001', payer: 'sender' }) }).then(r => r.json());
  orderId = o.id; ref = o.ref;
  let off: any; for (let i = 0; i < 30 && !off; i++) { off = (await call('/get_current_offer', undefined, driver.token)).offer; if (!off) await sleep(300); }
  await call('/accept_offer', { offer_id: off.offer_id }, driver.token);
  await u.click(nav().getByRole('button', { name: 'Orders' }));
  await u.type(await screen.findByLabelText('Reference or phone'), ref); await u.click(screen.getByRole('button', { name: 'Search' }));
  await u.click(await screen.findByText(ref));
  let d = await dialog();
  expect(await within(d).findByText('Assigned')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();                                            // the sender's name is HTML: shown as text, never run
  expect(within(d).getAllByText(/<img src=x onerror=alert\(1\)>/).length).toBeGreaterThan(0);
  expect(within(d).getByRole('button', { name: 'Return parcel to sender' })).toBeDisabled();  // only allowed after pickup
  await u.click(within(d).getByRole('button', { name: 'Find another driver' }));
  let a = screen.getAllByRole('dialog').at(-1)!; await u.type(within(a).getByLabelText(/^Reason/), 'Driver unreachable'); await u.click(within(a).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(within(screen.getAllByRole('dialog')[0]).getAllByText('Searching').length).toBeGreaterThan(0));
  d = screen.getAllByRole('dialog')[0];
  await u.click(within(d).getByRole('button', { name: 'Cancel order' }));
  a = screen.getAllByRole('dialog').at(-1)!; await u.click(within(a).getByRole('button', { name: 'Confirm' }));
  expect(await within(a).findByRole('alert')).toHaveTextContent('at least 3 characters');   // a reason is required
  await u.type(within(a).getByLabelText(/^Reason/), 'Customer asked support'); await u.click(within(a).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(within(screen.getAllByRole('dialog')[0]).getAllByText('Cancelled').length).toBeGreaterThan(0));
  expect(within(screen.getAllByRole('dialog')[0]).getByRole('button', { name: 'Cancel order' })).toBeDisabled();
  expect((await db.query(`SELECT status, cancel_reason FROM orders WHERE id=$1`, [orderId])).rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'support: Customer asked support' });
  await u.click(within(screen.getAllByRole('dialog')[0]).getByRole('button', { name: 'Close' }));
});

test('7. problems: a report is resolved with a written outcome', async () => {
  await call('/report_problem', { order_id: orderId, reason: 'Parcel was damaged', note: 'Box crushed' }, user.token);
  await u.click(nav().getByRole('button', { name: 'Problems' }));
  const row = (await screen.findByText('Parcel was damaged')).closest('tr')!;
  await u.click(within(row).getByRole('button', { name: 'Resolve' }));
  const d = await dialog(); await u.type(within(d).getByLabelText(/^What was done/), 'Refund arranged'); await u.click(within(d).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.queryByText('Parcel was damaged')).not.toBeInTheDocument());
  expect((await db.query(`SELECT status, resolution FROM problem_reports`)).rows[0]).toEqual({ status: 'resolved', resolution: 'Refund arranged' });
});

test('8. cash: correction, a handover that is too big is refused, a real one, and a reversal', async () => {
  await u.click(nav().getByRole('button', { name: 'Drivers' })); await u.click(screen.getByRole('tab', { name: 'All drivers' }));
  await u.click(within((await screen.findByText('Driver Console')).closest('tr')!).getByRole('button', { name: 'Cash' }));
  expect(await screen.findByText('0 DA')).toBeInTheDocument();
  await u.click(screen.getByRole('button', { name: 'Correct the account' }));
  let d = await dialog(); await u.type(within(d).getByLabelText('Amount (DA)'), '+4000'); await u.type(within(d).getByLabelText(/^Note/), 'Counted at the office'); await u.click(within(d).getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('4,000 DA')).toBeInTheDocument();
  await u.type(screen.getByLabelText('Amount (DA)'), '5000'); await u.click(screen.getAllByRole('button', { name: 'Record a handover' }).at(-1)!);
  expect(await screen.findByRole('alert')).toHaveTextContent('The driver holds less cash than that.');
  await u.clear(screen.getByLabelText('Amount (DA)')); await u.type(screen.getByLabelText('Amount (DA)'), '1500'); await u.click(screen.getAllByRole('button', { name: 'Record a handover' }).at(-1)!);
  expect(await screen.findByRole('status')).toHaveTextContent(/Receipt no\. \d+ · 1,500 DA/);
  expect(await screen.findByText('2,500 DA')).toBeInTheDocument();
  const hrow = (await screen.findByText(/^Handover to staff/)).closest('tr')!; await u.click(within(hrow).getByRole('button', { name: 'Reverse' }));
  d = await dialog(); await u.type(within(d).getByLabelText(/^Note/), 'Entered twice'); await u.click(within(d).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(within(screen.getByText(/^Handover to staff/).closest('tr')!).getByText('Reversed')).toBeInTheDocument());
  expect((await db.query(`SELECT sum(amount_da)::int b FROM cash_ledger`)).rows[0].b).toBe(4000);
});

test('9. ratings page shows its empty state', async () => {
  await u.click(nav().getByRole('button', { name: 'Ratings' }));
  expect(await screen.findByRole('heading', { name: 'Ratings and comments' })).toBeInTheDocument();
  expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
});

test('10. language: Arabic switches the whole console to right-to-left, French works too', async () => {
  await u.click(screen.getByRole('button', { name: 'العربية' }));
  expect(document.documentElement.dir).toBe('rtl'); expect(nav().getByRole('button', { name: 'الطلبات' })).toBeInTheDocument();
  await u.click(screen.getByRole('button', { name: 'Français' }));
  expect(document.documentElement.dir).toBe('ltr'); expect(nav().getByRole('button', { name: 'Commandes' })).toBeInTheDocument();
  await u.click(screen.getByRole('button', { name: 'English' }));
});

test('11. pasted areas from geojson.io are understood; nonsense is refused', () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[3, 36], [3.1, 36], [3.1, 36.1], [3, 36]]] } }] };
  expect(extractPolygon(JSON.stringify(fc))?.type).toBe('Polygon'); expect(extractPolygon('not json')).toBeNull(); expect(extractPolygon('{"type":"Point","coordinates":[1,2]}')).toBeNull();
});

test('12. logout ends the staff login on the SERVER, not just on screen', async () => {
  const before = (await db.query(`SELECT token_version FROM staff_users`)).rows[0].token_version;
  await u.click(nav().getByRole('button', { name: 'Log out' }));
  expect(await screen.findByRole('heading', { name: 'Staff login' })).toBeInTheDocument();
  expect((await db.query(`SELECT token_version FROM staff_users`)).rows[0].token_version).toBe(before + 1);
  const audit = (await db.query(`SELECT action FROM staff_audit ORDER BY id`)).rows.map(r => r.action);
  expect(audit).toEqual(expect.arrayContaining(['create_zone', 'open_zone', 'create_pricing', 'approve_driver', 'order_reassign', 'order_cancel', 'problem_resolved', 'cash_adjustment', 'cash_handover']));
});

test('13. a console left unattended logs itself out after 15 minutes, on the server too', async () => {
  // Log in again. The previous code may already be used, so use the next one (the server accepts one step ahead, once).
  // After a logout the form must be EMPTY: no password left behind on an unattended computer.
  expect(screen.getByLabelText(/^Password/)).toHaveValue(''); expect(screen.getByLabelText(/^Authenticator code/)).toHaveValue('');
  for (const [label, v] of [[/^Email/, EMAIL], [/^Password/, PW], [/^Authenticator code/, codeAt(SECRET, stepNow() + 1)]] as const) { const f = screen.getByLabelText(label); await u.clear(f); await u.type(f, v); }
  await u.click(screen.getByRole('button', { name: 'Log in' }));
  const okNav = await screen.findByRole('navigation', { name: 'Main' }).catch(() => null);
  if (!okNav) console.log('LOGIN SCREEN SAYS:', document.body.textContent?.slice(0, 400));
  expect(okNav).not.toBeNull();
  const before = (await db.query(`SELECT token_version FROM staff_users`)).rows[0].token_version;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  window.dispatchEvent(new KeyboardEvent('keydown'));           // activity re-arms the idle timer (now on the fake clock)
  vi.advanceTimersByTime(14 * 60 * 1000);
  expect(nav().getByRole('button', { name: 'Orders' })).toBeInTheDocument();          // 14 minutes: still logged in
  vi.advanceTimersByTime(60 * 1000 + 50);
  vi.useRealTimers();
  expect(await screen.findByRole('heading', { name: 'Staff login' })).toBeInTheDocument();
  expect(await screen.findByText('You were logged out after 15 minutes of inactivity.')).toBeInTheDocument();
  await waitFor(async () => expect((await db.query(`SELECT token_version FROM staff_users`)).rows[0].token_version).toBe(before + 1));
});
