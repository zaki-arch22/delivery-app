import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, minTouch, radius, space } from '../lib/theme';
import { T } from './kit';

// A list of big choices (one selected): a tick and a border mark the choice, not colour alone.
export function Choice<V extends string>({ value, options, onChange, testID }: { value: V | null; options: { v: V; label: string; sub?: string }[]; onChange: (v: V) => void; testID: string }) {
  return (
    <View accessibilityRole="radiogroup" style={{ gap: space(2) }}>
      {options.map(o => {
        const on = o.v === value;
        return (
          <Pressable key={o.v} testID={`${testID}-${o.v}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.v)} style={[s.opt, on && s.on]}>
            <T kind="label" style={on ? s.textOn : undefined}>{on ? '✓ ' : ''}{o.label}</T>
            {o.sub ? <T kind="muted">{o.sub}</T> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  opt: { minHeight: minTouch, borderRadius: radius, borderWidth: 2, borderColor: color.border, backgroundColor: color.white, paddingHorizontal: space(4), paddingVertical: space(2), justifyContent: 'center' },
  on: { borderColor: color.primary, backgroundColor: color.soft },
  textOn: { color: color.primary },
});
