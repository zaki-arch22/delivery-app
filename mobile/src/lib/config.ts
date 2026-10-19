// Where the server is. Set EXPO_PUBLIC_API_URL when building the app (for example https://api.yourdomain.dz).
// Release builds refuse anything but HTTPS (contract section J).
export function apiUrl(): string {
  const url = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  if (!url) throw new Error('EXPO_PUBLIC_API_URL is not set');
  if (!__DEV__ && !url.startsWith('https://')) throw new Error('The server address must use HTTPS');
  return url;
}
export const wsUrl = (api: string) => api.replace(/^http/, 'ws') + '/ws';
