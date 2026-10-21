import React, { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { apiUrl } from '../lib/config';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';
import { LanguageSwitch } from '../ui/LanguageSwitch';
import { RulesAccept } from '../ui/RulesAccept';

// Settings (contract A): language, switch or add the other profile, log out, log out of all devices.
export default function Settings() {
  const { t, services, state } = useApp();
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false), [rules, setRules] = useState(false);
  const [name, setName] = useState(state.active?.display_name ?? '');
  const active = state.active;
  const other = active?.type === 'user' ? 'driver' : 'user';
  const hasOther = state.profiles.some(p => p.type === other);
  const fail = (e: unknown) => { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); };

  async function run(key: string, f: () => Promise<void>) { setBusy(key); setMsg(null); try { await f(); } catch (e) { fail(e); } finally { setBusy(null); } }
  const switchProfile = () => run('switch', async () => { await services.session.switchProfile(other); router.replace('/home'); });
  const addUser = () => run('add', async () => {
    const n = name.trim(); if (n.length < 2 || n.length > 60) { setMsg({ text: t('name_invalid'), warn: true }); return; }
    if (!rules) { setMsg({ text: t('rules_needed'), warn: true }); return; }
    await services.session.addProfile('user', n, true); router.replace('/home');
  });
  const logout = () => run('logout', async () => { await services.session.logout(); router.replace('/welcome'); });
  const logoutAll = () => Alert.alert(t('logout_all_confirm'), t('logout_all_sub'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('confirm'), style: 'destructive', onPress: () => run('all', async () => { await services.session.logoutEverywhere(); router.replace('/welcome'); }) },
  ]);

  const deleteAccount = () => Alert.alert(t('delete_account_confirm'), t('delete_account_sub'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('delete_account'), style: 'destructive', onPress: () => run('delete', async () => { await services.session.deleteAccount(); router.replace('/welcome'); }) },
  ]);

  return (
    <Screen testID="screen-settings" title={t('settings')}>
      <Gap />
      <T kind="label">{t('choose_language')}</T>
      <LanguageSwitch />
      <Gap n={6} />
      <T kind="label">{t('settings_profile')}</T>
      {active ? <T testID="settings-active">{active.display_name} · {t(active.type === 'user' ? 'profile_user' : 'profile_driver')}</T> : null}
      {hasOther ? <Button testID="switch-profile" kind="secondary" busy={busy === 'switch'} label={t('switch_to', { type: t(other === 'user' ? 'profile_user' : 'profile_driver') })} onPress={switchProfile} />
        : other === 'driver' ? <Button testID="add-driver" kind="secondary" label={t('add_driver_profile')} onPress={() => router.push('/driver-signup')} />
        : adding ? (<>
            <Field testID="add-name" label={t('name_label')} value={name} onChangeText={setName} maxLength={60} />
            <RulesAccept value={rules} onChange={setRules} />
            <Button testID="add-user-confirm" label={t('create_profile')} busy={busy === 'add'} onPress={addUser} />
          </>)
        : <Button testID="add-user" kind="secondary" label={t('add_user_profile')} onPress={() => setAdding(true)} />}
      {msg ? <Notice text={msg.text} warn={msg.warn} /> : null}
      <Gap n={6} />
      {active ? <Button testID="open-record" kind="secondary" label={t('record_title')} onPress={() => router.push('/record')} /> : null}
      <Button testID="open-rules" kind="plain" label={t('rules_title')} onPress={() => router.push('/rules')} />
      <Button testID="open-privacy" kind="plain" label={t('privacy_policy')} onPress={() => Linking.openURL(apiUrl() + '/privacy')} />
      <Button testID="logout" kind="secondary" busy={busy === 'logout'} label={t('logout')} onPress={logout} />
      <Button testID="logout-all" kind="danger" busy={busy === 'all'} label={t('logout_all')} sub={t('logout_all_sub')} onPress={logoutAll} />
      <Gap n={4} />
      <Button testID="delete-account" kind="plain" busy={busy === 'delete'} label={t('delete_account')} onPress={deleteAccount} />
    </Screen>
  );
}
