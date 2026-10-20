import * as Location from 'expo-location';

// While the driver is online, the phone sends its position: at most every 15 s, and when it moved 25 m or more.
// Foreground only (the app stays open while working). Returns a function that stops it; null = location refused.
export async function startTracking(send: (lat: number, lng: number) => Promise<unknown>): Promise<(() => void) | null> {
  const perm = await Location.requestForegroundPermissionsAsync().catch(() => ({ granted: false }));
  if (!perm.granted) return null;
  const push = (l: Location.LocationObject) => { last = { lat: l.coords.latitude, lng: l.coords.longitude }; listeners.forEach(f => f(last!)); send(l.coords.latitude, l.coords.longitude).catch(() => {}); };
  try { push(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })); } catch { /* the watch below will send it */ }
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 15_000, distanceInterval: 25 }, push);
  return () => sub.remove();
}

// The courier's last known position, for his own map (no extra request: the same reading that is sent to the server).
let last: { lat: number; lng: number } | null = null;
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
