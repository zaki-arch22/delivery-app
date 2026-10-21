import type { Client } from '../core/api';
import type { Point } from './location';

// The other side of an order (contract: public_profile) and couriers around a point (nearby_couriers).
export interface PublicProfile {
  type: 'user' | 'driver'; name: string; photo_url: string | null; vehicle: 'motorbike' | 'car' | null;
  rating: string | null; rating_count: number; completed: number; member_since: string;
  comments: { stars: number; comment: string; at: string }[];
}
export interface Nearby { couriers: { vehicle: 'motorbike' | 'car'; lat: number; lng: number }[]; radius_m: number; wide_radius_m: number }

export const people = (c: Client) => ({
  profile: (by: { offer_id?: number | string; order_id?: string }) =>
    c.call<PublicProfile>('/public_profile?' + (by.offer_id != null ? 'offer_id=' + by.offer_id : 'order_id=' + encodeURIComponent(by.order_id ?? ''))),
  nearby: (at: Point) => c.call<Nearby>(`/nearby_couriers?lat=${at.lat.toFixed(5)}&lng=${at.lng.toFixed(5)}`),
});

// A circle on the map (for the search area), as a polygon the map can draw.
export function circle(center: Point, radiusM: number, steps = 64): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320, dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * 2 * Math.PI; out.push([center.lng + dLng * Math.cos(a), center.lat + dLat * Math.sin(a)]); }
  return out;
}
