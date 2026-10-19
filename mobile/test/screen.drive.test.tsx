// The driver path, driven like a driver would, against the REAL backend and the TEST database:
// go online (position sent), a live offer with cash to collect, accept, pick up, wrong code, cash confirmation, delivered,
// today's numbers and cash; a failed delivery that turns into a return; a job the sender cancels; going offline.
// Only the phone's GPS, the map drawing and the phone dialer are replaced.
import { Linking } from 'react-native';
import { screen, fireEvent, act, waitFor } from 'expo-router/testing-library';
import { API, db, open, svc, loginThroughScreens, uploadDocs, devCode } from './screens';
import { nodeFetch } from './http';
import { money } from '../src/lib/orders';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 36.7545, longitude: 3.0590 } })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  Accuracy: { Balanced: 3, High: 4 },
}));

const call = async (path: string, body?: any, token?: string, headers: any = {}) => (await (await nodeFetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })).json()) as any;
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.7650, lng: 3.0700 };
let sender = '', n = 0;
// The testing library turns non-breaking spaces (used in prices like 1 500) into plain spaces: match any space.
const rx = (text: string) => new RegExp(text.replace(/[\u00a0 ]/g, '\\s'));

// Driver home, online (tests can run alone or in order).
async function driverOnlineHome(services = svc()) {
  await open(services);
  await loginThroughScreens('0556000002', 'driver');
  const st = await screen.findByTestId('online-state');
  if (/offline/.test(JSON.stringify(st.props.children))) await act(async () => { await fireEvent.press(screen.getByTestId('toggle-online')); });
  await waitFor(() => expect(screen.getByTestId('online-state')).toHaveTextContent(/You are online/));
}
async function login(phone: string, path: 'user' | 'driver') { await call('/send_code', { phone }); return call('/verify_code', { phone, code: await devCode(phone), path }); }
async function newOrder(extra: any = {}) {
  const q = await call('/get_quote', { pickup: P, dropoff: D, size: 'small' }, sender);
  return call('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue Larbi Ben Mhidi 5' }, dropoff_address: { landmark: 'Jardin d’Essai' }, recipient_name: 'Samir Recipient', recipient_phone: '+213661234567', payer: 'sender', ...extra }, sender, { 'idempotency-key': 'drive-test-' + (++n) + '-' + Date.now() });
}

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, documents, profiles, accounts, zones, pricing_rules, security_events RESTART IDENTITY CASCADE`);
  await db.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-algiers', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await db.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
  const u = await login('+213556000001', 'user');
  sender = (await call('/add_profile', { type: 'user', display_name: 'Leila Sender' }, u.token)).token;
  const d = await login('+213556000002', 'driver');
  const p = await call('/add_profile', { type: 'driver', display_name: 'Karim Rider', documents: await uploadDocs(d.token) }, d.token);
  await db.query(`UPDATE profiles SET status='active' WHERE id=$1`, [p.active_profile.id]);
  await db.query(`UPDATE driver_details SET cash_limit_da=100000 WHERE profile_id=$1`, [p.active_profile.id]);
});
afterAll(async () => { await db.end(); });

test('online, offer with cash, accept, pickup, wrong code, cash check, delivered, numbers and cash', async () => {
  const dial = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
  await open(svc());
  await loginThroughScreens('0556000002', 'driver');
  expect(await screen.findByTestId('online-state')).toHaveTextContent(/You are offline/);
  await act(async () => { await fireEvent.press(screen.getByTestId('toggle-online')); });
  await waitFor(() => expect(screen.getByTestId('online-state')).toHaveTextContent(/You are online/));
  const d = (await db.query(`SELECT is_online, last_location IS NOT NULL AS located FROM driver_details`)).rows[0];
  expect(d).toEqual({ is_online: true, located: true });                                  // the position reached the server

  const o = await newOrder({ payer: 'recipient', cod_amount_da: 1500 });
  expect(await screen.findByTestId('offer-card', {}, { timeout: 15000 })).toBeTruthy();
  expect(screen.getByTestId('offer-price')).toHaveTextContent(rx(money(o.offered_da)));
  expect(screen.getByTestId('offer-cash')).toHaveTextContent(rx(`Collect ${money(1500 + o.offered_da)} DA in cash`));   // goods + fee paid by the recipient
  expect(screen.getByTestId('offer-left')).toHaveTextContent(/s left to answer/);
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });

  expect(await screen.findByTestId('job-step')).toHaveTextContent(/Go to the pickup/);
  expect(screen.getByTestId('job-address')).toHaveTextContent(/Rue Larbi Ben Mhidi 5/);
  await fireEvent.press(screen.getByTestId('call'));
  expect(dial).toHaveBeenCalledWith('tel:+213556000001');                                // calls the sender
  await act(async () => { await fireEvent.press(screen.getByTestId('picked-up')); });
  await waitFor(() => expect(screen.getByTestId('job-step')).toHaveTextContent(/Deliver the parcel/));

  const code = (await db.query(`SELECT delivery_code FROM orders WHERE id=$1`, [o.id])).rows[0].delivery_code as string;
  const wrong = code === '0000' ? '1111' : '0000';
  await fireEvent.changeText(screen.getByTestId('code-input'), code);
  await act(async () => { await fireEvent.press(screen.getByTestId('delivered')); });
  expect(await screen.findByTestId('job-msg')).toHaveTextContent(/Confirm that you collected the cash/);   // cash not confirmed yet
  await fireEvent.press(screen.getByTestId('cash-confirm'));
  await fireEvent.changeText(screen.getByTestId('code-input'), wrong);
  await act(async () => { await fireEvent.press(screen.getByTestId('delivered')); });
  await waitFor(() => expect(screen.getByTestId('job-msg')).toHaveTextContent(/Wrong code/));
  await fireEvent.changeText(screen.getByTestId('code-input'), code);
  await act(async () => { await fireEvent.press(screen.getByTestId('delivered')); });
  expect(await screen.findByTestId('job-done')).toHaveTextContent(/Delivered/);
  expect((await db.query(`SELECT status, code_attempts FROM orders WHERE id=$1`, [o.id])).rows[0]).toEqual({ status: 'delivered', code_attempts: 1 });

  await fireEvent.press(screen.getByTestId('rate-sender'));
  await fireEvent.press(await screen.findByTestId('star-4'));
  await act(async () => { await fireEvent.press(screen.getByTestId('send-rating')); });
  await screen.findByTestId('job-done');
  expect((await db.query(`SELECT stars FROM ratings`)).rows).toEqual([{ stars: 4 }]);      // the driver rated the sender

  await fireEvent.press(screen.getByTestId('back-home'));
  await waitFor(() => expect(screen.getByTestId('stat-earnings')).toHaveTextContent(rx(`${money(o.offered_da)} DA`)));
  expect(screen.getByTestId('stat-cash')).toHaveTextContent(/1\s500 DA/);            // only the goods money is in the cash ledger
  await fireEvent.press(screen.getByTestId('open-cash'));
  expect(await screen.findByTestId('cash-balance')).toHaveTextContent(/You hold 1\s500 DA/);
  expect(screen.getByText('Collected')).toBeTruthy();
  await fireEvent.press(screen.getByText('‹ Back'));
  await fireEvent.press(await screen.findByTestId('open-jobs'));
  expect(await screen.findByTestId('job-' + o.ref)).toHaveTextContent(/Delivered/);
  dial.mockRestore();
});

test('cannot deliver: the job turns into a return to the sender, finished with the sender\'s code', async () => {
  await driverOnlineHome();
  const o = await newOrder();
  expect(await screen.findByTestId('offer-card', {}, { timeout: 15000 })).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  const el_picked_up = await screen.findByTestId('picked-up'); await act(async () => { await fireEvent.press(el_picked_up); });
  await fireEvent.press(await screen.findByTestId('cant-deliver'));
  expect(screen.getByTestId('fail-confirm').props.accessibilityState.disabled).toBe(true);   // a reason is required
  await fireEvent.press(screen.getByTestId('fail-no_answer'));
  await act(async () => { await fireEvent.press(screen.getByTestId('fail-confirm')); });
  await waitFor(() => expect(screen.getByTestId('job-step')).toHaveTextContent(/Return the parcel to the sender/));
  expect(screen.getByTestId('job-address')).toHaveTextContent(/Rue Larbi Ben Mhidi 5/);   // back to the pickup address
  const ret = (await db.query(`SELECT id, delivery_code FROM orders WHERE parent_order_id=$1`, [o.id])).rows[0];
  await fireEvent.changeText(screen.getByTestId('code-input'), ret.delivery_code);
  await act(async () => { await fireEvent.press(screen.getByTestId('delivered')); });
  expect(await screen.findByTestId('job-done')).toBeTruthy();
  expect(screen.queryByTestId('rate-sender')).toBeNull();                                  // return legs are not rated
  expect((await db.query(`SELECT status FROM orders WHERE id IN ($1,$2) ORDER BY leg`, [o.id, ret.id])).rows.map((r: any) => r.status)).toEqual(['failed', 'delivered']);   // original failed, return delivered
});

test('the sender cancels after the driver accepted: the driver is told; going offline', async () => {
  await driverOnlineHome();
  const o = await newOrder();
  expect(await screen.findByTestId('offer-card', {}, { timeout: 15000 })).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  await screen.findByTestId('picked-up');
  await call('/cancel_order', { order_id: o.id, reason: 'changed my mind' }, sender);
  expect(await screen.findByTestId('job-none')).toHaveTextContent(/The sender cancelled this delivery/);   // live notification
  await fireEvent.press(screen.getByTestId('back-home'));
  const el_toggle_online = await screen.findByTestId('toggle-online'); await act(async () => { await fireEvent.press(el_toggle_online); });
  await waitFor(() => expect(screen.getByTestId('online-state')).toHaveTextContent(/You are offline/));
  expect((await db.query(`SELECT is_online FROM driver_details`)).rows[0].is_online).toBe(false);
});

test('no network in the middle of a job: steps are saved on the phone and sent when the network is back', async () => {
  const net = { down: false };
  const flaky: typeof fetch = ((u: any, i: any) => net.down ? Promise.reject(new TypeError('Network request failed')) : nodeFetch(u, i)) as any;
  await driverOnlineHome(svc(undefined, flaky));
  const o = await newOrder();
  expect(await screen.findByTestId('offer-card', {}, { timeout: 15000 })).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  const pick = await screen.findByTestId('picked-up');
  const status = async () => (await db.query(`SELECT status FROM orders WHERE id=$1`, [o.id])).rows[0].status;

  net.down = true;                                                                         // the driver enters a dead zone
  await act(async () => { await fireEvent.press(pick); });
  await waitFor(() => expect(screen.getByTestId('job-step')).toHaveTextContent(/Deliver the parcel/));   // the driver can go on
  expect(screen.getByTestId('unsent')).toHaveTextContent(/Waiting for network/);
  expect(screen.getByTestId('job-msg')).toHaveTextContent(/saved on the phone/);
  expect(await status()).toBe('assigned');                                                  // not on the server yet

  net.down = false;                                                                        // network is back: sent by itself
  await waitFor(async () => expect(await status()).toBe('picked_up'), { timeout: 8000 });
  await waitFor(() => expect(screen.queryByTestId('unsent')).toBeNull());

  const code = (await db.query(`SELECT delivery_code FROM orders WHERE id=$1`, [o.id])).rows[0].delivery_code as string;
  net.down = true;
  await fireEvent.changeText(screen.getByTestId('code-input'), code);
  await act(async () => { await fireEvent.press(screen.getByTestId('delivered')); });
  expect(await screen.findByTestId('job-done')).toBeTruthy();
  expect(screen.getByTestId('unsent')).toBeTruthy();
  expect(await status()).toBe('picked_up');
  net.down = false;
  await waitFor(async () => expect(await status()).toBe('delivered'), { timeout: 8000 });
});
