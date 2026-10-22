import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useApp } from '../lib/app';
import { addressLine, money, Order, when } from '../lib/orders';
import { color, radius, space } from '../lib/theme';
import type { Key } from '../i18n';
import { T } from './kit';

// One order in a list: reference, status in words (never colour alone), where to, price, date.
export function OrderCard({ o, onPress }: { o: Order; onPress: () => void }) {
  const { t, lang } = useApp();
  const price = o.locked_da ?? o.offered_da;
  return (
    <Pressable testID={'order-' + o.ref} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}>
      <View style={s.row}>
        <T kind="label" style={{ flex: 1 }}>{o.leg === 'return' ? t('return_leg') + ' · ' : ''}{o.ref}</T>
        <T style={[s.chip, ['failed', 'cancelled', 'expired'].includes(o.status) ? s.chipOff : null]}>{t(('status_' + o.status) as Key)}</T>
      </View>
      <T numberOfLines={1}>→ {o.recipient_name} · {addressLine(o.dropoff_address)}</T>
      <T kind="muted">{money(price)} {t('da')} · {when(o.created_at, lang)}</T>
    </Pressable>
  );
}
const s = StyleSheet.create({
  card: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  chip: { backgroundColor: color.soft, color: color.accent, borderRadius: 10, paddingHorizontal: space(2), fontSize: 14, overflow: 'hidden' },
  chipOff: { backgroundColor: '#EEF1F6', color: color.muted },
});
