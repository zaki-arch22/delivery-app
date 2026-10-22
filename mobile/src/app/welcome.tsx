import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { color, font, space } from '../lib/theme';
import { Gap, Screen, T } from '../ui/kit';
import { Icon, IconName } from '../ui/Icon';

// First screen: the two modes (CLAUDE.md section 4: one app, two paths), in the phone's language (changed later only in
// Settings). The other mode can be added later from the side menu.
export default function Welcome() {
  const { t, rtl } = useApp();
  const Path = ({ id, icon, title, sub, path }: { id: string; icon: IconName; title: string; sub: string; path: 'user' | 'driver' }) => (
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={title} onPress={() => router.push({ pathname: '/login', params: { path } })}
      style={({ pressed }) => [s.card, { flexDirection: rtl ? 'row-reverse' : 'row' }, pressed && { opacity: 0.85 }]}>
      <View style={s.icon}><Icon name={icon} size={30} tint={color.onBrand} /></View>
      <View style={{ flex: 1 }}><T style={s.cardTitle}>{title}</T><T kind="muted">{sub}</T></View>
      <Icon name="chevron-right" tint={color.muted} />
    </Pressable>
  );
  return (
    <Screen testID="screen-welcome">
      <Gap n={6} />
      <View style={s.hero}>
        <T style={s.brand}>{t('app_name')}</T>
        <T style={s.heroTitle}>{t('welcome_title')}</T>
        <T style={s.heroSub}>{t('welcome_sub')}</T>
      </View>
      <Gap n={6} />
      <Path id="path-user" icon="package" title={t('path_user')} sub={t('path_user_sub')} path="user" />
      <Path id="path-driver" icon="truck" title={t('path_driver')} sub={t('path_driver_sub')} path="driver" />
    </Screen>
  );
}
const s = StyleSheet.create({
  hero: { backgroundColor: color.brand, borderRadius: 28, padding: space(6) },
  brand: { color: color.onBrand, fontFamily: font.bold, fontSize: 15, opacity: 0.7 },
  heroTitle: { color: color.onBrand, fontFamily: font.bold, fontSize: 28, lineHeight: 40 },
  heroSub: { color: color.onBrand, fontSize: 16, lineHeight: 24, marginTop: space(2) },
  card: { alignItems: 'center', gap: space(4), backgroundColor: color.card, borderRadius: 24, padding: space(5), marginVertical: space(2) },
  icon: { width: 56, height: 56, borderRadius: 18, backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: font.bold, fontSize: 20, lineHeight: 30 },
});
