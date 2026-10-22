import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { idempotencyKey, ApiError } from '../core/api';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { Address, km, minutes, money, orders, Quote, RecipientHistory, Size } from '../lib/orders';
import { toInternational } from '../lib/phone';
import { addRecent } from '../lib/recent';
import { color, font, radius, space } from '../lib/theme';
import { AppMap } from '../ui/AppMap';
import { Sheet } from '../ui/Sheet';
import { MapOverlay, Button, Field, Gap, Notice, RoundButton, T } from '../ui/kit';
import { Choice } from '../ui/Choice';
import { Icon, IconName } from '../ui/Icon';
import { PayoutFields, usePayoutForm } from '../ui/PayoutFields';

const SIZES: { v: Size; icon: IconName }[] = [{ v: 'small', icon: 'mail' }, { v: 'medium', icon: 'package' }, { v: 'large', icon: 'archive' }];

// The route preview and the request (inDrive-style): the map shows A -> B, the panel holds the parcel size, the fare with
// minus/plus, the receiver, the address details, payment, and "auto-accept". Once sent, couriers are
// searched at once (contract B: get_quote, create_order).
export default function OrderDetails() {
  const [mapTouch, setMapTouch] = useState(false);   // a finger is moving the map: floating buttons step aside
  const { t, rtl, services } = useApp();
  const api = orders(services.client);
  const prm = useLocalSearchParams<{ plat: string; plng: string; dlat: string; dlng: string; pname?: string; dname?: string; daddr?: string; rname?: string; rphone?: string }>();
  const pickup = { lat: Number(prm.plat), lng: Number(prm.plng) }, dropoff = { lat: Number(prm.dlat), lng: Number(prm.dlng) };
  const savedAddr = (() => { try { return prm.daddr ? JSON.parse(prm.daddr) as Address : null; } catch { return null; } })();
  const [pa, setPa] = useState<Address>({ street: prm.pname || undefined }), [da, setDa] = useState<Address>(savedAddr ?? { street: prm.dname || undefined });
  const [rName, setRName] = useState(prm.rname ?? ''), [rPhone, setRPhone] = useState(prm.rphone ?? '');
  const [size, setSize] = useState<Size>('small');
  const [payer, setPayer] = useState<'sender' | 'recipient'>('sender');
  const [cod, setCod] = useState('');
  const payout = usePayoutForm();   // cash on delivery: where the courier sends the seller's money
  const codOn = /^\d+$/.test(cod.trim()) && Number(cod.trim()) > 0;
  const [inspection, setInspection] = useState<'outside' | 'open'>('outside');
  const [auto, setAuto] = useState(false);
  const [hist, setHist] = useState<RecipientHistory | null>(null);
  useEffect(() => {
    const ph = toInternational(rPhone); setHist(null); if (!ph) return;
    const h = setTimeout(() => { api.recipientHistory(ph).then(setHist).catch(() => {}); }, 600);
    return () => clearTimeout(h);
  }, [rPhone]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [quote, setQuote] = useState<Quote | null>(null), [quoting, setQuoting] = useState(false);
  const [price, setPrice] = useState(0);
  const [errs, setErrs] = useState<Record<string, string | null>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(idempotencyKey()).current;   // one key for this one order: a retry can never create a second order
  const err = (e: unknown) => { const m = errorMessage(e); return t(m.key, m.vars); };

  async function getQuote(s: Size) {
    setQuoting(true); setMsg(null);
    try { const q = await api.quote(pickup, dropoff, s); setQuote(q); setPrice(q.recommended_da); return q; }
    catch (e) { setQuote(null); setMsg(err(e)); return null; }
    finally { setQuoting(false); }
  }
  useEffect(() => { getQuote(size); }, [size]);   // eslint-disable-line react-hooks/exhaustive-deps

  function validate() {
    const e: Record<string, string | null> = {};
    if (!pa.street?.trim() && !pa.landmark?.trim()) e.pa = t('address_needed');
    if (!da.street?.trim() && !da.landmark?.trim()) e.da = t('address_needed');
    if (rName.trim().length < 2 || rName.trim().length > 60) e.rName = t('recipient_invalid');
    if (!toInternational(rPhone)) e.rPhone = t('phone_invalid');
    if (cod.trim() && !/^\d{1,9}$/.test(cod.trim())) e.cod = t('cod_invalid');
    else if (codOn && Number(cod.trim()) > 30000) e.cod = t('err_cod_too_high');
    setErrs(e);
    const payoutOk = !codOn || payout.validate(t);
    return Object.values(e).every(v => !v) && payoutOk;
  }

  async function submit() {
    if (!validate()) { setMsg(t('fill_missing')); return; }
    if (!quote) return;
    setBusy(true); setMsg(null);
    const body = (q: Quote) => ({ auto_accept: auto, quote_id: q.quote_id, offered_da: Math.min(q.max_da, Math.max(q.min_da, price)), pickup_address: pa, dropoff_address: da, recipient_name: rName.trim(), recipient_phone: toInternational(rPhone)!, payer, cod_amount_da: cod.trim() ? Number(cod.trim()) : 0, inspection });
    try {
      if (codOn) await payout.save();   // saved (or unchanged) before the order, which copies it
      const o = await api.create(key, body(quote));
      await addRecent(services.store, { name: da.street || da.landmark || prm.dname || o.ref, lat: dropoff.lat, lng: dropoff.lng, address: da, recipient_name: rName.trim(), recipient_phone: rPhone });
      router.dismissAll(); router.push({ pathname: '/order/[id]', params: { id: o.id } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'QUOTE_EXPIRED') { await getQuote(size); setMsg(t('err_quote_expired')); }   // the person confirms the new price
      else setMsg(err(e));
    } finally { setBusy(false); }
  }

  const step = 10, canDown = !!quote && price - step >= quote.min_da, canUp = !!quote && price + step <= quote.max_da;
  const footer = (
    <View>
      {msg ? <Notice testID="order-msg" warn text={msg} /> : null}
      <Button testID="confirm-order" busy={busy} disabled={quoting || !quote} label={quote ? t('request_delivery', { p: money(price) }) : t('continue')}
        onPress={submit} />
    </View>
  );
  return (
    <View style={s.root} testID="screen-order-details">
      <View style={s.mapBox}>
        <AppMap onTouching={setMapTouch} start={pickup} zoom={13} route={quote?.route ?? null} fit={[pickup, dropoff]} pad={{ top: 130, bottom: Dimensions.get('window').height * 0.62 }}
          pins={[{ id: 'A', at: pickup, kind: 'pickup', label: t('pickup') }, { id: 'B', at: dropoff, kind: 'dropoff', label: t('dropoff') }]} />
        <MapOverlay hidden={mapTouch} style={s.top}>
          <View style={[s.summary, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <RoundButton icon="arrow-left" label={t('back')} onPress={() => router.back()} size={44} light testID="back" />
            <View style={{ flex: 1, gap: 2 }}>
              <T numberOfLines={1} style={s.sumLine}>📦 {pa.street || pa.landmark || t('pickup')}</T>
              <T numberOfLines={1} style={s.sumLine}>🏁 {da.street || da.landmark || t('dropoff')}</T>
            </View>
            {quote ? (
              <View style={s.distBox} testID="route-distance" accessibilityLabel={t('distance_a11y', { km: km(quote.distance_m), min: minutes(quote.duration_s) })}>
                <T style={s.distKm}>{quote.distance_estimated ? '≈ ' : ''}{km(quote.distance_m)} {t('km')}</T>
                <T kind="muted" style={{ fontSize: 13 }}>~{minutes(quote.duration_s)} {t('min')}</T>
              </View>
            ) : null}
          </View>
        </MapOverlay>
      </View>
      <Sheet hidden={mapTouch} maxFraction={0.62} footer={footer} testID="details-sheet">
        <View style={[s.sizes, { flexDirection: rtl ? 'row-reverse' : 'row' }]} accessibilityRole="radiogroup">
          {SIZES.map(z => {
            const on = z.v === size;
            return (
              <Pressable key={z.v} testID={'size-' + z.v} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={t(`size_${z.v}`)} onPress={() => setSize(z.v)} style={[s.size, on && s.sizeOn]}>
                <Icon name={z.icon} size={26} tint={on ? color.lime : color.muted} />
                <T style={[s.sizeText, on && { color: color.lime }]}>{on ? '✓ ' : ''}{t(`size_${z.v}`)}</T>
                <T kind="muted" style={{ fontSize: 12, textAlign: 'center' }}>{t(z.v === 'large' ? 'by_car' : 'by_motorbike')}</T>
              </Pressable>
            );
          })}
        </View>
        <T kind="muted" style={{ marginTop: space(1) }}>{t(`size_${size}_sub`)}</T>

        {quoting || quote ? <View style={s.fare} testID="price-box">
          {quoting && !quote ? <T kind="muted">{t('quote_loading')}</T> : quote ? (<>
            <View style={[s.fareRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              <RoundButton testID="price-down" icon="minus" label={t('price_down')} disabled={!canDown} onPress={() => setPrice(price - step)} light />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <T style={s.fareText} testID="price">{money(price)} {t('da')}</T>
                <T kind="muted">{price === quote.recommended_da ? t('fare_recommended') : t('fare_yours')}</T>
              </View>
              <RoundButton testID="price-up" icon="plus" label={t('price_up')} disabled={!canUp} onPress={() => setPrice(price + step)} light />
            </View>
            <T kind="muted" testID="trip-info" style={{ textAlign: 'center' }}>{t(quote.vehicle === 'car' ? 'by_car' : 'by_motorbike')} · {t(quote.distance_estimated ? 'trip_info_est' : 'trip_info', { km: km(quote.distance_m), min: minutes(quote.duration_s) })} · {t('price_range', { min: money(quote.min_da), max: money(quote.max_da) })}</T>
          </>) : null}
        </View> : null}

        {quote ? <View style={[s.autoRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          <Icon name="zap" tint={color.lime} />
          <T style={{ flex: 1 }}>{t('auto_accept', { p: money(price) })}</T>
          <Switch testID="auto-accept" value={auto} onValueChange={setAuto} trackColor={{ true: color.lime, false: color.card2 }} thumbColor={color.pureWhite} accessibilityLabel={t('auto_accept', { p: money(price) })} />
        </View> : null}

        <Gap n={2} />
        <T kind="label">{t('recipient_title')}</T>
        <Field testID="r-name" label={t('recipient_name')} value={rName} onChangeText={setRName} error={errs.rName} maxLength={60} autoComplete="name" />
        <Field testID="r-phone" label={t('recipient_phone')} hint={t('phone_hint')} value={rPhone} onChangeText={setRPhone} error={errs.rPhone} keyboardType="phone-pad" maxLength={18} />
        {hist ? <Notice testID="r-history" warn={hist.refused > 0} text={hist.delivered + hist.refused + hist.no_answer === 0 ? t('rhist_none') : t('rhist_line', { d: hist.delivered, r: hist.refused, n: hist.no_answer })} /> : null}

        <Gap n={2} />
        <T kind="label">📦 {t('pickup')}</T>
        <Field testID="pa-street" label={t('street')} value={pa.street ?? ''} onChangeText={v => setPa({ ...pa, street: v })} error={errs.pa} maxLength={200} />
        <Field testID="pa-landmark" label={t('landmark')} value={pa.landmark ?? ''} onChangeText={v => setPa({ ...pa, landmark: v })} maxLength={200} />
        <Field testID="pa-building" label={t('building')} value={pa.building ?? ''} onChangeText={v => setPa({ ...pa, building: v })} maxLength={200} />

        <Gap n={2} />
        <T kind="label">🏁 {t('dropoff')}</T>
        <Field testID="da-street" label={t('street')} value={da.street ?? ''} onChangeText={v => setDa({ ...da, street: v })} error={errs.da} maxLength={200} />
        <Field testID="da-landmark" label={t('landmark')} value={da.landmark ?? ''} onChangeText={v => setDa({ ...da, landmark: v })} maxLength={200} />
        <Field testID="da-building" label={t('building')} value={da.building ?? ''} onChangeText={v => setDa({ ...da, building: v })} maxLength={200} />
        <Field testID="da-notes" label={t('notes_driver')} value={da.notes ?? ''} onChangeText={v => setDa({ ...da, notes: v })} maxLength={200} />

        <Gap n={2} />
        <T kind="label">{t('payer_label')}</T>
        <Choice testID="payer" value={payer} onChange={setPayer} options={[{ v: 'sender', label: t('payer_sender') }, { v: 'recipient', label: t('payer_recipient') }]} />
        <Field testID="cod" label={t('cod_label')} hint={t('cod_hint')} value={cod} onChangeText={v => setCod(v.replace(/[^\d]/g, ''))} error={errs.cod} keyboardType="number-pad" maxLength={9} />
        {codOn && payout.saved !== undefined && (!payout.saved || payout.changed) ? <PayoutFields form={payout} intro={t('payout_needed_cod')} /> : null}
        {codOn && payout.saved && !payout.changed ? <T kind="muted" testID="cod-payout">{t('payout_title')}: {payout.holder} · {payout.rip}</T> : null}
        <T kind="label">{t('inspection_label')}</T>
        <Choice testID="inspection" value={inspection} onChange={setInspection} options={[{ v: 'outside', label: t('insp_outside'), sub: t('insp_outside_sub') }, { v: 'open', label: t('insp_open'), sub: t('insp_open_sub') }]} />
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.page },
  mapBox: { flex: 1, minHeight: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  summary: { margin: space(3), backgroundColor: color.card, borderRadius: 20, padding: space(3), alignItems: 'center', gap: space(3) },
  sumLine: { fontFamily: font.semibold, fontSize: 15 },
  distBox: { alignItems: 'center', backgroundColor: color.card2, borderRadius: radius, paddingHorizontal: space(3), paddingVertical: space(1) },
  distKm: { fontFamily: font.bold, fontSize: 18, lineHeight: 26 },
  sizes: { gap: space(2) },
  size: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: color.card2, borderRadius: radius, paddingVertical: space(3), borderWidth: 2, borderColor: 'transparent' },
  sizeOn: { borderColor: color.lime },
  sizeText: { fontFamily: font.bold, textAlign: 'center' },
  fare: { backgroundColor: color.card2, borderRadius: 20, padding: space(3), marginTop: space(3), minHeight: 96, justifyContent: 'center' },
  fareRow: { alignItems: 'center', gap: space(2) },
  fareText: { fontFamily: font.bold, fontSize: 30, lineHeight: 42, textAlign: 'center' },
  autoRow: { alignItems: 'center', gap: space(3), paddingVertical: space(3) },
});
