import React, { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { Button, Field, Gap, Screen, T } from '../ui/kit';

// The FIRST profile, right after login (contract A: add_profile). Drivers go to the driver sign-up with photos.
export default function NewProfile() {
  const { t, services, state } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = state.needsProfile ?? 'user';

  async function create() {
    const n = name.trim();
    if (n.length < 2 || n.length > 60) { setError(t('name_invalid')); return; }
    setBusy(true); setError(null);
    try { await services.session.addProfile('user', n); router.replace('/home'); }
    catch (e) { const m = errorMessage(e); setError(t(m.key, m.vars)); }
    finally { setBusy(false); }
  }
  async function leave() { await services.session.logout(); router.replace('/welcome'); }

  if (path === 'driver') return <Redirect href="/driver-signup" />;
  return (
    <Screen testID="screen-new-user">
      <T kind="title">{t('profile_title_user')}</T>
      <T kind="muted">{t('profile_sub_user')}</T>
      <Gap />
      <Field testID="name-input" label={t('name_label')} error={error} value={name} onChangeText={v => { setName(v); setError(null); }}
        autoComplete="name" textContentType="name" maxLength={60} onSubmitEditing={create} returnKeyType="done" />
      <Button testID="create-profile" label={t('create_profile')} busy={busy} onPress={create} />
      <Button kind="plain" label={t('logout')} onPress={leave} />
    </Screen>
  );
}
