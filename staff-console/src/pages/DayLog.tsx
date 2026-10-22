import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, fmtNum, t, tx, useLang } from '../i18n';
import { dur, Empty, ErrorBox, Loading, Pager, Pill, Status, useLoad } from '../ui';
import { OrderDetail } from './Orders';
import type { Nav } from '../App';

const OUTCOMES = ['all', 'delivered', 'failed', 'cancelled', 'returns'] as const;
const shift = (day: string, n: number) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// The operations log (owner's wish, Oct 2026): what was DONE, one day at a time (Algiers time), apart from what is happening
// now. A day shows its numbers and its finished orders (filter by outcome); the 30 last days are one click away.
export function DayLog({ nav, day: start }: { nav: Nav; day?: string }) {
  useLang();
  const [day, setDay] = useState<string | undefined>(start), [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('all'), [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading } = useLoad(() => api<any>('/get_day_log' + qs({ day, outcome, page })), [day, outcome, page]);
  const go = (d: string) => { setDay(d); setPage(1); };
  const today = data?.days?.[0]?.day;
  const sm = data?.summary;
  return (
    <>
      <h1>{t('log.title')}</h1>
      <p className="help">{t('log.help')}</p>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="split">
          <aside className="card list" aria-label={t('log.days')}>
            <h3>{t('log.days')}</h3>
            <label className="field"><span className="field-label">{t('log.pick')}</span><input type="date" value={data.day} max={today} onChange={e => e.target.value && go(e.target.value)} /></label>
            <div className="days">{data.days.map((d: any) => (
              <button type="button" key={d.day} aria-pressed={d.day === data.day} onClick={() => go(d.day)}>
                <span className="num">{d.day === today ? t('log.today') : d.day}</span>
                <span className="muted num small">{d.delivered}/{d.created}{d.not_done ? ` · ✕${d.not_done}` : ''}</span>
              </button>))}</div>
          </aside>
          <div>
            <div className="card">
              <div className="page-head">
                <h2 className="num">{data.day === today ? `${t('log.today')} · ${data.day}` : data.day}</h2>
                <div className="row">
                  <button type="button" onClick={() => go(shift(data.day, -1))}>‹ {t('log.prev')}</button>
                  <button type="button" disabled={!today || data.day >= today} onClick={() => go(shift(data.day, 1))}>{t('log.next')} ›</button>
                </div>
              </div>
              <div className="tiles">
                <div className="tile"><span className="tile-v num">{sm.created}</span><span className="tile-k">{t('log.created')}</span></div>
                <div className="tile good"><span className="tile-v num">{sm.delivered}</span><span className="tile-k">{t('log.delivered')}</span></div>
                <div className={'tile ' + (sm.failed ? 'warn' : '')}><span className="tile-v num">{sm.failed}</span><span className="tile-k">{t('log.failed')}</span></div>
                <div className="tile"><span className="tile-v num">{sm.cancelled}</span><span className="tile-k">{t('log.cancelled')}</span></div>
                <div className="tile"><span className="tile-v num">{sm.returns}</span><span className="tile-k">{t('log.returns')}</span></div>
                <div className="tile"><span className="tile-v num">{fmtNum(sm.fees_da)} {t('common.da')}</span><span className="tile-k">{t('log.fees')}</span></div>
                <div className="tile"><span className="tile-v num">{fmtNum(sm.cod_da)} {t('common.da')}</span><span className="tile-k">{t('log.cod')}</span></div>
                <div className="tile"><span className="tile-v num">{fmtNum(sm.commission_da)} {t('common.da')}</span><span className="tile-k">{t('log.commission')}</span></div>
                <div className="tile"><span className="tile-v num">{dur(sm.avg_assign_s)}</span><span className="tile-k">{t('log.findTime')}</span></div>
                <div className="tile"><span className="tile-v num">{dur(sm.avg_trip_s)}</span><span className="tile-k">{t('log.tripTime')}</span></div>
                <button type="button" className={'tile ' + (sm.problems ? 'warn' : '')} onClick={() => nav.go('problems')}><span className="tile-v num">{sm.problems}</span><span className="tile-k">{t('log.problems')}</span></button>
                <button type="button" className="tile" onClick={() => nav.go('audit')}><span className="tile-v num">{sm.staff_actions}</span><span className="tile-k">{t('log.staff')}</span></button>
              </div>
            </div>
            <div className="card">
              <h3>{t('log.orders')}</h3>
              <div className="tabs" role="tablist">{OUTCOMES.map(o => <button type="button" role="tab" key={o} aria-selected={outcome === o} onClick={() => { setOutcome(o); setPage(1); }}>{t(`log.f.${o}`)}</button>)}</div>
              {!data.orders.length ? <Empty /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t('log.ended')}</th><th>{t('col.ref')}</th><th>{t('log.outcome')}</th><th>{t('col.user')}</th><th>{t('col.driver')}</th><th>{t('col.price')}</th><th>{t('col.cod')}</th><th>{t('col.problems')}</th></tr></thead>
                  <tbody>{data.orders.map((o: any) => (
                    <tr key={o.id} className="clickable" tabIndex={0} onClick={() => setOpen(o.id)} onKeyDown={e => e.key === 'Enter' && setOpen(o.id)}>
                      <td className="num">{fmtDate(o.ended_at ?? o.created_at)}</td>
                      <td><strong className="num">{o.ref}</strong>{o.leg === 'return' && <> <Pill tone="warn">{t('leg.return')}</Pill></>}</td>
                      <td><Status s={o.status} />{o.fail_reason && <div className="muted small">{tx('reason.delivery_failed:' + o.fail_reason, o.fail_reason)}</div>}{o.cancel_reason && <div className="muted small wrap-text">{o.cancel_reason}</div>}</td>
                      <td>{o.user_name}</td><td>{o.driver_name ?? <span className="muted">—</span>}</td>
                      <td className="num">{fmtNum(o.locked_da ?? o.offered_da)} {t('common.da')}</td><td className="num">{o.cod_amount_da ? `${fmtNum(o.cod_amount_da)} ${t('common.da')}` : '—'}</td>
                      <td className="num">{o.problems ? <Pill tone="warn">{o.problems}</Pill> : '—'}</td>
                    </tr>))}</tbody>
                </table></div>)}
              <Pager page={page} count={data.orders.length === 100 ? 50 : 0} onPage={setPage} />
            </div>
          </div>
        </div>)}
      {open && <OrderDetail id={open} nav={nav} onClose={() => setOpen(null)} />}
    </>
  );
}
