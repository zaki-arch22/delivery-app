// Test helper: driver document photos are uploaded first, then add_profile receives their ids.
import { readFileSync } from 'fs';
import { join } from 'path';
export const PHOTO = readFileSync(join(__dirname, 'fixtures', 'photo.jpg'));   // a made-up 480 x 360 test picture
export async function upload(base: string, token: string, kind: string, body: Buffer | string = PHOTO, type = 'image/jpeg') {
  const r = await fetch(`${base}/upload_document?kind=${encodeURIComponent(kind)}`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': type }, body: body as any });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
// Everything a courier gives at sign-up: identity, vehicle, and the four required photos.
export const DRIVER_INFO = { first_name: 'Karim', last_name: 'Test', birth_date: '1995-04-12', vehicle_color: 'Blue', plate_number: '12345 113 16' };
// A made-up Algérie Poste account (RIP). Couriers need one to sign up, sellers to sell with cash on delivery.
export const PAYOUT = { rip: '00799999 0012345678 90', holder_name: 'Test Holder' };
export async function setPayout(base: string, token: string) {
  const r = await fetch(`${base}/set_payout_account`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(PAYOUT) });
  if (r.status !== 200) throw new Error('set_payout_account failed: ' + r.status + ' ' + (await r.text()));
}
export async function driverDocs(base: string, token: string, vehicle = 'motorbike') {
  await setPayout(base, token);
  const out: Record<string, string> = { vehicle, ...DRIVER_INFO };
  for (const k of ['id_photo', 'licence_photo', 'ownership_photo', 'vehicle_photo']) {
    const r = await upload(base, token, k);
    if (r.s !== 200) throw new Error('upload failed: ' + JSON.stringify(r));
    out[k] = r.b.document_id;
  }
  return out;
}
