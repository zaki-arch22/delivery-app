import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, fmtNum, t, useLang } from '../i18n';
import { Empty, ErrorBox, Field, Loading, Pager, Pill, Status, useLoad } from '../ui';
import type { Nav } from '../App';

// Customers (senders and online sellers): list_users.
export function Customers({ nav }: { nav: Nav }) {
  useLang();
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => api<{ users: any[] }>('/list_users' + qs({ q: search, page })), [search, page]);
  return (
    <>
      <h1>{t('users.title')}</h1>
      <div className="card">
        <form className="filters" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim()); }}>
          <Field label={t('users.search')}><input value={q} maxLength={40} onChange={e => setQ(e.target.value)} /></Field>
          <button type="submit">{t('common.search')}</button>
        </form>
        <ErrorBox error={error} />
        {loading && !data ? <Loading /> : !data?.users.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('col.name')}</th><th>{t('col.status')}</th><th>{t('users.orders')}</th><th>{t('users.delivered')}</th><th>{t('col.rating')}</th><th>{t('users.codWaiting')}</th><th>{t('users.payout')}</th><th>{t('col.created')}</th><th>{t('col.actions')}</th></tr></thead>
            <tbody>{data.users.map(u => (
              <tr key={u.id}><td><strong>{u.display_name}</strong><div className="muted">{u.phone ?? '—'}</div></td><td><Status s={u.status} /></td>
                <td className="num">{u.orders}</td><td className="num">{u.delivered}</td><td className="num">{u.rating ?? '—'} <span className="muted">({u.rating_count})</span></td>
                <td className="num">{u.cod_waiting_da ? `${fmtNum(u.cod_waiting_da)} ${t('common.da')}` : '—'}</td>
                <td>{u.has_payout ? <Pill tone="good">✓</Pill> : <span className="muted">{t('drivers.noPayout')}</span>}</td>
                <td className="num">{fmtDate(u.created_at)}</td>
                <td><button type="button" onClick={() => nav.go('trust', { profileId: u.id })}>{t('users.record')}</button></td></tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={page} count={data.users.length} onPage={setPage} />}
      </div>
    </>
  );
}
