import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { photoBlob, pickPhoto } from '../lib/photos';
import { color, font, minTouch, radius, space } from '../lib/theme';
import { RulesAccept } from '../ui/RulesAccept';
import { Button, Field, Gap, Notice, Screen, T } from '../ui/kit';
import type { Key } from '../i18n';

type Kind = 'id_photo' | 'licence_photo' | 'vehicle_photo';
const KINDS: Kind[] = ['id_photo', 'licence_photo', 'vehicle_photo'];
type Slot = { uri?: string; id?: string; busy?: boolean; error?: string | null };

// Driver sign-up (contract A: upload_document x3, then add_profile). Used right after login on the driver path,
// and from Settings to add a driver profile to an existing sender account.
export default function DriverSignup() {
  const { t, services, state } = useApp();
  const [name, setName] = useState(state.active?.display_name ?? state.googleName ?? '');
  const [vehicle, setVehicle] = useState<'motorbike' | 'car' | null>(null);
  const [nid, setNid] = useState(''), [rules, setRules] = useState(false);
  const [slots, setSlots] = useState<Record<Kind, Slot>>({ id_photo: {}, licence_photo: {}, vehicle_photo: {} });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: Kind, s: Slot) => setSlots(prev => ({ ...prev, [k]: s }));
  const msg = (e: unknown) => { const m = errorMessage(e); return t(m.key, m.vars); };

  async function add(k: Kind, source: 'camera' | 'library') {
    setError(null);
    const p = await pickPhoto(source).catch(() => null);
    if (p === 'denied') { set(k, { ...slots[k], error: t('photo_denied') }); return; }
    if (!p) return;
    set(k, { uri: p.uri, busy: true });
    try { const id = await services.session.uploadDocument(k, await photoBlob(p.uri)); set(k, { uri: p.uri, id }); }
    catch (e) { set(k, { uri: p.uri, error: msg(e) }); }
  }

  async function submit() {
    const n = name.trim();
    if (n.length < 2 || n.length > 60) { setError(t('name_invalid')); return; }
    if (!vehicle) { setError(t('vehicle_missing')); return; }
    if (!KINDS.every(k => slots[k].id)) { setError(t('photos_missing')); return; }
    if (!/^\d{9,18}$/.test(nid)) { setError(t('nid_invalid')); return; }
    if (!rules) { setError(t('rules_needed')); return; }
    setBusy(true); setError(null);
    try {
      await services.session.addProfile('driver', n, true, { vehicle, id_photo: slots.id_photo.id!, licence_photo: slots.licence_photo.id!, vehicle_photo: slots.vehicle_photo.id! }, nid);
      router.dismissAll(); router.replace('/home');
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  }
  async function leave() {
    if (state.active) { router.back(); return; }              // from Settings: just go back
    await services.session.logout(); router.replace('/welcome');   // right after login: leave without a profile
  }

  return (
    <Screen testID="screen-driver-signup" title={t('driver_signup_title')} onBack={leave}>
      <T kind="muted">{t('driver_signup_sub')}</T>
      <Gap />
      <Field testID="name-input" label={t('name_label')} value={name} onChangeText={v => { setName(v); setError(null); }} autoComplete="name" textContentType="name" maxLength={60} />
      <T kind="label">{t('vehicle_label')}</T>
      <View accessibilityRole="radiogroup" style={s.row}>
        {(['motorbike', 'car'] as const).map(v => (
          <Pressable key={v} testID={'vehicle-' + v} accessibilityRole="radio" accessibilityState={{ selected: vehicle === v }} onPress={() => { setVehicle(v); setError(null); }} style={[s.choice, vehicle === v && s.choiceOn]}>
            <T style={[s.choiceText, vehicle === v && s.choiceTextOn]}>{vehicle === v ? '✓ ' : ''}{t(v === 'motorbike' ? 'vehicle_motorbike' : 'vehicle_car')}</T>
          </Pressable>
        ))}
      </View>
      <T kind="muted">{t('vehicle_hint')}</T>
      <Gap />
      {KINDS.map(k => {
        const sl = slots[k];
        return (
          <View key={k} style={s.slot} testID={'slot-' + k}>
            <View style={s.slotHead}>
              {sl.uri ? <Image source={{ uri: sl.uri }} style={s.thumb} accessibilityIgnoresInvertColors /> : <View style={[s.thumb, s.thumbEmpty]} />}
              <View style={{ flex: 1 }}>
                <T kind="label">{t(('photo_' + k) as Key)}</T>
                <T kind={sl.error ? 'error' : 'muted'} testID={'status-' + k}>{sl.busy ? t('uploading') : sl.error ? '⚠ ' + sl.error : sl.id ? '✓ ' + t('photo_ready') : t('required')}</T>
              </View>
            </View>
            <View style={s.row}>
              <Button testID={'camera-' + k} kind={sl.id ? 'plain' : 'secondary'} disabled={sl.busy} label={sl.id ? t('change_photo') : t('take_photo')} onPress={() => add(k, 'camera')} />
              {!sl.id ? <Button testID={'library-' + k} kind="plain" disabled={sl.busy} label={t('choose_photo')} onPress={() => add(k, 'library')} /> : null}
            </View>
          </View>
        );
      })}
      {error ? <Notice testID="signup-error" warn text={error} /> : null}
      <Field testID="nid-input" label={t('nid_label')} hint={t('nid_hint')} value={nid} onChangeText={v => { setNid(v.replace(/\D/g, '').slice(0, 18)); setError(null); }} keyboardType="number-pad" maxLength={18} />
      <RulesAccept value={rules} onChange={v => { setRules(v); setError(null); }} />
      <Button testID="submit-driver" label={t('submit_driver')} busy={busy} onPress={submit} />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(3), flexWrap: 'wrap', alignItems: 'center' },
  choice: { minHeight: minTouch, minWidth: 130, paddingHorizontal: space(4), borderRadius: radius, borderWidth: 2, borderColor: color.border, backgroundColor: color.white, justifyContent: 'center' },
  choiceOn: { borderColor: color.primary, backgroundColor: color.soft },
  choiceText: { fontFamily: font.semibold, textAlign: 'center' },
  choiceTextOn: { color: color.primary },
  slot: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4), marginVertical: space(2) },
  slotHead: { flexDirection: 'row', gap: space(3), alignItems: 'center' },
  thumb: { width: 72, height: 54, borderRadius: 8 },
  thumbEmpty: { backgroundColor: color.soft, borderWidth: 1, borderStyle: 'dashed', borderColor: color.border },
});
