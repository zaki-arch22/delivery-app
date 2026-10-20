// The driver path, driven like a driver would, against the REAL backend and the TEST database:
// go online (position sent), a live offer with cash to collect, accept, pick up, wrong code, cash confirmation, delivered,
// today's numbers and cash; a failed delivery that turns into a return; a job the sender cancels; going offline.
// Only the phone's GPS, the map drawing and the phone dialer are replaced.
import { Linking } from 'react-native';
import { screen, fireEvent, act, waitFor } from 'expo-router/testing-library';
import { API, db, open, svc, loginThroughScreens, uploadDocs, devCode, pressBack, menu, openRequest } from './screens';
import { nodeFetch } from './http';
import { money } from '../src/lib/orders';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 36.7545, longitude: 3.0590 } })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  Accuracy: { Balanced: 3, High: 4 },
}));

// The phone camera (photos) is replaced by a fixed test picture; the QR camera by a stand-in the test controls.
const mockPhoto = require('fs').readFileSync(require('path').join(__dirname, '../../backend/test/fixtures/photo.jpg'));
jest.mock('../src/lib/photos', () => ({
  pickPhoto: jest.fn(async () => ({ uri: 'file:///test/parcel.jpg' })),
  photoBlob: jest.fn(async () => new Blob([mockPhoto], { type: 'image/jpeg' })),
}));
const { cameraMock } = require('./mocks/camera');

const call = async (path: string, body?: any, token?: string, headers: any = {}) => (await (await nodeFetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })).json()) as any;
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.7650, lng: 3.0700 };
let sender = '', n = 0;
// The testing library turns non-breaking spaces (used in prices like 1 500) into plain spaces: match any space.
const rx = (text: string) => new RegExp(text.replace(/[\u00a0 ]/g, '\\s'));

// Driver home, online (tests can run alone or in order).
async function driverOnlineHome(services = svc()) {
  await db.query(`DELETE FROM otp_codes`);   // the same test number logs in many times: stay under the 5-codes-per-hour protection
  await open(services);
  await loginThroughScreens('0556000002', 'driver');
  const st = await screen.findByTestId('online-state');
  if (/Offline/.test(JSON.stringify(st.props.children))) await act(async () => { await fireEvent.press(screen.getByTestId('toggle-online')); });
  await waitFor(() => expect(screen.getByTestId('online-state')).toHaveTextContent(/Online/));
}
async function login(phone: string, path: 'user' | 'driver') { await call('/send_code', { phone }); return call('/verify_code', { phone, code: await devCode(phone), path }); }
async function newOrder(extra: any = {}) {
  const q = await call('/get_quote', { pickup: P, dropoff: D, size: 'small' }, sender);
  // auto-accept on: the courier who accepts the customer's price gets the job at once (choosing among offers has its own test).
  const o = await call('/create_order', { auto_accept: true, quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue Larbi Ben Mhidi 5' }, dropoff_address: { landmark: 'Jardin d’Essai' }, recipient_name: 'Samir Recipient', recipient_phone: '+213661234567', payer: 'sender', ...extra }, sender, { 'idempotency-key': 'drive-test-' + (++n) + '-' + Date.now() });
  await call('/track_confirm', { t: o.tracking_token });   // the receiver says yes first
  return o;
}

// Pickup as a driver does it: the sender's code (typed, or read from his QR), a parcel photo, then "picked up".
async function pickup(orderId: string, how: 'type' | 'qr' = 'type') {
  const r = (await db.query(`SELECT ref, pickup_code FROM orders WHERE id=$1`, [orderId])).rows[0];
  if (how === 'qr') {
    await fireEvent.press(await screen.findByTestId('scan-pickup'));
    cameraMock.next = `PCK1:${r.ref}:${r.pickup_code}`;
    await fireEvent.press(await screen.findByTestId('mock-scan'));
  } else await fireEvent.changeText(await screen.findByTestId('pickup-code-input'), r.pickup_code);
  await act(async () => { await fireEvent.press(screen.getByTestId('parcel-photo')); });
  await act(async () => { await fireEvent.press(screen.getByTestId('picked-up')); });
}

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, documents, profiles, accounts, zones, pricing_rules, security_events RESTART IDENTITY CASCADE`);
  await db.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-algiers', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await db.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
  const u = await login('+213556000001', 'user');
  sender = (await call('/add_profile', { accept_rules: true, type: 'user', display_name: 'Leila Sender' }, u.token)).token;
  const d = await login('+213556000002', 'driver');
  const p = await call('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Karim Rider', documents: await uploadDocs(d.token) }, d.token);
  await db.query(`UPDATE profiles SET status='active' WHERE id=$1`, [p.active_profile.id]);
  await db.query(`UPDATE driver_details SET cash_limit_da=100000 WHERE profile_id=$1`, [p.active_profile.id]);
});
afterAll(async () => { await db.end(); });

test('online, offer with cash, accept, pickup, wrong code, cash check, delivered, numbers and cash', async () => {
  const dial = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
  await open(svc());
  await loginThroughScreens('0556000002', 'driver');
  expect(await screen.findByTestId('online-state')).toHaveTextContent(/Offline/);
  await act(async () => { await fireEvent.press(screen.getByTestId('toggle-online')); });
  await waitFor(() => expect(screen.getByTestId('online-state')).toHaveTextContent(/Online/));
  const d = (await db.query(`SELECT is_online, last_location IS NOT NULL AS located FROM driver_details`)).rows[0];
  expect(d).toEqual({ is_online: true, located: true });                                  // the position reached the server

  const o = await newOrder({ payer: 'recipient', cod_amount_da: 1500 });
  expect(await openRequest()).toBeTruthy();
  expect(screen.getByTestId('offer-price')).toHaveTextContent(rx(money(o.offered_da)));
  expect(screen.getByTestId('offer-cash')).toHaveTextContent(rx(`Collect ${money(1500 + o.offered_da)} DA in cash`));   // goods + fee paid by the recipient
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });

  expect(await screen.findByTestId('job-step')).toHaveTextContent(/Go to the pickup/);
  expect(screen.getByTestId('job-address')).toHaveTextContent(/Rue Larbi Ben Mhidi 5/);
  await fireEvent.press(screen.getByTestId('call'));
  expect(dial).toHaveBeenCalledWith('tel:+213556000001');                                // calls the sender
  await act(async () => { await fireEvent.press(screen.getByTestId('picked-up')); });
  expect(await screen.findByTestId('job-msg')).toHaveTextContent(/pickup code has 4 digits/);   // no pickup without the sender's code
  const ref = (await db.query(`SELECT ref FROM orders WHERE id=$1`, [o.id])).rows[0].ref;
  await fireEvent.press(screen.getByTestId('scan-pickup'));
  cameraMock.next = `DLV1:${ref}:1234`;                                                   // the wrong kind of QR (a delivery QR)
  await fireEvent.press(await screen.findByTestId('mock-scan'));
  expect(await screen.findByTestId('job-msg')).toHaveTextContent(/not the right one for this step/);
  await fireEvent.press(screen.getByTestId('scan-pickup'));
  cameraMock.next = `PCK1:D999999:1234`;                                                  // another order's QR
  await fireEvent.press(await screen.findByTestId('mock-scan'));
  expect(await screen.findByTestId('job-msg')).toHaveTextContent(/belongs to another order/);
  await fireEvent.press(screen.getByTestId('scan-pickup'));
  cameraMock.next = `PCK1:${ref}:${(await db.query(`SELECT pickup_code FROM orders WHERE id=$1`, [o.id])).rows[0].pickup_code}`;
  await fireEvent.press(await screen.findByTestId('mock-scan'));
  await act(async () => { await fireEvent.press(screen.getByTestId('picked-up')); });
  expect(await screen.findByTestId('job-msg')).toHaveTextContent(/Take a photo of the parcel first/);   // no pickup without a photo
  await act(async () => { await fireEvent.press(screen.getByTestId('parcel-photo')); });
  expect(screen.getByTestId('parcel-photo')).toHaveTextContent(/Photo taken/);
  await act(async () => { await fireEvent.press(screen.getByTestId('picked-up')); });
  await waitFor(() => expect(screen.getByTestId('job-step')).toHaveTextContent(/Deliver the parcel/));
  const proof = (await db.query(`SELECT pickup_photo_doc IS NOT NULL AS photo, pickup_distance_m FROM orders WHERE id=$1`, [o.id])).rows[0];
  expect(proof.photo).toBe(true); expect(proof.pickup_distance_m).toBeLessThan(300);      // photo and position reached the server
  expect(screen.getByTestId('inspection')).toHaveTextContent(/outside of the parcel only/);

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
  await menu('menu-cash');
  expect(await screen.findByTestId('cash-balance')).toHaveTextContent(/You hold 1\s500 DA/);
  expect(screen.getByText('Collected')).toBeTruthy();
  await pressBack();
  await menu('menu-jobs');
  expect(await screen.findByTestId('job-' + o.ref)).toHaveTextContent(/Delivered/);
  dial.mockRestore();
});

test('cannot deliver: the job turns into a return to the sender, finished with the sender\'s code', async () => {
  await driverOnlineHome();
  const o = await newOrder();
  expect(await openRequest()).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  await pickup(o.id);
  await fireEvent.press(await screen.findByTestId('cant-deliver'));
  expect(screen.getByTestId('fail-confirm').props.accessibilityState.disabled).toBe(true);   // a reason is required
  await fireEvent.press(screen.getByTestId('fail-refused_damaged'));
  await act(async () => { await fireEvent.press(screen.getByTestId('fail-confirm')); });
  expect(await screen.findByTestId('job-msg')).toHaveTextContent(/photo as evidence first/);  // damage needs a photo
  await act(async () => { await fireEvent.press(screen.getByTestId('evidence-photo')); });
  await act(async () => { await fireEvent.press(screen.getByTestId('fail-confirm')); });
  await waitFor(() => expect(screen.getByTestId('job-step')).toHaveTextContent(/Return the parcel to the sender/));
  expect(screen.getByTestId('job-address')).toHaveTextContent(/Rue Larbi Ben Mhidi 5/);   // back to the pickup address
  const ret = (await db.query(`SELECT id, ref, delivery_code FROM orders WHERE parent_order_id=$1`, [o.id])).rows[0];
  expect((await db.query(`SELECT count(*)::int n FROM documents WHERE order_id=$1 AND kind='evidence_photo'`, [o.id])).rows[0].n).toBe(1);
  await fireEvent.press(screen.getByTestId('scan-delivery'));                             // the sender shows his QR: read by the camera
  cameraMock.next = `DLV1:${ret.ref}:${ret.delivery_code}`;
  await fireEvent.press(await screen.findByTestId('mock-scan'));
  await act(async () => { await fireEvent.press(screen.getByTestId('delivered')); });
  expect(await screen.findByTestId('job-done')).toBeTruthy();
  expect(screen.queryByTestId('rate-sender')).toBeNull();                                  // return legs are not rated
  expect((await db.query(`SELECT status FROM orders WHERE id IN ($1,$2) ORDER BY leg`, [o.id, ret.id])).rows.map((r: any) => r.status)).toEqual(['failed', 'delivered']);   // original failed, return delivered
  expect((await db.query(`SELECT data->>'method' m FROM order_events WHERE order_id=$1 AND type='delivered'`, [ret.id])).rows[0].m).toBe('qr');
});

test('the driver gives a job back before pickup: it searches again for another driver', async () => {
  await driverOnlineHome();
  const o = await newOrder();
  expect(await openRequest()).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  await fireEvent.press(await screen.findByTestId('give-back'));
  expect(screen.getByTestId('release-confirm').props.accessibilityState.disabled).toBe(true);   // a reason is required
  await fireEvent.press(screen.getByTestId('release-vehicle_problem'));
  await act(async () => { await fireEvent.press(screen.getByTestId('release-confirm')); });
  expect(await screen.findByTestId('job-none')).toHaveTextContent(/Another driver will take it/);
  expect((await db.query(`SELECT status, driver_profile_id FROM orders WHERE id=$1`, [o.id])).rows[0]).toEqual({ status: 'searching', driver_profile_id: null });
  await call('/cancel_order', { order_id: o.id }, sender);
});

test('the sender cancels after the driver accepted: the driver is told; going offline', async () => {
  await driverOnlineHome();
  const o = await newOrder();
  expect(await openRequest()).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  await screen.findByTestId('picked-up');
  await call('/cancel_order', { order_id: o.id, reason: 'changed my mind' }, sender);
  expect(await screen.findByTestId('job-none')).toHaveTextContent(/The sender cancelled this delivery/);   // live notification
  await fireEvent.press(screen.getByTestId('back-home'));
  const el_toggle_online = await screen.findByTestId('toggle-online'); await act(async () => { await fireEvent.press(el_toggle_online); });
  await waitFor(() => expect(screen.getByTestId('online-state')).toHaveTextContent(/Offline/));
  expect((await db.query(`SELECT is_online FROM driver_details`)).rows[0].is_online).toBe(false);
});

test('no network in the middle of a job: steps are saved on the phone and sent when the network is back', async () => {
  const net = { down: false };
  const flaky: typeof fetch = ((u: any, i: any) => net.down ? Promise.reject(new TypeError('Network request failed')) : nodeFetch(u, i)) as any;
  await driverOnlineHome(svc(undefined, flaky));
  const o = await newOrder();
  expect(await openRequest()).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  const pc = (await db.query(`SELECT pickup_code FROM orders WHERE id=$1`, [o.id])).rows[0].pickup_code;
  await fireEvent.changeText(await screen.findByTestId('pickup-code-input'), pc);
  await act(async () => { await fireEvent.press(screen.getByTestId('parcel-photo')); });
  const pick = screen.getByTestId('picked-up');
  const status = async () => (await db.query(`SELECT status FROM orders WHERE id=$1`, [o.id])).rows[0].status;

  net.down = true;                                                                         // the driver enters a dead zone
  await act(async () => { await fireEvent.press(pick); });
  await waitFor(() => expect(screen.getByTestId('job-step')).toHaveTextContent(/Deliver the parcel/));   // the driver can go on
  expect(screen.getByTestId('unsent')).toHaveTextContent(/Waiting for network/);
  expect(screen.getByTestId('job-msg')).toHaveTextContent(/saved on the phone/);
  expect(await status()).toBe('assigned');                                                  // not on the server yet

  net.down = false;                                                                        // network is back: sent by itself
  await waitFor(async () => expect(await status()).toBe('picked_up'), { timeout: 8000 });
  expect((await db.query(`SELECT pickup_photo_doc IS NOT NULL AS p FROM orders WHERE id=$1`, [o.id])).rows[0].p).toBe(true);   // the photo kept on the phone was sent too
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

test('the weekly selfie before going online, and the emergency button on a job', async () => {
  await call('/dev/config', { key: 'SELFIE_DAYS', value: 7 });
  await db.query(`DELETE FROM otp_codes`);
  await db.query(`UPDATE driver_details SET is_online=false`);
  await open(svc());
  await loginThroughScreens('0556000002', 'driver');
  expect(await screen.findByTestId('online-state')).toHaveTextContent(/Offline/);
  await act(async () => { await fireEvent.press(screen.getByTestId('toggle-online')); });
  await waitFor(() => expect(screen.getByTestId('online-state')).toHaveTextContent(/Online/));   // the selfie was taken and sent, then online
  const pid = (await db.query(`SELECT p.id FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213556000002' AND p.type='driver'`)).rows[0].id;
  expect((await db.query(`SELECT count(*)::int n FROM documents WHERE profile_id=$1 AND kind='selfie_photo'`, [pid])).rows[0].n).toBe(1);
  await call('/dev/config', { key: 'SELFIE_DAYS', value: 0 });

  const o = await newOrder();
  expect(await openRequest()).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-offer')); });
  await fireEvent.press(await screen.findByTestId('sos'));
  expect(screen.getByTestId('sos-17')).toBeTruthy(); expect(screen.getByTestId('sos-1055')).toBeTruthy();
  await act(async () => { await fireEvent.press(screen.getByTestId('sos-team')); });
  expect(await screen.findByTestId('job-msg')).toHaveTextContent(/Our team has been alerted/);
  expect((await db.query(`SELECT note FROM problem_reports WHERE order_id=$1 AND reason='emergency'`, [o.id])).rows[0].note).toMatch(/36\.754/);
  await call('/cancel_order', { order_id: o.id }, sender);
});

test('a courier offers a higher price; the customer chooses him; the job opens by itself', async () => {
  await driverOnlineHome();
  const o = await newOrder({ auto_accept: false });                                   // the customer chooses among offers
  expect(await openRequest()).toBeTruthy();
  const up = Math.ceil((o.offered_da + 50) / 10) * 10;   // the first "offer more" button (+50, inside the allowed maximum)
  await act(async () => { await fireEvent.press(screen.getByTestId('bid-' + up)); });
  expect(await screen.findByTestId('bid-waiting')).toHaveTextContent(rx(`${money(up)} DA`));   // waiting for the customer's answer
  const v = await call('/get_order?id=' + o.id, undefined, sender);
  expect(v.bids.map((b: any) => b.price_da)).toEqual([up]);
  await call('/accept_bid', { order_id: o.id, offer_id: v.bids[0].offer_id }, sender);
  expect(await screen.findByTestId('screen-job', {}, { timeout: 15000 })).toBeTruthy();   // the live notice opens the job
  expect((await db.query(`SELECT locked_da FROM orders WHERE id=$1`, [o.id])).rows[0].locked_da).toBe(up);
  await call('/cancel_order', { order_id: o.id }, sender);
});
