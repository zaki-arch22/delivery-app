import { useState } from 'react';
import { api, ApiError, qs } from '../api';
import { fmtDate, fmtNum, t, tx, useLang } from '../i18n';
import { ActionDialog, Empty, ErrorBox, Field, Loading, Modal, Pager, Pill, Status, useLoad } from '../ui';
import { DocPhoto } from './Drivers';
import { useLive } from '../live';
import type { Nav } from '../App';

const FILTERS = ['open', 'overdue', 'disputed', 'sent', 'confirmed', 'resolved_paid', 'resolved_unpaid', 'all'] as const;
const rip = (r: string) => r.replace(/^(\d{3})(\d{5})(\d{10})(\d{2})$/, '$1 $2 $3 $4');

// Goods money (cash on delivery) owed by couriers to sellers: list_settlements_staff, resolve_settlement.
export function Settlements({ nav }: { nav: Nav }) {
  useLang();
  const { refreshDash } = useLive();
  const [f, setF] = useState<(typeof FILTERS)[number]>('open'), [q, setQ] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [open, setOpen] = useState<any>(null), [decide, setDecide] = useState<any>(null), [outcome, setOutcome] = useState<'paid' | 'unpaid' | ''>('');
  const { data, error, loading, reload } = useLoad(() => api<any>('/list_settlements_staff' + qs({ status: f === 'all' ? undefined : f, q: search, page })), [f, search, page]);
  const tt = data?.totals;
  return (
    <>
      <h1>{t('settle.title')}</h1>
      <p className="help">{t('settle.help')}</p>
      {tt && <div className="tiles mb">
        <button type="button" className="tile" onClick={() => setF('open')}><span className="tile-v num">{fmtNum(tt.pending_da)} {t('common.da')}</span><span className="tile-k">{t('dash.settle_pending')} ({tt.pending})</span></button>
        <button type="button" className={'tile ' + (tt.overdue ? 'bad' : '')} onClick={() => setF('overdue')}><span className="tile-v num">{fmtNum(tt.overdue_da)} {t('common.da')}</span><span className="tile-k">{t('dash.settle_overdue')} ({tt.overdue})</span></button>
        <button type="button" className="tile" onClick={() => setF('sent')}><span className="tile-v num">{fmtNum(tt.sent_da)} {t('common.da')}</span><span className="tile-k">{t('dash.settle_sent')} ({tt.sent})</span></button>
        <button type="button" className={'tile ' + (tt.disputed ? 'bad' : '')} onClick={() => setF('disputed')}><span className="tile-v num">{fmtNum(tt.disputed_da)} {t('common.da')}</span><span className="tile-k">{t('dash.settle_disputed')} ({tt.disputed})</span></button>
      </div>}
      <div className="card">
        <div className="tabs" role="tablist">{FILTERS.map(x => <button type="button" role="tab" key={x} aria-selected={f === x} onClick={() => { setPage(1); setF(x); }}>{t(`settle.f.${x}` as any)}</button>)}</div>
        <form className="filters" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim()); }}>
          <Field label={t('settle.search')}><input value={q} maxLength={40} onChange={e => setQ(e.target.value)} /></Field>
          <button type="submit">{t('common.search')}</button>
        </form>
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : !data?.settlements.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('col.ref')}</th><th>{t('col.amount')}</th><th>{t('col.status')}</th><th>{t('col.driver')}</th><th>{t('settle.seller')}</th><th>{t('settle.due')}</th><th>{t('settle.proof')}</th><th>{t('col.actions')}</th></tr></thead>
            <tbody>{data.settlements.map((s: any) => (
              <tr key={s.order_id}>
                <td><button type="button" className="link num" onClick={() => nav.go('orders', { orderId: s.order_id })}>{s.ref}</button></td>
                <td className="num"><strong>{fmtNum(s.amount_da)} {t('common.da')}</strong></td>
                <td><Status s={s.overdue ? 'overdue' : s.status} />{s.overdue_at && !s.overdue && <div className="muted">{t('settle.late')}</div>}</td>
                <td>{s.driver_name}<div className="muted">{s.driver_phone}</div></td>
                <td>{s.seller_name}<div className="muted">{s.seller_phone}</div></td>
                <td className="num">{fmtDate(s.due_at)}</td>
                <td>{s.method ? <>{tx('settle.method.' + s.method)}{s.reference && <div className="muted num">{s.reference}</div>}</> : '—'}</td>
                <td><div className="row">
                  <button type="button" onClick={() => setOpen(s)}>{t('common.view')}</button>
                  {['pending', 'sent', 'disputed'].includes(s.status) && <button type="button" className={s.status === 'disputed' || s.overdue ? 'primary' : ''} onClick={() => { setOutcome(''); setDecide(s); }}>{t('settle.decide')}</button>}
                </div></td>
              </tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={page} count={data.settlements.length} onPage={setPage} />}
      </div>
      {open && <Modal title={`${open.ref} · ${fmtNum(open.amount_da)} ${t('common.da')}`} onClose={() => setOpen(null)} wide>
        <dl className="kv">
          <dt>{t('col.status')}</dt><dd><Status s={open.overdue ? 'overdue' : open.status} /></dd>
          <dt>{t('col.driver')}</dt><dd>{open.driver_name} · {open.driver_phone}</dd>
          <dt>{t('settle.seller')}</dt><dd>{open.seller_name} · {open.seller_phone}</dd>
          <dt>{t('settle.account')}</dt><dd className="num">{rip(open.seller_rip)}</dd>
          <dt>{t('settle.holder')}</dt><dd>{open.seller_holder}</dd>
          <dt>{t('col.created')}</dt><dd>{fmtDate(open.created_at)}</dd>
          <dt>{t('settle.due')}</dt><dd>{fmtDate(open.due_at)} {open.overdue_at && <Pill tone="bad">{t('settle.late')}</Pill>}</dd>
          <dt>{t('settle.proof')}</dt><dd>{open.method ? `${tx('settle.method.' + open.method)} · ${fmtDate(open.sent_at)}${open.reference ? ' · ' + open.reference : ''}` : '—'}</dd>
          {open.receipt_doc && <><dt>{t('settle.receipt')}</dt><dd><DocPhoto id={open.receipt_doc} label={t('doc.transfer_receipt')} /></dd></>}
          {open.dispute_note && <><dt>{t('settle.disputeNote')}</dt><dd className="wrap-text">{open.dispute_note} <span className="muted">({fmtDate(open.disputed_at)})</span></dd></>}
          {open.confirmed_at && <><dt>{t('status.confirmed')}</dt><dd>{fmtDate(open.confirmed_at)}</dd></>}
          {open.resolution_note && <><dt>{t('settle.resolution')}</dt><dd className="wrap-text">{open.resolution_note} <span className="muted">({open.resolved_by} · {fmtDate(open.resolved_at)})</span></dd></>}
        </dl>
        <div className="row end mt"><button type="button" onClick={() => { setOpen(null); nav.go('orders', { orderId: open.order_id }); }}>{t('problems.openOrder')}</button></div>
      </Modal>}
      {decide && <ActionDialog title={`${t('settle.decide')} · ${decide.ref} · ${fmtNum(decide.amount_da)} ${t('common.da')}`} help={t('settle.decideHelp')} reasonLabel="settle.resolution" onClose={() => setDecide(null)}
        onSubmit={async note => { if (!outcome) throw new ApiError(400, 'BAD_OUTCOME', ''); await api('/resolve_settlement', { order_id: decide.order_id, outcome, note }); reload(); refreshDash(); }}>
        <fieldset className="field"><legend className="field-label">{t('settle.outcome')}</legend>
          {(['paid', 'unpaid'] as const).map(o => <label key={o} className="check"><input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} />{t(`settle.${o}`)}</label>)}
        </fieldset>
      </ActionDialog>}
    </>
  );
}
