import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, t, useLang } from '../i18n';
import { Empty, ErrorBox, Field, Loading, Pager, useLoad } from '../ui';
import type { Nav } from '../App';

export function Ratings(_: { nav: Nav }) {
  useLang();
  const [f, setF] = useState({ max_stars: '', with_comment: false }), [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => api<{ ratings: any[] }>('/list_ratings' + qs({ ...f, page })), [f, page]);
  return (
    <>
      <h1>{t('ratings.title')}</h1>
      <div className="card filters">
        <Field label={t('ratings.max')}><select value={f.max_stars} onChange={e => { setPage(1); setF({ ...f, max_stars: e.target.value }); }}><option value="">{t('common.all')}</option>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select></Field>
        <label className="check"><input type="checkbox" checked={f.with_comment} onChange={e => { setPage(1); setF({ ...f, with_comment: e.target.checked }); }} />{t('ratings.withComment')}</label>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        {loading ? <Loading /> : !data?.ratings.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('col.created')}</th><th>{t('col.ref')}</th><th>{t('col.rater')}</th><th>{t('col.rated')}</th><th>{t('col.stars')}</th><th>{t('col.comment')}</th></tr></thead>
            <tbody>{data.ratings.map(r => (
              <tr key={r.id}><td className="num">{fmtDate(r.created_at)}</td><td>{r.ref}</td>
                <td>{r.rater} <span className="muted">({r.rater_type === 'driver' ? t('col.driver') : t('col.user')})</span></td>
                <td>{r.rated} <span className="muted">({r.rated_type === 'driver' ? t('col.driver') : t('col.user')})</span></td>
                <td aria-label={`${r.stars} / 5`}><strong>{'★'.repeat(r.stars)}</strong><span className="muted">{'★'.repeat(5 - r.stars)}</span></td><td className="wrap-text">{r.comment ?? ''}</td></tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={page} count={data.ratings.length} onPage={setPage} />}
      </div>
    </>
  );
}
