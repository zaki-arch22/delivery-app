import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useApp, useNotices } from '../lib/app';
import { driver, DriverHome as Home, Job, Offer } from '../lib/driver';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/orders';
import { tracking } from '../lib/tracker';
import { color, font, radius, space } from '../lib/theme';
import { Button, Gap, Notice, Screen, T } from './kit';

const OFFER_CHECK_MS = 5000;   // fallback check for offers while online (the live connection normally brings them at once)

// Driver home (contract C): online switch, today's numbers, the live offer with its countdown, the current job.
export function DriverHome() {
  const { t, state, services } = useApp();
  const api = driver(services.client);
  const p = state.active!;
  const [home, setHome] = useState<Home | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const active = p.status === 'active';
  const fail = (e: unknown) => { const m = errorMessage(e); setMsg({ text: t(m.key, m.vars), warn: true }); };
  const send = useCallback((lat: number, lng: number) => api.location(lat, lng), [services]);   // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const [h, j] = await Promise.all([api.home(), api.job()]);
      setHome(h); setJob(j);
      if (h.online) { await tracking.ensure(send); setOffer(j ? null : await api.offer()); } else { tracking.stop(); setOffer(null); }
    } catch { /* offline: keep what is shown, the next check retries */ }
  }, [services, active]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useNotices(n => { if (n.kind.startsWith('offer.') || n.kind.startsWith('job.') || n.kind.startsWith('cash.') || n.kind.startsWith('profile.')) load(); });
  useEffect(() => { if (!home?.online || job) return; const h = setInterval(() => api.offer().then(setOffer).catch(() => {}), OFFER_CHECK_MS); return () => clearInterval(h); }, [home?.online, job]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!offer) return; const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, [offer]);

  async function toggle() {
    if (!home) return;
    setBusy('online'); setMsg(null);
    try {
      if (!home.online) {
        await api.setOnline(true);
        if (!(await tracking.ensure(send))) { await api.setOnline(false); setMsg({ text: t('location_needed'), warn: true }); }
      } else { await api.setOnline(false); tracking.stop(); }
      await load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function accept() {
    if (!offer) return;
    setBusy('accept'); setMsg(null);
    try { await api.accept(offer.offer_id); setOffer(null); router.push('/job'); }
    catch (e) { fail(e); load(); } finally { setBusy(null); }
  }
  async function decline() {
    if (!offer) return;
    setBusy('decline');
    try { await api.decline(offer.offer_id); } catch { /* already gone */ } finally { setOffer(null); setBusy(null); }
  }

  const statusKey = p.status === 'rejected' ? 'home_driver_rejected' : p.status === 'suspended' ? 'home_driver_suspended' : 'home_driver_pending';
  const left = offer ? Math.max(0, Math.round((new Date(offer.expires_at).getTime() - now) / 1000)) : 0;
  const dist = (m: number | null) => m == null ? '—' : m < 1000 ? t('meters', { n: Math.round(m / 10) * 10 }) : t('kms', { n: (m / 1000).toFixed(1) });
  const cash = offer ? offer.cod_amount_da + (offer.payer === 'recipient' ? offer.price_da : 0) : 0;
  return (
    <Screen testID="screen-home">
      <T kind="title" testID="home-hello">{t('home_hello', { name: p.display_name })}</T>
      <T kind="muted">{t('profile_driver')}</T>
      {state.notice?.code === 'NO_PROFILE_FOR_PATH' ? <Notice testID="notice-no-profile" text={t(state.notice.missing === 'driver' ? 'notice_no_profile_driver' : 'notice_no_profile_user')} /> : null}
      {!active ? <Notice testID="driver-status" warn={p.status === 'suspended' || p.status === 'rejected'} text={t(statusKey)} /> : null}

      {active && home ? (<>
        {job ? <Button testID="continue-job" label={t('continue_job')} sub={job.ref} onPress={() => router.push('/job')} /> : (
          <Button testID="toggle-online" kind={home.online ? 'secondary' : 'primary'} busy={busy === 'online'} label={t(home.online ? 'go_offline' : 'go_online')} onPress={toggle} />
        )}
        <T kind="muted" testID="online-state">{home.online ? '● ' + t('online_now') : '○ ' + t('offline_now')}</T>

        {offer && left > 0 ? (
          <View style={s.offer} testID="offer-card" accessibilityLiveRegion="assertive">
            <T kind="label">{t('offer_title')} · {offer.ref}</T>
            <T style={s.offerPrice} testID="offer-price">{t('offer_price', { p: money(offer.price_da) })}</T>
            <T>{t('offer_pickup', { d: dist(offer.pickup_distance_m) })} · {t('offer_trip', { d: dist(offer.trip_distance_m) })}</T>
            <T testID="offer-cash">{cash > 0 ? '⚠ ' + t('offer_cash', { p: money(cash) }) : t('offer_no_cash')}</T>
            <T kind="muted">{offer.sender_rating ? t('offer_sender', { r: offer.sender_rating }) : t('offer_sender_new')} · {offer.pickup_address.street ?? offer.pickup_address.landmark ?? ''}</T>
            <T kind="muted" testID="offer-left">{t('offer_seconds', { s: left })}</T>
            <View style={s.row}>
              <View style={{ flex: 1 }}><Button testID="decline-offer" kind="secondary" busy={busy === 'decline'} label={t('decline')} onPress={decline} /></View>
              <View style={{ flex: 1 }}><Button testID="accept-offer" busy={busy === 'accept'} label={t('accept')} onPress={accept} /></View>
            </View>
          </View>
        ) : null}

        <View style={s.stats}>
          <Stat label={t('earnings_today')} value={`${money(home.earnings_today_da)} ${t('da')}`} testID="stat-earnings" />
          <Stat label={t('cash_held')} value={`${money(home.cash_held_da)} ${t('da')}`} sub={home.cash_limit_da ? t('cash_limit', { p: money(home.cash_limit_da) }) : t('no_cash_orders')} testID="stat-cash" />
          <Stat label={t('your_rating')} value={home.rating ? `★ ${home.rating}` : t('no_rating')} testID="stat-rating" />
        </View>
      </>) : null}

      {msg ? <Notice testID="driver-msg" warn={msg.warn} text={msg.text} /> : null}
      <Gap n={3} />
      {active ? <Button testID="open-jobs" kind="secondary" label={t('my_jobs')} onPress={() => router.push('/jobs')} /> : null}
      {active ? <Button testID="open-cash" kind="secondary" label={t('my_cash')} onPress={() => router.push('/cash')} /> : null}
      <Button testID="open-settings" kind="plain" label={t('settings')} onPress={() => router.push('/settings')} />
    </Screen>
  );
}

function Stat({ label, value, sub, testID }: { label: string; value: string; sub?: string; testID: string }) {
  return (
    <View style={s.stat} testID={testID}>
      <T kind="muted">{label}</T>
      <T style={s.statValue}>{value}</T>
      {sub ? <T kind="muted">{sub}</T> : null}
    </View>
  );
}
const s = StyleSheet.create({
  offer: { backgroundColor: color.white, borderRadius: radius, borderWidth: 3, borderColor: color.amber, padding: space(4), marginVertical: space(3) },
  offerPrice: { fontFamily: font.bold, fontSize: 34, lineHeight: 48, color: color.navy },
  row: { flexDirection: 'row', gap: space(3) },
  stats: { gap: space(2), marginTop: space(3) },
  stat: { backgroundColor: color.white, borderRadius: radius, borderWidth: 1, borderColor: color.border, padding: space(4) },
  statValue: { fontFamily: font.bold, fontSize: 22, lineHeight: 32, color: color.navy },
});
