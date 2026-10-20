import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import type { Key } from '../i18n';
import { Card, Gap, Row, Screen, T } from '../ui/kit';

// Help and support: short answers to the questions people ask most, and the way to reach our team about an order
// (a problem report from that order: staff see it with all the evidence). No phone line exists yet, so none is shown.
const QA: [Key, Key][] = [['faq_how_q', 'faq_how_a'], ['faq_offers_q', 'faq_offers_a'], ['faq_codes_q', 'faq_codes_a'], ['faq_cash_q', 'faq_cash_a'], ['faq_problem_q', 'faq_problem_a']];
export default function Help() {
  const { t, state } = useApp();
  const [open, setOpen] = useState<number | null>(0);
  const courier = state.active?.type === 'driver';
  return (
    <Screen testID="screen-help" title={t('menu_help')}>
      {QA.map(([q, a], i) => (
        <Pressable key={q} testID={'faq-' + i} accessibilityRole="button" accessibilityState={{ expanded: open === i }} onPress={() => setOpen(open === i ? null : i)}>
          <Card><T kind="label">{open === i ? '− ' : '+ '}{t(q)}</T>{open === i ? <T kind="muted">{t(a)}</T> : null}</Card>
        </Pressable>
      ))}
      <Gap n={3} />
      <T kind="label">{t('support_title')}</T>
      <T kind="muted">{t('support_sub')}</T>
      <Row testID="help-orders" icon={courier ? 'clock' : 'package'} label={t(courier ? 'menu_deliveries' : 'menu_parcels')} onPress={() => router.push(courier ? '/jobs' : '/orders')} />
    </Screen>
  );
}
