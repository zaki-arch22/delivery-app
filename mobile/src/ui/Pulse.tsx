import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { color } from '../lib/theme';

const WAVES = 3, WAVE_MS = 2400;   // three waves, one leaving the centre every 0.8 s

// The "searching" animation (inDrive-style, owner's wish Oct 2026): a faint blue disc around the point that grows slowly
// and stays small on screen, with waves leaving the centre and fading at its edge, again and again. It only SHOWS that a
// search is running: the real search area grows on its own schedule on the server. Screen-sized (not map-sized), so it
// looks the same at any zoom. Native-driver animations: smooth even while the app is busy.
export function Pulse({ radius, grow = 0, testID = 'pulse' }: { radius: number; grow?: number; testID?: string }) {
  const size = radius * 2;
  const outer = useRef(new Animated.Value(0.7 + 0.3 * grow)).current;
  useEffect(() => { Animated.timing(outer, { toValue: 0.7 + 0.3 * Math.min(1, Math.max(0, grow)), duration: 1000, useNativeDriver: true }).start(); }, [grow, outer]);
  const waves = useRef([...Array(WAVES)].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = waves.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay((i * WAVE_MS) / WAVES),
      Animated.timing(v, { toValue: 1, duration: WAVE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [waves]);
  return (
    <View pointerEvents="none" style={{ width: size, height: size }} testID={testID}>
      <Animated.View style={[s.disc, { width: size, height: size, borderRadius: radius, transform: [{ scale: outer }] }]} />
      {waves.map((v, i) => (
        <Animated.View key={i} style={[s.wave, { width: size, height: size, borderRadius: radius,
          opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.35, 0] }),
          transform: [{ scale: Animated.multiply(v, outer) }] }]} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  disc: { position: 'absolute', backgroundColor: color.search, opacity: 0.16 },
  wave: { position: 'absolute', backgroundColor: color.search },
});
