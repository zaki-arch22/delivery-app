import { Injectable, Logger } from '@nestjs/common';
import { cfg } from '../common/config';

export interface RouteResult { distance_m: number; duration_s: number; estimated: boolean; line?: [number, number][] | null }
type P = { lat: number; lng: number };

// The ONLY place that knows how distance is measured.
// With ROUTING_URL set, it asks our own OSRM server (free, open source, OpenStreetMap roads) for the real road distance.
// If OSRM is not configured, too slow, or finds no road, it falls back to a straight-line estimate marked `estimated`,
// so a quote never fails or hangs because of routing.
@Injectable()
export class Routing {
  private log = new Logger('Routing');

  // `withLine` also asks for the road's shape ([lng, lat] points) to draw on the map; without OSRM it is null (straight line).
  async route(a: P, b: P, withLine = false): Promise<RouteResult> {
    const base = cfg.routingUrl();
    if (base) {
      const road = await this.osrm(base, a, b, withLine);
      if (road) return road;
    }
    return this.estimate(a, b);
  }

  private async osrm(base: string, a: P, b: P, withLine: boolean): Promise<RouteResult | null> {
    // Coordinates are validated numbers (never user text), and OSRM wants lng,lat.
    const shape = withLine ? 'overview=simplified&geometries=geojson' : 'overview=false';
    const url = `${base.replace(/\/+$/, '')}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?${shape}&alternatives=false&steps=false`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(cfg.routingTimeoutMs()), redirect: 'error' });
      if (!r.ok) { this.log.warn(`OSRM answered ${r.status}; using the estimate`); return null; }
      const text = await r.text();
      if (text.length > 400_000) { this.log.warn('OSRM answer too large; using the estimate'); return null; }
      const j = JSON.parse(text);
      const route = j?.code === 'Ok' ? j.routes?.[0] : null;
      const d = Number(route?.distance), t = Number(route?.duration);
      if (!Number.isFinite(d) || !Number.isFinite(t) || d < 0 || t < 0) { this.log.warn(`OSRM found no route (${j?.code}); using the estimate`); return null; }
      return { distance_m: Math.max(1, Math.round(d)), duration_s: Math.max(1, Math.round(t)), estimated: false, line: withLine ? cleanLine(route?.geometry?.coordinates) : undefined };
    } catch (e: any) {
      this.log.warn(`OSRM unreachable (${e?.name ?? 'error'}); using the estimate`);
      return null;
    }
  }

  private estimate(a: P, b: P): RouteResult {
    const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    const straight = 2 * R * Math.asin(Math.sqrt(h));
    const distance_m = Math.max(1, Math.round(straight * cfg.routeFactor()));
    return { distance_m, duration_s: Math.round((distance_m / 1000 / cfg.fallbackKmh()) * 3600), estimated: true, line: null };
  }
}

// Only well-formed points, at most 1000 of them, rounded to about 1 m (smaller to store and send).
function cleanLine(c: any): [number, number][] | null {
  if (!Array.isArray(c) || c.length < 2) return null;
  const out: [number, number][] = [];
  for (const p of c.slice(0, 1000)) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return null;
    out.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  }
  return out;
}
