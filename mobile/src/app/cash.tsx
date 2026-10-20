import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '../lib/app';
import { CashEntry, driver } from '../lib/driver';
import { money, when } from '../lib/orders';
import { color, font, radius, space } from '../lib/theme';
import { Button, Notice, Screen, T } from '../ui/kit';

// The driver's cash (contract C: get_cash_balance): what they hold for senders, and every movement (never edited).
export default function Cash() {
  const { t, lang, services } = useApp();
  const [data, setData] = useState<{ balance_da: number; entries: CashEntry[] } | null>(null);
  useFocusEffect(useCallback(() => { driver(services.client).cash().then(setData).catch(() => {}); }, [services]));
  const label = (e: CashEntry) => e.type === 'handover' ? t('cash_handover', { n: e.id }) : e.type === 'adjustment' ? t('cash_adjustment') : t('cash_cod_collected');
  return (
    <Screen testID="screen-cash" title={t('my_cash')}>
      {data ? (<>
        <T style={s.balance} testID="cash-balance">{t('cash_balance', { p: money(data.balance_da) })}</T>
        <T kind="muted">{t('cash_explain')}</T>
        {!data.entries.length ? <Notice testID="cash-empty" text={t('no_cash_entries')} /> : null}
        {data.entries.map(e => (
          <View key={e.id} style={s.row} testID={'cash-' + e.id}>
            <View style={{ flex: 1 }}><T>{label(e)}</T><T kind="muted">{when(e.created_at, lang)}{e.note ? ' · ' + e.note : ''}</T></View>
            <T style={s.amount}>{e.amount_da > 0 ? '+' : '−'}{money(Math.abs(e.amount_da))} {t('da')}</T>
          </View>
        ))}
      </>) : null}
    </Screen>
  );
}
const s = StyleSheet.create({
  balance: { fontFamily: font.bold, fontSize: 26, lineHeight: 38, color: color.navy, marginVertical: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5) },
  amount: { fontFamily: font.bold, writingDirection: 'ltr' },
});
