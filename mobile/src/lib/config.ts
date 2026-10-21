// Where the server is. Set EXPO_PUBLIC_API_URL when building the app (for example https://api.yourdomain.dz).
// Release builds refuse anything but HTTPS (contract section J).
export function apiUrl(): string {
  const url = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  if (!url) throw new Error('EXPO_PUBLIC_API_URL is not set');
  if (!__DEV__ && !url.startsWith('https://')) throw new Error('The server address must use HTTPS');
  return url;
}
export const wsUrl = (api: string) => api.replace(/^http/, 'ws') + '/ws';

// The map's look (tiles). A setting, never hard-coded in screens, so another free tile service can be swapped in.
// Default: OpenFreeMap's public "dark" style (free, no key; OpenStreetMap data), to match the app's dark look.
export const mapStyleUrl = () => process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
// Where the map opens before we know anything better: central Algiers.
export const ALGIERS = { lat: 36.7538, lng: 3.0588 };

// Google sign-in: the "web client id" of the owner's Google/Firebase project (not a secret; it names our app to Google).
export const googleWebClientId = () => process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
