import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ApiError } from '../core/api';
import { useApp, useNotices } from '../lib/app';
import { driver, FAIL_REASONS, FailReason, Job, NEEDS_EVIDENCE, RELEASE_REASONS, ReleaseReason } from '../lib/driver';
import { currentPosition } from '../lib/location';
import { photoBlob, pickPhoto } from '../lib/photos';
import { readQr } from '../lib/proof';
import { QrScanner } from '../ui/QrScanner';
import { errorMessage } from '../lib/errors';
import { addressLine, money } from '../lib/orders';
import { color, font, radius, space } from '../lib/theme';
import { AppMap } from '../ui/AppMap';
import { Choice } from '../ui/Choice';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';

// The driver's active delivery (contract C: get_job, update_job_step, report_delivery_failure, release_job).
// Every handover is proved (TRUST_AND_SAFETY.md): at pickup the SENDER's code (or QR) + a photo of the parcel, at the door the
// RECEIVER's code (or QR); the phone's position is sent with each step.
export default function JobScreen() {
  const { t, services } = useApp();
  const api = driver(services.client);
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [done, setDone] = useState<Job | null>(null);
  const [code, setCode] = useState(''), [cashOk, setCashOk] = useState(false);
  const [failing, setFailing] = useState(false), [reason, setReason] = useState<FailReason | null>(null), [evidence, setEvidence] = useState<string | null>(null);
  const [pickupCode, setPickupCode] = useState(''), [parcel, setParcel] = useState<string | null>(null), [method, setMethod] = useState<'code' | 'qr'>('code');
  const [scan, setScan] = useState<null | 'PCK1' | 'DLV1'>(null);
  const [sos, setSos] = useState(false);
  const [releasing, setReleasing] = useState(false), [relReason, setRelReason] = useState<ReleaseReason | null>(null), [released, setReleased] = useState(false);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [unsent, setUnsent] = useState(false);   // a step is saved on the phone, waiting for network

  // The server's view of the job, plus any step saved on the phone that has not reached the server yet.
  const load = useCallback(async () => {
    try {
      const j = await api.job();
      const waiting = j ? await services.queue.pending(j.id) : [];
      setUnsent(waiting.length > 0);
      if (j && waiting.some(w => w.step === 'delivered')) { setDone(j); setJob(null); return; }
      if (j && j.status === 'assigned' && waiting.some(w => w.step === 'picked_up')) { setJob({ ...j, status: 'picked_up', next_step: 'delivered' }); return; }
      setJob(j);
    } catch { /* no network: keep what is shown */ }
  }, [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => services.queue.onEvent(e => {
    services.queue.pending().then(p => setUnsent(p.length > 0));
    if (!e.sent) setMsg({ text: t('step_sync_failed', { err: err(e.error) }), warn: true });
  }) as unknown as () => void, [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useNotices(n => { if (n.kind === 'job.cancelled') { setCancelled(true); load(); } else if (n.kind === 'job.updated') load(); });

  const err = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'CODE_WRONG') return t('err_code_wrong_driver');
    if (e instanceof ApiError && e.code === 'CODE_LOCKED') return t('err_code_locked');
    if (e instanceof ApiError && e.code === 'PICKUP_CODE_WRONG') return t('err_pickup_wrong');
    if (e instanceof ApiError && e.code === 'PICKUP_LOCKED') return t('err_pickup_locked');
    const m = errorMessage(e); return t(m.key, m.vars);
  };
  async function run(k: string, f: () => Promise<void>) { setBusy(k); setMsg(null); try { await f(); } catch (e) { setMsg({ text: err(e), warn: true }); } finally { setBusy(null); } }
  // A job step: sent at once when there is network; without network it is saved on the phone and sent later.
  type Item = { step: 'picked_up' | 'delivered'; location: { lat: number; lng: number }; delivery_code?: string; cash_collected_da?: number; method?: 'code' | 'qr'; pickup_code?: string; parcel_photo?: string; photo_uri?: string };
  async function step(item: Item | (() => Item), sent: () => Promise<void>, offline: () => void) {
    try { await sent(); }
    catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) throw e;
      if (await services.queue.send({ order_id: job!.id, ...(typeof item === 'function' ? item() : item) })) { await load(); return; }
      setUnsent(true); offline(); setMsg({ text: t('step_saved_offline') });
    }
  }

  // Where the phone is right now: required for pickup and delivery (proof of place). Works without network.
  async function here() { const p = await currentPosition(); if (!p) setMsg({ text: t('location_needed_step'), warn: true }); return p; }
  async function photo(set: (uri: string) => void) {
    const r = await pickPhoto('camera');
    if (r === 'denied') setMsg({ text: t('camera_needed'), warn: true }); else if (r) set(r.uri);
  }
  function scanned(data: string) {
    const kind = scan; setScan(null); if (!job || !kind) return;
    const r = readQr(data, kind, job.ref);
    if ('error' in r) { setMsg({ text: t(r.error === 'other_order' ? 'qr_other_order' : 'qr_wrong_kind'), warn: true }); return; }
    if (kind === 'PCK1') setPickupCode(r.code); else { setCode(r.code); setMethod('qr'); }
    setMsg({ text: t('qr_read') });
  }

  const pickedUp = () => job && run('pickup', async () => {
    if (job.needs_pickup_code && !/^\d{4}$/.test(pickupCode)) { setMsg({ text: t('pickup_code_4'), warn: true }); return; }
    if (!parcel) { setMsg({ text: t('photo_needed'), warn: true }); return; }
    const loc = await here(); if (!loc) return;
    let photoId: string | undefined;
    await step(() => ({ step: 'picked_up', location: loc, pickup_code: pickupCode, parcel_photo: photoId, photo_uri: parcel }), async () => {
      photoId = await api.photo('parcel_photo', await photoBlob(parcel));
      setJob((await api.pickedUp(job.id, pickupCode, photoId, loc)).job);
    }, () => setJob({ ...job, status: 'picked_up', next_step: 'delivered' }));
    setParcel(null); setPickupCode('');
  });
  const deliver = () => job && run('deliver', async () => {
    if (!/^\d{4}$/.test(code)) { setMsg({ text: t('code_4'), warn: true }); return; }
    if (job.cash_to_collect_da > 0 && !cashOk) { setMsg({ text: t('cash_confirm_needed'), warn: true }); return; }
    const loc = await here(); if (!loc) return;
    const finish = () => { setDone(job); setJob(null); setCode(''); setCashOk(false); setMethod('code'); };
    await step({ step: 'delivered', location: loc, delivery_code: code, cash_collected_da: job.cash_to_collect_da, method }, async () => { await api.delivered(job.id, code, job.cash_to_collect_da, loc, method); finish(); }, finish);
  });
  const fail = () => job && reason && run('fail', async () => {
    if (NEEDS_EVIDENCE.includes(reason) && !evidence) { setMsg({ text: t('evidence_needed'), warn: true }); return; }
    const evidenceId = evidence ? await api.photo('evidence_photo', await photoBlob(evidence)) : undefined;
    const ret = await api.fail(job.id, reason, { evidence_photo: evidenceId, location: await currentPosition() });
    setFailing(false); setReason(null); setEvidence(null); setCode(''); setJob(ret);   // the return leg back to the sender (or nothing, for a failed return)
  });
  const release = () => job && relReason && run('release', async () => {
    if (relReason === 'unsafe_or_prohibited' && !evidence) { setMsg({ text: t('evidence_needed'), warn: true }); return; }
    const evidenceId = evidence ? await api.photo('evidence_photo', await photoBlob(evidence)) : undefined;
    await api.release(job.id, relReason, { evidence_photo: evidenceId });
    setReleasing(false); setRelReason(null); setEvidence(null); setReleased(true); setJob(null);
  });
  const call = (phone: string) => Linking.openURL('tel:' + phone).catch(() => {});
  // Emergency: our team is alerted at once with the position; the public numbers are one tap away (17 police, 14 civil protection, 1055 gendarmerie).
  const alertTeam = () => job && run('sos', async () => {
    await services.client.call('/emergency', { order_id: job.id, location: await currentPosition() });
    setMsg({ text: t('sos_sent') });
  });
  const maps = (lat: number, lng: number) => Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}` : `geo:${lat},${lng}?q=${lat},${lng}`).catch(() => {});

  if (job === undefined) return <Screen testID="screen-job"><Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} /></Screen>;
  if (!job) return (
    <Screen testID="screen-job">
      {done ? (<>
        <T kind="title" testID="job-done">{t('job_delivered')}</T>
        {unsent ? <Notice testID="unsent" text={t('sync_pending')} /> : null}
        {msg ? <Notice testID="job-msg" warn={msg.warn} text={msg.text} /> : null}
        {done.leg === 'delivery' ? <Button testID="rate-sender" kind="secondary" label={t('rate_sender')} onPress={() => router.push({ pathname: '/rate/[id]', params: { id: done.id } })} /> : null}
      </>) : <Notice testID="job-none" warn={cancelled} text={released ? t('job_released') : cancelled ? t('job_cancelled') : t('no_active_job')} />}
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
      {unsent ? <Notice testID="unsent" text={t('sync_pending')} /> : null}
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

      {toPickup ? (<>
        <View style={s.box} testID="pickup-proof">
          <T kind="label">{t('pickup_proof_title')}</T>
          <T kind="muted">{t('pickup_steps')}</T>
          {job.needs_pickup_code ? (<>
            <Button testID="scan-pickup" kind="secondary" label={'▣ ' + t('scan_pickup_qr')} onPress={() => setScan('PCK1')} />
            <Field testID="pickup-code-input" label={t('pickup_code_label')} value={pickupCode} onChangeText={v => setPickupCode(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} />
          </>) : null}
          <Button testID="parcel-photo" kind="secondary" label={parcel ? '✓ ' + t('photo_taken') : '📷 ' + t('take_parcel_photo')} onPress={() => photo(setParcel)} />
        </View>
        <Button testID="picked-up" busy={busy === 'pickup'} label={t('picked_up_btn')} onPress={pickedUp} />
        {releasing ? (<>
          <T kind="label">{t('give_back_title')}</T>
          <Choice testID="release" value={relReason} onChange={v => { setRelReason(v); setEvidence(null); }} options={RELEASE_REASONS.map(v => ({ v, label: t(`release_${v}`) }))} />
          {relReason === 'unsafe_or_prohibited' ? <Button testID="evidence-photo" kind="secondary" label={evidence ? '✓ ' + t('photo_taken') : '📷 ' + t('evidence_photo_btn')} onPress={() => photo(setEvidence)} /> : null}
          <Button testID="release-confirm" kind="danger" busy={busy === 'release'} disabled={!relReason} label={t('give_back_confirm')} onPress={release} />
        </>) : <Button testID="give-back" kind="plain" label={t('give_back')} onPress={() => setReleasing(true)} />}
      </>) : (<>
        {job.leg === 'delivery' ? <Notice testID="inspection" text={t(job.inspection === 'open' ? 'insp_open_driver' : 'insp_outside_driver')} /> : null}
        {job.recipient_expecting_at ? <Notice testID="expecting" text={'✓ ' + t('recipient_expecting_driver')} /> : null}
        {job.cash_to_collect_da > 0 ? (
          <Pressable testID="cash-confirm" accessibilityRole="checkbox" accessibilityState={{ checked: cashOk }} onPress={() => setCashOk(!cashOk)} style={[s.cash, cashOk && s.cashOk]}>
            <T style={s.cashText}>⚠ {t('collect_now', { p: money(job.cash_to_collect_da) })}</T>
            <T kind="label">{cashOk ? '☑' : '☐'} {t('cash_confirm', { p: money(job.cash_to_collect_da) })}</T>
          </Pressable>
        ) : null}
        <Button testID="scan-delivery" kind="secondary" label={'▣ ' + t(job.leg === 'return' ? 'scan_return_qr' : 'scan_delivery_qr')} onPress={() => setScan('DLV1')} />
        <Field testID="code-input" label={t(job.leg === 'return' ? 'enter_code_return' : 'enter_code')} value={code} onChangeText={v => { setCode(v.replace(/\D/g, '').slice(0, 4)); setMethod('code'); }} keyboardType="number-pad" maxLength={4} />
        <Button testID="delivered" busy={busy === 'deliver'} label={t('delivered_btn')} onPress={deliver} />
        {failing ? (<>
          <T kind="label">{t('fail_title')}</T>
          <Choice testID="fail" value={reason} onChange={v => { setReason(v); setEvidence(null); }} options={(job.leg === 'return' ? FAIL_REASONS.slice(0, 2) : FAIL_REASONS).map(v => ({ v, label: t(`fail_${v}`) }))} />
          {reason && NEEDS_EVIDENCE.includes(reason) ? <Button testID="evidence-photo" kind="secondary" label={evidence ? '✓ ' + t('photo_taken') : '📷 ' + t('evidence_photo_btn')} onPress={() => photo(setEvidence)} /> : null}
          <Button testID="fail-confirm" kind="danger" busy={busy === 'fail'} disabled={!reason} label={t('fail_confirm')} onPress={fail} />
        </>) : <Button testID="cant-deliver" kind="plain" label={t('cant_deliver')} onPress={() => setFailing(true)} />}
      </>)}
      {msg ? <Notice testID="job-msg" warn={msg.warn} text={msg.text} /> : null}
      {sos ? (
        <View style={s.sos} testID="sos-box">
          <T kind="label">{t('sos_title')}</T>
          <Button testID="sos-team" kind="danger" busy={busy === 'sos'} label={t('sos_team')} onPress={alertTeam} />
          {EMERGENCY.map(e => <Button key={e.n} testID={'sos-' + e.n} kind="secondary" label={`☎ ${e.n} · ${t(e.k)}`} onPress={() => call(e.n)} />)}
          <Button kind="plain" label={t('close')} onPress={() => setSos(false)} />
        </View>
      ) : <Button testID="sos" kind="plain" label={'⚠ ' + t('sos_btn')} onPress={() => setSos(true)} />}
      <QrScanner visible={!!scan} title={t(scan === 'PCK1' ? 'scan_pickup_qr' : 'scan_delivery_qr')} onCode={scanned} onClose={() => setScan(null)} />
      <Gap />
    </Screen>
  );
}
// Public emergency numbers in Algeria (to be confirmed locally: sources list 14 and 1021 for civil protection).
const EMERGENCY = [{ n: '17', k: 'sos_police' }, { n: '14', k: 'sos_civil' }, { n: '1055', k: 'sos_gendarmerie' }] as const;
const s = StyleSheet.create({
  sos: { backgroundColor: '#FEF3C7', borderWidth: 2, borderColor: color.amber, borderRadius: radius, padding: space(4), marginVertical: space(2), gap: space(2) },
  mapBox: { height: 200, borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: color.border, marginVertical: space(3) },
  box: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5) },
  row: { flexDirection: 'row', gap: space(3), flexWrap: 'wrap', alignItems: 'center' },
  cash: { backgroundColor: '#FEF3C7', borderWidth: 2, borderColor: color.amber, borderRadius: radius, padding: space(4), marginVertical: space(2) },
  cashOk: { borderColor: color.primary },
  cashText: { fontFamily: font.bold, fontSize: 20, lineHeight: 30 },
});
