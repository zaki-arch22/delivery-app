import React from 'react';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { Card, Gap, Row, Screen, T } from '../ui/kit';

// Safety (side menu): how the platform protects everyone (codes, photos, positions, history), the rules and my record.
export default function Safety() {
  const { t, state } = useApp();
  const courier = state.active?.type === 'driver';
  return (
    <Screen testID="screen-safety" title={t('menu_safety')}>
      <Card><T kind="label">{t('safe_title')}</T>{(['safe_1', 'safe_2', 'safe_3', 'safe_4'] as const).map(k => <T key={k} kind="muted">• {t(k)}</T>)}</Card>
      {courier ? <Card><T kind="label">{t('sos_title')}</T><T kind="muted">{t('safe_sos')}</T></Card> : null}
      <Gap n={2} />
      <Row testID="safety-rules" icon="book-open" label={t('rules_title')} onPress={() => router.push('/rules')} />
      <Row testID="safety-record" icon="clipboard" label={t('record_title')} onPress={() => router.push('/record')} />
    </Screen>
  );
}
