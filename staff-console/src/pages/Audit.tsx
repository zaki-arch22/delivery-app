import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, t, useLang } from '../i18n';
import { Empty, ErrorBox, Field, Loading, useLoad } from '../ui';

// Every staff action, forever (list_audit_log). Nobody can edit or delete it: the database itself refuses.
export function Audit() {
  useLang();
  const [f, setF] = useState({ action: '', target: '' }), [applied, setApplied] = useState({ action: '', target: '' }), [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => api<{ entries: any[] }>('/list_audit_log' + qs({ ...applied, page })), [applied, page]);
  return (
    <>
      <h1>{t('audit.title')}</h1>
      <p className="help">{t('audit.help')}</p>
      <div className="card">
        <form className="filters" onSubmit={e => { e.preventDefault(); setPage(1); setApplied({ action: f.action.trim(), target: f.target.trim() }); }}>
          <Field label={t('audit.action')}><input value={f.action} placeholder="approve_driver" maxLength={40} onChange={e => setF({ ...f, action: e.target.value.replace(/[^a-z_]/g, '') })} /></Field>
          <Field label={t('audit.target')}><input value={f.target} maxLength={64} onChange={e => setF({ ...f, target: e.target.value })} /></Field>
          <button type="submit">{t('common.search')}</button>
        </form>
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : !data?.entries.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('col.created')}</th><th>{t('audit.staff')}</th><th>{t('audit.action')}</th><th>{t('audit.target')}</th><th>{t('audit.details')}</th></tr></thead>
            <tbody>{data.entries.map(e => (
              <tr key={e.id}><td className="num">{fmtDate(e.created_at)}</td><td>{e.staff}<div className="muted">{e.staff_email}</div></td><td><code>{e.action}</code></td>
                <td><span className="muted">{e.target_type}</span> <code className="wrap-text">{e.target_id}</code></td>
                <td className="wrap-text"><small>{Object.entries(e.data ?? {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</small></td></tr>))}</tbody>
          </table></div>)}
        {data && <div className="pager"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.prev')}</button><span>{page}</span><button type="button" disabled={data.entries.length < 100} onClick={() => setPage(page + 1)}>{t('common.next')}</button></div>}
      </div>
    </>
  );
}
