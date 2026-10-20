import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { useApp } from '../lib/app';
import { color } from '../lib/theme';

// Simple line icons (Feather, MIT licence, only this one icon font is bundled). Arrows and chevrons point the other way
// in Arabic (right-to-left), so "back" always points to where the person came from.
const MIRRORED = new Set(['arrow-left', 'arrow-right', 'chevron-left', 'chevron-right']);
export type IconName = React.ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 22, tint = color.text, testID }: { name: IconName; size?: number; tint?: string; testID?: string }) {
  const { rtl } = useApp();
  const n = rtl && MIRRORED.has(name) ? (name.includes('left') ? name.replace('left', 'right') : name.replace('right', 'left')) as IconName : name;
  return <Feather testID={testID} name={n} size={size} color={tint} accessibilityElementsHidden importantForAccessibility="no" />;
}
