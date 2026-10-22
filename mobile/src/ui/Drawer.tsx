import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { color, font, space } from '../lib/theme';
import type { Key } from '../i18n';
import { Button, Notice, T } from './kit';
import { Icon, IconName } from './Icon';

type Item = { icon: IconName; key: Key; to: string; testID: string };
// What each mode offers (every item opens a real screen backed by a server function).
const CUSTOMER: Item[] = [
  { icon: 'package', key: 'menu_parcels', to: '/orders', testID: 'menu-orders' },
  { icon: 'dollar-sign', key: 'menu_sales', to: '/sales', testID: 'menu-sales' },
  { icon: 'bell', key: 'menu_notifications', to: '/notifications', testID: 'menu-notifications' },
  { icon: 'shield', key: 'menu_safety', to: '/safety', testID: 'menu-safety' },
  { icon: 'settings', key: 'settings', to: '/settings', testID: 'menu-settings' },
  { icon: 'help-circle', key: 'menu_help', to: '/help', testID: 'menu-help' },
];
const COURIER: Item[] = [
  { icon: 'clock', key: 'menu_deliveries', to: '/jobs', testID: 'menu-jobs' },
  { icon: 'send', key: 'menu_settlements', to: '/settlements', testID: 'menu-settlements' },
  { icon: 'credit-card', key: 'menu_wallet', to: '/wallet', testID: 'menu-wallet' },
  { icon: 'dollar-sign', key: 'menu_cash', to: '/cash', testID: 'menu-cash' },
  { icon: 'bell', key: 'menu_notifications', to: '/notifications', testID: 'menu-notifications' },
  { icon: 'shield', key: 'menu_safety', to: '/safety', testID: 'menu-safety' },
  { icon: 'settings', key: 'settings', to: '/settings', testID: 'menu-settings' },
  { icon: 'help-circle', key: 'menu_help', to: '/help', testID: 'menu-help' },
];

// The side menu: who I am (name, stars), the pages of my current mode, and at the bottom the big button to switch between
// Customer mode and Courier mode. A missing second profile is created from here (Courier: sign-up with documents).
export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, rtl, state, services } = useApp();
  const insets = useSafeAreaInsets();
  const width = Math.min(360, Dimensions.get('window').width * 0.84);
  const x = useRef(new Animated.Value(-width)).current;
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  useEffect(() => { Animated.timing(x, { toValue: open ? 0 : -width, duration: 200, useNativeDriver: true }).start(); if (!open) setErr(null); }, [open, width, x]);
  const p = state.active;
  if (!p) return null;
  const courier = p.type === 'driver';
  const other = courier ? 'user' : 'driver';
  const hasOther = state.profiles.some(q => q.type === other);
  const go = (to: string) => { onClose(); router.push(to as any); };
  const switchMode = async () => {
    if (!hasOther) { go(other === 'driver' ? '/driver-signup' : '/add-customer'); return; }
    setBusy(true); setErr(null);
    try { await services.session.switchProfile(other); onClose(); router.replace('/home'); }
    catch (e) { const m = errorMessage(e); setErr(t(m.key, m.vars)); } finally { setBusy(false); }
  };
  const stars = p.rating ? Number(p.rating).toFixed(2) : null;
  const side = rtl ? { right: 0 } : { left: 0 };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose} accessibilityLabel={t('close')} testID="menu-close" />
      <Animated.View style={[s.panel, side, { width, transform: [{ translateX: rtl ? Animated.multiply(x, -1) : x }] }]} testID="menu">
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
          <Pressable testID="menu-profile" accessibilityRole="button" onPress={() => go('/profile')} style={[s.head, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <View style={s.avatar}><Text style={s.avatarText}>{p.display_name.trim().charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <T style={s.name} numberOfLines={1}>{p.display_name}</T>
              <T kind="muted">{stars ? `★ ${stars} (${p.rating_count})` : t('no_rating_yet')} · {t(courier ? 'mode_courier' : 'mode_customer')}</T>
            </View>
            <Icon name="chevron-right" tint={color.muted} />
          </Pressable>
          <ScrollView style={{ flex: 1 }}>
            {(courier ? COURIER : CUSTOMER).map(i => (
              <Pressable key={i.key} testID={i.testID} accessibilityRole="button" onPress={() => go(i.to)} style={({ pressed }) => [s.item, { flexDirection: rtl ? 'row-reverse' : 'row' }, pressed && { backgroundColor: color.card2 }]}>
                <Icon name={i.icon} tint={color.muted} />
                <T style={s.itemText}>{t(i.key)}</T>
              </Pressable>
            ))}
          </ScrollView>
          <View style={s.foot}>
            {err ? <Notice warn text={err} /> : null}
            <Button testID="switch-mode" busy={busy} icon={courier ? 'package' : 'truck'} label={t(courier ? 'to_customer_mode' : 'to_courier_mode')}
              sub={hasOther ? undefined : t(courier ? 'to_customer_new' : 'to_courier_new')} onPress={switchMode} />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: color.overlay },
  panel: { position: 'absolute', top: 0, bottom: 0, backgroundColor: color.card },
  head: { alignItems: 'center', gap: space(3), padding: space(4), borderBottomWidth: 1, borderBottomColor: color.line },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.lime, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: color.ink, fontFamily: font.bold, fontSize: 24 },
  name: { fontFamily: font.bold, fontSize: 20 },
  item: { alignItems: 'center', gap: space(4), paddingHorizontal: space(5), minHeight: 60 },
  itemText: { fontFamily: font.semibold, fontSize: 18, flex: 1 },
  foot: { padding: space(4), borderTopWidth: 1, borderTopColor: color.line },
});
