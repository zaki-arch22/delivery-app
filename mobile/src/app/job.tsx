import React, { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ApiError } from '../core/api';
import { useApp, useNotices } from '../lib/app';
import { driver, Job } from '../lib/driver';
import { errorMessage } from '../lib/errors';
import { addressLine, money } from '../lib/orders';
import { color, font, radius, space } from '../lib/theme';
import { AppMap } from '../ui/AppMap';
import { Choice } from '../ui/Choice';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';

type Reason = 'no_answer' | 'refused' | 'wrong_address';

// The driver's active delivery (contract C: get_job, update_job_step, report_delivery_failure).
export default function JobScreen() {
  const { t, services } = useApp();
  const api = driver(services.client);
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [done, setDone] = useState<Job | null>(null);
  const [code, setCode] = useState(''), [cashOk, setCashOk] = useState(false);
  const [failing, setFailing] = useState(false), [reason, setReason] = useState<Reason | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const load = useCallback(() => api.job().then(setJob).catch(() => {}), [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useNotices(n => { if (n.kind === 'job.cancelled') { setCancelled(true); load(); } else if (n.kind === 'job.updated') load(); });

  const err = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'CODE_WRONG') return t('err_code_wrong_driver');
    if (e instanceof ApiError && e.code === 'CODE_LOCKED') return t('err_code_locked');
    const m = errorMessage(e); return t(m.key, m.vars);
  };
  async function run(k: string, f: () => Promise<void>) { setBusy(k); setMsg(null); try { await f(); } catch (e) { setMsg({ text: err(e), warn: true }); } finally { setBusy(null); } }

  const pickedUp = () => job && run('pickup', async () => { setJob((await api.pickedUp(job.id)).job); });
  const deliver = () => job && run('deliver', async () => {
    if (!/^\d{4}$/.test(code)) { setMsg({ text: t('code_4'), warn: true }); return; }
    if (job.cash_to_collect_da > 0 && !cashOk) { setMsg({ text: t('cash_confirm_needed'), warn: true }); return; }
    await api.delivered(job.id, code, job.cash_to_collect_da);
    setDone(job); setJob(null); setCode(''); setCashOk(false);
  });
  const fail = () => job && reason && run('fail', async () => {
    const ret = await api.fail(job.id, reason);
    setFailing(false); setReason(null); setCode(''); setJob(ret);   // the return leg back to the sender (or nothing, for a failed return)
  });
  const call = (phone: string) => Linking.openURL('tel:' + phone).catch(() => {});
  const maps = (lat: number, lng: number) => Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}` : `geo:${lat},${lng}?q=${lat},${lng}`).catch(() => {});

  if (job === undefined) return <Screen testID="screen-job"><Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} /></Screen>;
  if (!job) return (
    <Screen testID="screen-job">
      {done ? (<>
        <T kind="title" testID="job-done">{t('job_delivered')}</T>
        {done.leg === 'delivery' ? <Button testID="rate-sender" kind="secondary" label={t('rate_sender')} onPress={() => router.push({ pathname: '/rate/[id]', params: { id: done.id } })} /> : null}
      </>) : <Notice testID="job-none" warn={cancelled} text={cancelled ? t('job_cancelled') : t('no_active_job')} />}
      <Button testID="back-home" label={t('back_home')} onPress={() => router.replace('/home')} />
    </Screen>
  );

  const toPickup = job.status === 'assigned';
  const target = toPickup ? { lat: job.pickup_lat, lng: job.pickup_lng } : { lat: job.dropoff_lat, lng: job.dropoff_lng };
  const who = toPickup ? { name: job.sender_name, phone: job.sender_phone } : { name: job.recipient_name, phone: job.recipient_phone };
  const addr = toPickup ? job.pickup_address : job.dropoff_address;
  return (
    <Screen testID="screen-job">
      <Button kind="plain" label={'‹ ' + t('back_home')} onPress={() => router.replace('/home')} />
      <T kind="muted">{job.ref}</T>
      <T kind="title" testID="job-step">{t(job.leg === 'return' ? 'job_return' : toPickup ? 'job_to_pickup' : 'job_to_dropoff')}</T>
      <View style={s.mapBox}>
        <AppMap start={target} zoom={14} pins={[{ id: 'A', at: { lat: job.pickup_lat, lng: job.pickup_lng }, kind: 'pickup', label: t('pickup') }, { id: 'B', at: { lat: job.dropoff_lat, lng: job.dropoff_lng }, kind: 'dropoff', label: t('dropoff') }]} />
      </View>
      <View style={s.box}>
        <T kind="label">{toPickup ? 'A' : 'B'} · {who.name}</T>
        <T testID="job-address">{addressLine(addr)}</T>
        {addr.notes ? <T kind="muted">{addr.notes}</T> : null}
        <View style={s.row}>
          <Button testID="call" kind="secondary" label={'☎ ' + t('call', { name: who.name })} onPress={() => call(who.phone)} />
          <Button testID="open-maps" kind="plain" label={t('open_maps')} onPress={() => maps(target.lat, target.lng)} />
        </View>
      </View>

      {toPickup ? <Button testID="picked-up" busy={busy === 'pickup'} label={t('picked_up_btn')} onPress={pickedUp} /> : (<>
        {job.cash_to_collect_da > 0 ? (
          <Pressable testID="cash-confirm" accessibilityRole="checkbox" accessibilityState={{ checked: cashOk }} onPress={() => setCashOk(!cashOk)} style={[s.cash, cashOk && s.cashOk]}>
            <T style={s.cashText}>⚠ {t('collect_now', { p: money(job.cash_to_collect_da) })}</T>
            <T kind="label">{cashOk ? '☑' : '☐'} {t('cash_confirm', { p: money(job.cash_to_collect_da) })}</T>
          </Pressable>
        ) : null}
        <Field testID="code-input" label={t(job.leg === 'return' ? 'enter_code_return' : 'enter_code')} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} />
        <Button testID="delivered" busy={busy === 'deliver'} label={t('delivered_btn')} onPress={deliver} />
        {failing ? (<>
          <T kind="label">{t('fail_title')}</T>
          <Choice testID="fail" value={reason} onChange={setReason} options={(['no_answer', 'refused', 'wrong_address'] as Reason[]).map(v => ({ v, label: t(`fail_${v}`) }))} />
          <Button testID="fail-confirm" kind="danger" busy={busy === 'fail'} disabled={!reason} label={t('fail_confirm')} onPress={fail} />
        </>) : <Button testID="cant-deliver" kind="plain" label={t('cant_deliver')} onPress={() => setFailing(true)} />}
      </>)}
      {msg ? <Notice testID="job-msg" warn={msg.warn} text={msg.text} /> : null}
      <Gap />
    </Screen>
  );
}
const s = StyleSheet.create({
  mapBox: { height: 200, borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: color.border, marginVertical: space(3) },
  box: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5) },
  row: { flexDirection: 'row', gap: space(3), flexWrap: 'wrap', alignItems: 'center' },
  cash: { backgroundColor: '#FEF3C7', borderWidth: 2, borderColor: color.amber, borderRadius: radius, padding: space(4), marginVertical: space(2) },
  cashOk: { borderColor: color.primary },
  cashText: { fontFamily: font.bold, fontSize: 20, lineHeight: 30 },
});
