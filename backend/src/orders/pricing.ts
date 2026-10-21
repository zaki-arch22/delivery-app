import { Db } from '../db/db.service';
import { fail } from '../common/errors';

export type Size = 'small' | 'medium' | 'large';
// Parcel size decides the vehicle: the user never picks one.
export const vehicleFor = (size: Size) => (size === 'large' ? 'car' : 'motorbike');
const up10 = (n: number) => Math.ceil(n / 10) * 10;
const down10 = (n: number) => Math.floor(n / 10) * 10;

export async function priceFor(db: Db, size: Size, distance_m: number) {
  const r = await db.one(`SELECT * FROM pricing_rules WHERE active`);
  if (!r) throw fail(503, 'PRICING_NOT_SET', 'Prices are not configured yet');
  const vehicle = vehicleFor(size);
  const km = Math.ceil(distance_m / 1000);
  const raw = r.base_da + r.per_km_da * km + (size === 'medium' ? r.medium_extra_da : size === 'large' ? r.large_extra_da : 0) + (vehicle === 'car' ? r.car_extra_da : 0);
  const recommended_da = up10(raw);
  const min_da = Math.min(recommended_da, up10((recommended_da * r.min_percent) / 100));
  const max_da = Math.max(recommended_da, down10((recommended_da * r.max_percent) / 100));
  return { pricing_version: r.version as number, vehicle, recommended_da, min_da, max_da, max_km: r.max_km as number };
}
