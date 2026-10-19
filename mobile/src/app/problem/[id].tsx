import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../../lib/app';
import { errorMessage } from '../../lib/errors';
import { orders } from '../../lib/orders';
import { Button, Field, Notice, Screen, T } from '../../ui/kit';
import { Choice } from '../../ui/Choice';

const REASONS = ['driver_late', 'damaged', 'not_delivered', 'price', 'other'] as const;

// Report a problem on an order; staff see it and reply in the app (contract B: report_problem).
export default function Problem() {
  const { t, services } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState<typeof REASONS[number] | null>(null), [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  async function send() {
    if (!reason) { setMsg({ text: t('choose_reason'), warn: true }); return; }
    setBusy(true); setMsg(null);
    try { await orders(services.client).problem(id, reason, note.trim()); setSent(true); setMsg({ text: t('problem_sent') }); }
    catch (e) { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); }
    finally { setBusy(false); }
  }
  return (
    <Screen testID="screen-problem">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('problem_title')}</T>
      {sent ? null : (<>
        <Choice testID="reason" value={reason} onChange={setReason} options={REASONS.map(v => ({ v, label: t(`pr_${v}`) }))} />
        <Field testID="note" label={t('note_label')} value={note} onChangeText={setNote} maxLength={1000} multiline />
      </>)}
      {msg ? <Notice testID="problem-msg" warn={msg.warn} text={msg.text} /> : null}
      {sent ? <Button label={t('back')} kind="secondary" onPress={() => router.back()} /> : <Button testID="send-problem" label={t('submit')} busy={busy} onPress={send} />}
    </Screen>
  );
}
