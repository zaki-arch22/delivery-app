import React, { useEffect, useState } from 'react';
import { useApp } from '../lib/app';
import { cleanRip, money as moneyApi, Payout, ripOk, showRip } from '../lib/money';
import { Field, Notice, T } from './kit';

// The BaridiMob (Algérie Poste RIP) account form, shared by Settings, courier sign-up and cash-on-delivery orders.
// It loads the saved account; save() stores it only when it changed. validate() shows the errors on the fields.
export function usePayoutForm() {
  const { services } = useApp();
  const api = moneyApi(services.client);
  const [saved, setSaved] = useState<Payout | null | undefined>(undefined);   // undefined = still loading
  const [rip, setRipRaw] = useState(''), [holder, setHolder] = useState('');
  const [errs, setErrs] = useState<{ rip?: string | null; holder?: string | null }>({});
  useEffect(() => {
    let live = true;
    api.payout().then(p => { if (!live) return; setSaved(p); if (p) { setRipRaw(showRip(p.rip)); setHolder(p.holder_name); } }).catch(() => live && setSaved(null));
    return () => { live = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const setRip = (v: string) => { setRipRaw(showRip(v)); setErrs(e => ({ ...e, rip: null })); };
  const changed = !saved || cleanRip(rip) !== saved.rip || holder.trim() !== saved.holder_name;
  return {
    saved, rip, holder, errs, changed,
    setRip, setHolder: (v: string) => { setHolder(v); setErrs(e => ({ ...e, holder: null })); },
    validate(t: (k: any) => string) {
      const e = { rip: ripOk(rip) ? null : t('payout_invalid'), holder: holder.trim().length >= 3 ? null : t('payout_holder_invalid') };
      setErrs(e); return !e.rip && !e.holder;
    },
    async save() { if (!changed) return saved!; const p = await api.setPayout(rip, holder); setSaved(p); return p; },
  };
}
export type PayoutForm = ReturnType<typeof usePayoutForm>;

export function PayoutFields({ form, intro }: { form: PayoutForm; intro?: string }) {
  const { t } = useApp();
  return (
    <>
      {intro ? <T kind="muted">{intro}</T> : null}
      <Field testID="payout-rip" label={t('payout_rip')} hint={t('payout_rip_hint')} value={form.rip} onChangeText={form.setRip} error={form.errs.rip}
        keyboardType="number-pad" maxLength={23} placeholder="007 99999 0000000000 00" />
      <Field testID="payout-holder" label={t('payout_holder')} hint={t('payout_holder_hint')} value={form.holder} onChangeText={form.setHolder} error={form.errs.holder} maxLength={80} autoComplete="name" />
      {form.changed && form.rip.length > 0 ? <Notice text={t('payout_check')} /> : null}
    </>
  );
}
