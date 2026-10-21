import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { photoBlob, pickPhoto } from '../lib/photos';
import { ApiError } from '../core/api';
import { useApp, useNotices } from '../lib/app';
import { driver, DriverHome as Home, Job, Request } from '../lib/driver';
import { errorMessage } from '../lib/errors';
import { minutes, money } from '../lib/orders';
import { lastPosition, onPosition, tracking } from '../lib/tracker';
import { ALGIERS } from '../lib/config';
import { color, font, radius, space } from '../lib/theme';
import { AppMap, AppMapRef, Pin } from './AppMap';
import { Sheet } from './Sheet';
import { Drawer } from './Drawer';
import { MapOverlay, Button, Notice, RoundButton, T } from './kit';
import { Icon } from './Icon';

const REQUEST_CHECK_MS = 5000;   // fallback check while online (the live connection normally brings requests at once)

// Courier mode home (contract C): the map with my position, the big online switch, and while online the requests near me.
// Several couriers see a request at once: I accept the customer's price or offer a higher one, then the customer chooses.
export function DriverHome() {
  const [mapTouch, setMapTouch] = useState(false);   // a finger is moving the map: floating buttons step aside
  const { t, rtl, state, services } = useApp();
  const api = driver(services.client);
  const p = state.active!;
  const map = useRef<AppMapRef>(null);
  const [menu, setMenu] = useState(false);
  const [home, setHome] = useState<Home | null>(null);
  const [reqs, setReqs] = useState<Request[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [me, setMe] = useState(lastPosition());
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const active = p.status === 'active';
  const fail = (e: unknown) => { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); };
  const send = useCallback((lat: number, lng: number) => api.location(lat, lng), [services]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onPosition(setMe), []);
  // While online and free, the same searching pulse as the customer's (waves leaving his position) shows he is waiting.

  // Only the LATEST refresh may change the screen: an older answer arriving late ("offline") must not undo a newer one.
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!active) return;
    const mine = ++seq.current;
    try {
      const [h, j] = await Promise.all([api.home(), api.job()]);
      if (mine !== seq.current) return;
      setHome(h); setJob(j);
      if (h.online) { await tracking.ensure(send); setReqs(j ? [] : await api.requests()); } else { tracking.stop(); setReqs([]); }
    } catch { /* offline: keep what is shown, the next check retries */ }
  }, [services, active]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useNotices(n => {
    if (n.kind === 'bid.accepted') { setOpen(null); router.push('/job'); return; }
    if (n.kind === 'bid.declined') setMsg({ text: t('bid_declined'), warn: true });
    if (n.kind === 'bid.expired') setMsg({ text: t('bid_expired') });
    if (n.kind.startsWith('offer.') || n.kind.startsWith('bid.') || n.kind.startsWith('job.') || n.kind.startsWith('cash.') || n.kind.startsWith('profile.')) load();
  });
  useEffect(() => { if (!home?.online || job) return; const h = setInterval(() => api.requests().then(setReqs).catch(() => {}), REQUEST_CHECK_MS); return () => clearInterval(h); }, [home?.online, job]);   // eslint-disable-line react-hooks/exhaustive-deps
  const free = !!home?.online && !job;
  const radar = free && me ? { at: me, grow: 1 } : null;
  const waiting = reqs.find(r => r.status === 'bid');
  useEffect(() => { if (!waiting) return; const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, [waiting?.offer_id]);

  // Once a week the courier takes a selfie before going online (the approved person is the one working).
  async function selfieThenOnline() {
    const ph = await pickPhoto('camera', true);
    if (ph === 'denied') { setMsg({ text: t('camera_needed'), warn: true }); return false; }
    if (!ph) return false;
    const r = await services.client.call<{ document_id: string }>('/upload_document?kind=selfie_photo', await photoBlob(ph.uri));
    await services.client.call('/submit_selfie', { document_id: r.document_id });
    await api.setOnline(true);
    return true;
  }
  async function toggle() {
    if (!home) return;
    setBusy('online'); setMsg(null);
    try {
      if (!home.online) {
        try { await api.setOnline(true); }
        catch (e) {
          if (!(e instanceof ApiError && e.code === 'SELFIE_REQUIRED')) throw e;
          setMsg({ text: t('selfie_needed') });
          if (!(await selfieThenOnline())) return;
        }
        if (!(await tracking.ensure(send))) { await api.setOnline(false); setMsg({ text: t('location_needed'), warn: true }); }
        else { const pos = lastPosition(); if (pos) map.current?.moveTo(pos, 13); }
      } else { await api.setOnline(false); tracking.stop(); }
      await load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function bid(r: Request, price?: number) {
    setBusy('bid' + (price ?? 'own')); setMsg(null);
    try {
      const out = await api.bid(r.offer_id, price);
      if (out.job) { setOpen(null); router.push('/job'); return; }
      await load();
    } catch (e) { fail(e); load(); } finally { setBusy(null); }
  }
  async function skip(r: Request) {
    setBusy('skip');
    try { await api.decline(r.offer_id); } catch { /* already gone */ } finally { setOpen(null); setBusy(null); load(); }
  }

  const statusKey = p.status === 'rejected' ? 'home_driver_rejected' : p.status === 'suspended' ? 'home_driver_suspended' : 'home_driver_pending';
  const dist = (m: number | null) => m == null ? '—' : m < 1000 ? t('meters', { n: Math.round(m / 10) * 10 }) : t('kms', { n: (m / 1000).toFixed(1) });
  const cashOf = (r: Request) => r.cod_amount_da + (r.payer === 'recipient' ? (r.my_price_da ?? r.price_da) : 0);
  const sel = reqs.find(r => r.offer_id === open) ?? waiting ?? null;
  const pins: Pin[] = [];
  if (me) pins.push({ id: 'me', at: me, kind: 'driver', label: t('you_are_here'), vehicle: undefined });
  if (sel) pins.push({ id: 'A', at: { lat: sel.pickup_lat, lng: sel.pickup_lng }, kind: 'pickup', label: t('pickup') }, { id: 'B', at: { lat: sel.dropoff_lat, lng: sel.dropoff_lng }, kind: 'dropoff', label: t('dropoff') });
  const fit = sel ? [...(me ? [me] : []), { lat: sel.pickup_lat, lng: sel.pickup_lng }, { lat: sel.dropoff_lat, lng: sel.dropoff_lng }] : undefined;

  return (
    <View style={s.root} testID="screen-home">
      <AppMap pulse={radar} onTouching={setMapTouch} ref={map} start={me ?? ALGIERS} zoom={me ? 13 : 12} pins={pins} fit={fit} pad={{ top: 120, bottom: 420 }} />
      <MapOverlay hidden={mapTouch} style={s.top}>
        <View style={[s.topRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          <RoundButton testID="open-menu" icon="menu" label={t('menu')} onPress={() => setMenu(true)} />
          {active && home ? (
            <Pressable testID="online-pill" onPress={job ? undefined : toggle} accessibilityRole="switch" accessibilityState={{ checked: home.online }} style={[s.pill, home.online && s.pillOn]}>
              <View style={[s.dot, home.online && s.dotOn]} />
              <T style={[s.pillText, home.online && { color: color.ink }]} testID="online-state">{home.online ? t('pill_online') : t('pill_offline')}</T>
            </Pressable>
          ) : null}
        </View>
      </MapOverlay>

      <Sheet hidden={mapTouch} testID="driver-sheet" maxFraction={0.62} peek={150}>
        {!sel ? <T kind="title" testID="home-hello" style={{ fontSize: 22 }}>{t('home_hello', { name: p.display_name })}</T> : null}
        {home?.online && !me ? <Notice testID="no-location" warn text={t('waiting_location')} /> : null}
        {state.notice?.code === 'NO_PROFILE_FOR_PATH' ? <Notice testID="notice-no-profile" text={t(state.notice.missing === 'driver' ? 'notice_no_profile_driver' : 'notice_no_profile_user')} /> : null}
        {!active ? <Notice testID="driver-status" warn={p.status === 'suspended' || p.status === 'rejected'} text={t(statusKey)} /> : null}
        {msg ? <Notice testID="driver-msg" warn={msg.warn} text={msg.text} /> : null}

        {active && home ? (<>
          {!sel ? (
            <View style={[s.stats, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              <Stat label={t('earnings_today')} value={`${money(home.earnings_today_da)}`} unit={t('da')} testID="stat-earnings" />
              <Stat label={t('cash_held')} value={`${money(home.cash_held_da)}`} unit={t('da')} testID="stat-cash" />
              <Stat label={t('your_rating')} value={home.rating ? `★ ${home.rating}` : '—'} testID="stat-rating" />
            </View>
          ) : null}
          {job ? <Button testID="continue-job" icon="navigation" label={t('continue_job')} sub={job.ref} onPress={() => router.push('/job')} /> : !home.online ? (<>
            <Button testID="toggle-online" busy={busy === 'online'} icon="power" label={t('go_online')} onPress={toggle} />
            <T kind="muted">{home.cash_limit_da ? t('cash_limit', { p: money(home.cash_limit_da) }) : t('no_cash_orders')}</T>
          </>) : sel ? (
            <RequestDetail r={sel} now={now} busy={busy} dist={dist} cash={cashOf(sel)} onBid={pr => bid(sel, pr)} onSkip={() => skip(sel)} onBack={() => setOpen(null)} />
          ) : (<>
            <T kind="label" testID="requests-title">{t('requests_near')}</T>
            {reqs.length === 0 ? <T kind="muted" testID="no-requests">{t('requests_none')}</T> : null}
            {reqs.map(r => (
              <Pressable key={r.offer_id} testID={'request-' + r.ref} onPress={() => setOpen(r.offer_id)} style={[s.req, { flexDirection: rtl ? 'row-reverse' : 'row' }]} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <T style={s.reqPrice}>{money(r.price_da)} {t('da')}</T>
                  <T kind="muted">{t('offer_pickup', { d: dist(r.pickup_distance_m) })} · {t('offer_trip', { d: dist(r.trip_distance_m) })}</T>
                  {cashOf(r) > 0 ? <T style={s.cash}>💵 {t('offer_cash', { p: money(cashOf(r)) })}</T> : null}
                </View>
                <Icon name="chevron-right" tint={color.muted} />
              </Pressable>
            ))}
            <Button testID="toggle-online" kind="secondary" busy={busy === 'online'} icon="power" label={t('go_offline')} onPress={toggle} />
          </>)}
        </>) : null}
      </Sheet>
      <Drawer open={menu} onClose={() => setMenu(false)} />
    </View>
  );
}

// One request, opened: the customer's price, distances, cash to collect, size, the sender's rating; accept or offer more.
function RequestDetail({ r, now, busy, dist, cash, onBid, onSkip, onBack }: { r: Request; now: number; busy: string | null; dist: (m: number | null) => string; cash: number; onBid: (p?: number) => void; onSkip: () => void; onBack: () => void }) {
  const { t, rtl } = useApp();
  const ups = [50, 100, 200].map(n => Math.ceil((r.price_da + n) / 10) * 10).filter(v => v <= r.max_da);
  if (r.status === 'bid') {
    const left = r.bid_expires_at ? Math.max(0, Math.round((new Date(r.bid_expires_at).getTime() - now) / 1000)) : 0;
    return (
      <View testID="bid-waiting" accessibilityLiveRegion="polite">
        <T kind="label">{t('bid_waiting')}</T>
        <T style={s.reqPrice}>{money(r.my_price_da ?? r.price_da)} {t('da')}</T>
        <T kind="muted">{t('bid_waiting_sub', { s: left })}</T>
        <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.round((left / 40) * 100))}%` }]} /></View>
      </View>
    );
  }
  return (
    <View testID="offer-card" accessibilityLiveRegion="assertive">
      <View style={[s.detailHead, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('back')} hitSlop={10} testID="request-back"><Icon name="arrow-left" /></Pressable>
        <T kind="label" style={{ flex: 1 }}>{t('offer_title')} · {r.ref}</T>
      </View>
      <T style={s.bigPrice} testID="offer-price">{money(r.price_da)} {t('da')}</T>
      <T>{t('offer_pickup', { d: dist(r.pickup_distance_m) })} · {t('offer_trip', { d: dist(r.trip_distance_m) })} · ~{minutes(r.trip_duration_s)} {t('min')}</T>
      <T testID="offer-cash" style={cash > 0 ? s.cash : undefined}>{cash > 0 ? '💵 ⚠ ' + t('offer_cash', { p: money(cash) }) : t('offer_no_cash')}</T>
      <T kind="muted">{t(`size_${r.size}` as any)} · {r.sender_rating ? t('offer_sender', { r: r.sender_rating }) : t('offer_sender_new')} · {r.pickup_address.street ?? r.pickup_address.landmark ?? ''}</T>
      <Button testID="sender-profile" kind="plain" icon="user" label={t('see_sender_profile')} onPress={() => router.push({ pathname: '/public-profile', params: { offer_id: String(r.offer_id) } })} />
      <Button testID="accept-offer" busy={busy === 'bidown'} label={t('accept_for', { p: money(r.price_da) })} onPress={() => onBid()} />
      {ups.length ? (<>
        <T kind="muted">{t('offer_your_price')}</T>
        <View style={[s.ups, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          {ups.map(v => <Button key={v} testID={'bid-' + v} kind="secondary" style={{ flex: 1 }} busy={busy === 'bid' + v} label={money(v)} a11y={t('offer_price_btn', { p: money(v) })} onPress={() => onBid(v)} />)}
        </View>
      </>) : null}
      <Button testID="decline-offer" kind="plain" busy={busy === 'skip'} label={t('not_for_me')} onPress={onSkip} />
    </View>
  );
}

function Stat({ label, value, unit, testID }: { label: string; value: string; unit?: string; testID: string }) {
  return (
    <View style={s.stat} testID={testID}>
      <T kind="muted" style={{ fontSize: 13 }}>{label}</T>
      <T style={s.statValue}>{value}{unit ? <T kind="muted"> {unit}</T> : null}</T>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.page },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: { alignItems: 'center', gap: space(3), padding: space(4) },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space(2), backgroundColor: color.card, borderRadius: 999, paddingHorizontal: space(5), minHeight: 52 },
  pillOn: { backgroundColor: color.lime },
  pillText: { fontFamily: font.bold, fontSize: 17 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: color.muted },
  dotOn: { backgroundColor: color.ink, borderColor: color.ink },
  stats: { gap: space(2), marginVertical: space(2) },
  stat: { flex: 1, backgroundColor: color.card2, borderRadius: radius, padding: space(3) },
  statValue: { fontFamily: font.bold, fontSize: 20, lineHeight: 30 },
  req: { alignItems: 'center', gap: space(3), backgroundColor: color.card2, borderRadius: 20, padding: space(4), marginVertical: space(1.5) },
  reqPrice: { fontFamily: font.bold, fontSize: 24, lineHeight: 34 },
  bigPrice: { fontFamily: font.bold, fontSize: 36, lineHeight: 50 },
  cash: { color: color.amber, fontFamily: font.semibold },
  detailHead: { alignItems: 'center', gap: space(3) },
  ups: { gap: space(2) },
  bar: { height: 5, borderRadius: 3, backgroundColor: color.card2, overflow: 'hidden', marginVertical: space(2) },
  barFill: { height: 5, backgroundColor: color.pureWhite },
});
