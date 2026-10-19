// The first screens (welcome, phone, code, first profile, home, settings), rendered for real and driven like a person would,
// against the REAL backend and the TEST database. Nothing is mocked except the phone's secure vault (kept in memory).
import React from 'react';
import { Alert } from 'react-native';
import { screen, fireEvent, waitFor, act } from 'expo-router/testing-library';
import { memoryStore } from '../src/core/storage';
import { toInternational, display } from '../src/lib/phone';
import { API, db, devCode, open, svc, uploadDocs, loginThroughScreens } from './screens';
import { nodeFetch } from './http';

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, notifications, device_tokens, driver_details, documents, profiles, accounts, security_events CASCADE`);
});
afterAll(async () => { await db.end(); });

test('phone numbers: what people type in Algeria becomes the international format', () => {
  expect(toInternational('0550 12 34 56')).toBe('+213550123456');
  expect(toInternational('+213 6 61-22-33-44')).toBe('+213661223344');
  expect(toInternational('00213771234567')).toBe('+213771234567');
  expect(toInternational('550123456')).toBe('+213550123456');
  expect(toInternational('0450123456')).toBeNull();   // not a mobile number
  expect(toInternational('05501234')).toBeNull();     // too short
  expect(toInternational('05501234567')).toBeNull();  // too long
  expect(toInternational('05a0123456')).toBeNull();
  expect(display('+213550123456')).toBe('0550 12 34 56');
});

test('welcome: language switch changes every text and the direction, and is remembered', async () => {
  const store = memoryStore();
  await open(svc(store));
  await screen.findByTestId('screen-welcome');
  expect(screen.getByText('I want to send parcels')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('lang-ar'));
  expect(await screen.findByText('أريد إرسال طرود')).toBeTruthy();
  expect(screen.getByText('أريد التوصيل')).toBeTruthy();
  const flat = (st: any): any => Array.isArray(st) ? Object.assign({}, ...st.map(flat)) : st ?? {};
  const scroll = screen.root!.queryAll((n: any) => flat(n.props?.contentContainerStyle).direction === 'rtl');
  expect(scroll.length).toBeGreaterThan(0);                           // the whole screen is right-to-left
  expect(flat(screen.getByText('أريد إرسال طرود').props.style).writingDirection).toBeUndefined(); // button text is centred
  await waitFor(async () => expect(await store.get('lang')).toBe('ar'));
  await fireEvent.press(screen.getByTestId('lang-fr'));
  expect(await screen.findByText('Je veux envoyer des colis')).toBeTruthy();
});

test('sender sign-up: bad number, wrong code, then code -> name -> home; reopening the app needs no new SMS', async () => {
  const store = memoryStore();
  await open(svc(store));
  await fireEvent.press(await screen.findByTestId('path-user'));
  await fireEvent.press(await screen.findByTestId('login-phone'));
  await fireEvent.changeText(await screen.findByTestId('phone-input'), '0450 00 00 01');
  await fireEvent.press(screen.getByTestId('send-code'));
  expect(await screen.findByTestId('phone-input-error')).toBeTruthy();                 // a landline is refused before any SMS
  await fireEvent.changeText(screen.getByTestId('phone-input'), '0553 00 00 01');
  await fireEvent.press(screen.getByTestId('send-code'));
  await screen.findByTestId('screen-code');
  expect(screen.getByText(/0553 00 00 01/)).toBeTruthy();
  const real = await devCode('+213553000001');
  const wrong = real === '000000' ? '111111' : '000000';
  await act(async () => { await fireEvent.changeText(screen.getByTestId('code-input'), wrong); });
  expect(await screen.findByText(/Wrong code/)).toBeTruthy();
  expect(screen.getByTestId('resend').props.accessibilityState.disabled).toBe(true);   // no new SMS for 60 s
  await act(async () => { await fireEvent.changeText(screen.getByTestId('code-input'), real); });
  await screen.findByTestId('screen-new-user');
  await fireEvent.changeText(screen.getByTestId('name-input'), 'A');
  await fireEvent.press(screen.getByTestId('create-profile'));
  expect(await screen.findByTestId('name-input-error')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('name-input'), 'Lina Haddad');
  await fireEvent.press(screen.getByTestId('create-profile'));
  expect(await screen.findByTestId('name-input-error')).toHaveTextContent(/Accept the platform rules/);   // the rules must be accepted
  await fireEvent.press(screen.getByTestId('read-rules'));
  expect(await screen.findByTestId('screen-rules')).toBeTruthy();
  expect(screen.getAllByText(/Prohibited goods/).length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByText('‹ Back'));
  await fireEvent.press(await screen.findByTestId('accept-rules'));
  await fireEvent.press(screen.getByTestId('create-profile'));
  expect(await screen.findByText('Hello, Lina Haddad')).toBeTruthy();
  const rows = await db.query(`SELECT p.type, p.display_name FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213553000001'`);
  expect(rows.rows).toEqual([{ type: 'user', display_name: 'Lina Haddad' }]);         // exactly one profile, the chosen path
  expect(await store.get('refresh_token')).toMatch(/^[0-9a-f]{64}$/);

  await screen.unmount();
  await open(svc(store));                                                              // the app is closed and opened again
  expect(await screen.findByText('Hello, Lina Haddad')).toBeTruthy();
});

test('driver path, new number: no profile is created; the driver sign-up opens', async () => {
  const s = svc();
  await open(s);
  await loginThroughScreens('0553000002', 'driver');
  await screen.findByTestId('screen-driver-signup');
  const me = await s.client.call('/get_me');                       // asked from the server, not the screen
  expect(me.profiles).toEqual([]);
  expect(me.active_profile).toBeNull();
});

test('a sender who picks "I want to deliver" lands in the sender profile with a calm notice (never an error)', async () => {
  await open(svc());
  await loginThroughScreens('0553000001', 'driver');
  expect(await screen.findByText('Hello, Lina Haddad')).toBeTruthy();
  expect(screen.getByTestId('notice-no-profile')).toBeTruthy();
});

test('driver with both profiles: pending status shown, switch to the sender profile from Settings', async () => {
  // A driver profile is created through the real API (documents as links until photo upload exists).
  const phone = '+213553000003';
  await nodeFetch(API + '/send_code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
  const v = await (await nodeFetch(API + '/verify_code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, code: await devCode(phone), path: 'driver' }) })).json() as any;
  const d = await (await nodeFetch(API + '/add_profile', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: JSON.stringify({ accept_rules: true, national_id: '123456789012', type: 'driver', display_name: 'Karim Driver', documents: await uploadDocs(v.token) }) })).json() as any;
  await nodeFetch(API + '/add_profile', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + d.token }, body: JSON.stringify({ accept_rules: true, type: 'user', display_name: 'Karim Sender' }) });

  await open(svc());
  await loginThroughScreens('0553000003', 'driver');
  expect(await screen.findByText('Hello, Karim Driver')).toBeTruthy();
  expect(screen.getByTestId('driver-status')).toHaveTextContent(/waiting for approval/);
  await fireEvent.press(screen.getByTestId('open-settings'));
  await fireEvent.press(await screen.findByTestId('switch-profile'));
  expect(await screen.findByText('Hello, Karim Sender')).toBeTruthy();
});

test('settings: add a driver profile opens sign-up, log out, log out of all devices', async () => {
  const store = memoryStore();
  await open(svc(store));
  await loginThroughScreens('0553000001', 'user');
  expect(await screen.findByText('Hello, Lina Haddad')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('open-settings'));
  await screen.findByTestId('screen-settings');
  await fireEvent.press(screen.getByTestId('add-driver'));
  await screen.findByTestId('screen-driver-signup');
  await fireEvent.press(screen.getByText('‹ Back'));
  await screen.findByTestId('screen-settings');
  await fireEvent.press(screen.getByTestId('logout'));
  await screen.findByTestId('screen-welcome');
  expect(await store.get('refresh_token')).toBeNull();

  // Two devices logged in, "log out of all devices" from one ends both.
  const other = svc();
  await other.session.sendCode('+213553000001');
  await other.session.verifyCode('+213553000001', await devCode('+213553000001'), 'user');
  await screen.unmount();
  await open(svc(store));
  await loginThroughScreens('0553000001', 'user');
  await screen.findByText('Hello, Lina Haddad');
  await fireEvent.press(screen.getByTestId('open-settings'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.find(b => b.style === 'destructive')?.onPress?.(); });
  await fireEvent.press(await screen.findByTestId('logout-all'));
  await screen.findByTestId('screen-welcome');
  alert.mockRestore();
  await expect(other.client.call('/get_me')).rejects.toMatchObject({ status: 401 });   // the other phone is logged out too
});

test('Google login, sender: picker closed -> nothing happens; then Google -> phone number -> name prefilled -> home; reopening stays logged in', async () => {
  const { googleMock } = require('./mocks/google-signin');
  const store = memoryStore();
  await open(svc(store));
  await fireEvent.press(await screen.findByTestId('path-user'));
  await screen.findByTestId('login-google');
  expect(screen.getByTestId('login-phone')).toBeTruthy();                                // SMS is also on in the test server
  googleMock.cancel = true;
  await fireEvent.press(screen.getByTestId('login-google'));
  await waitFor(() => expect(screen.getByTestId('login-google').props.accessibilityState?.busy).toBeFalsy());
  expect(screen.queryByTestId('login-error')).toBeNull();                               // closing Google's picker is not an error
  expect(screen.getByTestId('screen-login')).toBeTruthy();
  googleMock.cancel = false; googleMock.sub = 'g-mobile-sender'; googleMock.name = 'Sara Benali';
  await fireEvent.press(screen.getByTestId('login-google'));
  await screen.findByTestId('screen-contact-phone');
  await fireEvent.changeText(screen.getByTestId('contact-phone-input'), '0450 00 00 01');
  await fireEvent.press(screen.getByTestId('save-phone'));
  expect(await screen.findByTestId('contact-phone-input-error')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('contact-phone-input'), '0554 00 00 07');
  await fireEvent.press(screen.getByTestId('save-phone'));
  await screen.findByTestId('screen-new-user');
  expect(screen.getByTestId('name-input').props.value).toBe('Sara Benali');            // name offered by Google, can be changed
  await fireEvent.press(screen.getByTestId('accept-rules'));
  await fireEvent.press(screen.getByTestId('create-profile'));
  expect(await screen.findByText('Hello, Sara Benali')).toBeTruthy();
  const rows = await db.query(`SELECT a.phone, a.phone_verified, p.type FROM accounts a JOIN profiles p ON p.account_id=a.id WHERE a.google_sub='g-mobile-sender'`);
  expect(rows.rows).toEqual([{ phone: '+213554000007', phone_verified: false, type: 'user' }]);
  await screen.unmount();
  await open(svc(store));
  expect(await screen.findByText('Hello, Sara Benali')).toBeTruthy();
});

test('Google login, driver: phone number, then the driver sign-up with the Google name', async () => {
  const { googleMock } = require('./mocks/google-signin');
  googleMock.sub = 'g-mobile-driver'; googleMock.name = 'Yacine Driver';
  await open(svc());
  await fireEvent.press(await screen.findByTestId('path-driver'));
  await fireEvent.press(await screen.findByTestId('login-google'));
  await fireEvent.changeText(await screen.findByTestId('contact-phone-input'), '0664000008');
  await fireEvent.press(screen.getByTestId('save-phone'));
  await screen.findByTestId('screen-driver-signup');
  expect(screen.getByTestId('name-input').props.value).toBe('Yacine Driver');
  const n = await db.query(`SELECT count(*)::int n FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.google_sub='g-mobile-driver'`);
  expect(n.rows[0].n).toBe(0);                                                          // nothing is created before the photos
});

test('Google login: someone who left before giving the phone number is asked for it at the next login', async () => {
  const { googleMock } = require('./mocks/google-signin');
  googleMock.sub = 'g-mobile-later'; googleMock.name = 'Later Person';
  const store = memoryStore();
  await open(svc(store));
  await fireEvent.press(await screen.findByTestId('path-user'));
  await fireEvent.press(await screen.findByTestId('login-google'));
  await screen.findByTestId('screen-contact-phone');
  await screen.unmount();
  await open(svc(store));
  await fireEvent.press(await screen.findByTestId('path-user'));
  await fireEvent.press(await screen.findByTestId('login-google'));
  await screen.findByTestId('screen-contact-phone');
});

test('my record: a rule break with its reason, an appeal sent once, the block shown', async () => {
  await db.query(`DELETE FROM otp_codes`);   // this test number has logged in many times already (5 codes per hour protection)
  const store = memoryStore();
  await open(svc(store));
  await loginThroughScreens('0553000001', 'user');
  await screen.findByText('Hello, Lina Haddad');
  const pid = (await db.query(`SELECT p.id FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213553000001' AND p.type='user'`)).rows[0].id;
  await fireEvent.press(screen.getByTestId('open-settings'));
  await fireEvent.press(await screen.findByTestId('open-record'));
  expect(await screen.findByTestId('record-empty')).toHaveTextContent(/No rule broken/);
  await db.query(`INSERT INTO violations(profile_id, rule, points, note, source) VALUES ($1, 'late_cancel', 1, 'Cancelled after a driver had accepted', 'system')`, [pid]);
  await db.query(`INSERT INTO sanctions(profile_id, kind, level, until, reason, source) VALUES ($1, 'block', 5, now() + interval '1 day', 'test block', 'system')`, [pid]);
  await fireEvent.press(screen.getByText('‹ Back'));
  await fireEvent.press(await screen.findByTestId('open-record'));
  expect(await screen.findByTestId('record-points')).toHaveTextContent(/1 points in the last 90 days/);
  expect(screen.getByTestId('record-block')).toHaveTextContent(/blocked until/);
  expect(screen.getByText(/Sender cancels late/)).toBeTruthy();
  const vid = (await db.query(`SELECT id FROM violations WHERE profile_id=$1`, [pid])).rows[0].id;
  await fireEvent.press(screen.getByTestId('appeal-' + vid));
  await fireEvent.changeText(screen.getByTestId('appeal-text'), 'short');
  await act(async () => { await fireEvent.press(screen.getByTestId('appeal-send')); });
  expect(await screen.findByTestId('record-msg')).toHaveTextContent(/at least 10 characters/);
  await fireEvent.changeText(screen.getByTestId('appeal-text'), 'The driver never came, I waited 20 minutes.');
  await act(async () => { await fireEvent.press(screen.getByTestId('appeal-send')); });
  expect(await screen.findByTestId('record-msg')).toHaveTextContent(/Appeal sent/);
  await waitFor(() => expect(screen.queryByTestId('appeal-' + vid)).toBeNull());       // one appeal only
  expect((await db.query(`SELECT status FROM violations WHERE id=$1`, [vid])).rows[0].status).toBe('appealed');
  await db.query(`UPDATE sanctions SET lifted_at=now(), lift_note='test' WHERE profile_id=$1`, [pid]);
});
