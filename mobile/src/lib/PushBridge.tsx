import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useApp } from './app';
import { devicePushToken, onNewToken, onTap, quietWhileOpen, routeFor } from './push';

// Connects phone push to the app: registers this phone for the ACTIVE profile in the chosen language (again after every
// profile switch, language change or new token), and opens the right screen when a notification is tapped.
export function PushBridge() {
  const { services, state, lang, ready } = useApp();
  const activeId = state.active?.id ?? null;

  useEffect(() => { quietWhileOpen(); }, []);
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    const register = (token: string) => services.client.call('/register_device', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android', language: lang }).catch(() => {});
    devicePushToken().then(t => { if (live && t) register(t); });
    const sub = onNewToken(t => { if (live) register(t); });
    return () => { live = false; sub.remove(); };
  }, [services, activeId, lang]);
  useEffect(() => {
    if (!ready) return;
    const sub = onTap(data => { const r = routeFor(data); if (r && state.active) router.push(r as any); });
    return () => sub.remove();
  }, [ready, state.active]);
  return null;
}
