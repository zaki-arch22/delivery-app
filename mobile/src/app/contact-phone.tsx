import React, { useState } from 'react';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { toInternational } from '../lib/phone';
import { destination } from '../lib/nav';
import { Button, Field, Gap, Screen, T } from '../ui/kit';

// After a Google login: the contact number (set_phone). Drivers and senders call each other on it. Not checked by SMS yet.
export default function ContactPhone() {
  const { t, services } = useApp();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const phone = toInternational(value);
    if (!phone) { setError(t('phone_invalid')); return; }
    setBusy(true); setError(null);
    try { const s = await services.session.setPhone(phone); router.replace(destination(s)); }
    catch (e) { const m = errorMessage(e); setError(t(m.key, m.vars)); }
    finally { setBusy(false); }
  }
  async function leave() { await services.session.logout(); router.replace('/welcome'); }

  return (
    <Screen testID="screen-contact-phone">
      <T kind="title">{t('phone_title')}</T>
      <T kind="muted">{t('contact_phone_sub')}</T>
      <Gap />
      <Field testID="contact-phone-input" label={t('phone_label')} hint={t('phone_hint')} error={error} value={value}
        onChangeText={v => { setValue(v); setError(null); }} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
        maxLength={18} onSubmitEditing={save} returnKeyType="done" />
      <Button testID="save-phone" label={t('continue')} busy={busy} onPress={save} />
      <Button kind="plain" label={t('logout')} onPress={leave} />
    </Screen>
  );
}
