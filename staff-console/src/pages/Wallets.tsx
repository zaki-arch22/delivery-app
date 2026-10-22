import { useState } from 'react';
import { api, ApiError, qs } from '../api';
import { fmtDate, fmtNum, t, tx, useLang } from '../i18n';
import { ActionDialog, Empty, ErrorBox, Field, Loading, Pager, Pill, useLoad } from '../ui';
import { DocPhoto } from './Drivers';
import { useLive } from '../live';

const FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;
const rip = (r: string) => r.replace(/^(\d{3})(\d{5})(\d{10})(\d{2})$/, '$1 $2 $3 $4');

// Courier wallets (the platform's commission): list_topups, decide_topup, get_driver_wallet, add_wallet_adjustment, set_cash_limit.
export function Wallets({ driverId }: { driverId?: string }) {
  useLang();
  const { refreshDash } = useLive();
  const [f, setF] = useState<(typeof FILTERS)[number]>('pending'), [page, setPage] = useState(1), [sel, setSel] = useState<string | undefined>(driverId);
  const [act, setAct] = useState<{ x: any; approve: boolean } | null>(null);
  const { data, error, loading, reload } = useLoad(() => api<any>('/list_topups' + qs({ status: f, page })), [f, page]);
  return (
    <>
      <h1>{t('wallet.title')}</h1>
      <p className="help">{t('wallet.help')}</p>
      <div className="card">
        <h3>{t('wallet.platform')}</h3>
        {data && (data.platform_account ? <p className="num"><strong>{rip(data.platform_account.rip)}</strong> · {data.platform_account.holder_name}</p> : <p className="error">{t('wallet.platformMissing')}</p>)}
      </div>
      <div className="split">
        <div className="card">
          <h3>{t('wallet.queue')}</h3>
          <div className="tabs" role="tablist">{FILTERS.map(x => <button type="button" role="tab" key={x} aria-selected={f === x} onClick={() => { setPage(1); setF(x); }}>{t(`wallet.f.${x}`)}</button>)}</div>
          <ErrorBox error={error} />
          {loading && !data ? <Loading /> : !data?.topups.length ? <Empty /> : data.topups.map((x: any) => (
            <div key={x.id} className={'topup' + (sel === x.driver_id ? ' sel' : '')}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong className="num">{fmtNum(x.amount_da)} {t('common.da')}</strong>
                <Pill tone={x.status === 'approved' ? 'good' : x.status === 'rejected' ? 'bad' : 'warn'}>{t(`wallet.f.${x.status}` as any)}</Pill>
              </div>
              <button type="button" className="link" onClick={() => setSel(x.driver_id)}>{x.driver_name}</button> <span className="muted">{x.driver_phone}</span>
              <div className="muted">{t('wallet.reference')}: <span className="num">{x.reference}</span> · {fmtDate(x.created_at)}</div>
              <div className="muted">{t('wallet.balance')}: <span className="num">{fmtNum(x.balance_da)} {t('common.da')}</span></div>
              {x.reason && <div className="muted wrap-text">{x.reason}</div>}
              {x.decided_by && <div className="muted">{x.decided_by} · {fmtDate(x.decided_at)}</div>}
              <DocPhoto id={x.receipt_doc} label={t('doc.transfer_receipt')} />
              {x.status === 'pending' && <div className="row mt">
                <button type="button" className="primary" onClick={() => setAct({ x, approve: true })}>{t('wallet.approve')}</button>
                <button type="button" onClick={() => setAct({ x, approve: false })}>{t('wallet.reject')}</button></div>}
            </div>))}
          {data && <Pager page={page} count={data.topups.length} onPage={setPage} />}
        </div>
        <div>{sel ? <DriverWallet key={sel} id={sel} /> : <div className="card"><p className="muted">{t('wallet.pick')}</p></div>}</div>
      </div>
      {act && <ActionDialog title={`${t(act.approve ? 'wallet.approve' : 'wallet.reject')} · ${act.x.driver_name} · ${fmtNum(act.x.amount_da)} ${t('common.da')}`}
        help={act.approve ? t('wallet.approveHelp') : undefined} needReason={!act.approve} danger={!act.approve} onClose={() => setAct(null)}
        onSubmit={async reason => { await api('/decide_topup', { id: act.x.id, decision: act.approve ? 'approve' : 'reject', reason: act.approve ? undefined : reason }); reload(); refreshDash(); }} />}
    </>
  );
}

function DriverWallet({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api<any>('/get_driver_wallet' + qs({ profile_id: id })), [id]);
  const [adj, setAdj] = useState(false), [amount, setAmount] = useState(''), [lim, setLim] = useState(false), [limit, setLimit] = useState('');
  if (loading && !data) return <div className="card"><Loading /></div>;
  if (error) return <div className="card"><ErrorBox error={error} /></div>;
  return (
    <>
      <div className="card">
        <h2>{data.driver}</h2>
        <div className="tiles">
          <div className={'tile ' + (data.balance_da < 0 ? (data.balance_da <= -data.credit_da ? 'bad' : 'warn') : 'good')}><span className="tile-v num">{fmtNum(data.balance_da)} {t('common.da')}</span><span className="tile-k">{t('wallet.balance')}</span></div>
          <div className="tile"><span className="tile-v num">{fmtNum(data.credit_da)} {t('common.da')}</span><span className="tile-k">{t('wallet.credit')}</span></div>
          <div className="tile"><span className="tile-v num">{data.effective_limit_da == null ? '—' : `${fmtNum(data.effective_limit_da)} ${t('common.da')}`}</span><span className="tile-k">{t('wallet.effective')}</span></div>
          <div className="tile"><span className="tile-v num">{data.cash_limit_da == null ? '—' : `${fmtNum(data.cash_limit_da)} ${t('common.da')}`}</span><span className="tile-k">{t('wallet.ceiling')}</span></div>
        </div>
        <div className="row mt"><button type="button" onClick={() => { setAmount(''); setAdj(true); }}>{t('wallet.adjust')}</button><button type="button" onClick={() => { setLimit(String(data.cash_limit_da ?? '')); setLim(true); }}>{t('wallet.setLimit')}</button></div>
      </div>
      <div className="card">
        <h3>{t('cash.entries')}</h3>
        {!data.entries.length ? <Empty /> : <div className="table-wrap"><table>
          <thead><tr><th>{t('col.created')}</th><th>{t('col.type')}</th><th>{t('col.amount')}</th><th>{t('col.ref')}</th><th>{t('common.note')}</th><th>{t('col.by')}</th></tr></thead>
          <tbody>{data.entries.map((e: any) => <tr key={e.id}><td className="num">{fmtDate(e.created_at)}</td><td>{tx('wallet.' + e.type, e.type)} <span className="muted">#{e.id}</span></td>
            <td className="num"><strong>{e.amount_da > 0 ? '+' : ''}{fmtNum(e.amount_da)}</strong></td><td>{e.ref ?? ''}</td><td className="wrap-text">{e.note}</td><td>{e.staff ?? ''}</td></tr>)}</tbody>
        </table></div>}
      </div>
      {adj && <ActionDialog title={t('wallet.adjust')} help={t('wallet.adjustHelp')} reasonLabel="common.note" onClose={() => setAdj(false)}
        onSubmit={async n => { const v = Number(amount); if (!/^[+-]?\d+$/.test(amount) || v === 0) throw new ApiError(400, 'BAD_AMOUNT', ''); await api('/add_wallet_adjustment', { driver_profile_id: id, amount_da: v, note: n }); reload(); }}>
        <Field label={t('cash.amount')}><input value={amount} placeholder="+500 / -500" onChange={e => setAmount(e.target.value.replace(/[^\d+-]/g, ''))} /></Field>
      </ActionDialog>}
      {lim && <ActionDialog title={t('wallet.setLimit')} help={t('wallet.setLimitHelp')} needReason={false} onClose={() => setLim(false)}
        onSubmit={async () => { if (!/^\d+$/.test(limit)) throw new ApiError(400, 'BAD_NUMBER', ''); await api('/set_cash_limit', { driver_profile_id: id, cash_limit_da: Number(limit) }); reload(); }}>
        <Field label={t('drivers.cashLimit')}><input inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ''))} /></Field>
      </ActionDialog>}
    </>
  );
}
