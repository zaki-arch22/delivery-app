import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '../lib/app';
import { ALGIERS } from '../lib/config';
import { currentPosition, Point } from '../lib/location';
import { color, radius, space } from '../lib/theme';
import { AppMap, AppMapRef } from '../ui/AppMap';
import { Button, Notice, T } from '../ui/kit';

// Step 1 of a new order: put the pickup pin (A), then the delivery pin (B), by moving the map under a fixed pin.
// No address search (CLAUDE.md section 5): the exact point plus the details typed on the next screen.
export default function NewOrder() {
  const { t, rtl } = useApp();
  const map = useRef<AppMapRef>(null);
  const [center, setCenter] = useState<Point>(ALGIERS);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const step: 'pickup' | 'dropoff' = pickup ? 'dropoff' : 'pickup';

  async function locate() {
    setLocMsg(null);
    const p = await currentPosition();
    if (!p) { setLocMsg(t('location_denied')); return; }
    setCenter(p); map.current?.moveTo(p);
  }
  function confirm() {
    if (step === 'pickup') { setPickup(center); return; }
    router.push({ pathname: '/order-details', params: { plat: String(pickup!.lat), plng: String(pickup!.lng), dlat: String(center.lat), dlng: String(center.lng) } });
  }

  return (
    <SafeAreaView style={s.safe} testID="screen-new-order">
      <View style={[s.top, { direction: rtl ? 'rtl' : 'ltr' }]}>
        <Button kind="plain" label={'‹ ' + t(pickup ? 'change_pickup' : 'back')} onPress={() => pickup ? setPickup(null) : router.back()} />
        <T kind="title" testID="pick-title">{t(step === 'pickup' ? 'pick_pickup_title' : 'pick_dropoff_title')}</T>
        <T kind="muted">{t('pick_hint')}</T>
      </View>
      <View style={s.mapBox}>
        <AppMap ref={map} start={ALGIERS} onMoved={setCenter} centerPin={{ kind: step, label: t(step === 'pickup' ? 'pickup' : 'dropoff') }}
          pins={pickup ? [{ id: 'A', at: pickup, kind: 'pickup', label: t('pickup') }] : []} />
      </View>
      <View style={[s.bottom, { direction: rtl ? 'rtl' : 'ltr' }]}>
        {locMsg ? <Notice warn text={locMsg} /> : null}
        <Button testID="my-location" kind="secondary" label={'◎ ' + t('my_location')} onPress={locate} />
        <Button testID="confirm-point" label={t(step === 'pickup' ? 'confirm_pickup' : 'confirm_dropoff')} onPress={confirm} />
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  top: { paddingHorizontal: space(5), paddingBottom: space(2) },
  mapBox: { flex: 1, marginHorizontal: space(3), borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: color.border, minHeight: 280 },
  bottom: { padding: space(4) },
});
