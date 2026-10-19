import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { color, minTouch, radius, space } from '../lib/theme';
import { Button, T } from './kit';

// "I have read and accept the platform rules", with a link to read them. Required to create any profile.
export function RulesAccept({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useApp();
  return (<>
    <Pressable testID="accept-rules" accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={[s.box, value && s.on]}>
      <T kind="label">{value ? '☑' : '☐'} {t('rules_accept')}</T>
    </Pressable>
    <Button testID="read-rules" kind="plain" label={t('rules_read')} onPress={() => router.push('/rules')} />
  </>);
}
const s = StyleSheet.create({
  box: { minHeight: minTouch, borderRadius: radius, borderWidth: 2, borderColor: color.border, backgroundColor: color.white, padding: space(3), justifyContent: 'center', marginTop: space(3) },
  on: { borderColor: color.primary, backgroundColor: color.soft },
});
