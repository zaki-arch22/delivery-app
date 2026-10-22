import { useEffect, useState } from 'react';
import { fmtDate, fmtNum, t, useLang, Key } from '../i18n';
import { ErrorBox, Loading } from '../ui';
import { FeedList, useLive } from '../live';
import type { Nav, Page } from '../App';

type Tile = { k: string; v: number | null; unit?: 'da' | 'min' | 's'; go?: Page; tone?: 'warn' | 'bad' | 'good' };
const dur = (s: number | null) => (s == null ? '—' : s < 90 ? `${s} s` : `${Math.round(s / 60)} ${t('dash.min')}`);

// The whole platform at a glance (get_dashboard, refreshed every 30 s) and the live activity (get_staff_feed).
export function Dashboard({ nav }: { nav: Nav }) {
  useLang();
  const { dash, items, refreshDash } = useLive();
  useEffect(() => { refreshDash(); }, [refreshDash]);   // fresh numbers every time the page opens
  if (!dash) return <><h1>{t('dash.title')}</h1><Loading /></>;
  const o = dash.orders, p = dash.people, m = dash.money, c = dash.cases;
  const groups: { title: Key; tiles: Tile[] }[] = [
    { title: 'dash.cases', tiles: [
      { k: 'sos_24h', v: c.sos_24h, go: 'problems', tone: c.sos_24h ? 'bad' : undefined }, { k: 'settle_disputed', v: m.settle_disputed, go: 'settlements', tone: m.settle_disputed ? 'bad' : undefined },
      { k: 'settle_overdue', v: m.settle_overdue, go: 'settlements', tone: m.settle_overdue ? 'bad' : undefined }, { k: 'problems_open', v: c.problems_open, go: 'problems', tone: c.problems_open ? 'warn' : undefined },
      { k: 'drivers_pending', v: p.drivers_pending, go: 'drivers', tone: p.drivers_pending ? 'warn' : undefined }, { k: 'topups_pending', v: m.topups_pending, go: 'wallets', tone: m.topups_pending ? 'warn' : undefined },
      { k: 'appeals', v: c.appeals, go: 'trust', tone: c.appeals ? 'warn' : undefined }, { k: 'locked_codes', v: c.locked_codes, go: 'orders' }] },
    { title: 'dash.now', tiles: [
      { k: 'searching_now', v: o.searching_now, go: 'orders' }, { k: 'active_now', v: o.active_now, go: 'orders' }, { k: 'drivers_online', v: p.drivers_online, go: 'drivers' },
      { k: 'avg_assign', v: o.avg_assign_s, unit: 's' }, { k: 'avg_trip', v: o.avg_trip_s, unit: 's' }] },
    { title: 'dash.today', tiles: [
      { k: 'created_today', v: o.created_today, go: 'orders' }, { k: 'delivered_today', v: o.delivered_today, go: 'orders', tone: 'good' }, { k: 'cancelled_today', v: o.cancelled_today }, { k: 'failed_today', v: o.failed_today },
      { k: 'fees_today', v: o.fees_today_da, unit: 'da' }, { k: 'cod_today', v: o.cod_today_da, unit: 'da' }] },
    { title: 'dash.money', tiles: [
      { k: 'cash_held', v: m.cash_held_da, unit: 'da', go: 'cash' }, { k: 'settle_pending', v: m.settle_pending_da, unit: 'da', go: 'settlements' }, { k: 'settle_sent', v: m.settle_sent, go: 'settlements' },
      { k: 'paid_to_sellers_30d', v: m.paid_to_sellers_30d_da, unit: 'da' }, { k: 'commission_today', v: m.commission_today_da, unit: 'da' }, { k: 'commission_30d', v: m.commission_30d_da, unit: 'da' }, { k: 'wallets_owing', v: m.wallets_owing, go: 'wallets' }] },
    { title: 'dash.people', tiles: [
      { k: 'users', v: p.users, go: 'customers' }, { k: 'users_new_7d', v: p.users_new_7d, go: 'customers' }, { k: 'drivers', v: p.drivers, go: 'drivers' }, { k: 'blocked', v: p.blocked, go: 'trust' }, { k: 'delivered_total', v: o.delivered_total }] },
  ];
  const value = (x: Tile) => (x.unit === 's' ? dur(x.v) : `${fmtNum(x.v)}${x.unit === 'da' ? ' ' + t('common.da') : ''}`);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('dash.title')}</h1>
        <span className="muted">{t('dash.updated')}: {fmtDate(dash.at)} <button type="button" className="link" aria-label={t('dash.updated')} onClick={refreshDash}>↻</button></span>
      </div>
      {!dash.wallet_active && <p className="help">{t('dash.walletOff')}</p>}
      <div className="dash">
        <div className="dash-main">
          {groups.map(g => (
            <section key={g.title} className="card" aria-label={t(g.title)}>
              <h3>{t(g.title)}</h3>
              <div className="tiles">
                {g.tiles.map(x => {
                  const body = <><span className="tile-v num">{value(x)}</span><span className="tile-k">{t(('dash.' + x.k) as Key)}</span></>;
                  return x.go ? <button type="button" key={x.k} className={'tile ' + (x.tone ?? '')} onClick={() => nav.go(x.go!)}>{body}</button>
                    : <div key={x.k} className={'tile ' + (x.tone ?? '')}>{body}</div>;
                })}
              </div>
            </section>))}
          <DeliveredChart days={dash.days} />
        </div>
        <aside className="card dash-feed" aria-label={t('live.title')}>
          <h3>{t('live.title')}</h3>
          <FeedList items={items} limit={30} onOpenOrder={id => nav.go('orders', { orderId: id })} />
        </aside>
      </div>
      <ErrorBox error={null} />
    </>
  );
}

// One series (delivered orders per day): thin bars from the baseline, a hover tooltip, and a table view.
function DeliveredChart({ days }: { days: { day: string; created: number; delivered: number; fees_da: number }[] }) {
  const [table, setTable] = useState(false), [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 180, pad = 28, max = Math.max(1, ...days.map(d => d.delivered));
  const step = (W - pad * 2) / days.length, bw = Math.max(6, Math.min(26, step - 8));
  const y = (v: number) => H - pad - ((H - pad * 2) * v) / max;
  const h = hover == null ? null : days[hover];
  return (
    <section className="card" aria-label={t('dash.chart')}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>{t('dash.chart')}</h3><button type="button" className="link" onClick={() => setTable(!table)}>{t(table ? 'dash.chartHide' : 'dash.chartTable')}</button></div>
      <div className="chart" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('dash.chart')} preserveAspectRatio="none">
          {[0, 0.5, 1].map(f => <line key={f} x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} className="grid" />)}
          <text x={4} y={y(max) + 4} className="axis">{max}</text><text x={4} y={y(0) + 4} className="axis">0</text>
          {days.map((d, i) => {
            const x = pad + i * step + (step - bw) / 2, top = y(d.delivered), hgt = Math.max(0, y(0) - top);
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)}>
                <rect x={pad + i * step} y={pad / 2} width={step} height={H - pad} fill="transparent" />
                {hgt > 0 && <path className={'bar' + (hover === i ? ' on' : '')} d={`M${x},${y(0)} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${y(0)} Z`} />}
                {(i % 2 === days.length % 2 || i === days.length - 1) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="axis">{d.day.slice(8)}/{d.day.slice(5, 7)}</text>}
              </g>);
          })}
        </svg>
        {h && <div className="tip" style={{ left: `${((pad + hover! * step + step / 2) / W) * 100}%` }}><strong>{h.day}</strong><div>{t('dash.deliveredCol')}: <span className="num">{h.delivered}</span></div><div className="muted">{t('dash.createdCol')}: {h.created} · {fmtNum(h.fees_da)} {t('common.da')}</div></div>}
      </div>
      {table && <div className="table-wrap"><table><thead><tr><th>{t('dash.day')}</th><th>{t('dash.createdCol')}</th><th>{t('dash.deliveredCol')}</th><th>{t('dash.feesCol')}</th></tr></thead>
        <tbody>{days.map(d => <tr key={d.day}><td className="num">{d.day}</td><td className="num">{d.created}</td><td className="num">{d.delivered}</td><td className="num">{fmtNum(d.fees_da)}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
