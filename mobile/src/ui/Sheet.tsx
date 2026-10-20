import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/app';
import { bigRadius, color, space } from '../lib/theme';

// The dark panel at the bottom of a map screen (inDrive-style). Drag the handle (or tap it) to fold it down to its top part
// (`peek` pixels) and back up, so the map can be seen. Built with React Native only (no extra native library), so it
// reaches phones as an over-the-air update.
// `inline`: the sheet sits UNDER the map instead of over it (screens where a pin marks the map's centre: the centre must be
// the centre of what the person sees), overlapping it only by its rounded top. It does not fold.
export function Sheet({ children, footer, testID = 'sheet', peek = 150, maxFraction = 0.72, scroll = true, inline = false }:
  { children: React.ReactNode; footer?: React.ReactNode; testID?: string; peek?: number; maxFraction?: number; scroll?: boolean; inline?: boolean }) {
  const { t, rtl } = useApp();
  const insets = useSafeAreaInsets();
  const [h, setH] = useState(0);
  const [folded, setFolded] = useState(false);
  const y = useRef(new Animated.Value(0)).current;
  const hidden = Math.max(0, h - peek);
  useEffect(() => { Animated.spring(y, { toValue: folded ? hidden : 0, useNativeDriver: true, bounciness: 2 }).start(); }, [folded, hidden, y]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_e, g) => y.setValue(Math.min(hidden, Math.max(0, (folded ? hidden : 0) + g.dy))),
    onPanResponderRelease: (_e, g) => setFolded(f => (Math.abs(g.dy) < 6 ? !f : g.dy > 40 ? true : g.dy < -40 ? false : f)),
  }), [folded, hidden, y]);
  const max = Dimensions.get('window').height * maxFraction;
  const Body = scroll ? ScrollView : View;
  if (inline) return (
    <View testID={testID} style={[s.sheet, s.inline, { paddingBottom: Math.max(insets.bottom, space(3)), maxHeight: max + 40, direction: rtl ? 'rtl' : 'ltr' }]}>
      <View style={s.handleZone}><View style={s.handle} /></View>
      <Body {...(scroll ? { keyboardShouldPersistTaps: 'handled', contentContainerStyle: s.body, style: { maxHeight: max - (footer ? 90 : 0) } } : { style: s.body })}>{children}</Body>
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </View>
  );
  return (
    <Animated.View testID={testID} onLayout={e => setH(e.nativeEvent.layout.height)}
      style={[s.sheet, { paddingBottom: Math.max(insets.bottom, space(3)), maxHeight: max + 40, transform: [{ translateY: y }], direction: rtl ? 'rtl' : 'ltr' }]}>
      <Pressable {...pan.panHandlers} onPress={() => setFolded(f => !f)} accessibilityRole="button" accessibilityLabel={t(folded ? 'sheet_open' : 'sheet_fold')} style={s.handleZone} testID={testID + '-handle'}>
        <View style={s.handle} />
      </Pressable>
      <Body {...(scroll ? { keyboardShouldPersistTaps: 'handled', contentContainerStyle: s.body, style: { maxHeight: max - (footer ? 90 : 0) } } : { style: s.body })}>{children}</Body>
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.card, borderTopLeftRadius: bigRadius, borderTopRightRadius: bigRadius,
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: -2 } },
  inline: { position: 'relative', marginTop: -24 },
  handleZone: { alignItems: 'center', paddingVertical: space(2.5) },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: color.line },
  body: { paddingHorizontal: space(4), paddingBottom: space(2) },
  footer: { paddingHorizontal: space(4), paddingTop: space(1) },
});
