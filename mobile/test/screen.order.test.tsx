// The sender path, driven like a person would, against the REAL backend and the TEST database:
// map pins -> details -> price -> order -> searching (raise price) -> driver comes -> delivered -> rating -> problem report;
// a cancelled order; an area we do not serve; my orders. Only the map drawing and the phone's GPS are replaced.
import { Alert, Share } from 'react-native';
import { screen, fireEvent, act, waitFor } from 'expo-router/testing-library';
import { API, db, open, svc, loginThroughScreens, uploadDocs, devCode, PHOTO } from './screens';
import { nodeFetch } from './http';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 36.7600, longitude: 3.0500 } })),
  Accuracy: { Balanced: 3 },
}));

// The phone camera is replaced by a fixed test picture (evidence photos).
const mockPhoto = require('fs').readFileSync(require('path').join(__dirname, '../../backend/test/fixtures/photo.jpg'));
jest.mock('../src/lib/photos', () => ({ pickPhoto: jest.fn(async () => ({ uri: 'file:///test/evidence.jpg' })), photoBlob: jest.fn(async () => new Blob([mockPhoto], { type: 'image/jpeg' })) }));

const call = async (path: string, body?: any, token?: string) => (await (await nodeFetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json()) as any;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const P = { lat: 36.7538, lng: 3.0588 }, D = { lat: 36.7650, lng: 3.0700 };

// "Moving the map" = the map reporting a new centre, exactly what the real map does after a drag.
async function moveMapTo(p: { lat: number; lng: number }) {
  await act(async () => { await fireEvent(screen.getByTestId('map'), 'onRegionDidChange', { nativeEvent: { center: [p.lng, p.lat], zoom: 16 } }); });
}
// The driver's side of a pickup and a delivery, through the API (the driver screens have their own tests).
const parcelPhoto = async (tok: string) => ((await (await nodeFetch(API + '/upload_document?kind=parcel_photo', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/jpeg' }, body: PHOTO })).json()) as any).document_id;
async function apiPickup(orderId: string, dTok: string) {
  const o = (await db.query(`SELECT pickup_code, ST_Y(pickup_point::geometry) lat, ST_X(pickup_point::geometry) lng FROM orders WHERE id=$1`, [orderId])).rows[0];
  return call('/update_job_step', { order_id: orderId, step: 'picked_up', pickup_code: o.pickup_code, parcel_photo: await parcelPhoto(dTok), location: { lat: o.lat, lng: o.lng } }, dTok);
}
const dropoffOf = async (orderId: string) => (await db.query(`SELECT ST_Y(dropoff_point::geometry) lat, ST_X(dropoff_point::geometry) lng FROM orders WHERE id=$1`, [orderId])).rows[0];
async function driverOnline(phone: string, at: { lat: number; lng: number }) {
  await call('/send_code', { phone });
  const v = await call('/verify_code', { phone, code: await devCode(phone), path: 'driver' });
  const d = await call('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Rachid Rider', documents: await uploadDocs(v.token) }, v.token);
  await db.query(`UPDATE profiles SET status='active' WHERE id=$1`, [d.active_profile.id]);
  await db.query(`UPDATE driver_details SET cash_limit_da=100000 WHERE profile_id=$1`, [d.active_profile.id]);
  await call('/set_online', { online: true }, d.token); await call('/update_location', at, d.token);
  return d.token as string;
}
// Log in through the screens; a new number creates its sender profile first.
async function sender(phone: string, name = 'Nora Sender') {
  await loginThroughScreens(phone, 'user');
  if (await screen.findByTestId('name-input', {}, { timeout: 1500 }).catch(() => null)) {
    await fireEvent.changeText(screen.getByTestId('name-input'), name);
    await fireEvent.press(screen.getByTestId('accept-rules'));
    await fireEvent.press(screen.getByTestId('create-profile'));
  }
  await screen.findByTestId('send-parcel');
}
async function fillDetails() {
  await fireEvent.changeText(screen.getByTestId('pa-street'), 'Rue Didouche Mourad 12');
  await fireEvent.changeText(screen.getByTestId('da-landmark'), 'Next to the Grande Poste');
  await fireEvent.changeText(screen.getByTestId('r-name'), 'Amine Recipient');
  await fireEvent.changeText(screen.getByTestId('r-phone'), '0770 11 22 33');
}

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, documents, profiles, accounts, zones, pricing_rules, security_events RESTART IDENTITY CASCADE`);
  await db.query(`INSERT INTO zones(name, area, is_open) VALUES ('test-algiers', ST_GeogFromText('MULTIPOLYGON(((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6)))'), true)`);
  await db.query(`INSERT INTO pricing_rules(base_da, per_km_da, medium_extra_da, large_extra_da, car_extra_da, min_percent, max_percent, active) VALUES (100, 30, 50, 150, 100, 80, 150, true)`); // TEST numbers only
});
afterAll(async () => { await db.end(); });

test('new sender: "My orders" starts empty with a clear message', async () => {
  await open(svc());
  await sender('0555000005');
  await fireEvent.press(await screen.findByTestId('open-orders'));
  expect(await screen.findByTestId('orders-empty')).toHaveTextContent(/No orders yet/);
});

test('a full order: pins, details, price, searching, raise, driver, delivered, rating, problem report', async () => {
  const s = svc();
  await open(s);
  await sender('0555000001');
  await fireEvent.press(await screen.findByTestId('send-parcel'));

  // Pins: A then B. "My location" moves the map (GPS stand-in), then the person drags to the exact place.
  expect(await screen.findByTestId('pick-title')).toHaveTextContent(/Where do we pick it up\?/);
  await act(async () => { await fireEvent.press(screen.getByTestId('my-location')); });
  await moveMapTo(P);
  await fireEvent.press(screen.getByTestId('confirm-point'));
  expect(screen.getByTestId('pick-title')).toHaveTextContent(/Where does it go\?/);
  expect(screen.getByTestId('marker-A')).toBeTruthy();                                 // pickup stays on the map
  await moveMapTo(D);
  await fireEvent.press(screen.getByTestId('confirm-point'));
  await screen.findByTestId('screen-order-details');

  // Nothing filled: every problem is shown at once, nothing is sent.
  await fireEvent.press(screen.getByTestId('confirm-order'));
  expect(await screen.findByTestId('pa-street-error')).toHaveTextContent(/Add a street or a landmark\./);
  expect(screen.getByTestId('r-name-error')).toBeTruthy();
  expect(screen.getByTestId('r-phone-error')).toBeTruthy();
  expect((await db.query(`SELECT count(*)::int n FROM orders`)).rows[0].n).toBe(0);

  await fillDetails();
  expect(await screen.findByTestId('r-history')).toHaveTextContent(/No earlier parcels to this number/);   // what earlier parcels to this number became
  await fireEvent.press(screen.getByTestId('inspection-open'));                                         // the buyer may open it before paying
  await act(async () => { await fireEvent.press(screen.getByTestId('size-small')); });
  await screen.findByTestId('price-box');
  expect(screen.getByTestId('trip-info')).toHaveTextContent(/By motorbike/);
  const q = await db.query(`SELECT data FROM quotes ORDER BY created_at DESC LIMIT 1`);
  const rec = q.rows[0].data.recommended_da as number;
  expect(screen.getByTestId('price')).toHaveTextContent(new RegExp(`${rec} DA`));
  await fireEvent.press(screen.getByTestId('price-up'));
  expect(screen.getByTestId('price')).toHaveTextContent(new RegExp(`${rec + 10} DA`));
  await fireEvent.press(screen.getByTestId('payer-recipient'));
  await fireEvent.changeText(screen.getByTestId('cod'), '2500');
  await act(async () => { await fireEvent.press(screen.getByTestId('confirm-order')); });

  // Searching: the order exists once, with exactly what was chosen.
  expect(await screen.findByTestId('order-status')).toHaveTextContent(/Looking for a driver/);
  const [o] = (await db.query(`SELECT id, ref, offered_da, payer, cod_amount_da, recipient_phone, pickup_address, dropoff_address, delivery_code, pickup_code, inspection FROM orders`)).rows;
  expect(o).toMatchObject({ offered_da: rec + 10, payer: 'recipient', cod_amount_da: 2500, recipient_phone: '+213770112233', inspection: 'open' });
  expect(o.pickup_address).toEqual({ street: 'Rue Didouche Mourad 12' });
  expect(screen.getByTestId('delivery-code')).toHaveTextContent(o.delivery_code);    // the sender sees the code
  await act(async () => { await fireEvent.press(screen.getByTestId('raise-50')); });
  await waitFor(() => expect(screen.getByTestId('order-price')).toHaveTextContent(new RegExp(`Your offer: ${rec + 60} DA`)));

  // A driver nearby gets the offer and accepts; the screen follows by itself.
  const dTok = await driverOnline('+213555000009', { lat: 36.7545, lng: 3.0590 });
  let offer: any = null; for (let i = 0; i < 40 && !offer; i++) { offer = (await call('/get_current_offer', undefined, dTok)).offer; if (!offer) await sleep(250); }
  expect(offer?.price_da).toBe(rec + 60);                                               // the raised price reached the driver
  await call('/accept_offer', { offer_id: offer.offer_id }, dTok);
  expect(await screen.findByText('A driver is coming to pick it up')).toBeTruthy();
  expect(screen.getByTestId('driver-card')).toHaveTextContent(/Rachid Rider/);
  expect(screen.getByTestId('order-price')).toHaveTextContent(new RegExp(`Price: ${rec + 60} DA \\(fixed\\)`));
  expect(screen.getByTestId('pickup-code')).toHaveTextContent(o.pickup_code);         // the sender shows this (or its QR) to the driver
  expect(screen.getByTestId('pickup-qr')).toBeTruthy();
  const shared = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  await fireEvent.press(screen.getByTestId('share-tracking'));
  const msg = (shared.mock.calls[0][0] as any).message as string;
  expect(msg).toMatch(/Amine Recipient/); expect(msg).toMatch(new RegExp(`${API}/t/[A-Za-z0-9_-]{32}`));   // the receiver's tracking link
  shared.mockRestore();
  await call('/track_expecting', { t: /\/t\/([A-Za-z0-9_-]{32})/.exec(msg)![1] });   // the receiver opens the link and confirms
  await apiPickup(o.id, dTok);
  expect(await screen.findByText('On the way to the recipient')).toBeTruthy();
  expect(await screen.findByTestId('parcel-photo')).toBeTruthy();                      // the photo the driver took at pickup
  expect(screen.getByTestId('expecting')).toHaveTextContent(/expecting the parcel/);
  expect(screen.getByTestId('history')).toHaveTextContent(/Parcel collected \(code \+ photo\)/);
  expect(screen.queryByTestId('pickup-box')).toBeNull();                               // the pickup code is no longer needed
  expect(screen.queryByTestId('cancel-order')).toBeNull();                              // no cancel after pickup
  await call('/update_job_step', { order_id: o.id, step: 'delivered', delivery_code: o.delivery_code, cash_collected_da: 2500 + rec + 60, location: await dropoffOf(o.id) }, dTok);
  expect(await screen.findByText('Delivered')).toBeTruthy();

  // Rating, once.
  await fireEvent.press(await screen.findByTestId('rate'));
  await fireEvent.press(await screen.findByTestId('send-rating'));
  expect(await screen.findByText(/Choose from 1 to 5 stars\./)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('star-5'));
  await fireEvent.changeText(screen.getByTestId('comment'), 'Fast and polite');
  await act(async () => { await fireEvent.press(screen.getByTestId('send-rating')); });
  expect(await screen.findByText(/Thank you for your rating\./)).toBeTruthy();
  expect((await db.query(`SELECT stars, comment FROM ratings`)).rows).toEqual([{ stars: 5, comment: 'Fast and polite' }]);

  // A problem report reaches staff.
  await fireEvent.press(screen.getByTestId('report-problem'));
  await fireEvent.press(await screen.findByTestId('reason-damaged'));
  await act(async () => { await fireEvent.press(screen.getByTestId('add-photo')); });
  expect(screen.getByTestId('photo-count')).toHaveTextContent(/1 photo/);
  await act(async () => { await fireEvent.press(screen.getByTestId('send-problem')); });
  expect(await screen.findByTestId('problem-msg')).toHaveTextContent(/Our team will look at it/);
  expect((await db.query(`SELECT reason, cardinality(photos) n FROM problem_reports WHERE reporter_kind='profile'`)).rows).toEqual([{ reason: 'damaged', n: 1 }]);
});

test('cancel before pickup; the order list shows both orders', async () => {
  await open(svc());
  await sender('0555000001');
  await fireEvent.press(await screen.findByTestId('send-parcel'));
  await moveMapTo(P); await fireEvent.press(await screen.findByTestId('confirm-point'));
  await moveMapTo(D); await fireEvent.press(screen.getByTestId('confirm-point'));
  await screen.findByTestId('screen-order-details');
  await fillDetails();
  await act(async () => { await fireEvent.press(screen.getByTestId('size-large')); });
  await screen.findByTestId('price-box');
  expect(screen.getByTestId('trip-info')).toHaveTextContent(/By car/);                   // large parcel -> car
  await act(async () => { await fireEvent.press(screen.getByTestId('confirm-order')); });
  await screen.findByText(/Looking for a driver/);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => { b?.find(x => x.style === 'destructive')?.onPress?.(); });
  await act(async () => { await fireEvent.press(screen.getByTestId('cancel-order')); });
  alert.mockRestore();
  await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent(/Cancelled/));
  expect(screen.getByTestId('send-again')).toBeTruthy();
  await fireEvent.press(screen.getByText('‹ Back'));
  await fireEvent.press(await screen.findByTestId('open-orders'));
  await screen.findByTestId('screen-orders');
  expect(await screen.findAllByText(/^→ Amine Recipient/)).toHaveLength(2);
  expect(screen.getByText('Cancelled')).toBeTruthy();
  expect(screen.getByText('Delivered')).toBeTruthy();
});

test('a place we do not serve is refused with a clear message, and no order is made', async () => {
  await open(svc());
  await sender('0555000001');
  await fireEvent.press(await screen.findByTestId('send-parcel'));
  await moveMapTo({ lat: 35.6971, lng: -0.6308 }); await fireEvent.press(await screen.findByTestId('confirm-point'));   // Oran: outside the open zone
  await moveMapTo(D); await fireEvent.press(screen.getByTestId('confirm-point'));
  await screen.findByTestId('screen-order-details');
  await act(async () => { await fireEvent.press(screen.getByTestId('size-small')); });
  expect(await screen.findByTestId('order-msg')).toHaveTextContent(/We do not deliver there yet/);
  expect(screen.queryByTestId('price-box')).toBeNull();
});

test('after pickup the sender calls the parcel back: it returns to him, with a code and a QR for the driver', async () => {
  await db.query(`UPDATE driver_details SET is_online=false`);   // only this test's driver may get the offer
  const phone = '+213555000001';
  await call('/send_code', { phone }); const v = await call('/verify_code', { phone, code: await devCode(phone), path: 'user' });
  const q = await call('/get_quote', { pickup: P, dropoff: D, size: 'small' }, v.token);
  const o = await (await nodeFetch(API + '/create_order', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token, 'idempotency-key': 'recall-test-0001' }, body: JSON.stringify({ quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue Hassiba 3' }, dropoff_address: { street: 'Kouba' }, recipient_name: 'Recall Recipient', recipient_phone: '+213770998877', payer: 'sender' }) })).json() as any;
  const dTok = await driverOnline('+213555000019', { lat: 36.7545, lng: 3.0590 });
  let offer: any = null; for (let i = 0; i < 40 && !offer; i++) { offer = (await call('/get_current_offer', undefined, dTok)).offer; if (!offer) await sleep(250); }
  await call('/accept_offer', { offer_id: offer.offer_id }, dTok);
  await apiPickup(o.id, dTok);
  await open(svc());
  await sender('0555000001');
  await fireEvent.press(await screen.findByTestId('open-orders'));
  await fireEvent.press(await screen.findByText(/→ Recall Recipient/));
  await fireEvent.press(await screen.findByTestId('recall'));
  expect(screen.getByTestId('recall-confirm').props.accessibilityState.disabled).toBe(true);   // a reason is required
  await fireEvent.press(screen.getByTestId('recall-buyer_cancelled'));
  await act(async () => { await fireEvent.press(screen.getByTestId('recall-confirm')); });
  await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent(/Delivery failed/));
  expect(screen.getByTestId('history')).toHaveTextContent(/You called the parcel back: The buyer cancelled/);
  const ret = (await db.query(`SELECT id, status, leg FROM orders WHERE parent_order_id=$1`, [o.id])).rows[0];
  expect(ret).toMatchObject({ status: 'picked_up', leg: 'return' });                    // the driver is already bringing it back
});
