import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Phone push (contract G3). The phone's own push token (Firebase on Android, Apple via Firebase on iPhone) is sent to the
// server with register_device. Until the owner's Firebase project is added to the build, no token exists and push stays off:
// the app still works with the live connection while it is open.
export async function devicePushToken(): Promise<string | null> {
  try {
    // The channel first (Android 13+ shows the permission question only once a channel exists), then the question.
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Delivery', importance: Notifications.AndroidImportance.HIGH, sound: 'default', vibrationPattern: [0, 300, 200, 300] });
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return null;
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === 'string' && t.data.length >= 10 ? t.data : null;
  } catch { return null; }
}

// While the app is open, the live connection already shows everything: no second banner for the same event.
export function quietWhileOpen() {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
}

// Where a tapped notification leads (its data carries kind and order_id, contract G3).
export function routeFor(data: Record<string, unknown> | undefined): { pathname: string; params?: Record<string, string> } | null {
  const kind = String(data?.kind ?? ''), order = String(data?.order_id ?? '');
  if (kind === 'bid.accepted') return { pathname: '/job', params: { accepted: '1' } };   // the courier was chosen
  if (kind.startsWith('settlement.')) return { pathname: '/settlements' };
  if (kind.startsWith('sale.')) return { pathname: '/sales' };
  if (kind.startsWith('wallet.')) return { pathname: '/wallet' };
  if (kind.startsWith('trust.')) return { pathname: '/record' };
  if (kind === 'payout.changed') return { pathname: '/payout' };
  if (kind === 'security.new_login') return { pathname: '/settings' };
  if (kind === 'problem.resolved' && /^[0-9a-f-]{36}$/i.test(order)) return { pathname: '/order/[id]', params: { id: order } };
  if (kind.startsWith('offer.') || kind.startsWith('bid.') || kind.startsWith('profile.') || kind.startsWith('cash.') || kind === 'order.incoming') return { pathname: '/home' };   // incoming: not this person's order
  if (kind.startsWith('job.')) return { pathname: '/job' };
  if ((kind.startsWith('order.') || kind === 'return.delivered') && /^[0-9a-f-]{36}$/i.test(order)) return { pathname: '/order/[id]', params: { id: order } };
  return null;
}
// The notification whose tap OPENED the app (the app was closed): read once, after login is restored.
export async function launchTap(): Promise<Record<string, unknown> | null> {
  try { const r = await Notifications.getLastNotificationResponseAsync(); if (!r) return null; await Notifications.clearLastNotificationResponseAsync?.(); return r.notification.request.content.data ?? {}; }
  catch { return null; }
}
export const onTap = (f: (data: Record<string, unknown>) => void) =>
  Notifications.addNotificationResponseReceivedListener(r => f(r.notification.request.content.data ?? {}));
export const onNewToken = (f: (token: string) => void) => Notifications.addPushTokenListener(t => { if (typeof t.data === 'string') f(t.data); });
