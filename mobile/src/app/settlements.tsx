import React, { useCallback, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { CourierSettlement, money as moneyApi, showRip } from '../lib/money';
import { money, when } from '../lib/orders';
import { photoBlob, pickPhoto } from '../lib/photos';
import { color, font, radius, space } from '../lib/theme';
import { Button, Field, Notice, Screen, T } from '../ui/kit';
import type { Key } from '../i18n';

const REF = /^[A-Za-z0-9 \-/.]{4,40}$/;

// "Sellers' money" for couriers (contract: list_settlements, mark_settlement_sent): after each cash-on-delivery delivery the
// courier sends the goods money straight to the seller within 24 hours, by BaridiMob (reference + receipt photo) or by hand.
export default function Settlements() {
  const { t, lang, services } = useApp();
  const api = moneyApi(services.client);
  const [data, setData] = useState<{ to_send_da: number; waiting_confirmation_da: number; settlements: CourierSettlement[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null), [ref, setRef] = useState(''), [photo, setPhoto] = useState<{ uri: string; id?: string; busy?: boolean } | null>(null);
  const load = useCallback(() => { api.settlements().then(setData).catch(e => { const m = errorMessage(e); setMsg(t(m.key, m.vars)); }); }, [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(load);
  const fail = (e: unknown) => { const m = errorMessage(e); setMsg(t(m.key, m.vars)); };
  const open = (id: string) => { setSending(id); setRef(''); setPhoto(null); setMsg(null); };
  async function takePhoto() {
    const p = await pickPhoto('camera').catch(() => null);
    if (p === 'denied') { setMsg(t('photo_denied')); return; }
    if (!p) return;
    setPhoto({ uri: p.uri, busy: true });
    try { setPhoto({ uri: p.uri, id: await api.receiptPhoto(await photoBlob(p.uri)) }); } catch (e) { setPhoto(null); fail(e); }
  }
  async function sendBm(x: CourierSettlement) {
    if (!REF.test(ref.trim())) { setMsg(t('settle_ref_invalid')); return; }
    if (!photo?.id) { setMsg(t('settle_receipt_needed')); return; }
    setBusy(true); setMsg(null);
    try { await api.markSent(x.order_id, { method: 'baridimob', reference: ref.trim(), receipt_photo: photo.id }); setSending(null); load(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const sendCash = (x: CourierSettlement) => Alert.alert(t('settle_send_cash'), t('settle_cash_q', { p: money(x.amount_da) }), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('confirm'), onPress: async () => { setBusy(true); try { await api.markSent(x.order_id, { method: 'cash' }); load(); } catch (e) { fail(e); } finally { setBusy(false); } } }]);
  return (
    <Screen testID="screen-settlements" title={t('settle_title')}>
      <T kind="muted">{t('settle_explain')}</T>
      {data ? (<>
        <View style={s.totals}>
          <T style={[s.big, data.to_send_da > 0 && { color: color.amber }]} testID="settle-to-send">{t('settle_to_send', { p: money(data.to_send_da) })}</T>
          <T kind="muted">{t('settle_waiting', { p: money(data.waiting_confirmation_da) })}</T>
        </View>
        {msg && !sending ? <Notice warn text={msg} testID="settle-msg" /> : null}
        {!data.settlements.length ? <Notice testID="settle-empty" text={t('no_settlements')} /> : null}
        {data.settlements.map(x => {
          const todo = x.status === 'pending' || x.status === 'disputed';
          return (
            <View key={x.order_id} style={[s.card, (x.overdue || x.status === 'disputed') && { borderColor: color.danger }]} testID={'settle-' + x.ref}>
              <View style={s.head}><T style={s.amount}>{money(x.amount_da)} {t('da')}</T><T kind="muted">{x.ref}</T></View>
              <T testID={'settle-status-' + x.ref} style={{ color: x.overdue || x.status === 'disputed' ? color.amber : color.text }}>
                {x.status === 'pending' ? (x.overdue ? '⚠ ' + t('settle_overdue') : t('settle_due', { t: when(x.due_at, lang) })) : t(('st_' + x.status) as Key)}
              </T>
              {x.status === 'disputed' && x.dispute_note ? <T kind="muted">{t('settle_seller_says', { note: x.dispute_note })}</T> : null}
              {todo ? (<View style={s.account}>
                <T style={s.holder}>{t('settle_to', { holder: x.seller_holder })}</T>
                <T selectable style={s.rip} testID={'settle-rip-' + x.ref}>{showRip(x.seller_rip)}</T>
                <T kind="muted">{x.seller_name}{x.seller_phone ? ' · ' + x.seller_phone : ''}</T>
              </View>) : null}
              {todo ? (sending === x.order_id ? (<>
                <Field testID="settle-ref" label={t('settle_reference')} value={ref} onChangeText={setRef} maxLength={40} autoCapitalize="characters" />
                {photo?.uri ? <Image source={{ uri: photo.uri }} style={s.thumb} accessibilityIgnoresInvertColors /> : null}
                <Button testID="settle-photo" kind="secondary" icon="camera" busy={photo?.busy} label={photo?.id ? '✓ ' + t('settle_receipt_take') : t('settle_receipt_take')} onPress={takePhoto} />
                {msg ? <Notice warn text={msg} testID="settle-msg" /> : null}
                <Button testID="settle-send" busy={busy} label={t('settle_send')} onPress={() => sendBm(x)} />
                <Button kind="plain" label={t('cancel')} onPress={() => setSending(null)} />
              </>) : (<>
                <Button testID={'send-bm-' + x.ref} label={t('settle_send_bm')} onPress={() => open(x.order_id)} />
                <Button testID={'send-cash-' + x.ref} kind="secondary" busy={busy} label={t('settle_send_cash')} onPress={() => sendCash(x)} />
              </>)) : x.method ? <T kind="muted">{x.method === 'cash' ? t('sale_method_cash') : t('sale_method_baridimob', { r: x.reference ?? '' })}</T> : null}
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
  account: { backgroundColor: color.card2, borderRadius: radius, padding: space(3), gap: 2 },
  holder: { fontFamily: font.semibold },
  rip: { fontFamily: font.bold, fontSize: 20, letterSpacing: 1, writingDirection: 'ltr' },
  thumb: { width: '100%', height: 200, borderRadius: radius },
});
