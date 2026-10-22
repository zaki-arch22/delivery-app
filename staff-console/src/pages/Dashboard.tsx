import { useEffect } from 'react';
import { fmtDate, fmtNum, t, useLang, Key } from '../i18n';
import { dur, Loading } from '../ui';
import { AlertList, useLive } from '../live';
import type { Nav, Page } from '../App';

// The control room (owner's wish, Oct 2026: a screen to RUN the service, not to look at vague numbers):
// 1. what is waiting for a person right now, each with its button; 2. the situation right now; 3. today against yesterday;
// 4. the last 7 days as numbers (a day opens its log); 5. open alerts; 6. money in one line.
export function Dashboard({ nav }: { nav: Nav }) {
  useLang();
  const { dash, alerts, refreshDash } = useLive();
  useEffect(() => { refreshDash(); }, [refreshDash]);   // fresh numbers every time the page opens
  if (!dash) return <><h1>{t('dash.title')}</h1><Loading /></>;
  const o = dash.orders, p = dash.people, m = dash.money, c = dash.cases, week: any[] = dash.week ?? [];
  const todo: { n: number; k: Key; go: Page; tone: 'bad' | 'warn' }[] = ([
    { n: c.sos_24h, k: 'todo.sos', go: 'problems', tone: 'bad' }, { n: m.settle_disputed, k: 'todo.disputed', go: 'settlements', tone: 'bad' },
    { n: m.settle_overdue, k: 'todo.overdue', go: 'settlements', tone: 'bad' }, { n: c.locked_codes, k: 'todo.locked', go: 'live', tone: 'bad' },
    { n: c.problems_open, k: 'todo.problems', go: 'problems', tone: 'warn' }, { n: p.drivers_pending, k: 'todo.drivers', go: 'drivers', tone: 'warn' },
    { n: m.topups_pending, k: 'todo.topups', go: 'wallets', tone: 'warn' }, { n: c.appeals, k: 'todo.appeals', go: 'trust', tone: 'warn' },
  ] as const).filter(x => x.n > 0) as any;
  const today = week[0] ?? {}, yday = week[1] ?? {};
  const rate = (d: any) => (d.created ? Math.round((d.delivered / d.created) * 100) : null);
  const cmp: { k: Key; v: number | null; y: number | null; unit?: 'da' | '%' | 's'; goodUp: boolean }[] = [
    { k: 'dash.created_today', v: today.created, y: yday.created, goodUp: true }, { k: 'dash.delivered_today', v: today.delivered, y: yday.delivered, goodUp: true },
    { k: 'dash.success', v: rate(today), y: rate(yday), unit: '%', goodUp: true }, { k: 'dash.cancelled_today', v: today.cancelled, y: yday.cancelled, goodUp: false },
    { k: 'dash.avg_assign', v: today.avg_assign_s, y: yday.avg_assign_s, unit: 's', goodUp: false }, { k: 'dash.fees_today', v: today.fees_da, y: yday.fees_da, unit: 'da', goodUp: true },
  ];
  const show = (v: number | null, unit?: string) => (v == null ? '—' : unit === 's' ? dur(v) : unit === '%' ? `${v}%` : `${fmtNum(v)}${unit === 'da' ? ' ' + t('common.da') : ''}`);
  const openAlerts = alerts.filter(a => !a.handled);
  return (
    <>
      <div className="page-head">
        <h1>{t('dash.title')}</h1>
        <span className="muted">{t('dash.updated')}: {fmtDate(dash.at)} <button type="button" className="link" aria-label={t('common.refresh')} onClick={refreshDash}>↻</button></span>
      </div>
      {!dash.wallet_active && <p className="help">{t('dash.walletOff')}</p>}

      <section className="card" aria-label={t('todo.title')}>
        <h2>{t('todo.title')}</h2>
        {!todo.length ? <p className="ok-msg">✓ {t('todo.clear')}</p> : (
          <ul className="todo">{todo.map(x => (
            <li key={x.k} className={'todo-item ' + x.tone}>
              <span className="todo-n num">{fmtNum(x.n)}</span><span className="todo-k">{t(x.k)}</span>
              <button type="button" className={x.tone === 'bad' ? 'danger' : 'primary'} onClick={() => nav.go(x.go)}>{t('todo.open')}</button>
            </li>))}</ul>)}
      </section>

      <div className="dash">
        <div className="dash-main">
          <section className="card" aria-label={t('dash.now')}>
            <h2>{t('dash.now')}</h2>
            {o.searching_now > 0 && p.drivers_online === 0 && <p className="error">⚠ {t('dash.noCourier')}</p>}
            <div className="tiles">
              <button type="button" className={'tile ' + (o.searching_now ? 'warn' : '')} onClick={() => nav.go('live')}><span className="tile-v num">{o.searching_now}</span><span className="tile-k">{t('dash.searching_now')}</span></button>
              <button type="button" className="tile" onClick={() => nav.go('live')}><span className="tile-v num">{o.active_now}</span><span className="tile-k">{t('dash.active_now')}</span></button>
              <button type="button" className="tile" onClick={() => nav.go('live')}><span className="tile-v num">{p.drivers_online}</span><span className="tile-k">{t('dash.drivers_online')}</span></button>
              <div className="tile"><span className="tile-v num">{dur(o.avg_assign_s)}</span><span className="tile-k">{t('dash.avg_assign')}</span></div>
            </div>
          </section>

          <section className="card" aria-label={t('dash.vsYesterday')}>
            <h2>{t('dash.vsYesterday')}</h2>
            <div className="tiles">{cmp.map(x => {
              const diff = x.v != null && x.y != null ? x.v - x.y : null, better = diff == null || diff === 0 ? null : (diff > 0) === x.goodUp;
              return (
                <div key={x.k} className="tile">
                  <span className="tile-v num">{show(x.v, x.unit)}</span><span className="tile-k">{t(x.k)}</span>
                  <span className={'delta ' + (better == null ? '' : better ? 'up' : 'down')}>{diff == null || diff === 0 ? '=' : diff > 0 ? '▲' : '▼'} {t('dash.yesterday')}: {show(x.y, x.unit)}</span>
                </div>);
            })}</div>
          </section>

          <section className="card" aria-label={t('dash.week')}>
            <h2>{t('dash.week')}</h2>
            <p className="muted small">{t('dash.weekHelp')}</p>
            <div className="table-wrap keep-table"><table>
              <thead><tr><th>{t('col.day')}</th><th>{t('log.created')}</th><th>{t('log.delivered')}</th><th>{t('col.successRate')}</th><th>{t('log.cancelled')}</th><th>{t('log.failed')}</th><th>{t('col.findTime')}</th><th>{t('log.fees')}</th><th>{t('col.problems')}</th></tr></thead>
              <tbody>{week.map(d => (
                <tr key={d.day} className="clickable" tabIndex={0} onClick={() => nav.go('log', { day: d.day })} onKeyDown={e => e.key === 'Enter' && nav.go('log', { day: d.day })}>
                  <td className="num"><strong>{d.day}</strong></td><td className="num">{d.created}</td><td className="num">{d.delivered}</td><td className="num">{rate(d) == null ? '—' : rate(d) + '%'}</td>
                  <td className="num">{d.cancelled}</td><td className="num">{d.failed}</td><td className="num">{dur(d.avg_assign_s)}</td><td className="num">{fmtNum(d.fees_da)} {t('common.da')}</td><td className="num">{d.problems}</td>
                </tr>))}</tbody>
            </table></div>
          </section>

          <section className="card" aria-label={t('dash.money')}>
            <h2>{t('dash.money')}</h2>
            <div className="tiles">
              <button type="button" className="tile" onClick={() => nav.go('cash')}><span className="tile-v num">{fmtNum(m.cash_held_da)} {t('common.da')}</span><span className="tile-k">{t('dash.cash_held')}</span></button>
              <button type="button" className="tile" onClick={() => nav.go('settlements')}><span className="tile-v num">{fmtNum(m.settle_pending_da)} {t('common.da')}</span><span className="tile-k">{t('dash.settle_pending')} ({m.settle_pending})</span></button>
              <div className="tile"><span className="tile-v num">{fmtNum(m.paid_to_sellers_30d_da)} {t('common.da')}</span><span className="tile-k">{t('dash.paid_to_sellers_30d')}</span></div>
              <div className="tile"><span className="tile-v num">{fmtNum(m.commission_30d_da)} {t('common.da')}</span><span className="tile-k">{t('dash.commission_30d')}</span></div>
              <button type="button" className="tile" onClick={() => nav.go('wallets')}><span className="tile-v num">{m.wallets_owing}</span><span className="tile-k">{t('dash.wallets_owing')}</span></button>
            </div>
          </section>

          <section className="card" aria-label={t('dash.people')}>
            <h2>{t('dash.people')}</h2>
            <div className="tiles">
              <button type="button" className="tile" onClick={() => nav.go('customers')}><span className="tile-v num">{p.users}</span><span className="tile-k">{t('dash.users')} · {t('dash.users_new_7d')}: +{p.users_new_7d}</span></button>
              <button type="button" className="tile" onClick={() => nav.go('drivers')}><span className="tile-v num">{p.drivers}</span><span className="tile-k">{t('dash.drivers')}</span></button>
              <button type="button" className="tile" onClick={() => nav.go('trust')}><span className="tile-v num">{p.blocked}</span><span className="tile-k">{t('dash.blocked')}</span></button>
              <div className="tile"><span className="tile-v num">{fmtNum(o.delivered_total)}</span><span className="tile-k">{t('dash.delivered_total')}</span></div>
            </div>
          </section>
        </div>
        <aside className="card dash-side" aria-label={t('dash.openAlerts')}>
          <h2>{t('dash.openAlerts')} ({openAlerts.length})</h2>
          <AlertList alerts={openAlerts} go={nav.go} limit={12} />
        </aside>
      </div>
    </>
  );
}
