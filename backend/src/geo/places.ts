import { Injectable, Logger } from '@nestjs/common';
import { cfg } from '../common/config';
import { bad, fail } from '../common/errors';
import { limiter, limitsOff } from '../security/limiter';

export interface Place { name: string; detail: string; lat: number; lng: number }

// Place search ("Ardis", "Place des Martyrs"...). The ONLY class that knows which search service is used.
// GEOCODER_URL points to a Photon-compatible service (Photon = free, open-source search over OpenStreetMap data):
// komoot's public Photon for testing (fair use only), our own Photon server later. Empty = search switched off,
// and the app hides the search box (people move the map under the pin, which always works).
// Phones never call the search service directly: one place to cache, limit and switch providers.
const ALGIERS_BOX = '2.75,36.55,3.40,36.85';   // west,south,east,north: results stay in the Algiers area

@Injectable()
export class Places {
  private log = new Logger('Places');
  private cache = new Map<string, { at: number; places: Place[] }>();

  enabled() { return !!cfg.geocoderUrl(); }

  async search(profileId: string, qRaw: any, lang: any, near: { lat: number; lng: number } | null): Promise<{ places: Place[]; unavailable?: boolean }> {
    if (!this.enabled()) throw fail(503, 'SEARCH_OFF', 'Place search is not switched on');
    const q = typeof qRaw === 'string' ? qRaw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (q.length < 2 || q.length > 80) throw bad('BAD_QUERY', 'Type 2 to 80 characters');
    if (!limitsOff() && !limiter.hit('places:' + profileId, 30, 60_000).ok) throw fail(429, 'RATE_LIMITED', 'Too many searches. Wait a moment.');
    const l = lang === 'fr' || lang === 'en' ? lang : 'default';   // Photon has no Arabic option: "default" keeps local names
    const key = `${l}|${q.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return { places: hit.places };
    const u = new URL(cfg.geocoderUrl().replace(/\/+$/, '') + '/api/');
    u.searchParams.set('q', q); u.searchParams.set('limit', '8'); u.searchParams.set('bbox', ALGIERS_BOX);
    if (l !== 'default') u.searchParams.set('lang', l);
    if (near) { u.searchParams.set('lat', String(near.lat)); u.searchParams.set('lon', String(near.lng)); }
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(cfg.geocoderTimeoutMs()), redirect: 'error', headers: { 'user-agent': 'delivery-app (test server)' } });
      if (!r.ok) { this.log.warn(`search service answered ${r.status}`); return { places: [], unavailable: true }; }
      const text = await r.text();
      if (text.length > 300_000) return { places: [], unavailable: true };
      const places = parse(JSON.parse(text));
      if (this.cache.size > 2000) this.cache.clear();
      this.cache.set(key, { at: Date.now(), places });
      return { places };
    } catch (e: any) {
      this.log.warn(`search service unreachable (${e?.name ?? 'error'})`);
      return { places: [], unavailable: true };
    }
  }
}

const str = (v: any) => (typeof v === 'string' ? v.slice(0, 120) : '');
// Photon answers GeoJSON. Only clean fields are kept (no raw text from the service reaches the app unchecked).
export function parse(j: any): Place[] {
  const out: Place[] = [];
  for (const f of Array.isArray(j?.features) ? j.features.slice(0, 8) : []) {
    const c = f?.geometry?.coordinates, p = f?.properties ?? {};
    const lng = Number(c?.[0]), lat = Number(c?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const street = [str(p.street), str(p.housenumber)].filter(Boolean).join(' ');
    const name = str(p.name) || street;
    if (!name) continue;
    const detail = [street !== name ? street : '', str(p.district) || str(p.locality), str(p.city)].filter(Boolean).join(', ');
    out.push({ name, detail, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }
  return out;
}
