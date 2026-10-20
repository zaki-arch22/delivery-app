import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/app';
import { bigRadius, color, space } from '../lib/theme';

const HANDLE = 30;   // height of the drag handle zone

// The dark panel at the bottom of a map screen (inDrive-style). It follows the finger anywhere on it: drag up to open it
// to its full content, drag down to fold it to its top part (`peek` px) and see the map; it then glides to the nearest
// position (a quick flick decides the direction). When open and its content is longer than the screen allows, the
// content scrolls; at the top of the content, dragging down folds the panel. Tapping the handle opens/folds it.
// Built with React Native only (no extra native library), so it reaches phones as an over-the-air update.
// `inline`: the panel sits UNDER the map instead of over it (screens where a pin marks the map's centre: as the panel
// grows or folds, the map's own size changes, so the centre the person sees is always the point chosen).
export function Sheet({ children, footer, testID = 'sheet', peek = 150, maxFraction = 0.72, scroll = true, inline = false }:
  { children: React.ReactNode; footer?: React.ReactNode; testID?: string; peek?: number; maxFraction?: number; scroll?: boolean; inline?: boolean }) {
  const { t, rtl } = useApp();
  const insets = useSafeAreaInsets();
  const pad = Math.max(insets.bottom, space(3));
  const max = Dimensions.get('window').height * maxFraction;
  const [contentH, setContentH] = useState(0), [footerH, setFooterH] = useState(0);
  const natural = contentH ? Math.min(max, HANDLE + contentH + footerH + pad) : 0;   // 0 = not measured yet: natural size
  const low = natural ? Math.min(peek, natural) : peek;
  const height = useRef(new Animated.Value(0)).current;
  const now = useRef(0), open = useRef(true), scrollY = useRef(0), dragging = useRef(false);
  const [isOpen, setIsOpen] = useState(true);   // only for the handle's spoken label
  useEffect(() => { const id = height.addListener(v => { now.current = v.value; }); return () => height.removeListener(id); }, [height]);
  const glide = (to: number, velocity = 0) => Animated.spring(height, { toValue: to, velocity, useNativeDriver: false, bounciness: 0, speed: 16 }).start();
  // Content grew or shrank (a new state, a message): follow it, unless the person folded the panel or is dragging it.
  useEffect(() => { if (!natural || dragging.current) return; if (now.current === 0) { height.setValue(open.current ? natural : low); return; } glide(open.current ? natural : low); }, [natural, low]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useMemo(() => {
    let start = 0;
    const vertical = (g: { dx: number; dy: number }) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx);
    return PanResponder.create({
      // The panel takes the gesture when it should move: dragging up while not fully open, or dragging down while the
      // content is scrolled to its top. Otherwise the content scrolls (or a button is pressed) as usual.
      onMoveShouldSetPanResponderCapture: (_e, g) => !!natural && vertical(g) && ((g.dy < 0 && now.current < natural - 2) || (g.dy > 0 && scrollY.current <= 0)),
      onPanResponderGrant: () => { start = now.current || natural; dragging.current = true; height.stopAnimation(); },
      onPanResponderMove: (_e, g) => height.setValue(Math.min(natural, Math.max(low, start - g.dy))),
      onPanResponderRelease: (_e, g) => {
        dragging.current = false;
        const h = Math.min(natural, Math.max(low, start - g.dy));
        open.current = g.vy < -0.4 ? true : g.vy > 0.4 ? false : h > (natural + low) / 2; setIsOpen(open.current);
        glide(open.current ? natural : low, -g.vy);
      },
      onPanResponderTerminate: () => { dragging.current = false; glide(open.current ? natural : low); },
    });
  }, [natural, low]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { if (!natural) return; open.current = !open.current; setIsOpen(open.current); glide(open.current ? natural : low); };

  const Body = scroll ? ScrollView : View;
  const body = scroll
    ? { keyboardShouldPersistTaps: 'handled' as const, contentContainerStyle: s.body, scrollEventThrottle: 16, onScroll: (e: any) => { scrollY.current = e.nativeEvent.contentOffset.y; }, onContentSizeChange: (_w: number, h: number) => setContentH(h), style: { flexShrink: 1 } }
    : { style: s.body, onLayout: (e: any) => setContentH(e.nativeEvent.layout.height) };
  return (
    <Animated.View testID={testID} {...pan.panHandlers}
      style={[s.sheet, inline && s.inline, { paddingBottom: pad, maxHeight: max, direction: rtl ? 'rtl' : 'ltr' }, natural ? { height } : null]}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={t(isOpen ? 'sheet_fold' : 'sheet_open')} style={s.handleZone} testID={testID + '-handle'}>
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
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: color.line },
  body: { paddingHorizontal: space(4), paddingBottom: space(2) },
  footer: { paddingHorizontal: space(4), paddingTop: space(1) },
});
