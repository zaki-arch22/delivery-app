import { Db } from '../db/db.service';
export async function inOpenZone(db: Db, p: { lat: number; lng: number }) {
  const r = await db.one(`SELECT 1 FROM zones WHERE is_open AND ST_Covers(area, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) LIMIT 1`, [p.lng, p.lat]);
  return !!r;
}
