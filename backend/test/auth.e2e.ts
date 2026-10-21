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
import { DRIVER_INFO, driverDocs, upload, PHOTO } from './docs';
import { googleToken } from './google';
if (!process.env.TEST_DATABASE_URL || /\/delivery$/.test(process.env.TEST_DATABASE_URL)) throw new Error('Tests need TEST_DATABASE_URL pointing to a separate test database, never the real one');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });

(async () => {
  const phone = '+213551112233';
  // 1. new number, user path
  let r = await login(phone, 'user');
  ok('new number: login works, no profile yet', r.s === 200 && r.b.needs_profile === 'user' && r.b.active_profile === null);
  let tok = r.b.token; const refresh = r.b.refresh_token;
  ok('account-level token is refused on user area', (await api('/dev/only_user', undefined, tok)).b.error === 'WRONG_PROFILE');
  // 2. create user profile
  r = await api('/add_profile', { accept_rules: true, type: 'user', display_name: 'Karim Seller' }, tok); tok = r.b.token;
  ok('user profile created and active', r.s === 200 && r.b.active_profile.type === 'user' && r.b.active_profile.status === 'active');
  ok('user token works in user area', (await api('/dev/only_user', undefined, tok)).b.ok === 'user area');
  ok('user token REFUSED in driver area', (await api('/dev/only_driver', undefined, tok)).b.error === 'WRONG_PROFILE');
  ok('duplicate profile refused (409)', (await api('/add_profile', { accept_rules: true, type: 'user', display_name: 'Again' }, tok)).s === 409);
  // 2b. RULE: picking the other path at login must NOT create a second profile
  r = await login(phone, 'driver');
  ok('returning user picks "driver" at login: lands in the profile they HAVE', r.b.active_profile?.type === 'user' && r.b.needs_profile === null);
  ok('...and gets a notice pointing to Settings', r.b.notice?.code === 'NO_PROFILE_FOR_PATH' && r.b.notice?.missing === 'driver');
  ok('...and NO driver profile was created behind their back', r.b.profiles.length === 1 && (await pool.query(`SELECT 1 FROM profiles WHERE type='driver' AND account_id=(SELECT id FROM accounts WHERE phone=$1)`, [phone])).rowCount === 0);
  ok('new number picking a path gets only that one profile', (await login('+213660000077', 'driver')).b.needs_profile === 'driver');
  // 3. same number becomes a driver too (from Settings, while logged in to the first profile)
  ok('driver profile without documents refused', (await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Karim Driver' }, tok)).b.error === 'DRIVER_DOCS_MISSING');
  r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Karim Driver', documents: await driverDocs(B, tok) }, tok); tok = r.b.token;
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
  // 11. driver document photos
  {
    const sharp = (await import('sharp')).default;
    const stored$ = async (id: string): Promise<Buffer> => (await pool.query(`SELECT data FROM document_files WHERE document_id=$1`, [id])).rows[0]?.data;
    const P1 = '+213660000301', P2 = '+213660000302';
    const t1 = (await login(P1, 'driver')).b.token, t2 = (await login(P2, 'driver')).b.token;
    let u = await upload(B, t1, 'id_photo');
    ok('U1 a logged-in person (no profile yet) can upload a photo', u.s === 200 && /^[0-9a-f-]{36}$/.test(u.b.document_id) && u.b.kind === 'id_photo', JSON.stringify(u));
    const rec = (await pool.query(`SELECT d.size_bytes, d.sha256, encode(sha256(f.data), 'hex') AS real FROM documents d JOIN document_files f ON f.document_id=d.id WHERE d.id=$1`, [u.b.document_id])).rows[0];
    ok('U1 the photo is kept in the private database, exactly as recorded (size and fingerprint)', !!rec && rec.sha256 === rec.real && rec.size_bytes > 0, JSON.stringify(rec));
    const withGps = await sharp(PHOTO).withExif({ IFD0: { Copyright: 'SECRET-OWNER-DATA', Make: 'SecretCam' } }).jpeg().toBuffer();
    ok('U2 (test setup) the test photo really carries hidden camera data', withGps.includes(Buffer.from('SECRET-OWNER-DATA')));
    u = await upload(B, t1, 'licence_photo', withGps);
    const stored = await stored$(u.b.document_id);
    ok('U2 hidden data inside a photo (camera, location) is removed', u.s === 200 && !stored.includes(Buffer.from('SECRET-OWNER-DATA')) && !stored.includes(Buffer.from('SecretCam')));
    const huge = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#88aadd' } }).png().toBuffer();
    u = await upload(B, t1, 'vehicle_photo', huge, 'image/png');
    const m = await sharp(await stored$(u.b.document_id)).metadata();
    ok('U3 a big PNG is accepted, shrunk to at most 2000 px and stored as JPEG', u.s === 200 && m.format === 'jpeg' && Math.max(m.width!, m.height!) === 2000, JSON.stringify(m.format));
    await upload(B, t1, 'ownership_photo');
    const mine = { vehicle: 'motorbike', ...DRIVER_INFO, id_photo: '', licence_photo: '', ownership_photo: '', vehicle_photo: '' } as any;
    const all = await pool.query(`SELECT id, kind FROM documents WHERE account_id=(SELECT id FROM accounts WHERE phone=$1)`, [P1]);
    for (const row of all.rows) mine[row.kind] = row.id;
    const other = await driverDocs(B, t2);
    r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Thief Driver', documents: { ...mine, id_photo: other.id_photo } }, t1);
    ok('U4 someone else\'s photo cannot be used', r.b.error === 'BAD_DOCUMENT', JSON.stringify(r.b));
    r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Mixed Driver', documents: { ...mine, id_photo: mine.licence_photo, licence_photo: mine.id_photo } }, t1);
    ok('U4 a photo in the wrong place (licence as ID) is refused', r.b.error === 'BAD_DOCUMENT');
    ok('U4 a refused sign-up leaves no profile behind', (await pool.query(`SELECT 1 FROM profiles WHERE account_id=(SELECT id FROM accounts WHERE phone=$1)`, [P1])).rowCount === 0);
    // What the courier types at sign-up is checked (the owner's list: names, date of birth, vehicle colour and plate).
    const nid = () => String(1e11 + Math.floor(Math.random() * 9e11));
    const tryWith = async (extra: any) => (await api('/add_profile', { accept_rules: true, national_id: nid(), type: 'driver', display_name: 'Real Driver', documents: { ...mine, ...extra } }, t1)).b.error;
    ok('U6 first and last name are required', await tryWith({ first_name: ' ' }) === 'BAD_DRIVER_NAME' && await tryWith({ last_name: undefined }) === 'BAD_DRIVER_NAME' && await tryWith({ first_name: 'A\u202Eb' }) === 'BAD_DRIVER_NAME');
    const young = new Date(Date.now() - 17 * 365.25 * 24 * 3600_000).toISOString().slice(0, 10);
    ok('U6 a date of birth is required, a real date, at least 18 years ago', await tryWith({ birth_date: undefined }) === 'BAD_BIRTH_DATE' && await tryWith({ birth_date: '1990-02-31' }) === 'BAD_BIRTH_DATE' && await tryWith({ birth_date: young }) === 'BAD_BIRTH_DATE' && await tryWith({ birth_date: '12/04/1995' }) === 'BAD_BIRTH_DATE');
    ok('U6 the vehicle colour and plate are required', await tryWith({ vehicle_color: '' }) === 'BAD_VEHICLE_COLOR' && await tryWith({ plate_number: '12' }) === 'BAD_PLATE' && await tryWith({ plate_number: undefined }) === 'BAD_PLATE');
    ok('U6 the proof of ownership is required', await tryWith({ ownership_photo: undefined }) === 'DRIVER_DOCS_MISSING');
    ok('U6 extra vehicle photos must be photos of this sign-up (and never the same photo twice)', await tryWith({ vehicle_photos: [mine.id_photo] }) === 'BAD_DOCUMENT' && await tryWith({ vehicle_photos: [mine.vehicle_photo] }) === 'BAD_DOCUMENT' && await tryWith({ vehicle_photos: ['x'] }) === 'BAD_DOCUMENT');
    const tiny = await sharp({ create: { width: 120, height: 90, channels: 3, background: '#556677' } }).jpeg().toBuffer();
    const extra = (await upload(B, t1, 'vehicle_photo', tiny)).b;
    ok('U7 a small or blurry photo is NOT refused automatically: a person reviews every document', /^[0-9a-f-]{36}$/.test(extra.document_id ?? ''), extra);
    r = await api('/add_profile', { accept_rules: true, national_id: nid(), type: 'driver', display_name: 'Real Driver', documents: { ...mine, plate_number: '12345-113-16', vehicle_photos: [extra.document_id] } }, t1);
    ok('U5 driver sign-up with identity, vehicle and all photos works (pending a person\'s approval)', r.s === 200 && r.b.active_profile.status === 'pending_approval', r.b);
    const linked = await pool.query(`SELECT count(*)::int n FROM documents WHERE profile_id=$1`, [r.b.active_profile.id]);
    ok('U5 the five photos are now tied to that driver profile', linked.rows[0].n === 5);
    const dd = (await pool.query(`SELECT first_name, last_name, to_char(birth_date,'YYYY-MM-DD') b, vehicle_color, plate_number FROM driver_details WHERE profile_id=$1`, [r.b.active_profile.id])).rows[0];
    ok('U5 identity and vehicle are stored as typed (plate written the same way every time)', dd.first_name === 'Karim' && dd.last_name === 'Test' && dd.b === '1995-04-12' && dd.vehicle_color === 'Blue' && dd.plate_number === '12345 113 16', dd);
    const t3 = (await login('+213660000303', 'driver')).b.token;
    r = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Copy Driver', documents: mine }, t3);
    ok('U6 photos already used by a driver cannot be reused', r.b.error === 'BAD_DOCUMENT');
    let refused = 0; try { await pool.query(`DELETE FROM documents WHERE id=$1`, [mine.id_photo]); } catch { refused++; }
    try { await pool.query(`UPDATE documents SET profile_id=NULL WHERE id=$1`, [mine.id_photo]); } catch { refused++; }
    ok('U6 the database itself refuses to delete or detach a used photo', refused === 2);
    ok('U7 unknown kind refused', (await upload(B, t3, 'selfie')).b.error === 'BAD_KIND');
    ok('U7 the app cannot read photos back (staff only)', (await api('/get_document?id=' + mine.id_photo, undefined, t1)).b.error === 'STAFF_ONLY');
  }
  {
    // G. Login with Google (no SMS). The phone number is typed, not verified.
    let r = await api('/login_methods');
    ok('G1 the app can ask which login methods are on', r.s === 200 && r.b.google === true && r.b.sms === true, JSON.stringify(r.b));
    r = await api('/login_google', { id_token: googleToken('g-100001'), path: 'user' });
    ok('G2 new Google account: logged in, asked for a phone number and a profile', r.s === 200 && r.b.needs_phone === true && r.b.needs_profile === 'user' && r.b.active_profile === null && !!r.b.refresh_token, JSON.stringify(r.b));
    ok('G2 the Google name is offered to prefill the profile name', r.b.google_name === 'Test Person');
    let t = r.b.token;
    ok('G3 no profile before a phone number (drivers and senders must be able to call)', (await api('/add_profile', { accept_rules: true, type: 'user', display_name: 'Nadia' }, t)).b.error === 'PHONE_REQUIRED');
    ok('G4 a badly written phone number is refused', (await api('/set_phone', { phone: '0551 12 34 56' }, t)).b.error === 'BAD_PHONE');
    r = await api('/set_phone', { phone: '+213551000111' }, t);
    ok('G4 phone number saved as NOT verified', r.s === 200 && r.b.phone === '+213551000111' && r.b.phone_verified === false);
    r = await api('/add_profile', { accept_rules: true, type: 'user', display_name: 'Nadia' }, t);
    ok('G5 then the profile is created', r.s === 200 && r.b.active_profile.type === 'user');
    r = await api('/login_google', { id_token: googleToken('g-100001'), path: 'user' });
    ok('G6 the same Google account logs in again: same account, straight into the profile', r.s === 200 && r.b.needs_phone === false && r.b.active_profile?.display_name === 'Nadia' && r.b.needs_profile === null);
    r = await api('/get_me', undefined, r.b.token);
    ok('G7 get_me shows a Google account with an unverified phone', r.b.account.google === true && r.b.account.phone_verified === false && r.b.account.phone === '+213551000111');
    const t2 = (await api('/login_google', { id_token: googleToken('g-100002'), path: 'driver' })).b.token;
    ok('G8 another Google account may type the same number (unverified numbers prove nothing, so they are not unique)', (await api('/set_phone', { phone: '+213551000111' }, t2)).s === 200);
    ok('G8 ...and stays a separate account', (await pool.query(`SELECT count(*)::int n FROM accounts WHERE phone='+213551000111'`)).rows[0].n === 2);
    const sms = (await login('+213551000999', 'user')).b.token;
    ok('G9 a VERIFIED (SMS) phone number can never be overwritten by set_phone', (await api('/set_phone', { phone: '+213551000111' }, sms)).b.error === 'PHONE_LOCKED');
    ok('G10 an SMS login still works next to Google (separate accounts)', (await pool.query(`SELECT phone_verified, google_sub FROM accounts WHERE phone='+213551000999'`)).rows[0].phone_verified === true);
    let refused = false; try { await pool.query(`INSERT INTO accounts(phone, phone_verified) VALUES ('+213551000777', false)`); } catch { refused = true; }
    ok('G11 the database refuses an account that is neither Google nor a verified number', refused);
  }
  {
    // ===== DEL "delete my account" (Google Play / Apple rule) =====
    const g = (await api('/login_google', { id_token: googleToken('g-del-1'), path: 'driver' })).b;
    await api('/set_phone', { phone: '+213551000444' }, g.token);
    const nid = String(1e11 + Math.floor(Math.random() * 9e11));
    const d = (await api('/add_profile', { accept_rules: true, national_id: nid, type: 'driver', display_name: 'Del Driver', documents: await driverDocs(B, g.token) }, g.token)).b;
    const tok = d.token as string, pid = d.active_profile.id as string, refresh = d.refresh_token as string;
    ok('DEL1 nothing is deleted without the explicit confirmation word', (await api('/delete_account', {}, tok)).b.error === 'CONFIRM_REQUIRED' && (await api('/delete_account', { confirm: 'delete' }, tok)).b.error === 'CONFIRM_REQUIRED');
    const [st] = (await pool.query(`INSERT INTO staff_users(email, name, password_hash) VALUES ('del-test@example.test', 'T', 'x') ON CONFLICT (email) DO UPDATE SET name='T' RETURNING id`)).rows;
    await pool.query(`INSERT INTO cash_ledger(driver_profile_id, type, amount_da, note, staff_id) VALUES ($1, 'adjustment', 500, 'test: cash held', $2)`, [pid, st.id]);
    ok('DEL2 a driver who still holds senders\' cash cannot delete the account', (await api('/delete_account', { confirm: 'DELETE' }, tok)).b.error === 'CASH_HELD');
    await pool.query(`INSERT INTO cash_ledger(driver_profile_id, type, amount_da, note, staff_id) VALUES ($1, 'adjustment', -500, 'test: handed over', $2)`, [pid, st.id]);
    const del = await api('/delete_account', { confirm: 'DELETE' }, tok);
    ok('DEL3 with nothing owed, the account is deleted', del.s === 200 && del.b.ok === true, JSON.stringify(del.b));
    ok('DEL4 the login token stops working at once', (await api('/get_me', undefined, tok)).b.error === 'SESSION_ENDED');
    ok('DEL5 the refresh key is dead too', (await api('/refresh_token', { refresh_token: refresh })).s === 401);
    const acc = (await pool.query(`SELECT a.google_sub, a.phone, a.deleted_at, p.display_name, p.status, dd.first_name, dd.plate_number, dd.national_id_hash, dd.is_online
                                   FROM accounts a JOIN profiles p ON p.account_id=a.id JOIN driver_details dd ON dd.profile_id=p.id WHERE p.id=$1`, [pid])).rows[0];
    ok('DEL6 the Google link, phone, names, plate and ID number are erased; the profile is "deleted"', acc.google_sub === null && acc.phone === null && acc.deleted_at !== null && acc.display_name === 'Deleted' && acc.status === 'deleted'
      && acc.first_name === null && acc.plate_number === null && acc.national_id_hash === null && acc.is_online === false, JSON.stringify(acc));
    ok('DEL7 the document photos are erased', (await pool.query(`SELECT count(*)::int n FROM document_files f JOIN documents d ON d.id=f.document_id WHERE d.profile_id=$1`, [pid])).rows[0].n === 0);
    ok('DEL8 the cash ledger history stays (it protects the senders)', (await pool.query(`SELECT count(*)::int n FROM cash_ledger WHERE driver_profile_id=$1`, [pid])).rows[0].n === 2);
    const again = (await api('/login_google', { id_token: googleToken('g-del-1'), path: 'user' })).b;
    ok('DEL9 signing in again with the same Google account starts a NEW empty account', again.account?.id !== undefined ? again.account.id !== d.account?.id : (await pool.query(`SELECT count(*)::int n FROM accounts WHERE google_sub='g-del-1'`)).rows[0].n === 1);
    ok('DEL9 ...with no profile from before', again.needs_phone === true || (again.profiles ?? []).length === 0, JSON.stringify(again));
    ok('DEL10 the same ID card number can register again later (it was erased)', (await pool.query(`SELECT count(*)::int n FROM driver_details WHERE national_id_hash IS NOT NULL AND profile_id=$1`, [pid])).rows[0].n === 0);
  }
  console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
})();
