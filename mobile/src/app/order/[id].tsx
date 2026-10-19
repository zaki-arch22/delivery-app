import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useApp, useNotices } from '../../lib/app';
import { errorMessage } from '../../lib/errors';
import { ACTIVE, addressLine, money, Order, orders } from '../../lib/orders';
import { color, font, radius, space } from '../../lib/theme';
import { AppMap, Pin } from '../../ui/AppMap';
import { Button, Gap, Notice, Screen, T } from '../../ui/kit';
import type { Key } from '../../i18n';

const POLL_MS = 4000;   // driver position and status, until live location sharing exists (contract B)

// One order, from "looking for a driver" to "delivered" (contract B: get_order, raise_price, cancel_order).
export default function OrderScreen() {
  const { t, services } = useApp();
  const api = orders(services.client);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fail = (e: unknown) => { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); };

  const load = useCallback(() => api.get(id).then(setO).catch(() => {}), [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useNotices(n => { if (n.order_id === id) load(); });
  useEffect(() => { if (!o || !ACTIVE.includes(o.status)) return; const h = setInterval(load, POLL_MS); return () => clearInterval(h); }, [o?.status, load]);

  async function run(k: string, f: () => Promise<Order>) { setBusy(k); setMsg(null); try { setO(await f()); } catch (e) { fail(e); load(); } finally { setBusy(null); } }
  const raise = (n: number) => o && run('raise' + n, () => api.raise(o.id, Math.min(o.max_da, o.offered_da + n)));
  const cancel = () => Alert.alert(t('cancel_confirm'), t('cancel_sub'), [
    { text: t('keep'), style: 'cancel' },
    { text: t('cancel_order'), style: 'destructive', onPress: () => o && run('cancel', () => api.cancel(o.id, 'user_cancelled')) },
  ]);

  if (!o) return <Screen testID="screen-order"><Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} /></Screen>;
  const price = o.locked_da ?? o.offered_da;
  const pins: Pin[] = [{ id: 'A', at: { lat: o.pickup_lat, lng: o.pickup_lng }, kind: 'pickup', label: t('pickup') }, { id: 'B', at: { lat: o.dropoff_lat, lng: o.dropoff_lng }, kind: 'dropoff', label: t('dropoff') }];
  if (o.driver?.location) pins.push({ id: 'driver', at: o.driver.location, kind: 'driver', label: t('driver') });
  const raises = [50, 100].filter(n => o.offered_da < o.max_da && n > 0);

  return (
    <Screen testID="screen-order">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.canGoBack() ? router.back() : router.replace('/home')} />
      <T kind="muted">{t('order_ref', { ref: o.ref })}{o.leg === 'return' ? ' · ' + t('return_leg') : ''}</T>
      <T kind="title" testID="order-status">{t(('st_' + o.status) as Key)}</T>
      {o.status === 'searching' ? <T kind="muted">{t('st_searching_sub')}</T> : null}
      {o.status === 'failed' ? <Notice warn text={t('st_failed_sub')} /> : null}
      {o.status === 'expired' ? <T kind="muted">{t('st_expired_sub')}</T> : null}

      <View style={s.mapBox}><AppMap start={{ lat: o.pickup_lat, lng: o.pickup_lng }} zoom={13} pins={pins} /></View>

      <View style={s.box}>
        <T kind="label" testID="order-price">{t(o.locked_da ? 'price_locked' : 'price_now', { p: money(price) })}</T>
        {o.payer === 'recipient' ? <T kind="muted">{t('fee_by_recipient')}</T> : null}
        {o.cod_amount_da > 0 ? <T kind="muted">{t('cod_collect', { p: money(o.cod_amount_da) })}</T> : null}
        {o.status === 'searching' && raises.length ? (
          <View style={s.row}>
            {raises.map(n => <Button key={n} testID={'raise-' + n} kind="secondary" busy={busy === 'raise' + n} label={t('raise_by', { n: Math.min(n, o.max_da - o.offered_da) })} onPress={() => raise(n)} />)}
          </View>
        ) : null}
      </View>

      {o.driver ? (
        <View style={s.box} testID="driver-card">
          <T kind="label">{t('driver')}</T>
          <T>{o.driver.name} · {t(o.driver.vehicle === 'car' ? 'by_car' : 'by_motorbike')}</T>
          <T kind="muted">{o.driver.rating ? `★ ${o.driver.rating}` : t('no_rating')}</T>
        </View>
      ) : null}

      {['searching', 'assigned', 'picked_up'].includes(o.status) && o.leg === 'delivery' ? (
        <View style={[s.box, s.codeBox]} testID="code-box">
          <T kind="label">{t('dcode_title')}</T>
          <T style={s.code} testID="delivery-code" accessibilityLabel={o.delivery_code.split('').join(' ')}>{o.delivery_code}</T>
          <T kind="muted">{t('dcode_sub')}</T>
        </View>
      ) : null}

      <View style={s.box}>
        <T>A · {addressLine(o.pickup_address)}</T>
        <T>B · {o.recipient_name} · {addressLine(o.dropoff_address)}</T>
      </View>

      {msg ? <Notice testID="order-msg" warn={msg.warn} text={msg.text} /> : null}
      {o.status === 'delivered' && o.leg === 'delivery' ? (o.rated ? <Notice text={t('rated_thanks')} /> : <Button testID="rate" label={t('rate_driver')} onPress={() => router.push({ pathname: '/rate/[id]', params: { id: o.id } })} />) : null}
      {['expired', 'cancelled'].includes(o.status) ? <Button testID="send-again" label={t('send_again')} onPress={() => router.replace('/new-order')} /> : null}
      {['searching', 'assigned'].includes(o.status) ? <Button testID="cancel-order" kind="danger" busy={busy === 'cancel'} label={t('cancel_order')} onPress={cancel} /> : null}
      {!['searching', 'expired', 'cancelled'].includes(o.status) ? <Button testID="report-problem" kind="plain" label={t('report_problem')} onPress={() => router.push({ pathname: '/problem/[id]', params: { id: o.id } })} /> : null}
      <Gap />
    </Screen>
  );
}
const s = StyleSheet.create({
  mapBox: { height: 220, borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: color.border, marginVertical: space(3) },
  box: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5) },
  row: { flexDirection: 'row', gap: space(3), flexWrap: 'wrap' },
  codeBox: { backgroundColor: color.soft, borderColor: color.primary },
  code: { fontFamily: font.bold, fontSize: 40, lineHeight: 56, letterSpacing: 8, color: color.navy, textAlign: 'center', writingDirection: 'ltr' },
});
