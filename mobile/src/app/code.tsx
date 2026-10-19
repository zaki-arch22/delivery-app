import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { display } from '../lib/phone';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';
import { destination } from '../lib/nav';

const RESEND_AFTER_S = 60;

export default function Code() {
  const { t, services } = useApp();
  const { path, phone } = useLocalSearchParams<{ path: string; phone: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_AFTER_S);
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(id); }, [wait]);

  async function verify(value = code) {
    if (!/^\d{6}$/.test(value)) { setError(t('code_invalid')); return; }
    setBusy(true); setError(null);
    try {
      const s = await services.session.verifyCode(phone, value, path === 'driver' ? 'driver' : 'user');
      router.dismissAll();
      router.replace(destination(s));
    } catch (e) { const m = errorMessage(e); setError(t(m.key, m.vars)); setCode(''); }
    finally { setBusy(false); }
  }
  async function resend() {
    setError(null); setInfo(null);
    try { await services.session.sendCode(phone); setInfo(t('code_sent')); setWait(RESEND_AFTER_S); }
    catch (e) { const m = errorMessage(e); setError(t(m.key, m.vars)); }
  }

  return (
    <Screen testID="screen-code">
      <Button kind="plain" label={'‹ ' + t('change_number')} onPress={() => router.back()} />
      <T kind="title">{t('code_title')}</T>
      <T kind="muted">{t('code_sub', { phone: display(phone ?? '') })}</T>
      <Gap />
      <Field testID="code-input" label={t('code_label')} error={error} value={code} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6}
        onChangeText={v => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); setError(null); if (d.length === 6) verify(d); }} />
      {info ? <Notice text={info} /> : null}
      <Button testID="verify" label={t('verify')} busy={busy} onPress={() => verify()} />
      <Button testID="resend" kind="plain" disabled={wait > 0} label={wait > 0 ? t('resend_in', { s: wait }) : t('resend')} onPress={resend} />
    </Screen>
  );
}
