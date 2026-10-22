import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Keyboard, PanResponder, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/app';
import { bigRadius, color, space } from '../lib/theme';
import { useAreaHeight } from './Frame';

const HANDLE = 34;   // height of the drag handle zone

// The dark panel at the bottom of a map screen (inDrive-style). The WHOLE panel follows the finger (owner's wish: touch any
// part of it and move it smoothly), not only its top bar. It rests at three heights: folded (its top part, `peek` px, to see
// the map), normal (its content, at most `maxFraction` of the screen) and full (up to the top of the screen); on release it
// glides to the nearest one (a quick flick goes one step in its direction).
// One gesture does everything, like the big apps: dragging up first raises the panel to full height, then scrolls its
// content; dragging down first scrolls the content back to its top, then lowers the panel. The content is moved by this
// component itself (not by the phone's own scroll view), so the phone can never steal the drag from the panel. A flick keeps
// the content gliding. When the keyboard opens for a field inside, the panel goes to full height and shows that field.
// Taps (buttons, fields, switches) work as usual: the panel only takes over once the finger clearly moves up or down.
// Plain React Native (no native library): ships over the air.
// It floats over a full-screen map. `hidden`: a finger is on the map, so the panel slides away (owner's wish: only the map
// stays) and comes back when the map stops. `above`: a floating button that rides just above the panel (e.g. my location).
export function Sheet({ children, footer, above, hidden = false, testID = 'sheet', peek = 150, maxFraction = 0.72, scroll = true }:
  { children: React.ReactNode; footer?: React.ReactNode; above?: React.ReactNode; hidden?: boolean; testID?: string; peek?: number; maxFraction?: number; scroll?: boolean }) {
  const { t, rtl } = useApp();
  const insets = useSafeAreaInsets();
  const pad = Math.max(insets.bottom, space(3));
  const area = useAreaHeight() || Dimensions.get('window').height;
  const full = Math.round(area - space(2));
  const [contentH, setContentH] = useState(0), [footerH, setFooterH] = useState(0);
  const natural = contentH ? Math.min(area * maxFraction, HANDLE + contentH + footerH + pad, full) : 0;   // 0 = not measured yet
  const low = natural ? Math.min(peek, natural) : peek;
  const snaps = useMemo(() => [...new Set([low, natural, full].map(Math.round))].sort((a, b) => a - b), [low, natural, full]);
  // How far the content can move at full height (0 when it all fits).
  const maxScroll = scroll ? Math.max(0, contentH - (full - HANDLE - footerH - pad)) : 0;

  const height = useRef(new Animated.Value(0)).current, offset = useRef(new Animated.Value(0)).current;
  const now = useRef(0), off = useRef(0), level = useRef(1), dragging = useRef(false);   // level: 0 folded, 1 normal, 2 full
  const lim = useRef({ full, low, maxScroll, natural }); lim.current = { full, low, maxScroll, natural };
  const [atFull, setAtFull] = useState(false);
  const target = (l: number) => (l === 0 ? low : l === 2 ? full : natural);
  const setLevel = (l: number) => { level.current = l; setAtFull(l === 2); };
  useEffect(() => { const a = height.addListener(v => { now.current = v.value; }), b = offset.addListener(v => { off.current = v.value; }); return () => { height.removeListener(a); offset.removeListener(b); }; }, [height, offset]);
  const hide = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(hide, { toValue: hidden ? 1 : 0, duration: hidden ? 140 : 220, useNativeDriver: false }).start(); }, [hidden, hide]);
  const glide = (to: number, velocity = 0) => Animated.spring(height, { toValue: to, velocity, useNativeDriver: false, bounciness: 0, speed: 16 }).start();
  const scrollTo = (y: number) => Animated.spring(offset, { toValue: Math.min(lim.current.maxScroll, Math.max(0, y)), useNativeDriver: false, bounciness: 0, speed: 18 }).start();
  // Content grew or shrank (a new state, a message): follow it at the chosen level, unless the person is dragging.
  useEffect(() => { if (!natural || dragging.current) return; if (now.current === 0) { height.setValue(target(level.current)); return; } glide(target(level.current)); }, [natural, low, full]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (off.current > maxScroll) offset.setValue(maxScroll); }, [maxScroll, offset]);

  const pan = useMemo(() => {
    let startH = 0, startOff = 0;
    const vertical = (g: { dx: number; dy: number }) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx);
    // Where the finger's travel puts the panel and its content: up = panel first, then content; down = content first, then panel.
    const place = (dy: number) => {
      const L = lim.current, up = -dy;
      if (up >= 0) { const raise = Math.min(up, Math.max(0, L.full - startH)); return { h: startH + raise, o: Math.min(L.maxScroll, startOff + up - raise) }; }
      const back = Math.min(-up, startOff); return { h: Math.max(L.low, startH - (-up - back)), o: startOff - back };
    };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        const L = lim.current;
        if (!L.natural || !vertical(g)) return false;
        return g.dy < 0 ? (now.current < L.full - 2 || off.current < L.maxScroll - 1) : (off.current > 0.5 || now.current > L.low + 2);
      },
      onPanResponderGrant: () => { height.stopAnimation(); offset.stopAnimation(); startH = now.current || lim.current.natural; startOff = off.current; dragging.current = true; },
      onPanResponderMove: (_e, g) => { const p = place(g.dy); height.setValue(p.h); offset.setValue(p.o); },
      onPanResponderRelease: (_e, g) => {
        dragging.current = false;
        const L = lim.current, p = place(g.dy);
        // At full height with content to move: the content keeps gliding with the flick, the panel stays up.
        if (p.h >= L.full - 1 && (p.o > 0 || g.vy < 0) && L.maxScroll > 0) {
          setLevel(2);
          Animated.decay(offset, { velocity: -g.vy, deceleration: 0.997, useNativeDriver: false }).start();
          const id = offset.addListener(v => { if (v.value < 0 || v.value > L.maxScroll) { offset.stopAnimation(); offset.setValue(Math.min(L.maxScroll, Math.max(0, v.value))); offset.removeListener(id); } });
          setTimeout(() => offset.removeListener(id), 3000);
          return;
        }
        const h = p.h;
        let to: number;
        if (g.vy < -0.4) to = snaps.find(x => x > h + 1) ?? snaps[snaps.length - 1];          // flick up: next stop above
        else if (g.vy > 0.4) to = [...snaps].reverse().find(x => x < h - 1) ?? snaps[0];       // flick down: next stop below
        else to = snaps.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a));         // nearest stop
        setLevel(to >= L.full - 1 ? 2 : to <= L.low + 1 && L.low < L.natural ? 0 : 1);
        if (to < L.full - 1 && off.current > 0) scrollTo(0);
        glide(to, -g.vy);
      },
      onPanResponderTerminationRequest: () => false,   // a child never takes the finger back in the middle of a drag
      onPanResponderTerminate: () => { dragging.current = false; glide(target(level.current)); },
    });
  }, [natural, low, full, snaps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { if (!natural) return; const l = level.current === 2 ? 0 : level.current + 1; setLevel(l); if (l !== 2) scrollTo(0); glide(target(l)); };

  // The keyboard opened for a field in this panel: full height, and the field moved into view.
  const inner = useRef<View>(null);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      const input: any = (TextInput as any).State?.currentlyFocusedInput?.();
      if (!input || !inner.current || !lim.current.natural) return;
      try {
        input.measureLayout(inner.current, (_x: number, y: number, _w: number, h: number) => {
          setLevel(2); glide(lim.current.full);
          const view = lim.current.full - HANDLE - footerH - pad;
          if (y + h - off.current > view - space(4)) scrollTo(y + h - view + space(6));
          else if (y < off.current) scrollTo(y - space(4));
        }, () => {});
      } catch { /* not inside this panel */ }
    });
    return () => sub.remove();
  }, [footerH, pad]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View testID={testID} {...pan.panHandlers} pointerEvents={hidden ? 'none' : 'box-none'}
      style={[s.outer, natural ? { height } : { maxHeight: area * maxFraction },
        { opacity: hide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY: hide.interpolate({ inputRange: [0, 1], outputRange: [0, 400] }) }] }]}>
      {above ? <View pointerEvents="box-none" style={[s.above, { flexDirection: rtl ? 'row' : 'row-reverse' }]}>{above}</View> : null}
      <View style={[s.sheet, { paddingBottom: pad, direction: rtl ? 'rtl' : 'ltr' }, natural ? { flex: 1 } : null]}>
        <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={t(atFull ? 'sheet_fold' : 'sheet_open')} style={s.handleZone} testID={testID + '-handle'}>
          <View style={s.handle} />
        </Pressable>
        <View style={[s.viewport, natural ? { flex: 1 } : { flexShrink: 1 }]}>
          <Animated.View ref={inner as any} style={[s.body, { transform: [{ translateY: Animated.multiply(offset, -1) }] }]} onLayout={e => setContentH(e.nativeEvent.layout.height)}>
            {children}
          </Animated.View>
        </View>
        {footer ? <View style={s.footer} onLayout={e => setFooterH(e.nativeEvent.layout.height)}>{footer}</View> : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  outer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  above: { position: 'absolute', left: space(4), right: space(4), bottom: '100%', marginBottom: space(3) },
  sheet: { overflow: 'hidden', flexShrink: 1, backgroundColor: color.card, borderTopLeftRadius: bigRadius, borderTopRightRadius: bigRadius,
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: -2 } },
  handleZone: { alignItems: 'center', justifyContent: 'center', height: HANDLE },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: color.line },
  viewport: { overflow: 'hidden' },
  body: { paddingHorizontal: space(4), paddingBottom: space(2) },
  footer: { paddingHorizontal: space(4), paddingTop: space(1) },
});
