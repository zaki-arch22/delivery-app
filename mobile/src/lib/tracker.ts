import * as Location from 'expo-location';

// While the driver is online, the phone sends its position: at most every 15 s, and when it moved 25 m or more.
// Foreground only (the app stays open while working). Returns a function that stops it; null = location refused.
export async function startTracking(send: (lat: number, lng: number) => Promise<unknown>): Promise<(() => void) | null> {
  const perm = await Location.requestForegroundPermissionsAsync().catch(() => ({ granted: false }));
  if (!perm.granted) return null;
  const push = (l: Location.LocationObject) => { send(l.coords.latitude, l.coords.longitude).catch(() => {}); };
  try { push(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })); } catch { /* the watch below will send it */ }
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 15_000, distanceInterval: 25 }, push);
  return () => sub.remove();
}

// One tracker for the whole app: it keeps running while the driver moves between screens.
let stopFn: (() => void) | null = null, starting: Promise<boolean> | null = null;
export const tracking = {
  get on() { return stopFn !== null; },
  ensure(send: (lat: number, lng: number) => Promise<unknown>): Promise<boolean> {
    if (stopFn) return Promise.resolve(true);
    if (!starting) starting = startTracking(send).then(f => { stopFn = f; return f !== null; }).finally(() => { starting = null; });
    return starting;
  },
  stop() { stopFn?.(); stopFn = null; },
};
