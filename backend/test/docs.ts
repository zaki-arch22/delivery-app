// Test helper: driver document photos are uploaded first, then add_profile receives their ids.
import { readFileSync } from 'fs';
import { join } from 'path';
export const PHOTO = readFileSync(join(__dirname, 'fixtures', 'photo.jpg'));   // a made-up 480 x 360 test picture
export async function upload(base: string, token: string, kind: string, body: Buffer | string = PHOTO, type = 'image/jpeg') {
  const r = await fetch(`${base}/upload_document?kind=${encodeURIComponent(kind)}`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': type }, body: body as any });
  return { s: r.status, b: (await r.json().catch(() => ({}))) as any };
}
export async function driverDocs(base: string, token: string, vehicle = 'motorbike') {
  const out: Record<string, string> = { vehicle };
  for (const k of ['id_photo', 'licence_photo', 'vehicle_photo']) {
    const r = await upload(base, token, k);
    if (r.s !== 200) throw new Error('upload failed: ' + JSON.stringify(r));
    out[k] = r.b.document_id;
  }
  return out;
}
