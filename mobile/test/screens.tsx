// Shared helpers for the screen tests: the real screens, the real backend, the TEST database.
import React from 'react';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, act, configure } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pool } from 'pg';
import { AppProvider, makeServices, Services } from '../src/lib/app';
import { memoryStore } from '../src/core/storage';
import { nodeFetch } from './http';
import { toInternational } from '../src/lib/phone';
import Start from '../src/app/index';
import Welcome from '../src/app/welcome';
import Phone from '../src/app/phone';
import Code from '../src/app/code';
import NewProfile from '../src/app/new-profile';
import Home from '../src/app/home';
import Settings from '../src/app/settings';
import DriverSignup from '../src/app/driver-signup';

export const API = process.env.API_URL!;
if (!/_test$/.test(process.env.TEST_DATABASE_URL ?? '')) throw new Error('test database only');
export const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

export const devCode = async (phone: string) => ((await (await nodeFetch(API + '/dev/last_code?phone=' + encodeURIComponent(phone))).json()) as any).code as string;
configure({ asyncUtilTimeout: 10000 });   // real network calls to the test server
jest.setTimeout(60000);
export const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export function routes(services: Services) {
  const Layout = () => (
    <SafeAreaProvider initialMetrics={metrics}>
      <AppProvider services={services}><Stack screenOptions={{ headerShown: false }} /></AppProvider>
    </SafeAreaProvider>
  );
  return { _layout: Layout, index: Start, welcome: Welcome, phone: Phone, code: Code, 'new-profile': NewProfile, home: Home, settings: Settings, 'driver-signup': DriverSignup };
}
export async function open(services: Services) {
  const r = await renderRouter(routes(services), { initialUrl: '/' });
  return r;
}
export const PHOTO = require('fs').readFileSync(require('path').join(__dirname, '../../backend/test/fixtures/photo.jpg'));
export async function uploadDocs(token: string) {
  const out: Record<string, string> = { vehicle: 'motorbike' };
  for (const k of ['id_photo', 'licence_photo', 'vehicle_photo']) out[k] = ((await (await nodeFetch(API + '/upload_document?kind=' + k, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'image/jpeg' }, body: PHOTO })).json()) as any).document_id;
  return out;
}
export const svc = (store = memoryStore()) => makeServices(store, API, nodeFetch);

export async function loginThroughScreens(phoneTyped: string, path: 'user' | 'driver') {
  await fireEvent.press(await screen.findByTestId('path-' + path));
  await fireEvent.changeText(await screen.findByTestId('phone-input'), phoneTyped);
  await fireEvent.press(screen.getByTestId('send-code'));
  await screen.findByTestId('screen-code');
  const code = await devCode(toInternational(phoneTyped)!);
  await act(async () => { await fireEvent.changeText(screen.getByTestId('code-input'), code); });
}

