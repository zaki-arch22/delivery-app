import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useApp, useNotices } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { when } from '../lib/orders';
import { color, radius, space } from '../lib/theme';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';
import type { Key } from '../i18n';

interface Violation { id: number; rule: string; points: number; order_ref: string | null; note: string | null; status: 'active' | 'appealed' | 'upheld' | 'cancelled'; appeal_text: string | null; decision_note: string | null; created_at: string; can_appeal: boolean; counts: boolean }
interface Record { points_90d: number; active_block: null | { kind: 'block' | 'ban'; until: string | null; reason: string }; violations: Violation[]; sanctions: { id: number; kind: string; until: string | null; reason: string; lifted_at: string | null; created_at: string }[] }

// "My record" (contract A: my_record, appeal_violation): points of the last 90 days, any block and why, every rule break
// with its order and an appeal (once each). Fair and visible: nothing is decided in secret.
export default function RecordScreen() {
  const { t, services, lang } = useApp();
  const [r, setR] = useState<Record | null>(null);
  const [appealing, setAppealing] = useState<number | null>(null), [text, setText] = useState('');
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(() => services.client.call<Record>('/my_record').then(setR).catch(() => {}), [services]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useNotices(n => { if (n.kind.startsWith('trust.')) load(); });
  async function send(id: number) {
    if (text.trim().length < 10) { setMsg({ text: t('appeal_short'), warn: true }); return; }
    setBusy(true); setMsg(null);
    try { await services.client.call('/appeal_violation', { id, text: text.trim() }); setAppealing(null); setText(''); setMsg({ text: t('appeal_sent') }); await load(); }
    catch (e) { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); }
    finally { setBusy(false); }
  }
  if (!r) return <Screen testID="screen-record" title={t('record_title')} />;
  return (
    <Screen testID="screen-record" title={t('record_title')}>
      {r.active_block ? <Notice testID="record-block" warn text={r.active_block.until ? t('blocked_until', { d: when(r.active_block.until, lang) }) : t(r.active_block.kind === 'ban' ? 'banned' : 'blocked_review')} /> : null}
      <View style={s.box}>
        <T kind="label" testID="record-points">{t('record_points', { n: r.points_90d })}</T>
        <T kind="muted">{t('record_levels')}</T>
        <Button testID="record-rules" kind="plain" label={t('rules_read')} onPress={() => router.push('/rules')} />
      </View>
      {msg ? <Notice testID="record-msg" warn={msg.warn} text={msg.text} /> : null}
      {r.violations.length === 0 ? <Notice testID="record-empty" text={t('record_empty')} /> : null}
      {r.violations.map(v => (
        <View key={v.id} style={s.box} testID={'violation-' + v.id}>
          <T kind="label">{t(('rule_' + v.rule) as Key)} · {t('points_n', { n: v.points })}</T>
          <T kind="muted">{when(v.created_at, lang)}{v.order_ref ? ' · ' + v.order_ref : ''} · {t(('vstatus_' + v.status) as Key)}{v.counts ? '' : ' · ' + t('not_counted')}</T>
          {v.note ? <T>{v.note}</T> : null}
          {v.appeal_text ? <T kind="muted">{t('your_appeal')}: {v.appeal_text}</T> : null}
          {v.decision_note ? <T kind="muted">{t('decision')}: {v.decision_note}</T> : null}
          {v.can_appeal ? (appealing === v.id ? (<>
            <Field testID="appeal-text" label={t('appeal_label')} value={text} onChangeText={setText} multiline maxLength={1000} />
            <Button testID="appeal-send" label={t('appeal_send')} busy={busy} onPress={() => send(v.id)} />
          </>) : <Button testID={'appeal-' + v.id} kind="secondary" label={t('appeal_btn')} onPress={() => { setAppealing(v.id); setText(''); }} />) : null}
        </View>
      ))}
      <Gap />
    </Screen>
  );
}
const s = StyleSheet.create({ box: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5), gap: space(1) } });
