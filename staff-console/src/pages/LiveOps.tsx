import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fmtDate, fmtNum, t, tx, useLang } from '../i18n';
import { addressText, dur, ErrorBox, Loading, Pill, useLoad } from '../ui';
import { OrderDetail } from './Orders';
import type { Nav } from '../App';

const REFRESH_MS = 10_000;
const COLS = [{ s: 'searching', k: 'live.searching' }, { s: 'assigned', k: 'live.toPickup' }, { s: 'picked_up', k: 'live.onTheWay' }] as const;
const BAD = ['no_courier_10min', 'parcel_overdue', 'courier_silent', 'code_locked'];

// Live operations (owner's wish, Oct 2026: what is happening NOW, kept apart from the history): every order in progress in
// three columns (searching, going to the pickup, on the way), what needs a hand, the couriers online, and a map.
// Finished orders leave this page and appear in the operations log.
export function LiveOps({ nav }: { nav: Nav }) {
  useLang();
  const { data, error, loading, reload } = useLoad(() => api<any>('/get_live_operations'), []);
  const [only, setOnly] = useState(false), [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const h = window.setInterval(reload, REFRESH_MS); return () => window.clearInterval(h); }, [reload]);
  if (loading && !data) return <><h1>{t('live.titlePage')}</h1><Loading /></>;
  const orders: any[] = data?.orders ?? [], couriers: any[] = data?.couriers ?? [];
  const shown = only ? orders.filter(o => o.flags.length) : orders;
  const flagged = orders.filter(o => o.flags.length).length, free = couriers.filter(c => !c.job_ref).length;
  return (
    <>
      <div className="page-head">
        <h1>{t('live.titlePage')}</h1>
        <span className="muted">{t('dash.updated')}: {data ? fmtDate(data.at) : '—'} <button type="button" className="link" aria-label={t('common.refresh')} onClick={reload}>↻</button></span>
      </div>
      <p className="help">{t('live.help')}</p>
      <ErrorBox error={error} />
      <div className="tiles mb">
        {COLS.map(c => <div key={c.s} className="tile"><span className="tile-v num">{orders.filter(o => o.status === c.s).length}</span><span className="tile-k">{t(c.k)}</span></div>)}
        <div className="tile"><span className="tile-v num">{couriers.length}</span><span className="tile-k">{t('live.couriers')} ({free} {t('live.free')})</span></div>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!only} onClick={() => setOnly(false)}>{t('live.all')} ({orders.length})</button>
        <button type="button" role="tab" aria-selected={only} onClick={() => setOnly(true)}>{t('live.attention')} ({flagged})</button>
      </div>
      <div className="board">
        {COLS.map(c => {
          const list = shown.filter(o => o.status === c.s);
          return (
            <section key={c.s} className="board-col card" aria-label={t(c.k)}>
              <h3>{t(c.k)} <span className="muted">({list.length})</span></h3>
              {!list.length ? <p className="empty">{t('live.none')}</p> : list.map(o => (
                <button type="button" key={o.id} className={'op ' + (o.flags.some((f: string) => BAD.includes(f)) ? 'bad' : o.flags.length ? 'warn' : '')} onClick={() => setOpen(o.id)}>
                  <span className="op-head"><strong className="num">{o.ref}</strong>{o.leg === 'return' && <Pill tone="warn">{t('leg.return')}</Pill>}<span className="muted">{t('live.since', { t: dur(o.in_state_s) })}</span></span>
                  <span className="op-price num">{fmtNum(o.locked_da ?? o.offered_da)} {t('common.da')}{o.cod_amount_da ? ` · 💵 ${fmtNum(o.cod_amount_da)} ${t('common.da')}` : ''}</span>
                  <span className="op-line">📦 {addressText(o.pickup_address)}</span>
                  <span className="op-line">🏁 {addressText(o.dropoff_address)}</span>
                  <span className="op-line muted">{o.user_name}{o.user_phone ? ' · ' + o.user_phone : ''}</span>
                  {o.status === 'searching'
                    ? <span className="op-line muted">{t('live.notified', { n: o.couriers_notified })}{o.bids ? ' · ' + t('live.bids', { n: o.bids }) : ''}</span>
                    : <span className="op-line">🛵 {o.driver_name}{o.driver_phone ? ' · ' + o.driver_phone : ''} <span className="muted">· {o.driver_seen_s == null ? t('live.noPos') : t('live.seen', { t: dur(o.driver_seen_s) })}</span></span>}
                  {o.flags.length > 0 && <span className="op-flags">{o.flags.map((f: string) => <Pill key={f} tone={BAD.includes(f) ? 'bad' : 'warn'}>{tx('flag.' + f, f)}</Pill>)}</span>}
                </button>))}
            </section>);
        })}
      </div>
      <div className="split-even">
        <section className="card" aria-label={t('live.map')}>
          <h3>{t('live.map')}</h3>
          <LiveMap orders={orders} couriers={couriers} />
        </section>
        <section className="card" aria-label={t('live.couriers')}>
          <h3>{t('live.couriers')} ({couriers.length})</h3>
          {!couriers.length ? <p className="empty">{t('live.none')}</p> : (
            <ul className="plain-list">{couriers.map(c => (
              <li key={c.id}>
                <span><strong>{c.display_name}</strong> <span className="muted">· {tx('vehicle.' + c.vehicle)}{c.phone ? ' · ' + c.phone : ''}</span></span>
                <span className="row">{c.job_ref ? <Pill tone="info">{t('live.busy', { ref: c.job_ref })}</Pill> : <Pill tone="good">{t('live.free')}</Pill>}
                  <span className={'muted small' + (c.seen_s == null || c.seen_s > 120 ? ' error-text' : '')}>{c.seen_s == null ? t('live.noPos') : t('live.seen', { t: dur(c.seen_s) })}</span>
                  <button type="button" onClick={() => nav.go('trust', { profileId: c.id })}>{t('users.record')}</button></span>
              </li>))}</ul>)}
        </section>
      </div>
      {open && <OrderDetail id={open} nav={nav} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

// The map of what is happening: pickups of orders in progress (by state) and couriers online. Loaded only in a real browser
// (it needs WebGL); same free map style as the app (our server's /map/style.json, OpenFreeMap tiles).
function LiveMap({ orders, couriers }: { orders: any[]; couriers: any[] }) {
  const box = useRef<HTMLDivElement>(null), map = useRef<any>(null), marks = useRef<any[]>([]);
  const [off, setOff] = useState(false);
  useEffect(() => {
    let dead = false;
    if (typeof window === 'undefined' || !('WebGLRenderingContext' in window) || /jsdom/i.test(navigator.userAgent)) { setOff(true); return; }
    (async () => {
      try {
        const mod: any = await import('maplibre-gl'); const ml = mod.default ?? mod;
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (dead || !box.current) return;
        const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
        map.current = new ml.Map({ container: box.current, style: base + '/map/style.json', center: [3.06, 36.75], zoom: 11, attributionControl: { compact: true } });
        map.current.addControl(new ml.NavigationControl({ showCompass: false }));
        (map.current as any).__ml = ml;
        draw();
      } catch { setOff(true); }
    })();
    return () => { dead = true; map.current?.remove(); map.current = null; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const draw = () => {
    const m = map.current; if (!m) return; const ml = m.__ml;
    marks.current.forEach(x => x.remove()); marks.current = [];
    const dot = (cls: string, title: string) => { const e = document.createElement('div'); e.className = 'map-dot ' + cls; e.title = title; return e; };
    for (const o of orders) marks.current.push(new ml.Marker({ element: dot('o-' + o.status, `${o.ref} · ${tx('status.' + o.status)}`) }).setLngLat([o.pickup_lng, o.pickup_lat]).addTo(m));
    for (const c of couriers) if (c.lat != null) marks.current.push(new ml.Marker({ element: dot(c.job_ref ? 'c-busy' : 'c-free', c.display_name) }).setLngLat([c.lng, c.lat]).addTo(m));
    const pts = [...orders.map(o => [o.pickup_lng, o.pickup_lat]), ...couriers.filter(c => c.lat != null).map(c => [c.lng, c.lat])];
    if (pts.length && !m.__fitted) { const b = new ml.LngLatBounds(pts[0], pts[0]); pts.forEach(p => b.extend(p)); m.fitBounds(b, { padding: 50, maxZoom: 14, duration: 0 }); m.__fitted = true; }
  };
  useEffect(draw, [orders, couriers]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (off) return <p className="muted">{t('live.mapOff')}</p>;
  return (<>
    <div ref={box} className="live-map" role="img" aria-label={t('live.map')} />
    <div className="map-legend small"><span><i className="map-dot o-searching" /> {t('live.searching')}</span><span><i className="map-dot o-assigned" /> {t('live.toPickup')}</span><span><i className="map-dot o-picked_up" /> {t('live.onTheWay')}</span><span><i className="map-dot c-free" /> {t('live.free')}</span><span><i className="map-dot c-busy" /> {t('live.onJob')}</span></div>
  </>);
}
