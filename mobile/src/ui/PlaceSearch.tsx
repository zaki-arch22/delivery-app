import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useApp } from '../lib/app';
import { orders, Place } from '../lib/orders';
import type { Point } from '../lib/location';
import { color, font, radius, space } from '../lib/theme';
import { T } from './kit';
import { Icon } from './Icon';

// A search box with results ("Ardis", "Place des Martyrs"...), through our server (search_places). Shown only when the
// server says search is switched on; moving the map under the pin always works too (Algiers' landmarks matter most).
export function PlaceSearch({ near, onPick, placeholder, testID = 'place-search', autoFocus = false }:
  { near?: Point; onPick: (p: Place) => void; placeholder: string; testID?: string; autoFocus?: boolean }) {
  const { t, lang, rtl, services } = useApp();
  const [q, setQ] = useState(''), [res, setRes] = useState<Place[] | null>(null), [busy, setBusy] = useState(false), [down, setDown] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim(); setDown(false);
    if (text.length < 2) { setRes(null); return; }
    const my = ++seq.current;
    const h = setTimeout(async () => {
      setBusy(true);
      try { const r = await orders(services.client).search(text, lang, near); if (my === seq.current) { setRes(r.places); setDown(!!r.unavailable); } }
      catch { if (my === seq.current) { setRes([]); setDown(true); } }
      finally { if (my === seq.current) setBusy(false); }
    }, 450);   // waits for a pause in typing: fewer requests, less mobile data
    return () => clearTimeout(h);
  }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View testID={testID}>
      <View style={[s.box, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Icon name="search" tint={color.muted} />
        <TextInput testID={testID + '-input'} value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={color.muted} autoFocus={autoFocus}
          accessibilityLabel={placeholder} style={[s.input, { textAlign: rtl ? 'right' : 'left' }]} returnKeyType="search" maxLength={80} />
        {busy ? <ActivityIndicator color={color.muted} /> : q ? <Pressable accessibilityLabel={t('clear')} onPress={() => setQ('')} hitSlop={10}><Icon name="x" tint={color.muted} /></Pressable> : null}
      </View>
      {res && !res.length && !busy ? <T kind="muted" style={s.empty} testID={testID + '-empty'}>{t(down ? 'search_down' : 'search_none')}</T> : null}
      {(res ?? []).map((p, i) => (
        <Pressable key={i} testID={`${testID}-result-${i}`} accessibilityRole="button" onPress={() => { setQ(''); setRes(null); onPick(p); }}
          style={({ pressed }) => [s.item, { flexDirection: rtl ? 'row-reverse' : 'row' }, pressed && { opacity: 0.7 }]}>
          <Icon name="map-pin" tint={color.muted} />
          <View style={{ flex: 1 }}><T style={s.name} numberOfLines={1}>{p.name}</T>{p.detail ? <T kind="muted" numberOfLines={1}>{p.detail}</T> : null}</View>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { alignItems: 'center', gap: space(3), backgroundColor: color.card2, borderRadius: radius, paddingHorizontal: space(4), minHeight: 56 },
  input: { flex: 1, color: color.text, fontFamily: font.semibold, fontSize: 18, paddingVertical: space(3) },
  item: { alignItems: 'center', gap: space(3), paddingVertical: space(3) },
  name: { fontFamily: font.semibold },
  empty: { paddingVertical: space(3) },
});
