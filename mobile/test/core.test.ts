/** @jest-environment node */
// The app's foundation, against the REAL backend (test database only).
import { createHmac, hkdfSync } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import WS from 'ws';
import { Client, ApiError } from '../src/core/api';
import { Session } from '../src/core/session';
import { Realtime, Notice } from '../src/core/realtime';
import { memoryStore } from '../src/core/storage';

const API = process.env.API_URL!, WSURL = API.replace(/^http/, 'ws') + '/ws';
if (!/_test$/.test(process.env.TEST_DATABASE_URL ?? '')) throw new Error('test database only');
const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async <T,>(f: () => T | Promise<T>, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(100); } return null; };
const devCode = async (phone: string) => (await (await fetch(API + '/dev/last_code?phone=' + encodeURIComponent(phone))).json()).code as string;
// An access key that EXPIRED a minute ago, signed exactly like the server signs (same derived key).
const expired = (tok: string) => {
  const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); const now = Math.floor(Date.now() / 1000);
  const b = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ ...p, iat: now - 1000, exp: now - 60 })}`;
  const key = Buffer.from(hkdfSync('sha256', process.env.JWT_SECRET!, 'delivery-v1', 'jwt-app', 32));
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
};
const newApp = (store = memoryStore()) => { let refreshCalls = 0; const f: typeof fetch = (u, i) => { if (String(u).endsWith('/refresh_token')) refreshCalls++; return fetch(u, i); }; const c = new Client(API, store, f); return { store, client: c, session: new Session(c), refreshes: () => refreshCalls }; };
async function signUp(phone: string, name: string, app = newApp()) {
  await app.session.sendCode(phone); const s = await app.session.verifyCode(phone, await devCode(phone), 'user');
  expect(s.needsProfile).toBe('user'); await app.session.addProfile('user', name, true); return app;
}

beforeAll(async () => { await db.query(`TRUNCATE otp_codes, sessions, notifications, device_tokens, driver_details, profiles, accounts, security_events CASCADE`); });
afterAll(async () => { await db.end(); });

test('1. login: the long-lived key goes into the secure vault; the short-lived key stays in memory only', async () => {
  const app = await signUp('+213552000001', 'Lina');
  expect(app.session.state.active?.type).toBe('user');
  expect(await app.store.get('refresh_token')).toMatch(/^[0-9a-f]{64}$/);
  expect(await app.store.get('access_token')).toBeNull();
  expect(app.client.token).toBeTruthy();
});

test('2. reopening the app resumes the login from the vault, without a new SMS code', async () => {
  const first = await signUp('+213552000002', 'Omar');
  const reopened = newApp(first.store);                       // same phone vault, fresh app memory
  expect(await reopened.session.restore()).toBe(true);
  expect(reopened.session.state.active?.display_name).toBe('Omar');
});

test('3. FIVE requests notice an expired key at the same moment: exactly ONE renewal is sent, all five succeed, the session survives', async () => {
  const app = await signUp('+213552000003', 'Sara');
  await app.client.setSession(expired(app.client.token!));
  const results = await Promise.all(Array.from({ length: 5 }, () => app.client.call('/get_me')));
  expect(results.every(r => r.active_profile?.display_name === 'Sara')).toBe(true);
  expect(app.refreshes()).toBe(1);
  expect((await app.client.call('/get_me')).account).toBeTruthy();          // still logged in: no false "theft" alarm
  expect((await db.query(`SELECT count(*)::int n FROM security_events WHERE type='refresh_token_reuse'`)).rows[0].n).toBe(0);
});

test('4. a second profile from Settings, and switching between the two', async () => {
  const app = await signUp('+213552000004', 'Karim Seller');
  // Sign-up photos go up through the same client (renewal and all), then add_profile gets their ids.
  const photo = () => new Blob([readFileSync(join(__dirname, '../../backend/test/fixtures/photo.jpg'))], { type: 'image/jpeg' });
  const docs = { vehicle: 'motorbike', id_photo: await app.session.uploadDocument('id_photo', photo()), licence_photo: await app.session.uploadDocument('licence_photo', photo()), vehicle_photo: await app.session.uploadDocument('vehicle_photo', photo()) };
  expect(docs.id_photo).toMatch(/^[0-9a-f-]{36}$/);
  await app.session.addProfile('driver', 'Karim Driver', true, docs, '100000000001');
  expect(app.session.state.active?.type).toBe('driver'); expect(app.session.state.profiles.length).toBe(2);
  await app.session.switchProfile('user');
  expect(app.session.state.active?.type).toBe('user');
  expect((await app.client.call('/get_me')).active_profile.type).toBe('user');
});

test('5. "log out of all devices" empties the vault on THIS phone and kills the login on the OTHER phone', async () => {
  const phoneA = await signUp('+213552000005', 'Nadia');
  const phoneB = newApp(); await phoneB.session.sendCode('+213552000005'); await phoneB.session.verifyCode('+213552000005', await devCode('+213552000005'), 'user');
  let signedOut = false; phoneA.client.onSignedOut(() => { signedOut = true; });
  expect(await phoneA.session.logoutEverywhere()).toBeGreaterThanOrEqual(2);
  expect(await phoneA.store.get('refresh_token')).toBeNull(); expect(signedOut).toBe(true);
  await expect(phoneB.client.call('/get_me')).rejects.toBeInstanceOf(ApiError);
  expect(await phoneB.store.get('refresh_token')).toBeNull();               // the other phone notices and clears itself too
});

test('6. live notifications: delivered once; a dropped connection reconnects and picks up exactly what was missed', async () => {
  const app = await signUp('+213552000006', 'Yacine'); const pid = app.session.state.active!.id;
  const rt = new Realtime(app.client, app.store, WSURL, WS as any); const got: Notice[] = []; rt.onNotice(n => got.push(n));
  await rt.start(pid); await sleep(400);
  const add = (k: string) => db.query(`INSERT INTO notifications(profile_id,type,dedupe_key,push_state) VALUES ($1,'order.assigned',$2,'skipped')`, [pid, k]);
  await add('n1'); expect(await until(() => got.length === 1)).toBeTruthy();
  (rt as any).ws.close();                                                   // the network drops
  await add('n2'); await add('n3');                                         // ... while two notifications happen
  expect(await until(() => got.length === 3, 10000)).toBeTruthy();
  expect(got.map(n => n.id)).toEqual([...got.map(n => n.id)].sort((a, b) => a - b));
  expect(new Set(got.map(n => n.id)).size).toBe(3);                          // nothing twice
  rt.stop();
});

test('7. live connection with an EXPIRED key: it renews the key and connects anyway', async () => {
  const app = await signUp('+213552000007', 'Rania'); const pid = app.session.state.active!.id;
  await app.client.setSession(expired(app.client.token!));
  const rt = new Realtime(app.client, app.store, WSURL, WS as any); const got: Notice[] = []; rt.onNotice(n => got.push(n));
  await rt.start(pid); await sleep(300);
  await until(async () => { await db.query(`INSERT INTO notifications(profile_id,type,dedupe_key,push_state) VALUES ($1,'order.assigned',$2,'skipped') ON CONFLICT DO NOTHING`, [pid, 'x' + Math.floor(Date.now() / 1000)]); return got.length > 0; }, 12000);
  expect(got.length).toBeGreaterThan(0); rt.stop();
});

test('8. offline job-step queue: a step the server refuses is dropped and reported, never retried forever', async () => {
  const { StepQueue } = require('../src/core/queue');
  const app = await signUp('+213552000008', 'Queue Tester');
  const q = new StepQueue(app.client, app.store, 200);
  const events: any[] = []; q.onEvent((e: any) => events.push(e));
  await q.send({ order_id: '00000000-0000-0000-0000-000000000000', step: 'picked_up', location: { lat: 36.75, lng: 3.05 } });   // a sender profile has no job: refused
  expect(events).toHaveLength(1);
  expect(events[0].sent).toBe(false);
  expect(events[0].error.code).toBe('WRONG_PROFILE');
  expect(await q.pending()).toEqual([]);
  expect(await app.store.get('job_steps')).toBe('[]');                                   // nothing left on the phone
  q.stop();
});
