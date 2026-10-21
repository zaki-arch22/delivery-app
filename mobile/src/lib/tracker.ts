import * as Location from 'expo-location';

const HEARTBEAT_MS = 30_000;   // the server forgets a courier whose position is older than 2 minutes: resend while standing still
const FIRST_FIX_MS = 10_000;   // never wait longer than this for the first reading (indoors a precise fix can take minutes)

// While the driver is online, the phone sends its position: every 15 s from the phone's location service, and the last
// reading again every 30 s even if he does not move (a courier waiting for requests usually stands still; before, nothing
// was sent until he moved 25 m, so after 2 minutes he silently stopped receiving requests).
// Foreground only (the app stays open while working). Returns a function that stops it; null = location refused.
export async function startTracking(send: (lat: number, lng: number) => Promise<unknown>): Promise<(() => void) | null> {
  const perm = await Location.requestForegroundPermissionsAsync().catch(() => ({ granted: false }));
  if (!perm.granted) return null;
  const push = (l: { coords: { latitude: number; longitude: number } }) => {
    last = { lat: l.coords.latitude, lng: l.coords.longitude }; lastAt = Date.now();
    listeners.forEach(f => f(last!)); send(last.lat, last.lng).catch(() => {});
  };
  // First reading at once: the phone's last known position (instant), then a fresh one, but never wait more than 10 s.
  try { const k = await Location.getLastKnownPositionAsync(); if (k) push(k); } catch { /* none yet */ }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fresh = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise<null>(r => { timer = setTimeout(() => r(null), FIRST_FIX_MS); })]);
    clearTimeout(timer);
    if (fresh) push(fresh);
  } catch { /* the watch below will send it */ }
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 15_000, distanceInterval: 0 }, push);
  const beat = setInterval(() => { if (last && Date.now() - lastAt < 5 * 60_000) send(last.lat, last.lng).catch(() => {}); }, HEARTBEAT_MS);   // never a reading older than 5 min
  (beat as any).unref?.();   // test runs only: a forgotten timer must not keep the test process alive (phones have no unref)
  return () => { sub.remove(); clearInterval(beat); };
}

// The courier's last known position, for his own map (no extra request: the same reading that is sent to the server).
let last: { lat: number; lng: number } | null = null, lastAt = 0;
export const lastPositionAge = () => (lastAt ? Date.now() - lastAt : Infinity);
const listeners = new Set<(p: { lat: number; lng: number }) => void>();
export const lastPosition = () => last;
export function onPosition(f: (p: { lat: number; lng: number }) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

// One tracker for the whole app: it keeps running while the driver moves between screens.
let stopFn: (() => void) | null = null, starting: Promise<boolean> | null = null, generation = 0;
export const tracking = {
  get on() { return stopFn !== null; },
  ensure(send: (lat: number, lng: number) => Promise<unknown>): Promise<boolean> {
    if (stopFn) return Promise.resolve(true);
    if (!starting) {
      const gen = generation;
      starting = startTracking(send).then(f => {
        if (gen !== generation) { f?.(); return false; }   // stopped while it was starting: do not leave it running
        stopFn = f; return f !== null;
      }).finally(() => { starting = null; });
    }
    return starting;
  },
  stop() { generation++; stopFn?.(); stopFn = null; },
};
