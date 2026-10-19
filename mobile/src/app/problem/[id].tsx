import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../../lib/app';
import { errorMessage } from '../../lib/errors';
import { orders } from '../../lib/orders';
import { photoBlob, pickPhoto } from '../../lib/photos';
import { Button, Field, Notice, Screen, T } from '../../ui/kit';
import { Choice } from '../../ui/Choice';

const REASONS = ['driver_late', 'damaged', 'not_delivered', 'wrong_item', 'missing_item', 'driver_behaviour', 'price', 'other'] as const;
const MAX_PHOTOS = 3;

// Report a problem on an order, with up to 3 photos as evidence, until 24 h after the order ended (contract B: report_problem).
// Staff see it with the order's whole history and reply in the app.
export default function Problem() {
  const { t, services } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState<typeof REASONS[number] | null>(null), [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  async function addPhoto() {
    const p = await pickPhoto('camera');
    if (p === 'denied') setMsg({ text: t('camera_needed'), warn: true }); else if (p) setPhotos(x => [...x, p.uri].slice(0, MAX_PHOTOS));
  }
  async function send() {
    if (!reason) { setMsg({ text: t('choose_reason'), warn: true }); return; }
    setBusy(true); setMsg(null);
    try {
      const ids: string[] = [];
      for (const uri of photos) ids.push((await services.client.call<{ document_id: string }>('/upload_document?kind=evidence_photo', await photoBlob(uri))).document_id);
      await orders(services.client).problem(id, reason, note.trim(), ids); setSent(true); setMsg({ text: t('problem_sent') });
    } catch (e) { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); }
    finally { setBusy(false); }
  }
  return (
    <Screen testID="screen-problem">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('problem_title')}</T>
      {sent ? null : (<>
        <Choice testID="reason" value={reason} onChange={setReason} options={REASONS.map(v => ({ v, label: t(`pr_${v}`) }))} />
        <Field testID="note" label={t('note_label')} value={note} onChangeText={setNote} maxLength={1000} multiline />
        {photos.length < MAX_PHOTOS ? <Button testID="add-photo" kind="secondary" label={'📷 ' + t('add_evidence', { n: photos.length, max: MAX_PHOTOS })} onPress={addPhoto} /> : null}
        {photos.length ? <T kind="muted" testID="photo-count">{t('photos_added', { n: photos.length })}</T> : null}
        <T kind="muted">{t('report_window')}</T>
      </>)}
      {msg ? <Notice testID="problem-msg" warn={msg.warn} text={msg.text} /> : null}
      {sent ? <Button label={t('back')} kind="secondary" onPress={() => router.back()} /> : <Button testID="send-problem" label={t('submit')} busy={busy} onPress={send} />}
    </Screen>
  );
}
