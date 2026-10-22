import React, { useCallback, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { money as moneyApi, Sale } from '../lib/money';
import { money, when } from '../lib/orders';
import { color, font, radius, space } from '../lib/theme';
import { Button, Field, Notice, Screen, T } from '../ui/kit';
import type { Key } from '../i18n';

// "Money from my sales" (contract: list_sales, confirm_settlement, dispute_settlement, get_settlement_receipt): the goods money
// each courier must send the seller within 24 hours. The seller confirms it arrived, or tells our team it did not.
export default function Sales() {
  const { t, lang, services } = useApp();
  const api = moneyApi(services.client);
  const [data, setData] = useState<{ waiting_da: number; received_da: number; sales: Sale[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<string | null>(null), [note, setNote] = useState(''), [receipt, setReceipt] = useState<string | null>(null);
  const load = useCallback(() => { api.sales().then(setData).catch(e => { const m = errorMessage(e); setMsg(t(m.key, m.vars)); }); }, [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(load);
  const run = async (id: string, f: () => Promise<unknown>) => { setBusy(id); setMsg(null); try { await f(); setDisputing(null); setNote(''); load(); } catch (e) { const m = errorMessage(e); setMsg(t(m.key, m.vars)); } finally { setBusy(null); } };
  const confirm = (s: Sale) => Alert.alert(t('sale_confirm'), t('sale_confirm_q', { p: money(s.amount_da) }), [
    { text: t('cancel'), style: 'cancel' }, { text: t('confirm'), onPress: () => run(s.order_id, () => api.confirm(s.order_id)) }]);
  const status = (s: Sale) => s.overdue ? t('st_overdue') : t(('st_' + s.status) as Key, { t: when(s.due_at, lang) });
  return (
    <Screen testID="screen-sales" title={t('sales_title')}>
      <T kind="muted">{t('sales_explain')}</T>
      {data ? (<>
        <View style={s.totals}>
          <T style={s.big} testID="sales-waiting">{t('sales_waiting', { p: money(data.waiting_da) })}</T>
          <T kind="muted">{t('sales_received', { p: money(data.received_da) })}</T>
        </View>
        {msg ? <Notice warn text={msg} testID="sales-msg" /> : null}
        {!data.sales.length ? <Notice testID="sales-empty" text={t('no_sales')} /> : null}
        {data.sales.map(x => {
          const open = ['pending', 'sent', 'disputed'].includes(x.status);
          return (
            <View key={x.order_id} style={[s.card, x.overdue && { borderColor: color.danger }]} testID={'sale-' + x.ref}>
              <View style={s.head}><T style={s.amount}>{money(x.amount_da)} {t('da')}</T><T kind="muted">{x.ref}</T></View>
              <T style={{ color: x.overdue || x.status === 'disputed' ? color.amber : x.status === 'confirmed' || x.status === 'resolved_paid' ? color.lime : color.text }} testID={'sale-status-' + x.ref}>{status(x)}</T>
              <T kind="muted">{t('sale_by', { name: x.driver_name })}{x.driver_phone ? ' · ' + x.driver_phone : ''}</T>
              {x.method ? <T kind="muted">{x.method === 'cash' ? t('sale_method_cash') : t('sale_method_baridimob', { r: x.reference ?? '' })} · {x.sent_at ? when(x.sent_at, lang) : ''}</T> : null}
              {x.resolution_note ? <T kind="muted">{x.resolution_note}</T> : null}
              {x.has_receipt ? (receipt === x.order_id
                ? <Image testID={'receipt-' + x.ref} accessibilityLabel={t('sale_receipt')} style={s.receipt} resizeMode="contain" source={{ uri: `${services.client.baseUrl}/get_settlement_receipt?order_id=${x.order_id}`, headers: { Authorization: 'Bearer ' + (services.client.token ?? '') } }} />
                : <Button testID={'show-receipt-' + x.ref} kind="plain" icon="image" label={t('sale_receipt')} onPress={() => setReceipt(x.order_id)} />) : null}
              {open ? (disputing === x.order_id ? (<>
                <Field testID="dispute-note" label={t('sale_dispute_note')} value={note} onChangeText={setNote} maxLength={500} multiline />
                <Button testID="dispute-send" kind="danger" busy={busy === x.order_id} label={t('sale_dispute_send')} onPress={() => note.trim().length < 3 ? setMsg(t('sale_dispute_note')) : run(x.order_id, () => api.dispute(x.order_id, note.trim()))} />
                <Button kind="plain" label={t('cancel')} onPress={() => setDisputing(null)} />
              </>) : (<>
                <Button testID={'confirm-' + x.ref} label={t('sale_confirm')} busy={busy === x.order_id} onPress={() => confirm(x)} />
                {x.status === 'sent' || x.overdue ? <Button testID={'dispute-' + x.ref} kind="secondary" label={t('sale_dispute')} onPress={() => { setNote(''); setDisputing(x.order_id); }} /> : null}
              </>)) : null}
            </View>
          );
        })}
      </>) : msg ? <Notice warn text={msg} /> : null}
    </Screen>
  );
}
const s = StyleSheet.create({
  totals: { backgroundColor: color.card, borderRadius: 20, padding: space(4), marginVertical: space(3) },
  big: { fontFamily: font.bold, fontSize: 24, lineHeight: 34 },
  card: { backgroundColor: color.card, borderRadius: radius, borderWidth: 1, borderColor: color.line, padding: space(4), marginVertical: space(1.5), gap: space(1) },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { fontFamily: font.bold, fontSize: 20, writingDirection: 'ltr' },
  receipt: { width: '100%', height: 320, borderRadius: radius, backgroundColor: color.card2 },
});
