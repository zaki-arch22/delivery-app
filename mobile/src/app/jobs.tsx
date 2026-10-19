import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '../lib/app';
import { driver, JobRow } from '../lib/driver';
import { money, when } from '../lib/orders';
import { color, radius, space } from '../lib/theme';
import { Button, Notice, Screen, T } from '../ui/kit';
import type { Key } from '../i18n';

const PAGE = 20;
// My deliveries (contract C: list_jobs), newest first.
export default function Jobs() {
  const { t, lang, services } = useApp();
  const [list, setList] = useState<JobRow[] | null>(null), [page, setPage] = useState(1), [more, setMore] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(async (p: number) => {
    setBusy(true);
    try { const r = await driver(services.client).jobs(p); setList(prev => (p === 1 ? r.jobs : [...(prev ?? []), ...r.jobs])); setMore(r.jobs.length === PAGE); setPage(p); }
    catch { setList(prev => prev ?? []); } finally { setBusy(false); }
  }, [services]);
  useFocusEffect(useCallback(() => { load(1); }, [load]));
  return (
    <Screen testID="screen-jobs">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('my_jobs')}</T>
      {list && !list.length ? <Notice testID="jobs-empty" text={t('no_jobs')} /> : null}
      {(list ?? []).map(j => (
        <View key={j.id} style={s.card} testID={'job-' + j.ref}>
          <T kind="label">{j.leg === 'return' ? t('return_leg') + ' · ' : ''}{j.ref} · {t(('status_' + j.status) as Key)}</T>
          <T kind="muted">{j.locked_da != null ? `${money(j.locked_da)} ${t('da')} · ` : ''}{when(j.delivered_at ?? j.created_at, lang)}</T>
        </View>
      ))}
      {more ? <Button testID="load-more" kind="secondary" busy={busy} label={t('load_more')} onPress={() => load(page + 1)} /> : null}
    </Screen>
  );
}
const s = StyleSheet.create({ card: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(1.5) } });
