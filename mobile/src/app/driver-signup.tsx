import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { errorMessage } from '../lib/errors';
import { photoBlob, pickPhoto } from '../lib/photos';
import { color, font, minTouch, radius, space } from '../lib/theme';
import { RulesAccept } from '../ui/RulesAccept';
import { PayoutFields, usePayoutForm } from '../ui/PayoutFields';
import { Button, Card, Field, Gap, Notice, Screen, T } from '../ui/kit';
import type { Key } from '../i18n';

type Kind = 'id_photo' | 'licence_photo' | 'ownership_photo' | 'vehicle_photo';
const KINDS: Kind[] = ['id_photo', 'licence_photo', 'ownership_photo', 'vehicle_photo'];
const MAX_EXTRA = 3;   // more vehicle photos (the plate must be readable on at least one)
type Slot = { uri?: string; id?: string; busy?: boolean; error?: string | null };

// "12041995" or "12/04/1995" -> "1995-04-12" (null if not a real date).
export function isoDate(typed: string): string | null {
  const d = typed.replace(/\D/g, '');
  if (d.length !== 8) return null;
  const iso = `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  const x = new Date(iso + 'T00:00:00Z');
  return !isNaN(x.getTime()) && x.toISOString().slice(0, 10) === iso ? iso : null;
}
const age = (iso: string) => (Date.now() - new Date(iso + 'T00:00:00Z').getTime()) / (365.25 * 24 * 3600_000);

// Courier sign-up (owner's list, Oct 2026; contract A: upload_document for each photo, then add_profile):
// identity (first and last name, date of birth, ID card number), vehicle (type, colour, plate) and documents (ID card,
// driving licence, proof of ownership, vehicle photos). Photos are never refused for quality: a person at our team
// checks everything before the courier can work. Used right after login on the courier path, and from the side menu.
export default function DriverSignup() {
  const { t, services, state } = useApp();
  const guess = (state.active?.display_name ?? state.googleName ?? '').trim().split(/\s+/);
  const [first, setFirst] = useState(guess[0] ?? ''), [last, setLast] = useState(guess.slice(1).join(' '));
  const [birth, setBirth] = useState('');
  const [vehicle, setVehicle] = useState<'motorbike' | 'car' | null>(null);
  const [colour, setColour] = useState(''), [plate, setPlate] = useState('');
  const [nid, setNid] = useState(''), [rules, setRules] = useState(false);
  const [slots, setSlots] = useState<Record<Kind, Slot>>({ id_photo: {}, licence_photo: {}, ownership_photo: {}, vehicle_photo: {} });
  const [extra, setExtra] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payout = usePayoutForm();   // couriers send sellers' money by BaridiMob, and need their own account (RIP)
  const set = (k: Kind, s: Slot) => setSlots(prev => ({ ...prev, [k]: s }));
  const msg = (e: unknown) => { const m = errorMessage(e); return t(m.key, m.vars); };

  async function upload(kind: Kind, source: 'camera' | 'library', put: (s: Slot) => void, prev: Slot) {
    setError(null);
    const p = await pickPhoto(source).catch(() => null);
    if (p === 'denied') { put({ ...prev, error: t('photo_denied') }); return; }
    if (!p) return;
    put({ uri: p.uri, busy: true });
    try { const id = await services.session.uploadDocument(kind, await photoBlob(p.uri)); put({ uri: p.uri, id }); }
    catch (e) { put({ uri: p.uri, error: msg(e) }); }
  }
  const putExtra = (i: number) => (s: Slot) => setExtra(prev => prev.map((x, j) => (j === i ? s : x)));

  async function submit() {
    const f = first.trim(), l = last.trim(), dob = isoDate(birth);
    if (!f || !l) { setError(t('driver_name_missing')); return; }
    if (!dob || age(dob) < 18 || age(dob) > 80) { setError(t('birth_invalid')); return; }
    if (!vehicle) { setError(t('vehicle_missing')); return; }
    if (colour.trim().length < 2) { setError(t('colour_missing')); return; }
    if (plate.replace(/[^0-9A-Za-z]/g, '').length < 5) { setError(t('plate_invalid')); return; }
    if (!KINDS.every(k => slots[k].id) || extra.some(x => x.busy)) { setError(t('photos_missing')); return; }
    if (!/^\d{9,18}$/.test(nid)) { setError(t('nid_invalid')); return; }
    if (!payout.validate(t)) { setError(t('payout_needed_driver')); return; }
    if (!rules) { setError(t('rules_needed')); return; }
    setBusy(true); setError(null);
    try {
      await payout.save();
      const docs: Record<string, any> = { vehicle, first_name: f, last_name: l, birth_date: dob, vehicle_color: colour.trim(), plate_number: plate.trim() };
      for (const k of KINDS) docs[k] = slots[k].id;
      const more = extra.map(x => x.id).filter(Boolean);
      if (more.length) docs.vehicle_photos = more;
      await services.session.addProfile('driver', `${f} ${l}`.slice(0, 60), true, docs, nid);
      router.dismissAll(); router.replace('/home');
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  }
  async function leave() {
    if (state.active) { router.back(); return; }              // from the menu or Settings: just go back
    await services.session.logout(); router.replace('/welcome');   // right after login: leave without a profile
  }

  const PhotoSlot = ({ id, label, hint, sl, onPick }: { id: string; label: string; hint?: string; sl: Slot; onPick: (src: 'camera' | 'library') => void }) => (
    <View style={s.slot} testID={'slot-' + id}>
      <View style={s.slotHead}>
        {sl.uri ? <Image source={{ uri: sl.uri }} style={s.thumb} accessibilityIgnoresInvertColors /> : <View style={[s.thumb, s.thumbEmpty]} />}
        <View style={{ flex: 1 }}>
          <T kind="label">{label}</T>
          {hint ? <T kind="muted">{hint}</T> : null}
          <T kind={sl.error ? 'error' : 'muted'} testID={'status-' + id}>{sl.busy ? t('uploading') : sl.error ? '⚠ ' + sl.error : sl.id ? '✓ ' + t('photo_ready') : t('required')}</T>
        </View>
      </View>
      <View style={s.row}>
        <Button testID={'camera-' + id} kind={sl.id ? 'plain' : 'secondary'} disabled={sl.busy} label={sl.id ? t('change_photo') : t('take_photo')} onPress={() => onPick('camera')} />
        {!sl.id ? <Button testID={'library-' + id} kind="plain" disabled={sl.busy} label={t('choose_photo')} onPress={() => onPick('library')} /> : null}
      </View>
    </View>
  );

  return (
    <Screen testID="screen-driver-signup" title={t('driver_signup_title')} onBack={leave}>
      <T kind="muted">{t('driver_signup_sub')}</T>

      <Card>
        <T kind="label">{t('signup_identity')}</T>
        <Field testID="first-input" label={t('first_name')} value={first} onChangeText={v => { setFirst(v); setError(null); }} autoComplete="given-name" maxLength={40} />
        <Field testID="last-input" label={t('last_name')} value={last} onChangeText={v => { setLast(v); setError(null); }} autoComplete="family-name" maxLength={40} />
        <Field testID="birth-input" label={t('birth_date')} hint={t('birth_hint')} value={birth} placeholder="12/04/1995" keyboardType="number-pad" maxLength={10}
          onChangeText={v => { const d = v.replace(/\D/g, '').slice(0, 8); setBirth([d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/')); setError(null); }} />
        <Field testID="nid-input" label={t('nid_label')} hint={t('nid_hint')} value={nid} onChangeText={v => { setNid(v.replace(/\D/g, '').slice(0, 18)); setError(null); }} keyboardType="number-pad" maxLength={18} />
      </Card>

      <Card>
        <T kind="label">{t('signup_vehicle')}</T>
        <View accessibilityRole="radiogroup" style={s.row}>
          {(['motorbike', 'car'] as const).map(v => (
            <Pressable key={v} testID={'vehicle-' + v} accessibilityRole="radio" accessibilityState={{ selected: vehicle === v }} onPress={() => { setVehicle(v); setError(null); }} style={[s.choice, vehicle === v && s.choiceOn]}>
              <T style={[s.choiceText, vehicle === v && s.choiceTextOn]}>{vehicle === v ? '✓ ' : ''}{t(v === 'motorbike' ? 'vehicle_motorbike' : 'vehicle_car')}</T>
            </Pressable>
          ))}
        </View>
        <T kind="muted">{t('vehicle_hint')}</T>
        <Field testID="colour-input" label={t('vehicle_colour')} value={colour} onChangeText={v => { setColour(v); setError(null); }} maxLength={30} />
        <Field testID="plate-input" label={t('plate_number')} hint={t('plate_hint')} value={plate} autoCapitalize="characters" maxLength={20}
          onChangeText={v => { setPlate(v.toUpperCase().replace(/[^0-9A-Z -]/g, '')); setError(null); }} />
      </Card>

      <Card testID="signup-payout">
        <T kind="label">{t('payout_title')}</T>
        {payout.saved === undefined ? null : <PayoutFields form={payout} intro={t('payout_needed_driver')} />}
      </Card>

      <T kind="label" style={{ marginTop: space(3) }}>{t('signup_documents')}</T>
      <T kind="muted">{t('signup_documents_sub')}</T>
      {KINDS.map(k => <PhotoSlot key={k} id={k} label={t(('photo_' + k) as Key)} hint={t(('photo_' + k + '_hint') as Key)} sl={slots[k]} onPick={src => upload(k, src, x => set(k, x), slots[k])} />)}
      {extra.map((x, i) => <PhotoSlot key={'extra' + i} id={'extra-' + i} label={`${t('photo_vehicle_photo')} ${i + 2}`} sl={x} onPick={src => upload('vehicle_photo', src, putExtra(i), x)} />)}
      {extra.length < MAX_EXTRA ? <Button testID="add-vehicle-photo" kind="plain" icon="plus" label={t('add_vehicle_photo')} onPress={() => setExtra([...extra, {}])} /> : null}

      <Gap n={2} />
      {error ? <Notice testID="signup-error" warn text={error} /> : null}
      <RulesAccept value={rules} onChange={v => { setRules(v); setError(null); }} />
      <Button testID="submit-driver" label={t('submit_driver')} sub={t('submit_driver_sub')} busy={busy} onPress={submit} />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(3), flexWrap: 'wrap', alignItems: 'center' },
  choice: { minHeight: minTouch, minWidth: 130, paddingHorizontal: space(4), borderRadius: radius, borderWidth: 2, borderColor: 'transparent', backgroundColor: color.card2, justifyContent: 'center' },
  choiceOn: { borderColor: color.lime },
  choiceText: { fontFamily: font.semibold, textAlign: 'center' },
  choiceTextOn: { color: color.lime },
  slot: { backgroundColor: color.card, borderRadius: 20, padding: space(4), marginVertical: space(2) },
  slotHead: { flexDirection: 'row', gap: space(3), alignItems: 'center' },
  thumb: { width: 72, height: 54, borderRadius: 8 },
  thumbEmpty: { backgroundColor: color.card2, borderWidth: 1, borderStyle: 'dashed', borderColor: color.line },
});
