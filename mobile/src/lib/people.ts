import type { Client } from '../core/api';
import type { Point } from './location';

// The other side of an order (contract: public_profile) and couriers around a point (nearby_couriers).
export interface PublicProfile {
  type: 'user' | 'driver'; name: string; photo_url: string | null; vehicle: 'motorbike' | 'car' | null;
  rating: string | null; rating_count: number; completed: number; member_since: string;
  comments: { stars: number; comment: string; at: string }[];
}
export interface Nearby { couriers: { vehicle: 'motorbike' | 'car'; lat: number; lng: number }[] }


export const people = (c: Client) => ({
  profile: (by: { offer_id?: number | string; order_id?: string }) =>
    c.call<PublicProfile>('/public_profile?' + (by.offer_id != null ? 'offer_id=' + by.offer_id : 'order_id=' + encodeURIComponent(by.order_id ?? ''))),
  nearby: (at: Point) => c.call<Nearby>(`/nearby_couriers?lat=${at.lat.toFixed(5)}&lng=${at.lng.toFixed(5)}`),
});
