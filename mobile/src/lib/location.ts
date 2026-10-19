import * as Location from 'expo-location';
export type Point = { lat: number; lng: number };

// The phone's current position, asked only when the person taps "My location". null = permission refused or not available.
export async function currentPosition(): Promise<Point | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch { return null; }
}
