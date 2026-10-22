import React, { useState } from 'react';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { Button, Notice, Screen, T } from '../ui/kit';
import { PayoutFields, usePayoutForm } from '../ui/PayoutFields';

// "My BaridiMob account" (contract: get_payout_account, set_payout_account): where couriers send this person's sales money.
export default function PayoutScreen() {
  const { t } = useApp();
  const form = usePayoutForm();
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    setMsg(null);
    if (!form.validate(t)) return;
    setBusy(true);
    try { await form.save(); setMsg({ text: t('payout_saved') }); } catch (e) { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); } finally { setBusy(false); }
  };
  return (
    <Screen testID="screen-payout" title={t('payout_title')}>
      <T kind="muted">{t('payout_sub')}</T>
      {form.saved === undefined ? null : <PayoutFields form={form} />}
      {msg ? <Notice testID="payout-msg" warn={msg.warn} text={msg.text} /> : null}
      <Button testID="payout-save" label={t('save')} busy={busy} disabled={form.saved === undefined} onPress={save} />
    </Screen>
  );
}
