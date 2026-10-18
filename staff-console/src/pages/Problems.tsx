import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, t, tx, useLang } from '../i18n';
import { ActionDialog, Empty, ErrorBox, Field, Loading, Pager, Status, useLoad } from '../ui';
import type { Nav } from '../App';

export function Problems({ nav }: { nav: Nav }) {
  useLang();
  const [status, setStatus] = useState('open'), [page, setPage] = useState(1), [resolving, setResolving] = useState<any>(null), [error, setError] = useState<string | null>(null);
  const { data, error: le, loading, reload } = useLoad(() => api<{ problems: any[] }>('/list_problems' + qs({ status, page })), [status, page]);
  const progress = async (id: number) => { setError(null); try { await api('/resolve_problem', { id, status: 'in_progress' }); reload(); } catch (e: any) { setError(e.message); } };
  return (
    <>
      <h1>{t('problems.title')}</h1>
      <div className="card filters">
        <Field label={t('col.status')}><select value={status} onChange={e => { setPage(1); setStatus(e.target.value); }}>
          <option value="">{t('common.all')}</option>{['open', 'in_progress', 'resolved'].map(s => <option key={s} value={s}>{tx('status.' + s)}</option>)}</select></Field>
      </div>
      <div className="card">
        <ErrorBox error={le ?? error} />
        {loading ? <Loading /> : !data?.problems.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('col.created')}</th><th>{t('col.ref')}</th><th>{t('col.reporter')}</th><th>{t('col.reason')}</th><th>{t('col.status')}</th><th>{t('col.actions')}</th></tr></thead>
            <tbody>{data.problems.map(p => (
              <tr key={p.id}>
                <td className="num">{fmtDate(p.created_at)}</td>
                <td><button type="button" className="link" onClick={() => nav.go('orders', { orderId: p.order_id })}>{p.ref}</button></td>
                <td>{p.reporter} <span className="muted">({p.reporter_type === 'driver' ? t('col.driver') : t('col.user')})</span><div className="muted">{p.reporter_phone}</div></td>
                <td><strong className="wrap-text">{p.reason}</strong>{p.note && <div className="wrap-text">{p.note}</div>}{p.resolution && <div className="muted wrap-text">→ {p.resolution}</div>}</td>
                <td><Status s={p.status} /></td>
                <td>{p.status !== 'resolved' && <div className="row">
                  {p.status === 'open' && <button type="button" onClick={() => progress(p.id)}>{t('problems.inProgress')}</button>}
                  <button type="button" className="primary" onClick={() => setResolving(p)}>{t('problems.resolve')}</button></div>}</td>
              </tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={page} count={data.problems.length} onPage={setPage} />}
      </div>
      {resolving && <ActionDialog title={`${t('problems.resolve')} · ${resolving.ref}`} reasonLabel="problems.resolution" onClose={() => setResolving(null)}
        onSubmit={async resolution => { await api('/resolve_problem', { id: resolving.id, status: 'resolved', resolution }); reload(); }} />}
    </>
  );
}
