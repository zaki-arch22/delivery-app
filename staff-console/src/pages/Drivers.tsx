import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, fmtNum, t, tx, useLang } from '../i18n';
import { ActionDialog, Empty, ErrorBox, Field, Loading, Pager, Pill, Status, useLoad } from '../ui';
import type { Nav } from '../App';

export function Drivers({ nav }: { nav: Nav }) {
  useLang();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  return (
    <>
      <h1>{t('nav.drivers')}</h1>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>{t('drivers.pending')}</button>
        <button type="button" role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>{t('drivers.all')}</button>
      </div>
      {tab === 'pending' ? <Pending /> : <All nav={nav} />}
    </>
  );
}

function Pending() {
  const { data, error, loading, reload } = useLoad(() => api<{ drivers: any[] }>('/list_pending_drivers'), []);
  const [approve, setApprove] = useState<any>(null), [reject, setReject] = useState<any>(null), [limit, setLimit] = useState('');
  return (
    <div className="card">
      <p className="help">{t('drivers.docsNote')}</p>
      <ErrorBox error={error} />
      {loading ? <Loading /> : !data?.drivers.length ? <Empty /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('col.name')}</th><th>{t('col.phone')}</th><th>{t('col.vehicle')}</th><th>{t('col.docs')}</th><th>{t('col.created')}</th><th>{t('col.actions')}</th></tr></thead>
          <tbody>{data.drivers.map(d => (
            <tr key={d.id}><td><strong>{d.display_name}</strong></td><td>{d.phone}</td><td>{tx('vehicle.' + d.vehicle)}</td>
              <td className="muted wrap-text">{[d.id_photo_url, d.licence_photo_url, d.vehicle_photo_url].join('\n')}</td><td className="num">{fmtDate(d.created_at)}</td>
              <td><div className="row"><button type="button" className="primary" onClick={() => { setLimit(''); setApprove(d); }}>{t('drivers.approve')}</button><button type="button" onClick={() => setReject(d)}>{t('drivers.reject')}</button></div></td></tr>))}</tbody>
        </table></div>)}
      {approve && <ActionDialog title={`${t('drivers.approve')} · ${approve.display_name}`} needReason={false} onClose={() => setApprove(null)}
        onSubmit={async () => { if (!/^\d+$/.test(limit)) throw Object.assign(new Error(), { status: 400, code: 'BAD_NUMBER' }); await api('/approve_driver', { profile_id: approve.id, cash_limit_da: Number(limit) }); reload(); }}>
        <Field label={t('drivers.cashLimit')} hint={t('drivers.cashLimitHint')}><input inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value.replace(/\D/g, ''))} /></Field>
      </ActionDialog>}
      {reject && <ActionDialog title={`${t('drivers.reject')} · ${reject.display_name}`} danger onClose={() => setReject(null)} onSubmit={async reason => { await api('/reject_driver', { profile_id: reject.id, reason }); reload(); }} />}
    </div>
  );
}

function All({ nav }: { nav: Nav }) {
  const [f, setF] = useState({ status: '', online: '', holding_cash: false }), [page, setPage] = useState(1), [act, setAct] = useState<{ d: any; suspend: boolean } | null>(null);
  const { data, error, loading, reload } = useLoad(() => api<{ drivers: any[] }>('/list_drivers' + qs({ ...f, page })), [f, page]);
  return (
    <>
      <div className="card filters">
        <Field label={t('col.status')}><select value={f.status} onChange={e => { setPage(1); setF({ ...f, status: e.target.value }); }}><option value="">{t('common.all')}</option>{['active', 'pending_approval', 'suspended', 'rejected'].map(s => <option key={s} value={s}>{tx('status.' + s)}</option>)}</select></Field>
        <Field label={t('drivers.onlineFilter')}><select value={f.online} onChange={e => { setPage(1); setF({ ...f, online: e.target.value }); }}><option value="">{t('common.all')}</option><option value="true">{t('common.yes')}</option><option value="false">{t('common.no')}</option></select></Field>
        <label className="check"><input type="checkbox" checked={f.holding_cash} onChange={e => { setPage(1); setF({ ...f, holding_cash: e.target.checked }); }} />{t('drivers.holding')}</label>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        {loading ? <Loading /> : !data?.drivers.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('col.name')}</th><th>{t('col.status')}</th><th>{t('col.online')}</th><th>{t('col.rating')}</th><th>{t('col.deliveries')}</th><th>{t('col.cashHeld')}</th><th>{t('col.limit')}</th><th>{t('col.actions')}</th></tr></thead>
            <tbody>{data.drivers.map(d => (
              <tr key={d.id}><td><strong>{d.display_name}</strong><div className="muted">{d.phone} · {tx('vehicle.' + d.vehicle)}</div></td><td><Status s={d.status} /></td>
                <td>{d.is_online ? <Pill tone="good">{t('common.yes')}</Pill> : <span className="muted">{t('common.no')}</span>}</td>
                <td className="num">{d.rating ?? '—'} <span className="muted">({d.rating_count})</span></td><td className="num">{d.deliveries}</td>
                <td className="num">{fmtNum(d.cash_held_da)} {t('common.da')}</td><td className="num">{d.cash_limit_da == null ? '—' : `${fmtNum(d.cash_limit_da)} ${t('common.da')}`}</td>
                <td><div className="row">
                  {d.status === 'active' && <button type="button" onClick={() => setAct({ d, suspend: true })}>{t('drivers.suspend')}</button>}
                  {d.status === 'suspended' && <button type="button" onClick={() => setAct({ d, suspend: false })}>{t('drivers.unsuspend')}</button>}
                  <button type="button" onClick={() => nav.go('cash', { driverId: d.id })}>{t('drivers.cashPage')}</button></div></td></tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={page} count={data.drivers.length} onPage={setPage} />}
      </div>
      {act && <ActionDialog title={`${t(act.suspend ? 'drivers.suspend' : 'drivers.unsuspend')} · ${act.d.display_name}`} danger={act.suspend} onClose={() => setAct(null)}
        onSubmit={async reason => { await api(act.suspend ? '/suspend_profile' : '/unsuspend_profile', { profile_id: act.d.id, reason }); reload(); }} />}
    </>
  );
}
