import React from 'react';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { Button, Gap, Screen, T } from '../ui/kit';
import { LanguageSwitch } from '../ui/LanguageSwitch';

// First screen: language, then the two paths (CLAUDE.md section 4: one app, two paths).
export default function Welcome() {
  const { t } = useApp();
  return (
    <Screen testID="screen-welcome">
      <LanguageSwitch />
      <Gap n={8} />
      <T kind="label">{t('app_name')}</T>
      <T kind="title">{t('welcome_title')}</T>
      <Gap n={2} />
      <T kind="muted">{t('welcome_sub')}</T>
      <Gap n={8} />
      <Button testID="path-user" label={t('path_user')} sub={t('path_user_sub')} onPress={() => router.push({ pathname: '/login', params: { path: 'user' } })} />
      <Button testID="path-driver" kind="secondary" label={t('path_driver')} sub={t('path_driver_sub')} onPress={() => router.push({ pathname: '/login', params: { path: 'driver' } })} />
    </Screen>
  );
}
