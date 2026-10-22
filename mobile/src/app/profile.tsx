import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../lib/app';
import { account } from '../lib/account';
import { errorMessage } from '../lib/errors';
import { toInternational } from '../lib/phone';
import { color, font, space } from '../lib/theme';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';

// Profile (from the side menu): name (a customer may change it; a courier's name was checked against his ID card),
// contact phone, rating. Functions: get_me, rename_profile, set_phone.
export default function Profile() {
  const { t, services, state } = useApp();
  const p = state.active!;
  const api = account(services.client);
  const [name, setName] = useState(p.display_name), [phone, setPhone] = useState(''), [verified, setVerified] = useState(false);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { api.me().then(m => { setPhone(m.account?.phone ?? ''); setVerified(!!m.account?.phone_verified); }).catch(() => {}); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const courier = p.type === 'driver';
  async function save() {
    setBusy(true); setMsg(null);
    try {
      if (!courier && name.trim() !== p.display_name) await api.rename(name.trim());
      if (!verified && phone) { const ph = toInternational(phone); if (!ph) { setMsg({ text: t('phone_invalid'), warn: true }); return; } await api.setPhone(ph); }
      await services.session.restore();   // fresh name and rating everywhere in the app
      setMsg({ text: t('saved') });
    } catch (e) { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); }
    finally { setBusy(false); }
  }
  return (
    <Screen testID="screen-profile" title={t('profile_title')}>
      <View style={s.avatar}><Text style={s.avatarText}>{p.display_name.trim().charAt(0).toUpperCase()}</Text></View>
      <T style={{ textAlign: 'center' }} kind="muted">{p.rating ? `★ ${Number(p.rating).toFixed(2)} (${p.rating_count})` : t('no_rating_yet')} · {t(courier ? 'mode_courier' : 'mode_customer')}</T>
      <Gap n={4} />
      <Field testID="profile-name" label={t('name_label')} value={name} onChangeText={setName} maxLength={60} editable={!courier} hint={courier ? t('name_locked_courier') : undefined} />
      <Field testID="profile-phone" label={t('phone_label')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={18} editable={!verified} hint={verified ? t('phone_verified') : t('contact_phone_sub')} />
      {msg ? <Notice testID="profile-msg" warn={msg.warn} text={msg.text} /> : null}
      <Gap n={4} />
      <Button testID="profile-save" busy={busy} label={t('save')} onPress={save} />
    </Screen>
  );
}
const s = StyleSheet.create({
  avatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: space(2) },
  avatarText: { color: color.onBrand, fontFamily: font.bold, fontSize: 48 },
});
