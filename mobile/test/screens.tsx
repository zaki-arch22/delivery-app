// Shared helpers for the screen tests: the real screens, the real backend, the TEST database.
// Rule for these tests: never wait for an element INSIDE act(...): act holds screen updates back until it ends.
import React from 'react';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, act, configure } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { execFileSync } from 'child_process';
import { AppProvider, makeServices, Services } from '../src/lib/app';
import { PushBridge } from '../src/lib/PushBridge';
import { memoryStore } from '../src/core/storage';
import { nodeFetch } from './http';
import { toInternational } from '../src/lib/phone';
import Start from '../src/app/index';
import Welcome from '../src/app/welcome';
import Phone from '../src/app/phone';
import Login from '../src/app/login';
import ContactPhone from '../src/app/contact-phone';
import Code from '../src/app/code';
import NewProfile from '../src/app/new-profile';
import Home from '../src/app/home';
import Settings from '../src/app/settings';
import DriverSignup from '../src/app/driver-signup';
import NewOrder from '../src/app/new-order';
import OrderDetails from '../src/app/order-details';
import OrderScreen from '../src/app/order/[id]';
import Orders from '../src/app/orders';
import Rate from '../src/app/rate/[id]';
import Problem from '../src/app/problem/[id]';
import JobScreen from '../src/app/job';
import Jobs from '../src/app/jobs';
import Cash from '../src/app/cash';

export const API = process.env.API_URL!;
if (!/_test$/.test(process.env.TEST_DATABASE_URL ?? '')) throw new Error('test database only');
// Test database access through the psql program, synchronously. (The pg library stalled while the navigation test
// tool's fake clocks were on; a separate program is never affected.) Values are quoted as SQL literals.
const lit = (v: any): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
export const db = {
  async query(text: string, params: any[] = []) {
    const q = text.replace(/\$(\d+)/g, (_, i) => lit(params[Number(i) - 1]));
    const isRead = /^\s*(SELECT|WITH)\b/i.test(q);
    const out = execFileSync('psql', [process.env.TEST_DATABASE_URL!, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', isRead ? `SELECT coalesce(json_agg(x), '[]') FROM (${q}) x` : q], { encoding: 'utf8' });
    return { rows: isRead ? JSON.parse(out.trim() || '[]') : [] as any[] };
  },
  async end() {},
};

export const devCode = async (phone: string) => ((await (await nodeFetch(API + '/dev/last_code?phone=' + encodeURIComponent(phone))).json()) as any).code as string;
configure({ asyncUtilTimeout: 10000 });   // real network calls to the test server
jest.setTimeout(60000);
export const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export function routes(services: Services) {
  const Layout = () => (
    <SafeAreaProvider initialMetrics={metrics}>
      <AppProvider services={services}><PushBridge /><Stack screenOptions={{ headerShown: false }} /></AppProvider>
    </SafeAreaProvider>
  );
  return { _layout: Layout, index: Start, welcome: Welcome, login: Login, 'contact-phone': ContactPhone, phone: Phone, code: Code, 'new-profile': NewProfile, home: Home, settings: Settings, 'driver-signup': DriverSignup, 'new-order': NewOrder, 'order-details': OrderDetails, 'order/[id]': OrderScreen, orders: Orders, 'rate/[id]': Rate, 'problem/[id]': Problem, job: JobScreen, jobs: Jobs, cash: Cash };
}
export async function open(services: Services) {
  const r = await renderRouter(routes(services), { initialUrl: '/' });
  // renderRouter switches to fake clocks; these tests talk to a real server and need real time (polling, waits).
  jest.useRealTimers();
  return r;
}
export const PHOTO = require('fs').readFileSync(require('path').join(__dirname, '../../backend/test/fixtures/photo.jpg'));
export async function uploadDocs(token: string) {
  const out: Record<string, string> = { vehicle: 'motorbike' };
  for (const k of ['id_photo', 'licence_photo', 'vehicle_photo']) out[k] = ((await (await nodeFetch(API + '/upload_document?kind=' + k, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'image/jpeg' }, body: PHOTO })).json()) as any).document_id;
  return out;
}
// The live connection uses the `ws` package (Node), exactly like the core tests.
export const svc = (store = memoryStore(), fetchFn: typeof fetch = nodeFetch) => makeServices(store, API, fetchFn, require('ws'), 500);

export async function loginThroughScreens(phoneTyped: string, path: 'user' | 'driver') {
  await fireEvent.press(await screen.findByTestId('path-' + path));
  await fireEvent.press(await screen.findByTestId('login-phone'));
  await fireEvent.changeText(await screen.findByTestId('phone-input'), phoneTyped);
  await fireEvent.press(screen.getByTestId('send-code'));
  await screen.findByTestId('screen-code');
  const code = await devCode(toInternational(phoneTyped)!);
  await act(async () => { await fireEvent.changeText(screen.getByTestId('code-input'), code); });
}

