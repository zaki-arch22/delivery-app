// Manual visual check (not part of test-all): makes one order on the TEST server and prints its tracking link.
import { Pool } from 'pg';
import { driverDocs, upload } from './docs';
const B = 'http://localhost:3399';
const api = async (p: string, body?: any, tok?: string, h: any = {}) => { const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...h }, body: body ? JSON.stringify(body) : undefined }); return r.json() as any; };
const login = async (phone: string, path: string) => { await api('/send_code', { phone }); const c = (await api('/dev/last_code?phone=' + encodeURIComponent(phone))).code; return api('/verify_code', { phone, code: c, path }); };
(async () => {
  if (!/_test$/.test(process.env.TEST_DATABASE_URL ?? '')) throw new Error('test database only');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await pool.query(`TRUNCATE otp_codes, sessions, quotes, offers, order_events, ratings, cash_ledger, problem_reports, notifications, device_tokens, orders, driver_details, document_files, documents, profiles, accounts, zones, pricing_rules, security_events RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO zones(name, area, is_open) VALUES ('test', ST_Multi(ST_GeomFromText('POLYGON((2.9 36.6, 3.3 36.6, 3.3 36.9, 2.9 36.9, 2.9 36.6))', 4326))::geography, true)`);
  await pool.query(`INSERT INTO pricing_rules(base_da, per_km_da, min_percent, max_percent, active) VALUES (200, 50, 80, 200, true)`);
  const u = await login('+213550123001', 'user'); const ut = (await api('/add_profile', { accept_rules: true, type: 'user', display_name: 'Amina Boutique' }, u.token)).token;
  const d = await login('+213550123002', 'driver'); const dr = await api('/add_profile', { accept_rules: true, national_id: String(1e11 + Math.floor(Math.random() * 9e11)), type: 'driver', display_name: 'Yacine Driver', documents: await driverDocs(B, d.token) }, d.token);
  await pool.query(`UPDATE profiles SET status='active' WHERE id=$1`, [dr.active_profile.id]); await pool.query(`UPDATE driver_details SET cash_limit_da=50000 WHERE profile_id=$1`, [dr.active_profile.id]);
  await api('/set_online', { online: true }, dr.token); await api('/update_location', { lat: 36.7600, lng: 3.0500 }, dr.token);
  const q = await api('/get_quote', { pickup: { lat: 36.7538, lng: 3.0588 }, dropoff: { lat: 36.7750, lng: 3.0600 }, size: 'small' }, ut);
  const o = await api('/create_order', { quote_id: q.quote_id, offered_da: q.recommended_da, pickup_address: { street: 'Rue Didouche Mourad' }, dropoff_address: { street: 'Bab El Oued', landmark: 'near the market' }, recipient_name: 'Karim', recipient_phone: '+213770123456', payer: 'recipient', cod_amount_da: 4500, inspection: 'open', auto_accept: true }, ut, { 'idempotency-key': 'visual-key-01' });
  await api('/track_confirm', { t: o.tracking_token });
  for (let i = 0; i < 20; i++) { const f = (await api('/get_current_offer', undefined, dr.token)).offer; if (f) { await api('/accept_offer', { offer_id: f.offer_id }, dr.token); break; } await new Promise(r => setTimeout(r, 500)); }
  const v = await api('/get_order?id=' + o.id, undefined, ut);
  const ph = (await upload(B, dr.token, 'parcel_photo')).b.document_id;
  await api('/update_job_step', { order_id: o.id, step: 'picked_up', pickup_code: v.pickup_code, parcel_photo: ph, location: { lat: 36.7538, lng: 3.0588 } }, dr.token);
  await api('/update_location', { lat: 36.7650, lng: 3.0590 }, dr.token);
  console.log(B + '/t/' + v.tracking_token); await pool.end();
})();
