import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { toInternational } from '../lib/phone';
import { Button, Field, Gap, Screen, T } from '../ui/kit';

export default function Phone() {
  const { t, services } = useApp();
  const { path } = useLocalSearchParams<{ path: string }>();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const phone = toInternational(value);
    if (!phone) { setError(t('phone_invalid')); return; }
    setBusy(true); setError(null);
    try {
      await services.session.sendCode(phone);
      router.push({ pathname: '/code', params: { path: path === 'driver' ? 'driver' : 'user', phone } });
    } catch (e) { const m = errorMessage(e); setError(t(m.key, m.vars)); }
    finally { setBusy(false); }
  }

  return (
    <Screen testID="screen-phone">
      <Button kind="plain" label={'‹ ' + t('back')} onPress={() => router.back()} />
      <T kind="title">{t('phone_title')}</T>
      <T kind="muted">{t('phone_sub')}</T>
      <Gap />
      <Field testID="phone-input" label={t('phone_label')} hint={t('phone_hint')} error={error} value={value}
        onChangeText={v => { setValue(v); setError(null); }} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
        maxLength={18} onSubmitEditing={send} returnKeyType="send" />
      <Button testID="send-code" label={t('send_code')} busy={busy} onPress={send} />
    </Screen>
  );
}
