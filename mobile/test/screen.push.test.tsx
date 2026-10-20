// Phone push: the phone is registered for the ACTIVE profile in the chosen language, moved on a profile switch,
// updated on a language change, and a tapped notification opens the right screen. Real backend, TEST database;
// only the phone's notification system is replaced (test/mocks/notifications.ts).
import { screen, fireEvent, act, waitFor } from 'expo-router/testing-library';
import { API, db, open, svc, loginThroughScreens, devCode, menu } from './screens';
import { nodeFetch } from './http';
const { pushState } = require('./mocks/notifications');

const call = async (path: string, body?: any, token?: string, headers: any = {}) => (await (await nodeFetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })).json()) as any;
const device = async () => (await db.query(`SELECT p.type, d.language FROM device_tokens d JOIN profiles p ON p.id=d.profile_id WHERE d.token=$1`, ['fcm-test-token-0001'])).rows;

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, documents, profiles, accounts, zones, pricing_rules, security_events RESTART IDENTITY CASCADE`);
  await db.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-algiers', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await db.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
});
afterAll(async () => { pushState.token = null; await db.end(); });

test('no Firebase in the build yet: nothing is registered and the app works normally', async () => {
  pushState.token = null;
  await open(svc());
  await loginThroughScreens('0557000001', 'user');
  await fireEvent.changeText(await screen.findByTestId('name-input'), 'Hana Sender');
  await fireEvent.press(screen.getByTestId('accept-rules'));
  await fireEvent.press(screen.getByTestId('create-profile'));
  await screen.findByTestId('send-parcel');
  expect((await db.query(`SELECT count(*)::int n FROM device_tokens`)).rows[0].n).toBe(0);
});

test('registered for the active profile and language; language change and profile switch follow; a tap opens the order', async () => {
  pushState.token = 'fcm-test-token-0001';
  const s = svc();
  await open(s);
  await loginThroughScreens('0557000001', 'user');
  await screen.findByTestId('send-parcel');
  await waitFor(async () => expect(await device()).toEqual([{ type: 'user', language: 'en' }]));

  await menu('menu-settings');
  await act(async () => { await fireEvent.press(await screen.findByTestId('lang-ar')); });
  await waitFor(async () => expect(await device()).toEqual([{ type: 'user', language: 'ar' }]));   // push texts now in Arabic
  await act(async () => { await fireEvent.press(screen.getByTestId('lang-en')); });

  // A driver profile on the same number: after switching, this phone's pushes belong to the driver profile only.
  const up = async (kind: string) => (await (await nodeFetch(API + '/upload_document?kind=' + kind, { method: 'POST', headers: { authorization: 'Bearer ' + s.client.token, 'content-type': 'image/jpeg' }, body: require('fs').readFileSync(require('path').join(__dirname, '../../backend/test/fixtures/photo.jpg')) })).json() as any).document_id;
  await act(async () => { await s.session.addProfile('driver', 'Hana Driver', true, { vehicle: 'motorbike', id_photo: await up('id_photo'), licence_photo: await up('licence_photo'), vehicle_photo: await up('vehicle_photo') }, '100000000002'); });
  await waitFor(async () => expect(await device()).toEqual([{ type: 'driver', language: 'en' }]));
  await act(async () => { await s.session.switchProfile('user'); });
  await waitFor(async () => expect(await device()).toEqual([{ type: 'user', language: 'en' }]));

  // An order exists; the person taps its notification: the order screen opens.
  const q = await call('/get_quote', { pickup: { lat: 36.7538, lng: 3.0588 }, dropoff: { lat: 36.765, lng: 3.07 }, size: 'small' }, s.client.token!);
  const o = await call('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue A' }, dropoff_address: { street: 'Rue B' }, recipient_name: 'Omar', recipient_phone: '+213661111111', payer: 'sender' }, s.client.token!, { 'idempotency-key': 'push-test-order-1' });
  await act(async () => { pushState.tap({ id: '1', kind: 'order.assigned', order_id: o.id }); });
  expect(await screen.findByTestId('order-status')).toHaveTextContent(/Waiting for Omar to confirm/);
});

test('a registered recipient sees the incoming parcel and its code on the home screen (live, and from a tapped push)', async () => {
  pushState.token = null;
  // Someone else sends a parcel to Hana's number.
  await call('/send_code', { phone: '+213557000002' });
  const v = await call('/verify_code', { phone: '+213557000002', code: await devCode('+213557000002'), path: 'user' });
  const other = (await call('/add_profile', { accept_rules: true, type: 'user', display_name: 'Yanis Sender' }, v.token)).token;
  const send = async (key: string) => {
    const q = await call('/get_quote', { pickup: { lat: 36.7538, lng: 3.0588 }, dropoff: { lat: 36.765, lng: 3.07 }, size: 'small' }, other);
    return call('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue C' }, dropoff_address: { street: 'Rue D' }, recipient_name: 'Hana', recipient_phone: '+213557000001', payer: 'sender' }, other, { 'idempotency-key': key });
  };
  await open(svc());
  await loginThroughScreens('0557000001', 'user');
  await screen.findByTestId('send-parcel');
  await new Promise(r => setTimeout(r, 1000));                                           // the live connection is up
  const o1 = await send('push-incoming-1');
  // The receiver is asked first (yes / no); after "yes" the order searches for couriers and the card shows the code.
  expect(await screen.findByTestId('incoming-' + o1.ref)).toHaveTextContent(/Yanis wants to send you a parcel/);
  await act(async () => { await fireEvent.press(screen.getByTestId('incoming-yes-' + o1.ref)); });
  await waitFor(() => expect(screen.getByTestId('incoming-' + o1.ref)).toHaveTextContent(new RegExp(`Give this code to the driver when you receive it: ${o1.delivery_code}`)));
  await waitFor(async () => expect((await db.query(`SELECT status FROM orders WHERE id=$1`, [o1.id])).rows[0].status).toBe('searching'));
  // A push tapped while the app was closed carries the same data.
  await act(async () => { pushState.tap({ id: '99', kind: 'order.incoming', order_id: '11111111-1111-1111-1111-111111111111', ref: 'TEST-REF', delivery_code: '4321' }); });
  expect(await screen.findByTestId('incoming-TEST-REF')).toHaveTextContent(/4321/);
});
