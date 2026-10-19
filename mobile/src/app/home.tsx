import React from 'react';
import { Redirect, router } from 'expo-router';
import { useApp } from '../lib/app';
import { Button, Gap, Notice, Screen, T } from '../ui/kit';

// Temporary landing screen: becomes "New order" (user) and the driver home (driver) in step 3 of CLAUDE.md section 9.
export default function Home() {
  const { t, state } = useApp();
  const p = state.active;
  if (!p) return <Redirect href="/" />;
  const driverKey = p.status === 'active' ? 'home_driver_active' : p.status === 'rejected' ? 'home_driver_rejected' : p.status === 'suspended' ? 'home_driver_suspended' : 'home_driver_pending';
  return (
    <Screen testID="screen-home">
      <T kind="title" testID="home-hello">{t('home_hello', { name: p.display_name })}</T>
      <T kind="muted">{t(p.type === 'user' ? 'profile_user' : 'profile_driver')}</T>
      {state.notice?.code === 'NO_PROFILE_FOR_PATH' ? <Notice testID="notice-no-profile" text={t(state.notice.missing === 'driver' ? 'notice_no_profile_driver' : 'notice_no_profile_user')} /> : null}
      <Gap />
      {p.type === 'user' ? <Notice text={t('home_user_soon')} /> : <Notice testID="driver-status" warn={p.status === 'suspended' || p.status === 'rejected'} text={t(driverKey)} />}
      <Gap n={6} />
      <Button testID="open-settings" kind="secondary" label={t('settings')} onPress={() => router.push('/settings')} />
    </Screen>
  );
}
