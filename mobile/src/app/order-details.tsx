import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { idempotencyKey, ApiError } from '../core/api';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { Address, km, minutes, money, orders, Quote, RecipientHistory, Size } from '../lib/orders';
import { toInternational } from '../lib/phone';
import { color, font, radius, space } from '../lib/theme';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';
import { Choice } from '../ui/Choice';

// Step 2 of a new order: address details, recipient, size, who pays, cash on delivery, and the price (contract B: get_quote, create_order).
export default function OrderDetails() {
  const { t, services } = useApp();
  const api = orders(services.client);
  const prm = useLocalSearchParams<{ plat: string; plng: string; dlat: string; dlng: string }>();
  const pickup = { lat: Number(prm.plat), lng: Number(prm.plng) }, dropoff = { lat: Number(prm.dlat), lng: Number(prm.dlng) };
  const [pa, setPa] = useState<Address>({}), [da, setDa] = useState<Address>({});
  const [rName, setRName] = useState(''), [rPhone, setRPhone] = useState('');
  const [size, setSize] = useState<Size | null>(null);
  const [payer, setPayer] = useState<'sender' | 'recipient'>('sender');
  const [cod, setCod] = useState('');
  const [inspection, setInspection] = useState<'outside' | 'open'>('outside');
  // How earlier parcels to this receiver number ended (counts only): shown once the number is complete.
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
  useEffect(() => { if (size) getQuote(size); }, [size]);   // eslint-disable-line react-hooks/exhaustive-deps

  function validate() {
    const e: Record<string, string | null> = {};
    if (!pa.street?.trim() && !pa.landmark?.trim()) e.pa = t('address_needed');
    if (!da.street?.trim() && !da.landmark?.trim()) e.da = t('address_needed');
    if (rName.trim().length < 2 || rName.trim().length > 60) e.rName = t('recipient_invalid');
    if (!toInternational(rPhone)) e.rPhone = t('phone_invalid');
    if (cod.trim() && !/^\d{1,9}$/.test(cod.trim())) e.cod = t('cod_invalid');
    if (!size) e.size = t('choose_size');
    setErrs(e);
    return Object.values(e).every(v => !v);
  }

  async function submit() {
    if (!validate() || !quote) { if (!quote && size) setMsg(t('choose_size')); return; }
    setBusy(true); setMsg(null);
    const body = (q: Quote) => ({ quote_id: q.quote_id, offered_da: Math.min(q.max_da, Math.max(q.min_da, price)), pickup_address: pa, dropoff_address: da, recipient_name: rName.trim(), recipient_phone: toInternational(rPhone)!, payer, cod_amount_da: cod.trim() ? Number(cod.trim()) : 0, inspection });
    try {
      const o = await api.create(key, body(quote));
      router.dismissAll(); router.push({ pathname: '/order/[id]', params: { id: o.id } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'QUOTE_EXPIRED') { await getQuote(size!); setMsg(t('err_quote_expired')); }   // the person confirms the new price
      else setMsg(err(e));
    } finally { setBusy(false); }
  }

  const step = 10, canDown = !!quote && price - step >= quote.min_da, canUp = !!quote && price + step <= quote.max_da;
  return (
    <Screen testID="screen-order-details">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('details_title')}</T>

      <Section letter="A" title={t('pickup')}>
        <Field testID="pa-street" label={t('street')} value={pa.street ?? ''} onChangeText={v => setPa({ ...pa, street: v })} error={errs.pa} maxLength={200} />
        <Field testID="pa-landmark" label={t('landmark')} value={pa.landmark ?? ''} onChangeText={v => setPa({ ...pa, landmark: v })} maxLength={200} />
        <Field testID="pa-building" label={t('building')} value={pa.building ?? ''} onChangeText={v => setPa({ ...pa, building: v })} maxLength={200} />
      </Section>

      <Section letter="B" title={t('dropoff')}>
        <Field testID="da-street" label={t('street')} value={da.street ?? ''} onChangeText={v => setDa({ ...da, street: v })} error={errs.da} maxLength={200} />
        <Field testID="da-landmark" label={t('landmark')} value={da.landmark ?? ''} onChangeText={v => setDa({ ...da, landmark: v })} maxLength={200} />
        <Field testID="da-building" label={t('building')} value={da.building ?? ''} onChangeText={v => setDa({ ...da, building: v })} maxLength={200} />
        <Field testID="da-notes" label={t('notes_driver')} value={da.notes ?? ''} onChangeText={v => setDa({ ...da, notes: v })} maxLength={200} />
        <Field testID="r-name" label={t('recipient_name')} value={rName} onChangeText={setRName} error={errs.rName} maxLength={60} autoComplete="name" />
        <Field testID="r-phone" label={t('recipient_phone')} hint={t('phone_hint')} value={rPhone} onChangeText={setRPhone} error={errs.rPhone} keyboardType="phone-pad" maxLength={18} />
        {hist ? <Notice testID="r-history" warn={hist.refused > 0} text={hist.delivered + hist.refused + hist.no_answer === 0 ? t('rhist_none') : t('rhist_line', { d: hist.delivered, r: hist.refused, n: hist.no_answer })} /> : null}
      </Section>

      <T kind="label">{t('size_label')}</T>
      <Choice testID="size" value={size} onChange={v => { setSize(v); setErrs({ ...errs, size: null }); }} options={(['small', 'medium', 'large'] as Size[]).map(v => ({ v, label: t(`size_${v}`), sub: t(`size_${v}_sub`) }))} />
      {errs.size ? <T kind="error">⚠ {errs.size}</T> : null}
      <Gap n={3} />
      <T kind="label">{t('payer_label')}</T>
      <Choice testID="payer" value={payer} onChange={setPayer} options={[{ v: 'sender', label: t('payer_sender') }, { v: 'recipient', label: t('payer_recipient') }]} />
      <T kind="label">{t('inspection_label')}</T>
      <Choice testID="inspection" value={inspection} onChange={setInspection} options={[{ v: 'outside', label: t('insp_outside'), sub: t('insp_outside_sub') }, { v: 'open', label: t('insp_open'), sub: t('insp_open_sub') }]} />
      <Field testID="cod" label={t('cod_label')} hint={t('cod_hint')} value={cod} onChangeText={v => setCod(v.replace(/[^\d]/g, ''))} error={errs.cod} keyboardType="number-pad" maxLength={9} />

      {quoting ? <Notice text={t('quote_loading')} /> : null}
      {quote ? (
        <View style={s.price} testID="price-box">
          <T kind="label">{t('price_title')}</T>
          <T kind="muted" testID="trip-info">{t(quote.vehicle === 'car' ? 'by_car' : 'by_motorbike')} · {t(quote.distance_estimated ? 'trip_info_est' : 'trip_info', { km: km(quote.distance_m), min: minutes(quote.duration_s) })}</T>
          <View style={s.priceRow}>
            <Button testID="price-down" kind="secondary" label="−10" a11y={t('price_down')} disabled={!canDown} onPress={() => setPrice(price - step)} />
            <T style={s.priceText} testID="price">{money(price)} {t('da')}</T>
            <Button testID="price-up" kind="secondary" label="+10" a11y={t('price_up')} disabled={!canUp} onPress={() => setPrice(price + step)} />
          </View>
          <T kind="muted">{t('price_recommended', { p: money(quote.recommended_da) })}</T>
          <T kind="muted">{t('price_range', { min: money(quote.min_da), max: money(quote.max_da) })}</T>
        </View>
      ) : null}
      {msg ? <Notice testID="order-msg" warn text={msg} /> : null}
      <Button testID="confirm-order" label={quote ? t('confirm_order', { p: money(price) }) : t('continue')} busy={busy} disabled={quoting} onPress={submit} />
    </Screen>
  );
}

function Section({ letter, title, children }: { letter: string; title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}><View style={[s.badge, letter === 'B' && { backgroundColor: color.navy }]}><T style={s.badgeText}>{letter}</T></View><T kind="label">{title}</T></View>
      {children}
    </View>
  );
}
const s = StyleSheet.create({
  section: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(3) },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: color.white, fontFamily: font.bold, textAlign: 'center' },
  price: { backgroundColor: color.soft, borderRadius: radius, padding: space(4), marginVertical: space(3) },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
  priceText: { fontFamily: font.bold, fontSize: 28, lineHeight: 40, color: color.navy, textAlign: 'center', flex: 1 },
});
