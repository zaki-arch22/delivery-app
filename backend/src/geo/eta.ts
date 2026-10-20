import { Injectable } from '@nestjs/common';
import { Routing } from './routing';
import { cfg } from '../common/config';

export interface EtaInput { id: string; status: string; driver_lat: number | null; driver_lng: number | null; last_location_at: any; pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number; duration_s: number }

// Time left until the parcel arrives: courier -> receiver once picked up; courier -> sender + the trip before that.
// Kept 15 s per order, so screens that check every few seconds do not ask the routing server every time.
@Injectable()
export class Eta {
  private cache = new Map<string, { at: number; s: number | null; estimated: boolean }>();
  constructor(private routing: Routing) {
    setInterval(() => { const old = Date.now() - 60_000; for (const [k, v] of this.cache) if (v.at < old) this.cache.delete(k); }, 60_000).unref();
  }

  async forOrder(o: EtaInput): Promise<{ s: number | null; estimated: boolean }> {
    const fresh = o.last_location_at && Date.now() - new Date(o.last_location_at).getTime() < cfg.locationFreshS() * 1000;
    if (!['assigned', 'picked_up'].includes(o.status) || !fresh || o.driver_lat == null || o.driver_lng == null) return { s: null, estimated: true };
    const key = o.id + ':' + o.status;
    const hit = this.cache.get(key); if (hit && Date.now() - hit.at < 15_000) return hit;
    const here = { lat: o.driver_lat, lng: o.driver_lng };
    const r = o.status === 'picked_up'
      ? await this.routing.route(here, { lat: o.dropoff_lat, lng: o.dropoff_lng })
      : await this.routing.route(here, { lat: o.pickup_lat, lng: o.pickup_lng }).then(a => ({ ...a, duration_s: a.duration_s + o.duration_s }));
    const v = { at: Date.now(), s: r.duration_s, estimated: r.estimated }; this.cache.set(key, v); return v;
  }
}
