import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Dimensions, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useApp, useNotices } from '../../lib/app';
import { errorMessage } from '../../lib/errors';
import { ACTIVE, addressLine, Bid, km, minutes, money, Order, orders, RecallReason, when, whatsappUrl } from '../../lib/orders';
import { deliveryQr, pickupQr } from '../../lib/proof';
import { Nearby, people } from '../../lib/people';
import { Qr } from '../../ui/Qr';
import { Choice } from '../../ui/Choice';
import { color, font, radius, space } from '../../lib/theme';
import { AppMap, Pin } from '../../ui/AppMap';
import { Sheet } from '../../ui/Sheet';
import { MapOverlay, Button, Card, Gap, Notice, RoundButton, Screen, T } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import type { Key } from '../../i18n';

const POLL_MS = 4000;   // status and the courier's position while active; live notifications refresh at once in between

const NEARBY_MS = 10_000;   // couriers around the pickup are refreshed this often while searching

// One order, from "waiting for the receiver" to "delivered" (contract B). The map shows A, B, the route and the courier;
// the panel follows the order's state; while couriers answer, their offers appear on top for the customer to choose.
export default function OrderScreen() {
  const [mapTouch, setMapTouch] = useState(false);   // a finger is moving the map: floating buttons step aside
  const { t, services, lang, rtl } = useApp();
  const api = orders(services.client);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [want, setWant] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [recalling, setRecalling] = useState(false), [recallReason, setRecallReason] = useState<RecallReason | null>(null);
  const fail = (e: unknown) => { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); };
  const [near, setNear] = useState<Nearby | null>(null);   // couriers around the pickup while searching (cars on the map)

  const load = useCallback(() => api.get(id).then(x => { setO(x); setWant(w => (w > x.offered_da ? w : x.offered_da)); }).catch(() => {}), [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useNotices(n => { if (n.order_id === id) load(); });
  useEffect(() => { if (!o || !ACTIVE.includes(o.status)) return; const h = setInterval(load, POLL_MS); return () => clearInterval(h); }, [o?.status, load]);
  useEffect(() => { if (!o || o.status !== 'searching') return; const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, [o?.status]);
  useEffect(() => {
    if (!o || o.status !== 'searching') { setNear(null); return; }
    const at = { lat: o.pickup_lat, lng: o.pickup_lng };
    const get = () => people(services.client).nearby(at).then(setNear).catch(() => {});
    get(); const h = setInterval(get, NEARBY_MS); return () => clearInterval(h);
  }, [o?.status, o?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function run(k: string, f: () => Promise<Order>) { setBusy(k); setMsg(null); try { const x = await f(); setO(x); setWant(x.offered_da); } catch (e) { fail(e); load(); } finally { setBusy(null); } }
  const cancel = () => Alert.alert(t('cancel_confirm'), t('cancel_sub'), [
    { text: t('keep'), style: 'cancel' },
    { text: t('cancel_order'), style: 'destructive', onPress: () => o && run('cancel', () => api.cancel(o.id, 'user_cancelled')) },
  ]);
  const recall = () => o && recallReason && run('recall', () => api.recall(o.id, recallReason)).then(() => setRecalling(false));
  const trackUrl = o?.tracking_token ? `${services.client.baseUrl}/t/${o.tracking_token}` : null;
  const shareText = o && trackUrl ? t('share_message', { name: o.recipient_name, url: trackUrl }) : '';
  const share = () => { if (shareText) Share.share({ message: shareText }).catch(() => {}); };
  const whatsapp = () => { if (o && shareText) Linking.openURL(whatsappUrl(o.recipient_phone, shareText)).catch(share); };
  const photoSrc = (doc: string) => ({ uri: `${services.client.baseUrl}/get_order_photo?order_id=${o!.id}&id=${doc}`, headers: { Authorization: 'Bearer ' + (services.client.token ?? '') } });

  if (!o) return <Screen testID="screen-order" title="" />;
  const A = { lat: o.pickup_lat, lng: o.pickup_lng }, B = { lat: o.dropoff_lat, lng: o.dropoff_lng };
  const pins: Pin[] = [{ id: 'A', at: A, kind: 'pickup', label: t('pickup') }, { id: 'B', at: B, kind: 'dropoff', label: t('dropoff') }];
  if (o.driver?.location) pins.push({ id: 'driver', at: o.driver.location, kind: 'driver', label: t('driver'), vehicle: o.driver.vehicle });
  // While searching the map centres on the pickup (the pulse around it, like inDrive); afterwards it shows the trip.
  const fit = o.status === 'searching' ? [A] : o.driver?.location && ['assigned', 'picked_up'].includes(o.status) ? [o.driver.location, o.status === 'assigned' ? A : B] : [A, B];
  const H = Dimensions.get('window').height;
  const left = (iso: string | null) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000)) : 0);
  const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const price = o.locked_da ?? o.offered_da;
  const showBids = o.status === 'searching' && o.bids.length > 0;
  // While searching: the map stays centred on the pickup and zooms out slowly (zoom 16 down to 12 over the whole search,
  // fastest at the start), the pulse keeps growing, and the map cannot be moved by hand (owner's wish, like inDrive).
  const searching = o.status === 'searching';
  const searchShare = searching && o.search_ends_at ? Math.min(1, Math.max(0, (now - new Date(o.search_started_at).getTime()) / Math.max(1, new Date(o.search_ends_at).getTime() - new Date(o.search_started_at).getTime()))) : 0;

  return (
    <View style={s.root} testID="screen-order">
      <AppMap onTouching={setMapTouch} start={A} zoom={13} pins={pins} route={o.route} fit={fit} nearby={near?.couriers ?? []}
        pulse={searching ? { at: A, grow: searchShare } : null} follow={searching ? { center: A, zoom: 16 - 4 * Math.sqrt(searchShare) } : null} pad={{ top: showBids ? H * 0.5 : 110, bottom: H * 0.5 }} />
      <MapOverlay hidden={mapTouch} style={s.top}>
        <View style={[s.topRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          <RoundButton testID="back" icon="arrow-left" label={t('back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />
          <View style={s.refChip}><T style={s.refText}>{o.ref}{o.leg === 'return' ? ' · ' + t('return_leg') : ''}</T></View>
        </View>
        {showBids ? <Offers bids={o.bids} now={now} busy={busy} onAccept={b => run('acc' + b.offer_id, () => api.acceptBid(o.id, b.offer_id))} onDecline={b => run('dec' + b.offer_id, () => api.declineBid(o.id, b.offer_id))} /> : null}
      </MapOverlay>

      <Sheet hidden={mapTouch} testID="order-sheet" maxFraction={showBids ? 0.3 : 0.6} peek={170}>
        <T kind="title" testID="order-status" style={{ fontSize: 24 }}>{t(('st_' + o.status) as Key, { name: o.recipient_name })}</T>


        {o.status === 'searching' ? (<>
          <View style={[s.timerRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <T kind="muted" style={{ flex: 1 }} testID="couriers-told">{o.couriers_notified ? t('couriers_told', { n: o.couriers_notified }) : t('st_searching_sub')}</T>
            <T style={s.clock} testID="timer">{clock(left(o.search_ends_at))}</T>
          </View>
          <Progress value={left(o.search_ends_at) / 600} />
          <View style={[s.fareRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <RoundButton testID="want-down" icon="minus" label={t('price_down')} light disabled={want - 10 < o.offered_da || want <= o.offered_da} onPress={() => setWant(Math.max(o.offered_da, want - 10))} />
            <View style={{ flex: 1, alignItems: 'center' }}><T style={s.fare} testID="order-price">{money(want)} {t('da')}</T><T kind="muted">{t('your_offer')}</T></View>
            <RoundButton testID="want-up" icon="plus" label={t('price_up')} light disabled={want + 10 > o.max_da} onPress={() => setWant(Math.min(o.max_da, want + 10))} />
          </View>
          <Button testID="raise" kind="secondary" busy={busy === 'raise'} disabled={want <= o.offered_da} label={want > o.offered_da ? t('raise_to', { p: money(want) }) : t('raise_hint')} onPress={() => run('raise', () => api.raise(o.id, want))} />
          <AutoAccept o={o} busy={busy === 'auto'} onChange={v => run('auto', () => api.setAutoAccept(o.id, v))} t={t} rtl={rtl} />
        </>) : null}

        {['assigned', 'picked_up'].includes(o.status) && o.driver ? (
          <Card testID="driver-card" style={{ backgroundColor: color.card2 }}>
            <Pressable testID="driver-profile" accessibilityRole="button" accessibilityLabel={t('see_profile') + ': ' + o.driver.name}
              onPress={() => router.push({ pathname: '/public-profile', params: { order_id: o.id } })} style={[s.drvRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              <View style={s.avatar}><T style={s.avatarText}>{o.driver.name.charAt(0).toUpperCase()}</T></View>
              <View style={{ flex: 1 }}>
                <T style={s.strong}>{o.driver.name}</T>
                <T kind="muted">{o.driver.rating ? `★ ${o.driver.rating}` : t('no_rating')} · {t('deliveries_n', { n: o.driver.deliveries })} · {t(o.driver.vehicle === 'car' ? 'by_car' : 'by_motorbike')}</T>
              </View>
              <Icon name={rtl ? 'chevron-left' : 'chevron-right'} tint={color.muted} />
            </Pressable>
            {o.eta_s != null ? <T style={s.eta} testID="eta">{t(o.status === 'assigned' ? 'eta_pickup_then' : 'eta_arrive', { m: minutes(o.eta_s) })}{o.eta_estimated ? ' ' + t('estimate') : ''}</T> : null}
          </Card>
        ) : null}

        {o.status === 'failed' ? <Notice warn text={t('st_failed_sub')} /> : null}
        {o.status === 'expired' ? <T kind="muted">{t('st_expired_sub')}</T> : null}

        {o.status === 'assigned' && o.pickup_code ? (
          <Card testID="pickup-box" style={s.codeBox}>
            <T kind="label">{t('pickup_code_title')}</T>
            <T style={s.code} testID="pickup-code" accessibilityLabel={o.pickup_code.split('').join(' ')}>{o.pickup_code}</T>
            <Qr value={pickupQr(o.ref, o.pickup_code)} size={180} testID="pickup-qr" />
            <T kind="muted">{t('pickup_code_sub')}</T>
          </Card>
        ) : null}

        {['searching', 'assigned', 'picked_up'].includes(o.status) ? (
          <Card testID="code-box" style={s.codeBox}>
            <T kind="label">{t('dcode_title')}</T>
            <T style={s.code} testID="delivery-code" accessibilityLabel={o.delivery_code.split('').join(' ')}>{o.delivery_code}</T>
            {o.leg === 'return' ? <Qr value={deliveryQr(o.ref, o.delivery_code)} size={180} testID="return-qr" /> : null}
            <T kind="muted">{t(o.leg === 'return' ? 'dcode_sub_return' : 'dcode_sub')}</T>
            {trackUrl && o.leg === 'delivery' ? (<>
              <Button testID="share-whatsapp" icon="message-circle" label={t('share_whatsapp', { name: o.recipient_name })} onPress={whatsapp} />
              <Button testID="share-tracking" kind="secondary" icon="share-2" label={t('share_other')} onPress={share} />
            </>) : null}
            {o.recipient_expecting_at ? <Notice testID="expecting" text={'✓ ' + t('expecting_yes')} /> : null}
          </Card>
        ) : null}

        <Card style={{ backgroundColor: color.card2 }}>
          <T testID="order-price-line" style={s.strong}>{t(o.locked_da ? 'price_locked' : 'price_now', { p: money(price) })}</T>
          <T kind="muted" testID="order-distance">{km(o.distance_m)} {t('km')} · ~{minutes(o.duration_s)} {t('min')}</T>
          {o.payer === 'recipient' ? <T kind="muted">{t('fee_by_recipient')}</T> : null}
          {o.cod_amount_da > 0 ? <T kind="muted">💵 {t('cod_collect', { p: money(o.cod_amount_da) })}</T> : null}
          <Gap n={2} />
          <T>📦 {addressLine(o.pickup_address)}</T>
          <T>🏁 {o.recipient_name} · {addressLine(o.dropoff_address)}</T>
        </Card>

        {o.pickup_photo_doc || o.evidence_photos.length ? (
          <Card testID="photos" style={{ backgroundColor: color.card2 }}>
            {o.pickup_photo_doc ? (<><T kind="label">{t('parcel_photo_title')}</T><Image testID="parcel-photo" source={photoSrc(o.pickup_photo_doc)} style={s.photo} resizeMode="contain" accessibilityLabel={t('parcel_photo_title')} /></>) : null}
            {o.evidence_photos.map(d => <View key={d}><T kind="label">{t('evidence_title')}</T><Image source={photoSrc(d)} style={s.photo} resizeMode="contain" accessibilityLabel={t('evidence_title')} /></View>)}
          </Card>
        ) : null}

        {msg ? <Notice testID="order-msg" warn={msg.warn} text={msg.text} /> : null}
        {o.status === 'picked_up' && o.leg === 'delivery' ? (recalling ? (<>
          <T kind="label">{t('recall_title')}</T>
          <Choice testID="recall" value={recallReason} onChange={setRecallReason} options={(['buyer_cancelled', 'wrong_parcel', 'wrong_address', 'other'] as RecallReason[]).map(v => ({ v, label: t(`recall_${v}`) }))} />
          <Button testID="recall-confirm" kind="danger" busy={busy === 'recall'} disabled={!recallReason} label={t('recall_confirm')} onPress={recall} />
        </>) : <Button testID="recall" kind="plain" label={t('recall_btn')} onPress={() => setRecalling(true)} />) : null}
        {o.status === 'delivered' && o.leg === 'delivery' ? (o.rated ? <Notice text={t('rated_thanks')} /> : <Button testID="rate" label={t('rate_driver')} onPress={() => router.push({ pathname: '/rate/[id]', params: { id: o.id } })} />) : null}
        {['expired', 'cancelled'].includes(o.status) ? <Button testID="send-again" label={t('send_again')} onPress={() => router.replace('/home')} /> : null}
        {['searching', 'assigned'].includes(o.status) ? <Button testID="cancel-order" kind="danger" icon="x" busy={busy === 'cancel'} label={t(o.status === 'assigned' ? 'cancel_order' : 'cancel_request')} onPress={cancel} /> : null}
        {!['searching', 'expired', 'cancelled'].includes(o.status) ? <Button testID="report-problem" kind="plain" label={t('report_problem')} onPress={() => router.push({ pathname: '/problem/[id]', params: { id: o.id } })} /> : null}

        <View testID="history" style={{ marginTop: space(3) }}>
          <T kind="label">{t('history_title')}</T>
          {o.history.map((e, i) => <T key={i} kind="muted">{when(e.at, lang)} · {historyText(e, t, money)}</T>)}
        </View>
      </Sheet>
    </View>
  );
}

function AutoAccept({ o, busy, onChange, t, rtl }: { o: Order; busy: boolean; onChange: (v: boolean) => void; t: (k: Key, v?: Record<string, string | number>) => string; rtl: boolean }) {
  return (
    <View style={[s.autoRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <Icon name="zap" tint={color.lime} />
      <T style={{ flex: 1 }}>{t('auto_accept', { p: money(o.offered_da) })}</T>
      <Switch testID="auto-accept" disabled={busy} value={o.auto_accept} onValueChange={onChange} trackColor={{ true: color.lime, false: color.card2 }} thumbColor={color.pureWhite} accessibilityLabel={t('auto_accept', { p: money(o.offered_da) })} />
    </View>
  );
}

function Progress({ value }: { value: number }) {
  return <View style={s.bar}><View style={[s.barFill, { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }]} /></View>;
}

// Couriers' offers, cheapest first (inDrive's "choose a driver"): price and time to arrive first, then who, then Decline/Accept.
function Offers({ bids, now, busy, onAccept, onDecline }: { bids: Bid[]; now: number; busy: string | null; onAccept: (b: Bid) => void; onDecline: (b: Bid) => void }) {
  const { t, rtl } = useApp();
  return (
    <View style={s.offers} testID="offers">
      <T style={s.offersTitle}>{t('choose_courier')}</T>
      <ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.5 }}>
        {bids.map(b => {
          const sec = Math.max(0, Math.round((new Date(b.expires_at).getTime() - now) / 1000));
          return (
            <View key={b.offer_id} style={s.offer} testID={'offer-' + b.offer_id}>
              <View style={[s.offerTop, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                <T style={s.offerPrice}>{money(b.price_da)} {t('da')}</T>
                {b.eta_s != null ? <T style={s.offerEta}>{t('min_n', { n: minutes(b.eta_s) })}</T> : null}
              </View>
              <Pressable testID={'courier-' + b.offer_id} accessibilityRole="button" accessibilityLabel={t('see_profile') + ': ' + b.driver.name}
                onPress={() => router.push({ pathname: '/public-profile', params: { offer_id: String(b.offer_id) } })} style={[s.drvRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                <View style={s.avatar}><T style={s.avatarText}>{b.driver.name.charAt(0).toUpperCase()}</T></View>
                <View style={{ flex: 1 }}>
                  <T style={s.strong}>{b.driver.name} {b.driver.rating ? `★ ${b.driver.rating}` : ''}</T>
                  <T kind="muted">{t('deliveries_n', { n: b.driver.deliveries })} · {t(b.driver.vehicle === 'car' ? 'by_car' : 'by_motorbike')}</T>
                </View>
                <Icon name={rtl ? 'chevron-left' : 'chevron-right'} tint={color.muted} />
              </Pressable>
              <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.round((sec / 40) * 100))}%` }]} /></View>
              <View style={[s.offerBtns, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                <Button testID={'decline-' + b.offer_id} kind="secondary" style={{ flex: 1 }} busy={busy === 'dec' + b.offer_id} label={t('decline')} onPress={() => onDecline(b)} />
                <Button testID={'accept-' + b.offer_id} style={{ flex: 1 }} busy={busy === 'acc' + b.offer_id} label={t('accept')} onPress={() => onAccept(b)} />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// One line of the order's history, in plain words (reasons and distances included: nothing is hidden from the sender).
function historyText(e: { type: string; data: any }, t: (k: Key, v?: Record<string, string | number>) => string, m: (n: number) => string) {
  const base = t(('h_' + e.type) as Key);
  const d = e.data ?? {};
  if (d.reason && ['delivery_failed', 'released_by_driver', 'recalled_by_sender'].includes(e.type)) {
    const k = (e.type === 'delivery_failed' ? 'fail_' : e.type === 'released_by_driver' ? 'release_' : 'recall_') + d.reason;
    return `${base}: ${t(k as Key)}`;
  }
  if (e.type === 'bid_made' && d.price_da) return `${base}: ${m(d.price_da)} ${t('da')}`;
  if (e.type === 'flag_far_away') return t('h_flag_far_away', { m: d.distance_m });
  if (e.type === 'cancelled' && d.late) return `${base} (${t('late')})`;
  return base;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.page },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: { alignItems: 'center', gap: space(3), padding: space(4) },
  refChip: { backgroundColor: color.card, borderRadius: 999, paddingHorizontal: space(4), paddingVertical: space(2) },
  refText: { fontFamily: font.semibold, fontSize: 14 },
  timerRow: { alignItems: 'center', gap: space(2) },
  clock: { fontFamily: font.bold, fontSize: 22 },
  bar: { height: 5, borderRadius: 3, backgroundColor: color.card2, overflow: 'hidden', marginVertical: space(2) },
  barFill: { height: 5, backgroundColor: color.pureWhite },
  fareRow: { alignItems: 'center', gap: space(2), backgroundColor: color.card2, borderRadius: 20, padding: space(3), marginTop: space(2) },
  fare: { fontFamily: font.bold, fontSize: 28, lineHeight: 40, textAlign: 'center' },
  autoRow: { alignItems: 'center', gap: space(3), paddingVertical: space(3) },
  drvRow: { alignItems: 'center', gap: space(3) },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.lime, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: color.ink, fontFamily: font.bold, fontSize: 20, textAlign: 'center' },
  strong: { fontFamily: font.semibold },
  eta: { fontFamily: font.bold, fontSize: 20, color: color.lime, marginTop: space(2) },
  codeBox: { backgroundColor: color.card2, borderWidth: 2, borderColor: color.lime },
  code: { fontFamily: font.bold, fontSize: 40, lineHeight: 56, letterSpacing: 8, color: color.lime, textAlign: 'center', writingDirection: 'ltr' },
  photo: { width: '100%', height: 220, borderRadius: radius, marginVertical: space(2), backgroundColor: color.card },
  offers: { marginHorizontal: space(3) },
  offersTitle: { fontFamily: font.bold, fontSize: 24, lineHeight: 34, marginBottom: space(2), textShadowColor: '#000', textShadowRadius: 6 },
  offer: { backgroundColor: color.card, borderRadius: 24, padding: space(4), marginBottom: space(3), elevation: 8 },
  offerTop: { alignItems: 'baseline', gap: space(3) },
  offerPrice: { fontFamily: font.bold, fontSize: 30, lineHeight: 42 },
  offerEta: { fontFamily: font.bold, fontSize: 22, color: color.muted },
  offerBtns: { gap: space(3) },
});
