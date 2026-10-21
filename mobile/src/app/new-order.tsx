import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../lib/app';
import { ALGIERS } from '../lib/config';
import { currentPosition, Point } from '../lib/location';
import { orders, Place } from '../lib/orders';
import { usePlaceSearch } from '../lib/features';
import { color, font, radius, space } from '../lib/theme';
import { AppMap, AppMapRef } from '../ui/AppMap';
import { Sheet } from '../ui/Sheet';
import { PlaceSearch } from '../ui/PlaceSearch';
import { MapOverlay, Button, Notice, RoundButton, T } from '../ui/kit';
import { Icon } from '../ui/Icon';

// Where the parcel goes: search a place, or move the map under the flag pin. The pickup point (chosen on the home map)
// stays visible. Without params (older links), the pickup is chosen here first.
export default function NewOrder() {
  const [mapTouch, setMapTouch] = useState(false);   // a finger is moving the map: floating buttons step aside
  const { t, rtl, lang, services } = useApp();
  const prm = useLocalSearchParams<{ plat?: string; plng?: string; pname?: string }>();
  const given = prm.plat && prm.plng ? { lat: Number(prm.plat), lng: Number(prm.plng) } : null;
  const map = useRef<AppMapRef>(null);
  const [pickup, setPickup] = useState<Point | null>(given);
  const [pname, setPname] = useState<string>(prm.pname ?? '');
  const [center, setCenter] = useState<Point>(given ?? ALGIERS);
  const [name, setName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);   // the map just stopped: "Done" waits for the place's name (like inDrive)
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const search = usePlaceSearch();
  const step: 'pickup' | 'dropoff' = pickup ? 'dropoff' : 'pickup';
  useEffect(() => {
    if (!search) return;
    setResolving(true);
    const h = setTimeout(() => { orders(services.client).reverse(center, lang).then(r => setName(r.place?.name ?? null)).catch(() => setName(null)).finally(() => setResolving(false)); }, 500);
    return () => clearTimeout(h);
  }, [center.lat, center.lng, search, lang]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (p: Place) => { const at = { lat: p.lat, lng: p.lng }; setCenter(at); setName(p.name); map.current?.moveTo(at, 17); };
  async function locate() {
    setLocMsg(null);
    const p = await currentPosition();
    if (!p) { setLocMsg(t('location_denied')); return; }
    setCenter(p); map.current?.moveTo(p);
  }
  function confirm() {
    if (step === 'pickup') { setPickup(center); setPname(name ?? ''); setName(null); return; }
    router.push({ pathname: '/order-details', params: { plat: String(pickup!.lat), plng: String(pickup!.lng), pname, dlat: String(center.lat), dlng: String(center.lng), dname: name ?? '' } });
  }

  return (
    <View style={s.root} testID="screen-new-order">
      <View style={{ flex: 1 }}>
        <AppMap onTouching={setMapTouch} ref={map} start={given ?? ALGIERS} zoom={given ? 14 : 13} onMoved={setCenter} centerPin={{ kind: step, label: t(step === 'pickup' ? 'pickup' : 'dropoff'), title: resolving ? null : name }}
          pins={pickup ? [{ id: 'A', at: pickup, kind: 'pickup', label: t('pickup') }] : []} />
        <MapOverlay hidden={mapTouch} style={s.top}>
          <View style={[s.topRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <RoundButton testID="back" icon="arrow-left" label={t('back')} onPress={() => (step === 'dropoff' && !given ? setPickup(null) : router.back())} />
            {pickup ? (
              <View style={[s.card, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                <Icon name="package" tint={color.lime} size={18} />
                <T style={s.cardText} numberOfLines={1}>{pname || t('pickup')}</T>
              </View>
            ) : null}
          </View>
        </MapOverlay>
      </View>
      <Sheet hidden={mapTouch} maxFraction={0.42} testID="dest-sheet" above={<RoundButton testID="my-location" icon="navigation" label={t('my_location')} onPress={locate} />}
        footer={<Button testID="confirm-point" label={t(step === 'pickup' ? 'confirm_pickup' : 'confirm_dropoff')} onPress={confirm} />}>
        <T kind="title" testID="pick-title" style={{ fontSize: 22 }}>{t(step === 'pickup' ? 'pick_pickup_title' : 'pick_dropoff_title')}</T>
        {name ? <T style={s.chosen} testID="chosen-name" numberOfLines={1}>{name}</T> : <T kind="muted">{t('pick_hint')}</T>}
        {search ? <PlaceSearch near={center} placeholder={t(step === 'pickup' ? 'search_pickup' : 'search_dropoff')} onPick={pick} /> : null}
        {locMsg ? <Notice warn text={locMsg} /> : null}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.page },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: { alignItems: 'center', gap: space(3), padding: space(4) },
  card: { flex: 1, alignItems: 'center', gap: space(2), backgroundColor: color.card, borderRadius: radius, paddingHorizontal: space(4), minHeight: 48 },
  cardText: { fontFamily: font.semibold, flex: 1 },
  chosen: { fontFamily: font.bold, fontSize: 18, marginBottom: space(2) },
});
