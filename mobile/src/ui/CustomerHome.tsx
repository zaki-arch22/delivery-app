import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useApp, useNotices } from '../lib/app';
import { ALGIERS } from '../lib/config';
import { currentPosition, Point } from '../lib/location';
import { ACTIVE, Order, orders, Place } from '../lib/orders';
import { addIncoming, Incoming, listIncoming } from '../lib/incoming';
import { listRecent, RecentPlace } from '../lib/recent';
import { usePlaceSearch } from '../lib/features';
import { errorMessage } from '../lib/errors';
import { color, font, radius, space } from '../lib/theme';
import type { Key } from '../i18n';
import { AppMap, AppMapRef } from './AppMap';
import { Sheet } from './Sheet';
import { Drawer } from './Drawer';
import { PlaceSearch } from './PlaceSearch';
import { MapOverlay, Button, Notice, RoundButton, T } from './kit';
import { Icon } from './Icon';

// Customer mode home (inDrive-style): the map fills the screen, the pickup point is under the fixed pin (move the map, or
// search), and the panel below asks "Where to, and for how much?". Parcels on their way and requests to receive a parcel
// appear on top of the panel.
export function CustomerHome() {
  const [mapTouch, setMapTouch] = useState(false);   // a finger is moving the map: floating buttons step aside
  const { t, lang, rtl, services, state } = useApp();
  const api = orders(services.client);
  const map = useRef<AppMapRef>(null);
  const [menu, setMenu] = useState(false);
  const [center, setCenter] = useState<Point>(ALGIERS);
  const [place, setPlace] = useState<string | null>(null);
  const [noLoc, setNoLoc] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState<Order[]>([]);
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [recent, setRecent] = useState<RecentPlace[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const search = usePlaceSearch();

  const load = useCallback(() => {
    api.list(1).then(r => setActive(r.orders.filter(o => ACTIVE.includes(o.status)))).catch(() => {});
    listIncoming(services.store).then(setIncoming);
    listRecent(services.store).then(setRecent);
  }, [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(load);
  useNotices(n => {
    if (n.kind === 'order.incoming') addIncoming(services.store, n.data, n.order_id).then(setIncoming);
    else if (n.order_id) load();
  });

  const locate = useCallback(async () => {
    const p = await currentPosition();
    if (!p) { setNoLoc(true); return; }
    setNoLoc(false); setCenter(p); map.current?.moveTo(p, 16);
  }, []);
  useEffect(() => { locate(); }, [locate]);
  // The street name under the pin (only when search is on). Waits until the map stops moving.
  useEffect(() => {
    if (!search) return;
    const h = setTimeout(() => { api.reverse(center, lang).then(r => setPlace(r.place?.name ?? null)).catch(() => setPlace(null)); }, 700);
    return () => clearTimeout(h);
  }, [center.lat, center.lng, search, lang]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pickupParams = { plat: String(center.lat), plng: String(center.lng), pname: place ?? '' };
  const whereTo = () => router.push({ pathname: '/new-order', params: pickupParams });
  const again = (r: RecentPlace) => router.push({ pathname: '/order-details', params: { ...pickupParams, dlat: String(r.lat), dlng: String(r.lng), dname: r.name, daddr: JSON.stringify(r.address), rname: r.recipient_name ?? '', rphone: r.recipient_phone ?? '' } });
  const pickPickup = (p: Place) => { setSearching(false); setCenter({ lat: p.lat, lng: p.lng }); setPlace(p.name); map.current?.moveTo({ lat: p.lat, lng: p.lng }, 17); };

  return (
    <View style={s.root} testID="screen-home">
      <View style={{ flex: 1 }}>
        <AppMap onTouching={setMapTouch} ref={map} start={ALGIERS} zoom={13} onMoved={setCenter} centerPin={{ kind: 'pickup', label: t('pickup') }} />
        <MapOverlay hidden={mapTouch} style={s.top}>
          {noLoc ? (
            <Pressable testID="location-banner" onPress={locate} style={s.banner} accessibilityRole="button">
              <T style={s.bannerTitle}>{t('loc_banner_title')}</T><T style={s.bannerSub}>{t('loc_banner_sub')}</T>
            </Pressable>
          ) : null}
          <View style={[s.topRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]} pointerEvents="box-none">
            <RoundButton testID="open-menu" icon="menu" label={t('menu')} onPress={() => setMenu(true)} />
            <Pressable testID="pickup-card" onPress={() => search && setSearching(true)} style={s.pickupCard} accessibilityRole="button" accessibilityLabel={t('pickup_point')}>
              <View style={{ flex: 1 }}>
                <T kind="muted" style={{ fontSize: 13 }}>{t('pickup_point')}</T>
                <T style={s.pickupName} numberOfLines={1}>{place ?? t('pickup_move_map')}</T>
              </View>
              {search ? <Icon name="search" size={18} tint={color.muted} /> : null}
            </Pressable>
          </View>
        </MapOverlay>
        <MapOverlay hidden={mapTouch} style={[s.locate, rtl ? { left: space(4) } : { right: space(4) }]}><RoundButton testID="my-location" icon="navigation" label={t('my_location')} onPress={locate} /></MapOverlay>
      </View>

      <Sheet inline maxFraction={0.5} testID="home-sheet">
        {searching ? (<>
          <PlaceSearch autoFocus near={center} placeholder={t('search_pickup')} onPick={pickPickup} testID="pickup-search" />
          <Button kind="plain" label={t('close')} onPress={() => setSearching(false)} />
        </>) : (<>
          <T kind="muted" testID="home-hello">{t('home_hello', { name: state.active?.display_name ?? '' })}</T>
          {state.notice?.code === 'NO_PROFILE_FOR_PATH' ? <Notice testID="notice-no-profile" text={t(state.notice.missing === 'driver' ? 'notice_no_profile_driver' : 'notice_no_profile_user')} /> : null}
          {incoming.map(i => (
            <View key={i.order_id} style={s.incoming} testID={'incoming-' + i.ref}>
              <T style={s.strong}>📦 {i.sender ? t('incoming_from', { name: i.sender }) : t('incoming_title')} · {i.ref}</T>
              <T>{t('incoming_code', { code: i.delivery_code })}</T>
            </View>
          ))}
          {active.map(o => (
            <Pressable key={o.id} testID={'order-' + o.ref} onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })} style={[s.active, { flexDirection: rtl ? 'row-reverse' : 'row' }]} accessibilityRole="button">
              <Icon name="package" tint={color.lime} />
              <View style={{ flex: 1 }}><T style={s.strong}>{t(('st_' + o.status) as Key, { name: o.recipient_name })}</T><T kind="muted" numberOfLines={1}>{o.ref} · {o.recipient_name}</T></View>
              <Icon name="chevron-right" tint={color.muted} />
            </Pressable>
          ))}
          <Pressable testID="send-parcel" onPress={whereTo} style={[s.where, { flexDirection: rtl ? 'row-reverse' : 'row' }]} accessibilityRole="button" accessibilityLabel={t('where_to')}>
            <Icon name="search" size={24} />
            <T style={s.whereText}>{t('where_to')}</T>
          </Pressable>
          {recent.map((r, i) => (
            <Pressable key={i} testID={'recent-' + i} onPress={() => again(r)} style={[s.recent, { flexDirection: rtl ? 'row-reverse' : 'row' }]} accessibilityRole="button">
              <Icon name="clock" tint={color.muted} />
              <View style={{ flex: 1 }}><T style={s.strong} numberOfLines={1}>{r.name}</T>{r.recipient_name ? <T kind="muted" numberOfLines={1}>{r.recipient_name}</T> : null}</View>
            </Pressable>
          ))}
        </>)}
      </Sheet>
      <Drawer open={menu} onClose={() => setMenu(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.page },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  banner: { backgroundColor: color.amber, paddingVertical: space(3), paddingHorizontal: space(4), alignItems: 'center' },
  bannerTitle: { color: color.ink, fontFamily: font.bold, textAlign: 'center' },
  bannerSub: { color: color.ink, textAlign: 'center' },
  topRow: { alignItems: 'center', gap: space(3), padding: space(4) },
  pickupCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space(2), backgroundColor: color.card, borderRadius: radius, paddingHorizontal: space(4), paddingVertical: space(2) },
  pickupName: { fontFamily: font.bold, fontSize: 17 },
  locate: { position: 'absolute', bottom: space(10) },
  where: { alignItems: 'center', gap: space(3), backgroundColor: color.card2, borderRadius: 18, paddingHorizontal: space(4), minHeight: 64, marginVertical: space(2) },
  whereText: { fontFamily: font.bold, fontSize: 20, flex: 1 },
  recent: { alignItems: 'center', gap: space(4), paddingVertical: space(3) },
  strong: { fontFamily: font.semibold },
  active: { alignItems: 'center', gap: space(3), backgroundColor: color.card2, borderRadius: radius, padding: space(3), marginVertical: space(1) },
  incoming: { borderWidth: 2, borderColor: color.lime, borderRadius: radius, padding: space(3), marginVertical: space(1) },
  row2: { gap: space(3) },
});
