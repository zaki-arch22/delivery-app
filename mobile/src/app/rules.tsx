import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { color, radius, space } from '../lib/theme';
import { Button, Gap, Screen, T } from '../ui/kit';
import type { Key } from '../i18n';

// The platform rules, in plain words (backend/docs/TRUST_AND_SAFETY.md). The same rules for everyone.
const SECTIONS: [Key, Key][] = [['rules_s1_t', 'rules_s1'], ['rules_s2_t', 'rules_s2'], ['rules_s3_t', 'rules_s3'], ['rules_s4_t', 'rules_s4'], ['rules_s5_t', 'rules_s5'], ['rules_s6_t', 'rules_s6']];
const POINTS: [Key, number][] = [['rule_driver_released', 1], ['rule_late_cancel', 1], ['rule_not_ordered_refusal', 2], ['rule_far_confirmation', 3], ['rule_wrong_item', 4], ['rule_damaged_by_driver', 4], ['rule_behaviour', 3], ['rule_prohibited_goods', 6]];
export default function Rules() {
  const { t } = useApp();
  return (
    <Screen testID="screen-rules">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('rules_title')}</T>
      <T kind="muted">{t('rules_intro')}</T>
      {SECTIONS.map(([h, b]) => <View key={h} style={s.box}><T kind="label">{t(h)}</T><T>{t(b)}</T></View>)}
      <View style={s.box}>
        <T kind="label">{t('rules_points_t')}</T>
        {POINTS.map(([k, p]) => <T key={k}>• {t(k)}: {p}</T>)}
        <T kind="muted">{t('rules_points_sub')}</T>
      </View>
      <View style={s.box}>
        <T kind="label">{t('rules_levels_t')}</T>
        <T>{t('rules_levels')}</T>
      </View>
      <Gap />
    </Screen>
  );
}
const s = StyleSheet.create({ box: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5), gap: space(1) } });
