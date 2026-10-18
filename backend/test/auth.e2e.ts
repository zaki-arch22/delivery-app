const B = 'http://localhost:3399';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function api(path: string, body?: any, token?: string, method = body ? 'POST' : 'GET') {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, b: await r.json().catch(() => ({})) as any };
}
async function login(phone: string, path: 'user' | 'driver') {
  await api('/send_code', { phone });
  const { b } = await api('/dev/last_code?phone=' + encodeURIComponent(phone));
  return api('/verify_code', { phone, code: b.code, path });
}
import { Pool } from 'pg';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('Tests need TEST_DATABASE_URL pointing to a separate test database, never the real one');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
const docs = { id_photo_url: 'x/id.jpg', licence_photo_url: 'x/lic.jpg', vehicle_photo_url: 'x/v.jpg', vehicle: 'motorbike' };

(async () => {
  const phone = '+213551112233';
  // 1. new number, user path
  let r = await login(phone, 'user');
  ok('new number: login works, no profile yet', r.s === 200 && r.b.needs_profile === 'user' && r.b.active_profile === null);
  let tok = r.b.token; const refresh = r.b.refresh_token;
  ok('account-level token is refused on user area', (await api('/dev/only_user', undefined, tok)).b.error === 'WRONG_PROFILE');
  // 2. create user profile
  r = await api('/add_profile', { type: 'user', display_name: 'Karim Seller' }, tok); tok = r.b.token;
  ok('user profile created and active', r.s === 200 && r.b.active_profile.type === 'user' && r.b.active_profile.status === 'active');
  ok('user token works in user area', (await api('/dev/only_user', undefined, tok)).b.ok === 'user area');
  ok('user token REFUSED in driver area', (await api('/dev/only_driver', undefined, tok)).b.error === 'WRONG_PROFILE');
  ok('duplicate profile refused (409)', (await api('/add_profile', { type: 'user', display_name: 'Again' }, tok)).s === 409);
  // 2b. RULE: picking the other path at login must NOT create a second profile
  r = await login(phone, 'driver');
  ok('returning user picks "driver" at login: lands in the profile they HAVE', r.b.active_profile?.type === 'user' && r.b.needs_profile === null);
  ok('...and gets a notice pointing to Settings', r.b.notice?.code === 'NO_PROFILE_FOR_PATH' && r.b.notice?.missing === 'driver');
  ok('...and NO driver profile was created behind their back', r.b.profiles.length === 1 && (await pool.query(`SELECT 1 FROM profiles WHERE type='driver' AND account_id=(SELECT id FROM accounts WHERE phone=$1)`, [phone])).rowCount === 0);
  ok('new number picking a path gets only that one profile', (await login('+213660000077', 'driver')).b.needs_profile === 'driver');
  // 3. same number becomes a driver too (from Settings, while logged in to the first profile)
  ok('driver profile without documents refused', (await api('/add_profile', { type: 'driver', display_name: 'Karim Driver' }, tok)).b.error === 'DRIVER_DOCS_MISSING');
  r = await api('/add_profile', { type: 'driver', display_name: 'Karim Driver', documents: docs }, tok); tok = r.b.token;
  ok('driver profile created on the SAME number, pending approval', r.s === 200 && r.b.active_profile.type === 'driver' && r.b.active_profile.status === 'pending_approval' && r.b.profiles.length === 2);
  ok('pending driver cannot use driver area', (await api('/dev/only_driver', undefined, tok)).b.error === 'PROFILE_NOT_ACTIVE');
  // 4. switching, no new SMS
  r = await api('/switch_profile', { type: 'user' }, tok); tok = r.b.token;
  ok('switch to user profile without SMS', r.s === 200 && (await api('/dev/only_user', undefined, tok)).b.ok === 'user area');
  ok('user profile unaffected by pending driver profile', (await api('/dev/only_driver', undefined, tok)).b.error === 'WRONG_PROFILE');
  ok('names are independent per profile', (await api('/get_me', undefined, tok)).b.profiles.map((p: any) => p.display_name).sort().join() === 'Karim Driver,Karim Seller');
  // 5. staff approves driver -> effect is immediate
  await pool.query(`UPDATE profiles SET status='active' WHERE type='driver' AND account_id=(SELECT id FROM accounts WHERE phone=$1)`, [phone]);
  r = await api('/switch_profile', { type: 'driver' }, tok); const driverTok = r.b.token;
  ok('after approval, driver area opens', (await api('/dev/only_driver', undefined, driverTok)).b.ok === 'driver area');
  ok('old user token is dead after switching to driver (no cross-use)', (await api('/dev/only_user', undefined, tok)).b.error === 'PROFILE_CHANGED');
  // 6. suspend ONE profile only
  await pool.query(`UPDATE profiles SET status='suspended' WHERE type='user' AND account_id=(SELECT id FROM accounts WHERE phone=$1)`, [phone]);
  ok('driver profile still works while user profile is suspended', (await api('/dev/only_driver', undefined, driverTok)).b.ok === 'driver area');
  r = await api('/switch_profile', { type: 'user' }, driverTok); const userTok2 = r.b.token;
  ok('suspended user profile is refused immediately', (await api('/dev/only_user', undefined, userTok2)).b.error === 'PROFILE_NOT_ACTIVE');
  await pool.query(`UPDATE profiles SET status='active' WHERE type='user' AND account_id=(SELECT id FROM accounts WHERE phone=$1)`, [phone]);
  ok('unsuspended user profile works again, instantly', (await api('/dev/only_user', undefined, userTok2)).b.ok === 'user area');
  r = await api('/switch_profile', { type: 'driver' }, userTok2); const driverTok2 = r.b.token;
  // 7. returning login picks the right profile per chosen path
  r = await login(phone, 'driver'); ok('returning login, path=driver opens the driver profile', r.b.active_profile?.type === 'driver' && r.b.needs_profile === null && r.b.profiles.length === 2);
  r = await login(phone, 'user');   ok('returning login, path=user opens the user profile', r.b.active_profile?.type === 'user');
  // 8. a different number has nothing in common
  r = await login('+213660000001', 'driver'); ok('other number starts clean: needs driver profile', r.b.needs_profile === 'driver' && r.b.profiles.length === 0);
  // 9. code safety
  await api('/send_code', { phone: '+213660000002' });
  r = await api('/verify_code', { phone: '+213660000002', code: '000000', path: 'user' }); ok('wrong code refused', r.b.error === 'CODE_WRONG');
  const good = (await api('/dev/last_code?phone=' + encodeURIComponent('+213660000002'))).b.code;
  r = await api('/verify_code', { phone: '+213660000002', code: good, path: 'user' }); ok('right code accepted', r.s === 200);
  r = await api('/verify_code', { phone: '+213660000002', code: good, path: 'user' }); ok('same code cannot be used twice', r.s === 401);
  r = await api('/send_code', { phone: 'abc' }); ok('bad phone refused', r.b.error === 'BAD_PHONE');
  r = await api('/get_me'); ok('no token refused', r.s === 401);
  // 10. refresh and logout
  r = await api('/refresh_token', { refresh_token: refresh }); ok('refresh gives a new token', r.s === 200 && !!r.b.token);
  ok('old refresh token is dead after use', (await api('/refresh_token', { refresh_token: refresh })).s === 401);
  await api('/logout', {}, driverTok2); ok('logged-out token refused', (await api('/get_me', undefined, driverTok2)).s === 401);
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})();
