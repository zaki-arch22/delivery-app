import React, { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../lib/app';
import { ApiError } from '../core/api';
import { errorMessage } from '../lib/errors';
import { googleIdToken } from '../lib/google';
import { destination } from '../lib/nav';
import { Button, Gap, Notice, Screen, T } from '../ui/kit';

// How to log in. The server says which methods are on (login_methods): Google now (free), SMS later.
export default function Login() {
  const { t, services } = useApp();
  const { path } = useLocalSearchParams<{ path: string }>();
  const p = path === 'driver' ? 'driver' : 'user';
  const [methods, setMethods] = useState<{ google: boolean; sms: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setMethods(await services.session.loginMethods()); }
    catch (e) { const m = errorMessage(e); setError(t(m.key, m.vars)); }
  }, [services, t]);
  useEffect(() => { load(); }, [load]);

  async function google() {
    setBusy(true); setError(null);
    try {
      const token = await googleIdToken();
      if (!token) return;                                  // the person closed Google's account picker
      const s = await services.session.loginGoogle(token, p);
      router.dismissAll();
      router.replace(destination(s));
    } catch (e) {
      if (e instanceof ApiError) { const m = errorMessage(e); setError(t(m.key, m.vars)); } else setError(t('err_google'));
    } finally { setBusy(false); }
  }

  return (
    <Screen testID="screen-login" title={t('login_title')}>
      <T kind="muted">{t('login_sub')}</T>
      <Gap />
      {error ? <><Notice testID="login-error" warn text={error} /><Button kind="secondary" label={t('try_again')} onPress={load} /></> : null}
      {!methods && !error ? <T kind="muted">{t('loading')}</T> : null}
      {methods?.google ? <Button testID="login-google" label={t('login_google')} busy={busy} onPress={google} /> : null}
      {methods?.sms ? <Button testID="login-phone" kind="secondary" label={t('login_phone')} onPress={() => router.push({ pathname: '/phone', params: { path: p } })} /> : null}
      {methods && !methods.google && !methods.sms ? <Notice testID="login-none" text={t('login_none')} /> : null}
    </Screen>
  );
}
