import React, { useState } from 'react';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { Button, Field, Notice, Screen, T } from '../ui/kit';
import { RulesAccept } from '../ui/RulesAccept';

// Customer mode for a courier who has no customer profile yet (side menu button): a name and the rules, then switch.
export default function AddCustomer() {
  const { t, services, state } = useApp();
  const [name, setName] = useState(state.active?.display_name ?? ''), [rules, setRules] = useState(false);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  async function create() {
    const n = name.trim(); if (n.length < 2 || n.length > 60) { setMsg(t('name_invalid')); return; }
    if (!rules) { setMsg(t('rules_needed')); return; }
    setBusy(true); setMsg(null);
    try { await services.session.addProfile('user', n, true); router.replace('/home'); }
    catch (e) { const m = errorMessage(e); setMsg(t(m.key, m.vars)); } finally { setBusy(false); }
  }
  return (
    <Screen testID="screen-add-customer" title={t('to_customer_mode')}>
      <T kind="muted">{t('add_customer_sub')}</T>
      <Field testID="add-name" label={t('name_label')} value={name} onChangeText={setName} maxLength={60} />
      <RulesAccept value={rules} onChange={setRules} />
      {msg ? <Notice warn text={msg} /> : null}
      <Button testID="add-user-confirm" busy={busy} label={t('create_profile')} onPress={create} />
    </Screen>
  );
}
