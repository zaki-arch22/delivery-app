// The first screens (welcome, phone, code, first profile, home, settings), rendered for real and driven like a person would,
// against the REAL backend and the TEST database. Nothing is mocked except the phone's secure vault (kept in memory).
import React from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor, act, configure } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pool } from 'pg';
import { AppProvider, makeServices, Services } from '../src/lib/app';
import { memoryStore } from '../src/core/storage';
import { nodeFetch } from './http';
import { toInternational, display } from '../src/lib/phone';
import Start from '../src/app/index';
import Welcome from '../src/app/welcome';
import Phone from '../src/app/phone';
import Code from '../src/app/code';
import NewProfile from '../src/app/new-profile';
import Home from '../src/app/home';
import Settings from '../src/app/settings';

const API = process.env.API_URL!;
if (!/_test$/.test(process.env.TEST_DATABASE_URL ?? '')) throw new Error('test database only');
const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

const devCode = async (phone: string) => ((await (await nodeFetch(API + '/dev/last_code?phone=' + encodeURIComponent(phone))).json()) as any).code as string;
configure({ asyncUtilTimeout: 10000 });   // real network calls to the test server
jest.setTimeout(60000);
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function routes(services: Services) {
  const Layout = () => (
    <SafeAreaProvider initialMetrics={metrics}>
      <AppProvider services={services}><Stack screenOptions={{ headerShown: false }} /></AppProvider>
    </SafeAreaProvider>
  );
  return { _layout: Layout, index: Start, welcome: Welcome, phone: Phone, code: Code, 'new-profile': NewProfile, home: Home, settings: Settings };
}
async function open(services: Services) {
  const r = await renderRouter(routes(services), { initialUrl: '/' });
  return r;
}
const svc = (store = memoryStore()) => makeServices(store, API, nodeFetch);

async function loginThroughScreens(phoneTyped: string, path: 'user' | 'driver') {
  await fireEvent.press(await screen.findByTestId('path-' + path));
  await fireEvent.changeText(await screen.findByTestId('phone-input'), phoneTyped);
  await fireEvent.press(screen.getByTestId('send-code'));
  await screen.findByTestId('screen-code');
  const code = await devCode(toInternational(phoneTyped)!);
  await act(async () => { await fireEvent.changeText(screen.getByTestId('code-input'), code); });
}

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, notifications, device_tokens, driver_details, profiles, accounts, security_events CASCADE`);
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
  expect(await screen.findByText('Hello, Lina Haddad')).toBeTruthy();
  const rows = await db.query(`SELECT p.type, p.display_name FROM profiles p JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213553000001'`);
  expect(rows.rows).toEqual([{ type: 'user', display_name: 'Lina Haddad' }]);         // exactly one profile, the chosen path
  expect(await store.get('refresh_token')).toMatch(/^[0-9a-f]{64}$/);

  await screen.unmount();
  await open(svc(store));                                                              // the app is closed and opened again
  expect(await screen.findByText('Hello, Lina Haddad')).toBeTruthy();
});

test('driver path, new number: no profile is created and the driver sign-up notice is shown', async () => {
  const s = svc();
  await open(s);
  await loginThroughScreens('0553000002', 'driver');
  await screen.findByTestId('screen-new-driver');
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
  const d = await (await nodeFetch(API + '/add_profile', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: JSON.stringify({ type: 'driver', display_name: 'Karim Driver', documents: { id_photo_url: 'a', licence_photo_url: 'b', vehicle_photo_url: 'c', vehicle: 'motorbike' } }) })).json() as any;
  await nodeFetch(API + '/add_profile', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + d.token }, body: JSON.stringify({ type: 'user', display_name: 'Karim Sender' }) });

  await open(svc());
  await loginThroughScreens('0553000003', 'driver');
  expect(await screen.findByText('Hello, Karim Driver')).toBeTruthy();
  expect(screen.getByTestId('driver-status')).toHaveTextContent(/waiting for approval/);
  await fireEvent.press(screen.getByTestId('open-settings'));
  await fireEvent.press(await screen.findByTestId('switch-profile'));
  expect(await screen.findByText('Hello, Karim Sender')).toBeTruthy();
});

test('settings: no button for a driver profile that cannot be added yet, log out, log out of all devices', async () => {
  const store = memoryStore();
  await open(svc(store));
  await loginThroughScreens('0553000001', 'user');
  expect(await screen.findByText('Hello, Lina Haddad')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('open-settings'));
  await screen.findByTestId('screen-settings');
  expect(screen.getByText(/Adding a driver profile opens/)).toBeTruthy();    // no button that does not work
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
