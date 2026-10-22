import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { money as moneyApi, showRip, Wallet as W, WalletEntry } from '../lib/money';
import { money, when } from '../lib/orders';
import { photoBlob, pickPhoto } from '../lib/photos';
import { color, font, radius, space } from '../lib/theme';
import { Button, Field, Notice, Row, Screen, T } from '../ui/kit';

const REF = /^[A-Za-z0-9 \-/.]{4,40}$/;

// The courier's prepaid wallet (contract: get_wallet, request_topup): the platform's commission is taken from it after each
// delivery; it is topped up by a BaridiMob transfer to the platform's account, checked by our team. Also shows the goods money
// held and the cash limit (which grows with deliveries).
export default function Wallet() {
  const { t, lang, services } = useApp();
  const api = moneyApi(services.client);
  const [w, setW] = useState<W | null>(null), [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [topping, setTopping] = useState(false), [amount, setAmount] = useState(''), [ref, setRef] = useState(''), [photo, setPhoto] = useState<{ uri: string; id?: string; busy?: boolean } | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.wallet().then(setW).catch(e => { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); }); }, [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(load);
  const fail = (e: unknown) => { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); };
  async function takePhoto() {
    const p = await pickPhoto('camera').catch(() => null);
    if (p === 'denied') { setMsg({ text: t('photo_denied'), warn: true }); return; }
    if (!p) return;
    setPhoto({ uri: p.uri, busy: true });
    try { setPhoto({ uri: p.uri, id: await api.receiptPhoto(await photoBlob(p.uri)) }); } catch (e) { setPhoto(null); fail(e); }
  }
  async function send() {
    const n = Number(amount);
    if (!/^\d+$/.test(amount) || n < 100 || n > 200000) { setMsg({ text: t('wallet_amount_invalid'), warn: true }); return; }
    if (!REF.test(ref.trim())) { setMsg({ text: t('settle_ref_invalid'), warn: true }); return; }
    if (!photo?.id) { setMsg({ text: t('settle_receipt_needed'), warn: true }); return; }
    setBusy(true); setMsg(null);
    try { setW(await api.topup(n, ref, photo.id)); setTopping(false); setAmount(''); setRef(''); setPhoto(null); setMsg({ text: t('wallet_topup_sent') }); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const label = (e: WalletEntry) => e.type === 'commission' ? t('wallet_commission', { ref: e.ref ?? '' }) : e.type === 'topup' ? t('wallet_topup_entry') : t('wallet_adjust') + (e.note ? ' · ' + e.note : '');
  return (
    <Screen testID="screen-wallet" title={t('wallet_title')}>
      {w ? (<>
        <View style={s.totals}>
          <T style={[s.big, w.balance_da < 0 && { color: color.amber }]} testID="wallet-balance">{t('wallet_balance', { p: money(w.balance_da) })}</T>
          {w.active ? <T kind="muted">{t('wallet_explain', { c: w.commission_percent ?? 10 })}</T> : <T kind="muted" testID="wallet-off">{t('wallet_off')}</T>}
          {w.balance_da < 0 ? <T style={{ color: color.amber }}>{t('wallet_low', { p: money(-w.balance_da), c: money(w.credit_da) })}</T> : null}
        </View>
        <Row icon="briefcase" label={t('wallet_cash', { p: money(w.cash_held_da), l: w.cash_limit_da == null ? '0' : money(w.cash_limit_da) })} onPress={() => router.push('/cash')} testID="wallet-cash" />
        <Row icon="send" label={t('menu_settlements')} onPress={() => router.push('/settlements')} testID="wallet-settlements" />
        {w.platform_account ? (<View style={s.account}>
          <T kind="label">{t('wallet_platform')}</T>
          <T style={s.holder}>{w.platform_account.holder_name}</T>
          <T selectable style={s.rip} testID="platform-rip">{showRip(w.platform_account.rip)}</T>
        </View>) : null}
        {msg ? <Notice testID="wallet-msg" warn={msg.warn} text={msg.text} /> : null}
        {w.active ? (topping ? (<>
          <Field testID="topup-amount" label={t('wallet_amount')} value={amount} onChangeText={v => setAmount(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
          <Field testID="topup-ref" label={t('settle_reference')} value={ref} onChangeText={setRef} maxLength={40} autoCapitalize="characters" />
          {photo?.uri ? <Image source={{ uri: photo.uri }} style={s.thumb} accessibilityIgnoresInvertColors /> : null}
          <Button testID="topup-photo" kind="secondary" icon="camera" busy={photo?.busy} label={photo?.id ? '✓ ' + t('settle_receipt_take') : t('settle_receipt_take')} onPress={takePhoto} />
          <Button testID="topup-send" busy={busy} label={t('wallet_topup_send')} onPress={send} />
          <Button kind="plain" label={t('cancel')} onPress={() => setTopping(false)} />
        </>) : <Button testID="topup-open" icon="plus" label={t('wallet_topup')} onPress={() => { setMsg(null); setTopping(true); }} />) : null}
        {w.topups.map(x => (
          <T key={'t' + x.id} testID={'topup-' + x.id} kind="muted" style={x.status === 'rejected' ? { color: color.amber } : undefined}>
            {x.status === 'pending' ? t('topup_pending', { p: money(x.amount_da) }) : x.status === 'approved' ? t('topup_approved', { p: money(x.amount_da) }) : t('topup_rejected', { p: money(x.amount_da), r: x.reason ?? '' })} · {when(x.created_at, lang)}
          </T>))}
        <T kind="label" style={{ marginTop: space(4) }}>{t('wallet_history')}</T>
        {!w.entries.length ? <Notice testID="wallet-empty" text={t('no_wallet_entries')} /> : null}
        {w.entries.map(e => (
          <View key={e.id} style={s.row} testID={'wallet-' + e.id}>
            <View style={{ flex: 1 }}><T>{label(e)}</T><T kind="muted">{when(e.created_at, lang)}</T></View>
            <T style={s.amount}>{e.amount_da > 0 ? '+' : '−'}{money(Math.abs(e.amount_da))} {t('da')}</T>
          </View>))}
      </>) : msg ? <Notice warn text={msg.text} /> : null}
    </Screen>
  );
}
const s = StyleSheet.create({
  totals: { backgroundColor: color.card, borderRadius: 20, padding: space(4), marginVertical: space(3), gap: space(1) },
  big: { fontFamily: font.bold, fontSize: 26, lineHeight: 38 },
  account: { backgroundColor: color.card2, borderRadius: radius, padding: space(3), gap: 2, marginVertical: space(2) },
  holder: { fontFamily: font.semibold },
  rip: { fontFamily: font.bold, fontSize: 20, letterSpacing: 1, writingDirection: 'ltr' },
  thumb: { width: '100%', height: 200, borderRadius: radius },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: color.card, borderRadius: radius, borderWidth: 1, borderColor: color.line, padding: space(4), marginVertical: space(1.5) },
  amount: { fontFamily: font.bold, writingDirection: 'ltr' },
});
