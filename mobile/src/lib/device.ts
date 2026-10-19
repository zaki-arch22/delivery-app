import { Platform } from 'react-native';
import * as Application from 'expo-application';

// This phone's id for this app (Android: stays the same after reinstalling; changes only after a factory reset).
// Sent with every request; the server keeps only a one-way fingerprint. null where not available.
let cached: string | null | undefined;
export function deviceId(): string | null {
  if (cached !== undefined) return cached;
  try { cached = Platform.OS === 'android' ? Application.getAndroidId() || null : null; } catch { cached = null; }
  return cached;
}
