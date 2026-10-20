// The customer path, driven like a person would, against the REAL backend and the TEST database:
// pickup on the home map -> destination -> details and fare -> the receiver confirms through the link -> couriers answer with
// prices -> the customer chooses one -> pickup -> delivered -> rating -> problem report; a receiver who declines; a cancelled
// order; an area we do not serve; my orders. Only the map drawing, the phone's GPS and the share/WhatsApp sheet are replaced.
import { Alert, Linking, Share } from 'react-native';
import { screen, fireEvent, act, waitFor } from 'expo-router/testing-library';
import { API, db, open, svc, loginThroughScreens, uploadDocs, devCode, PHOTO, pressBack, menu } from './screens';
import { nodeFetch } from './http';
import { memoryStore } from '../src/core/storage';

const kept = memoryStore();   // the phone of the full-order test, reopened by the next test (recent places live on the phone)

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
// (Earlier screens stay mounted under the current one, each with its map: the last map is the one on screen.)
async function moveMapTo(p: { lat: number; lng: number }) {
  const maps = screen.getAllByTestId('map');
  await act(async () => { await fireEvent(maps[maps.length - 1], 'onRegionDidChange', { nativeEvent: { center: [p.lng, p.lat], zoom: 16 } }); });
}
// The driver's side of a pickup and a delivery, through the API (the driver screens have their own tests).
const parcelPhoto = async (tok: string) => ((await (await nodeFetch(API + '/upload_document?kind=parcel_photo', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'image/jpeg' }, body: PHOTO })).json()) as any).document_id;
async function apiPickup(orderId: string, dTok: string) {
  const o = (await db.query(`SELECT pickup_code, ST_Y(pickup_point::geometry) lat, ST_X(pickup_point::geometry) lng FROM orders WHERE id=$1`, [orderId])).rows[0];
  return call('/update_job_step', { order_id: orderId, step: 'picked_up', pickup_code: o.pickup_code, parcel_photo: await parcelPhoto(dTok), location: { lat: o.lat, lng: o.lng } }, dTok);
}
const dropoffOf = async (orderId: string) => (await db.query(`SELECT ST_Y(dropoff_point::geometry) lat, ST_X(dropoff_point::geometry) lng FROM orders WHERE id=$1`, [orderId])).rows[0];
async function driverOnline(phone: string, at: { lat: number; lng: number }, name = 'Rachid Rider') {
  await call('/send_code', { phone });
  const v = await call('/verify_code', { phone, code: await devCode(phone), path: 'driver' });
  const d = await call('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: name, documents: await uploadDocs(v.token) }, v.token);
  await db.query(`UPDATE profiles SET status='active' WHERE id=$1`, [d.active_profile.id]);
  await db.query(`UPDATE driver_details SET cash_limit_da=100000 WHERE profile_id=$1`, [d.active_profile.id]);
  await call('/set_online', { online: true }, d.token); await call('/update_location', at, d.token);
  return d.token as string;
}
// Log in through the screens; a new number creates its sender profile first.
async function sender(phone: string, name = 'Nora Sender') {
  await db.query(`DELETE FROM otp_codes`);   // the same test number logs in many times: stay under the 5-codes-per-hour protection
  await loginThroughScreens(phone, 'user');
  if (await screen.findByTestId('name-input', {}, { timeout: 1500 }).catch(() => null)) {
    await fireEvent.changeText(screen.getByTestId('name-input'), name);
    await fireEvent.press(screen.getByTestId('accept-rules'));
    await fireEvent.press(screen.getByTestId('create-profile'));
  }
  await screen.findByTestId('send-parcel');
}
// Pickup on the home map, then the destination, then the details screen.
async function chooseRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  await moveMapTo(from);
  await fireEvent.press(await screen.findByTestId('send-parcel'));
  await screen.findByTestId('screen-new-order');
  await moveMapTo(to);
  await fireEvent.press(screen.getByTestId('confirm-point'));
  await screen.findByTestId('screen-order-details');
}
const tokenOf = (msg: string) => /\/t\/([A-Za-z0-9_-]{32})/.exec(msg)![1];
const requestsOf = async (tok: string, ref: string) => { for (let i = 0; i < 40; i++) { const r = (await call('/list_requests', undefined, tok)).requests.find((x: any) => x.ref === ref); if (r) return r; await sleep(250); } return null; };
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

test('new sender: "My parcels" starts empty with a clear message', async () => {
  await open(svc());
  await sender('0555000005');
  await menu('menu-orders');
  expect(await screen.findByTestId('orders-empty')).toHaveTextContent(/No orders yet/);
});

test('a full order: route, fare, receiver confirms, couriers offer, choose one, delivered, rating, problem report', async () => {
  const s = svc(kept);
  await open(s);
  await sender('0555000001');
  // The pickup is the centre of the home map ("My location" moves it, then the person drags to the exact place).
  await act(async () => { await fireEvent.press(screen.getByTestId('my-location')); });
  await moveMapTo(P);
  await fireEvent.press(screen.getByTestId('send-parcel'));
  expect(await screen.findByTestId('pick-title')).toHaveTextContent(/Where does it go\?/);
  expect(screen.getByTestId('marker-A')).toBeTruthy();                                 // the pickup stays on the map
  await moveMapTo(D);
  await fireEvent.press(screen.getByTestId('confirm-point'));
  await screen.findByTestId('screen-order-details');

  // The fare shows at once (small parcel by default); the route is drawn (dashed: no road shape on the test server).
  await screen.findByTestId('price');
  expect(screen.getByTestId('layer-route-line').props.accessibilityHint).toBe('dashed');
  const q = await db.query(`SELECT data FROM quotes ORDER BY created_at DESC LIMIT 1`);
  const rec = q.rows[0].data.recommended_da as number;
  expect(screen.getByTestId('price')).toHaveTextContent(new RegExp(`${rec} DA`));
  // Nothing filled: every problem is shown at once, nothing is sent.
  await fireEvent.press(screen.getByTestId('confirm-order'));
  expect(await screen.findByTestId('pa-street-error')).toHaveTextContent(/Add a street or a landmark\./);
  expect(screen.getByTestId('r-name-error')).toBeTruthy();
  expect(screen.getByTestId('r-phone-error')).toBeTruthy();
  expect((await db.query(`SELECT count(*)::int n FROM orders`)).rows[0].n).toBe(0);

  await fillDetails();
  expect(await screen.findByTestId('r-history')).toHaveTextContent(/No earlier parcels to this number/);
  await fireEvent.press(screen.getByTestId('inspection-open'));
  expect(screen.getByTestId('trip-info')).toHaveTextContent(/By motorbike/);
  await fireEvent.press(screen.getByTestId('price-up'));
  expect(screen.getByTestId('price')).toHaveTextContent(new RegExp(`${rec + 10} DA`));
  await fireEvent.press(screen.getByTestId('payer-recipient'));
  await fireEvent.changeText(screen.getByTestId('cod'), '2500');
  expect(screen.getByTestId('confirm-order')).toHaveTextContent(/Amine Recipient confirms first/);
  await act(async () => { await fireEvent.press(screen.getByTestId('confirm-order')); });

  // Waiting for the receiver: the order exists once, nobody is searched yet; the link goes out by WhatsApp.
  expect(await screen.findByTestId('order-status')).toHaveTextContent(/Waiting for Amine Recipient to confirm/);
  const [o] = (await db.query(`SELECT id, ref, status, offered_da, payer, cod_amount_da, recipient_phone, pickup_address, dropoff_address, delivery_code, pickup_code, inspection, auto_accept FROM orders`)).rows;
  expect(o).toMatchObject({ status: 'awaiting_recipient', offered_da: rec + 10, payer: 'recipient', cod_amount_da: 2500, recipient_phone: '+213770112233', inspection: 'open', auto_accept: false });
  expect(o.dropoff_address).toEqual({ landmark: 'Next to the Grande Poste' });
  const wa = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
  await fireEvent.press(screen.getByTestId('ask-whatsapp'));
  const url = wa.mock.calls[0][0] as string; wa.mockRestore();
  expect(url).toMatch(/^https:\/\/wa\.me\/213770112233\?text=/);                       // a WhatsApp chat with the receiver, message ready
  const msg = decodeURIComponent(url.split('text=')[1]);
  expect(msg).toMatch(/Amine Recipient/); expect(msg).toMatch(new RegExp(`${API}/t/[A-Za-z0-9_-]{32}`));
  expect((await call('/track_confirm', { t: tokenOf(msg) })).status).toBe('searching');  // the receiver opens the link and says yes
  expect(await screen.findByText(/Looking for a courier/)).toBeTruthy();
  expect(screen.getByTestId('delivery-code')).toHaveTextContent(o.delivery_code);       // the sender sees the code

  // The customer raises his offer with + (by 10) and confirms.
  for (let i = 0; i < 5; i++) await fireEvent.press(screen.getByTestId('want-up'));
  expect(screen.getByTestId('order-price')).toHaveTextContent(new RegExp(`${rec + 60} DA`));
  await act(async () => { await fireEvent.press(screen.getByTestId('raise')); });
  await waitFor(async () => expect((await db.query(`SELECT offered_da FROM orders WHERE id=$1`, [o.id])).rows[0].offered_da).toBe(rec + 60));

  // Two couriers nearby answer: one accepts the price, one asks for more. Both offers appear; the customer picks one.
  const d1 = await driverOnline('+213555000009', { lat: 36.7545, lng: 3.0590 });
  const d2 = await driverOnline('+213555000010', { lat: 36.7550, lng: 3.0595 }, 'Yacine Fast');
  const r1 = await requestsOf(d1, o.ref), r2 = await requestsOf(d2, o.ref);
  expect(r1?.price_da).toBe(rec + 60);                                                  // the raised price reached the couriers
  expect((await call('/make_bid', { offer_id: r1.offer_id }, d1)).bid?.price_da).toBe(rec + 60);                    // accepts the customer's price
  expect((await call('/make_bid', { offer_id: r2.offer_id, price_da: rec + 80 }, d2))).toMatchObject({ bid: { price_da: rec + 80 } });   // proposes 20 DA more
  expect(await screen.findByTestId('offers')).toHaveTextContent(/Choose a courier/);
  expect(await screen.findByTestId('offer-' + r2.offer_id)).toHaveTextContent(/Yacine Fast/);
  expect(screen.getByTestId('offer-' + r1.offer_id)).toHaveTextContent(new RegExp(`${rec + 60} DA`));
  await act(async () => { await fireEvent.press(screen.getByTestId('decline-' + r2.offer_id)); });   // too expensive
  await waitFor(() => expect(screen.queryByTestId('offer-' + r2.offer_id)).toBeNull());
  await act(async () => { await fireEvent.press(screen.getByTestId('accept-' + r1.offer_id)); });
  expect(await screen.findByText('A courier is coming to pick it up')).toBeTruthy();
  expect(screen.getByTestId('driver-card')).toHaveTextContent(/Rachid Rider/);
  expect(screen.getByTestId('order-price-line')).toHaveTextContent(new RegExp(`Price: ${rec + 60} DA \\(fixed\\)`));
  expect(screen.getByTestId('pickup-code')).toHaveTextContent(o.pickup_code);
  expect(screen.getByTestId('pickup-qr')).toBeTruthy();
  const shared = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  const shareBtns = screen.getAllByTestId('share-tracking'); await fireEvent.press(shareBtns[shareBtns.length - 1]);
  expect((shared.mock.calls[0][0] as any).message).toMatch(new RegExp(`${API}/t/[A-Za-z0-9_-]{32}`));
  shared.mockRestore();
  await apiPickup(o.id, d1);
  expect(await screen.findByText('On the way to Amine Recipient')).toBeTruthy();
  expect(await screen.findByTestId('parcel-photo')).toBeTruthy();
  expect(screen.getByTestId('expecting')).toHaveTextContent(/expecting the parcel/);    // the receiver's yes counts as "expecting it"
  expect(screen.getByTestId('history')).toHaveTextContent(/The receiver confirmed/);
  expect(screen.getByTestId('history')).toHaveTextContent(/Parcel collected \(code \+ photo\)/);
  expect(screen.queryByTestId('pickup-box')).toBeNull();
  expect(screen.queryByTestId('cancel-order')).toBeNull();
  await call('/update_job_step', { order_id: o.id, step: 'delivered', delivery_code: o.delivery_code, cash_collected_da: 2500 + rec + 60, location: await dropoffOf(o.id) }, d1);
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
  await db.query(`UPDATE driver_details SET is_online=false`);
});

test('the receiver declines: the request ends and the sender sees why; it is remembered in "recent" places', async () => {
  await open(svc(kept));                                   // same phone, still logged in
  await screen.findByTestId('send-parcel');
  expect(await screen.findByTestId('recent-0')).toHaveTextContent(/Next to the Grande Poste/);   // the last destination, one tap away
  await fireEvent.press(screen.getByTestId('recent-0'));
  await screen.findByTestId('screen-order-details');
  expect(screen.getByTestId('r-name').props.value).toBe('Amine Recipient');              // receiver filled in from that time
  await fireEvent.changeText(screen.getByTestId('pa-street'), 'Rue Didouche Mourad 12');
  await act(async () => { await fireEvent.press(await screen.findByTestId('confirm-order')); });
  await screen.findByText(/Waiting for Amine Recipient to confirm/);
  const o = (await db.query(`SELECT id, tracking_hash FROM orders ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const shared = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  await fireEvent.press(screen.getByTestId('share-tracking'));
  const msg = (shared.mock.calls[0][0] as any).message as string; shared.mockRestore();
  await call('/track_decline', { t: tokenOf(msg), reason: 'not_ordered' });
  expect(await screen.findByTestId('recipient-declined')).toHaveTextContent(/Amine Recipient said he is not expecting this parcel/);
  expect(screen.getByTestId('order-status')).toHaveTextContent(/Cancelled/);
  expect((await db.query(`SELECT status, cancel_reason FROM orders WHERE id=$1`, [o.id])).rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'recipient_declined' });
});

test('cancel while waiting; the order list shows the orders', async () => {
  await open(svc());
  await sender('0555000001');
  await chooseRoute(P, D);
  await fillDetails();
  await act(async () => { await fireEvent.press(screen.getByTestId('size-large')); });
  await waitFor(() => expect(screen.getByTestId('trip-info')).toHaveTextContent(/By car/));   // large parcel -> car, new price shown
  await act(async () => { await fireEvent.press(screen.getByTestId('confirm-order')); });
  await screen.findByText(/Waiting for Amine Recipient to confirm/);
  expect((await db.query(`SELECT vehicle FROM orders ORDER BY created_at DESC LIMIT 1`)).rows[0].vehicle).toBe('car');   // large parcel -> car
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => { b?.find(x => x.style === 'destructive')?.onPress?.(); });
  await act(async () => { await fireEvent.press(screen.getByTestId('cancel-order')); });
  alert.mockRestore();
  await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent(/Cancelled/));
  expect(screen.getByTestId('send-again')).toBeTruthy();
  await pressBack();
  await menu('menu-orders');
  await screen.findByTestId('screen-orders');
  expect((await screen.findAllByText(/^→ Amine Recipient/)).length).toBeGreaterThanOrEqual(3);
  expect(screen.getAllByText('Cancelled').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Delivered')).toBeTruthy();
});

test('a place we do not serve is refused with a clear message, and no order is made', async () => {
  await open(svc());
  await sender('0555000001');
  await chooseRoute({ lat: 35.6971, lng: -0.6308 }, D);   // Oran: outside the open zone
  expect(await screen.findByTestId('order-msg')).toHaveTextContent(/We do not deliver there yet/);
  expect(screen.queryByTestId('price')).toBeNull();
});

test('after pickup the sender calls the parcel back: it returns to him, with a code and a QR for the driver', async () => {
  await db.query(`UPDATE driver_details SET is_online=false`);   // only this test's driver may get the offer
  const phone = '+213555000001';
  await call('/send_code', { phone }); const v = await call('/verify_code', { phone, code: await devCode(phone), path: 'user' });
  const q = await call('/get_quote', { pickup: P, dropoff: D, size: 'small' }, v.token);
  const o = await (await nodeFetch(API + '/create_order', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token, 'idempotency-key': 'recall-test-0001' }, body: JSON.stringify({ auto_accept: true, quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue Hassiba 3' }, dropoff_address: { street: 'Kouba' }, recipient_name: 'Recall Recipient', recipient_phone: '+213770998877', payer: 'sender' }) })).json() as any;
  await call('/track_confirm', { t: o.tracking_token });
  const dTok = await driverOnline('+213555000019', { lat: 36.7545, lng: 3.0590 });
  const r = await requestsOf(dTok, o.ref);
  await call('/make_bid', { offer_id: r.offer_id }, dTok);   // auto-accept: the job is his at once
  await apiPickup(o.id, dTok);
  await open(svc());
  await sender('0555000001');
  await menu('menu-orders');
  await fireEvent.press(await screen.findByText(/→ Recall Recipient/));
  await fireEvent.press(await screen.findByTestId('recall'));
  expect(screen.getByTestId('recall-confirm').props.accessibilityState.disabled).toBe(true);   // a reason is required
  await fireEvent.press(screen.getByTestId('recall-buyer_cancelled'));
  await act(async () => { await fireEvent.press(screen.getByTestId('recall-confirm')); });
  await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent(/Delivery failed/));
  expect(screen.getByTestId('history')).toHaveTextContent(/You called the parcel back: The buyer cancelled/);
  const ret = (await db.query(`SELECT id, status, leg FROM orders WHERE parent_order_id=$1`, [o.id])).rows[0];
  expect(ret).toMatchObject({ status: 'picked_up', leg: 'return' });
});

test('side menu: profile name, notifications, safety and help pages', async () => {
  await open(svc());
  await sender('0555000001');
  await menu('menu-profile');
  await screen.findByTestId('screen-profile');
  await fireEvent.changeText(screen.getByTestId('profile-name'), 'Nora S.');
  await act(async () => { await fireEvent.press(screen.getByTestId('profile-save')); });
  expect(await screen.findByTestId('profile-msg')).toHaveTextContent(/Saved/);
  expect((await db.query(`SELECT display_name FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213555000001' AND p.type='user'`)).rows[0].display_name).toBe('Nora S.');
  await pressBack();
  await menu('menu-notifications');
  expect((await screen.findAllByText(/The receiver confirmed: looking for couriers/)).length).toBeGreaterThan(0);   // from the first order
  expect(screen.queryByText(/delivery_code/)).toBeNull();
  await pressBack();
  await menu('menu-safety');
  expect(await screen.findByText(/The receiver confirms before any courier moves/)).toBeTruthy();
  await pressBack();
  await menu('menu-help');
  expect(await screen.findByText(/How does sending a parcel work\?/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('faq-2'));
  expect(await screen.findByText(/Couriers nearby see your price/)).toBeTruthy();
});
