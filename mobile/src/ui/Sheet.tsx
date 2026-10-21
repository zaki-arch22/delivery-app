import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/app';
import { bigRadius, color, space } from '../lib/theme';
import { useAreaHeight } from './Frame';

const HANDLE = 34;   // height of the drag handle zone

// The dark panel at the bottom of a map screen (inDrive-style). It follows the finger anywhere on it and rests at one of
// three heights: folded (its top part, `peek` px, to see the map), normal (its content, at most `maxFraction` of the
// screen) and full (up to the top of the screen). On release it glides to the nearest one (a quick flick goes one step in
// its direction). The content scrolls only at full height; below that, dragging the content moves the panel, so the
// phone's own scrolling never fights the drag. At the top of the content, dragging down lowers the panel again.
// Tapping the handle steps up, and from full folds it. Plain React Native (no native library): ships over the air.
// `inline`: the panel sits UNDER the map instead of over it (as it grows, the map shrinks, so a centre pin stays centred).
export function Sheet({ children, footer, testID = 'sheet', peek = 150, maxFraction = 0.72, scroll = true, inline = false }:
  { children: React.ReactNode; footer?: React.ReactNode; testID?: string; peek?: number; maxFraction?: number; scroll?: boolean; inline?: boolean }) {
  const { t, rtl } = useApp();
  const insets = useSafeAreaInsets();
  const pad = Math.max(insets.bottom, space(3));
  const area = useAreaHeight() || Dimensions.get('window').height;
  const full = Math.round(area - space(2));
  const [contentH, setContentH] = useState(0), [footerH, setFooterH] = useState(0);
  const natural = contentH ? Math.min(area * maxFraction, HANDLE + contentH + footerH + pad, full) : 0;   // 0 = not measured yet
  const low = natural ? Math.min(peek, natural) : peek;
  const snaps = useMemo(() => [...new Set([low, natural, full].map(Math.round))].sort((a, b) => a - b), [low, natural, full]);
  const height = useRef(new Animated.Value(0)).current;
  const now = useRef(0), level = useRef(1), scrollY = useRef(0), dragging = useRef(false);   // level: 0 folded, 1 normal, 2 full
  const [atFull, setAtFull] = useState(false);
  const target = (l: number) => (l === 0 ? low : l === 2 ? full : natural);
  const setLevel = (l: number) => { level.current = l; setAtFull(l === 2); };
  useEffect(() => { const id = height.addListener(v => { now.current = v.value; }); return () => height.removeListener(id); }, [height]);
  const glide = (to: number, velocity = 0) => Animated.spring(height, { toValue: to, velocity, useNativeDriver: false, bounciness: 0, speed: 16 }).start();
  // Content grew or shrank (a new state, a message): follow it at the chosen level, unless the person is dragging.
  useEffect(() => { if (!natural || dragging.current) return; if (now.current === 0) { height.setValue(target(level.current)); return; } glide(target(level.current)); }, [natural, low, full]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useMemo(() => {
    let start = 0;
    const vertical = (g: { dx: number; dy: number }) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx);
    const clamp = (h: number) => Math.min(full, Math.max(low, h));
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => !!natural && vertical(g) &&
        ((g.dy < 0 && now.current < full - 2) || (g.dy > 0 && (level.current < 2 || scrollY.current <= 0) && now.current > low + 2)),
      onPanResponderGrant: () => { start = now.current || natural; dragging.current = true; height.stopAnimation(); },
      onPanResponderMove: (_e, g) => height.setValue(clamp(start - g.dy)),
      onPanResponderRelease: (_e, g) => {
        dragging.current = false;
        const h = clamp(start - g.dy);
        let to: number;
        if (g.vy < -0.4) to = snaps.find(x => x > h + 1) ?? snaps[snaps.length - 1];          // flick up: next stop above
        else if (g.vy > 0.4) to = [...snaps].reverse().find(x => x < h - 1) ?? snaps[0];       // flick down: next stop below
        else to = snaps.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a));         // nearest stop
        setLevel(to >= full - 1 ? 2 : to <= low + 1 && low < natural ? 0 : 1);
        glide(to, -g.vy);
      },
      onPanResponderTerminate: () => { dragging.current = false; glide(target(level.current)); },
    });
  }, [natural, low, full, snaps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { if (!natural) return; const l = level.current === 2 ? 0 : level.current + 1; setLevel(l); glide(target(l)); };

  const Body = scroll ? ScrollView : View;
  const body = scroll
    ? { keyboardShouldPersistTaps: 'handled' as const, contentContainerStyle: s.body, scrollEventThrottle: 16, scrollEnabled: atFull || !natural,
        onScroll: (e: any) => { scrollY.current = e.nativeEvent.contentOffset.y; }, onContentSizeChange: (_w: number, h: number) => setContentH(h), style: { flexShrink: 1 } }
    : { style: s.body, onLayout: (e: any) => setContentH(e.nativeEvent.layout.height) };
  return (
    <Animated.View testID={testID} {...pan.panHandlers}
      style={[s.sheet, inline && s.inline, { paddingBottom: pad, direction: rtl ? 'rtl' : 'ltr' }, natural ? { height } : { maxHeight: area * maxFraction }]}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={t(atFull ? 'sheet_fold' : 'sheet_open')} style={s.handleZone} testID={testID + '-handle'}>
        <View style={s.handle} />
      </Pressable>
      <Body {...body}>{children}</Body>
      {footer ? <View style={s.footer} onLayout={e => setFooterH(e.nativeEvent.layout.height)}>{footer}</View> : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden', backgroundColor: color.card, borderTopLeftRadius: bigRadius, borderTopRightRadius: bigRadius,
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: -2 } },
  inline: { position: 'relative', marginTop: -24 },
  handleZone: { alignItems: 'center', justifyContent: 'center', height: HANDLE },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: color.line },
  body: { paddingHorizontal: space(4), paddingBottom: space(2) },
  footer: { paddingHorizontal: space(4), paddingTop: space(1) },
});
