// A server where SMS login and Google login are both switched off must refuse both, and say so to the app.
import { googleToken } from './google';
const B = 'http://localhost:3399'; let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x: any = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`); };
const api = async (path: string, body?: any) => { const r = await fetch(B + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => ({})) as any }; };
(async () => {
  const m = await api('/login_methods');
  ok('OFF1 the app is told that no login method is on', m.b.google === false && m.b.sms === false, m.b);
  ok('OFF2 SMS codes are refused (no SMS is sent, no cost)', (await api('/send_code', { phone: '+213551234567' })).b.error === 'LOGIN_METHOD_OFF');
  ok('OFF2 code checks are refused', (await api('/verify_code', { phone: '+213551234567', code: '123456', path: 'user' })).b.error === 'LOGIN_METHOD_OFF');
  ok('OFF3 Google login is refused when the app\'s Google ids are not set', (await api('/login_google', { id_token: googleToken('g-off-1'), path: 'user' })).b.error === 'LOGIN_METHOD_OFF');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
