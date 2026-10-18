import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';

export interface RouteResult { distance_m: number; duration_s: number; estimated: boolean }
type P = { lat: number; lng: number };

// The ONLY place that knows how distance is measured. Google Maps (or any provider) replaces `route` later;
// nothing else in the system changes. Until a maps key is configured, this fallback estimates from straight lines.
@Injectable()
export class Routing {
  async route(a: P, b: P): Promise<RouteResult> {
    const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    const straight = 2 * R * Math.asin(Math.sqrt(h));
    const distance_m = Math.max(1, Math.round(straight * cfg.routeFactor()));
    return { distance_m, duration_s: Math.round((distance_m / 1000 / cfg.fallbackKmh()) * 3600), estimated: true };
  }
}
