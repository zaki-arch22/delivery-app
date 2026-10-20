import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, fmtNum, t, tx, useLang, Key } from '../i18n';
import { ActionDialog, addressText, Empty, ErrorBox, Field, Loading, Modal, Pager, Pill, Status, useLoad } from '../ui';
import type { Nav } from '../App';
import { DocPhoto } from './Drivers';

const STATUSES = ['awaiting_recipient', 'searching', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled', 'expired'];

export function Orders({ nav, openId }: { nav: Nav; openId?: string }) {
  useLang();
  const [f, setF] = useState({ q: '', status: '', unassigned: false, problem: false, older_than_min: '', leg: '' }), [applied, setApplied] = useState(f), [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | undefined>(openId);
  const { data, error, loading, reload } = useLoad(() => api<{ orders: any[] }>('/list_all_orders' + qs({ ...applied, page })), [applied, page]);
  const set = (k: keyof typeof f, v: any) => setF({ ...f, [k]: v });
  return (
    <>
      <h1>{t('orders.title')}</h1>
      <form className="card filters" onSubmit={e => { e.preventDefault(); setPage(1); setApplied(f); }}>
        <Field label={t('orders.search')}><input value={f.q} maxLength={40} onChange={e => set('q', e.target.value)} /></Field>
        <Field label={t('col.status')}><select value={f.status} onChange={e => set('status', e.target.value)}><option value="">{t('common.all')}</option>{STATUSES.map(s => <option key={s} value={s}>{tx('status.' + s)}</option>)}</select></Field>
        <Field label={t('orders.legFilter')}><select value={f.leg} onChange={e => set('leg', e.target.value)}><option value="">{t('common.all')}</option><option value="delivery">{t('leg.delivery')}</option><option value="return">{t('leg.return')}</option></select></Field>
        <Field label={t('orders.older')}><input inputMode="numeric" value={f.older_than_min} onChange={e => set('older_than_min', e.target.value.replace(/\D/g, ''))} /></Field>
        <label className="check"><input type="checkbox" checked={f.unassigned} onChange={e => set('unassigned', e.target.checked)} />{t('orders.unassigned')}</label>
        <label className="check"><input type="checkbox" checked={f.problem} onChange={e => set('problem', e.target.checked)} />{t('orders.problem')}</label>
        <button type="submit" className="primary">{t('common.search')}</button>
      </form>
      <div className="card">
        <ErrorBox error={error} />
        {loading ? <Loading /> : !data?.orders.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('col.ref')}</th><th>{t('col.status')}</th><th>{t('col.created')}</th><th>{t('col.user')}</th><th>{t('col.driver')}</th><th>{t('col.price')}</th><th>{t('col.cod')}</th><th>{t('col.flags')}</th></tr></thead>
            <tbody>{data.orders.map(o => (
              <tr key={o.id} className="clickable" tabIndex={0} onClick={() => setOpen(o.id)} onKeyDown={e => e.key === 'Enter' && setOpen(o.id)}>
                <td><strong>{o.ref}</strong>{o.leg === 'return' && <> <Pill tone="warn">{t('leg.return')}</Pill></>}</td><td><Status s={o.status} /></td><td className="num">{fmtDate(o.created_at)}</td>
                <td>{o.user_name}<div className="muted">{o.user_phone}</div></td><td>{o.driver_name ?? <span className="muted">{t('common.none')}</span>}</td>
                <td className="num">{fmtNum(o.locked_da ?? o.offered_da)} {t('common.da')}</td><td className="num">{o.cod_amount_da ? `${fmtNum(o.cod_amount_da)} ${t('common.da')}` : '—'}</td>
                <td>{o.has_open_problem && <Pill tone="warn">{t('flag.problem')}</Pill>} {o.code_attempts >= 5 && <Pill tone="bad">{t('flag.codeLocked')}</Pill>}</td>
              </tr>))}</tbody>
          </table></div>)}
        {data && <Pager page={page} count={data.orders.length} onPage={setPage} />}
      </div>
      {open && <OrderDetail id={open} nav={nav} onClose={() => { setOpen(undefined); reload(); }} />}
    </>
  );
}

type Act = 'cancel' | 'reassign' | 'start_return' | 'reset_code_attempts' | 'correct_address';
const ADDR = ['street', 'commune', 'building', 'entrance', 'floor', 'apartment', 'landmark', 'notes'] as const;

export function OrderDetail({ id, onClose }: { id: string; nav: Nav; onClose: () => void }) {
  useLang();
  const { data, error, loading, reload } = useLoad(() => api<any>('/get_order_timeline' + qs({ id })), [id]);
  const [act, setAct] = useState<Act | null>(null), [which, setWhich] = useState<'pickup' | 'dropoff'>('dropoff'), [addr, setAddr] = useState<Record<string, string>>({});
  const o = data?.order;
  // Each action is offered ONLY in the states where the server accepts it.
  const can: Record<Act, boolean> = o ? {
    cancel: ['awaiting_recipient', 'searching', 'assigned'].includes(o.status), reassign: o.status === 'assigned', start_return: o.status === 'picked_up' && o.leg === 'delivery',
    reset_code_attempts: o.status === 'picked_up' && o.code_attempts > 0, correct_address: ['searching', 'assigned', 'picked_up'].includes(o.status),
  } : { cancel: false, reassign: false, start_return: false, reset_code_attempts: false, correct_address: false };
  const run = async (reason: string) => {
    const body: any = { order_id: id, action: act };
    if (act === 'correct_address') { body.which = which; body.address = Object.fromEntries(Object.entries(addr).filter(([, v]) => v.trim())); } else body.reason = reason;
    await api('/staff_order_action', body); reload();
  };
  const openAct = (a: Act) => { if (a === 'correct_address' && o) { const cur = (which === 'pickup' ? o.pickup_address : o.dropoff_address) ?? {}; setAddr({ ...cur }); } setAct(a); };
  return (
    <Modal wide title={o ? `${o.ref}` : t('common.loading')} onClose={onClose}>
      <ErrorBox error={error} />
      {loading && !o ? <Loading /> : o && (<>
        <section>
          <div className="row"><Status s={o.status} />{o.leg === 'return' && <Pill tone="warn">{t('leg.return')}</Pill>}<span className="muted">{fmtDate(o.created_at)}</span></div>
          <h3 className="mt">{t('detail.summary')}</h3>
          <dl className="kv">
            <dt>{t('detail.sender')}</dt><dd>{o.user_name} · {o.user_phone}</dd>
            <dt>{t('col.driver')}</dt><dd>{o.driver_name ? `${o.driver_name} · ${o.driver_phone}` : t('detail.none')}</dd>
            <dt>{t('detail.recipient')}</dt><dd>{o.recipient_name} · {o.recipient_phone}</dd>
            <dt>{t('detail.pickup')}</dt><dd className="wrap-text">{addressText(o.pickup_address)}</dd>
            <dt>{t('detail.dropoff')}</dt><dd className="wrap-text">{addressText(o.dropoff_address)}</dd>
            <dt>{t('detail.price')}</dt><dd className="num">{fmtNum(o.locked_da ?? o.offered_da)} {t('common.da')}</dd>
            <dt>{t('detail.payer')}</dt><dd>{tx('payer.' + o.payer)}</dd>
            <dt>{t('col.cod')}</dt><dd className="num">{o.cod_amount_da ? `${fmtNum(o.cod_amount_da)} ${t('common.da')}` : '—'}</dd>
            <dt>{t('col.vehicle')}</dt><dd>{tx('vehicle.' + o.vehicle)}</dd>
            {o.code_attempts > 0 && <><dt>{t('detail.wrongCodes')}</dt><dd>{o.code_attempts} / 5</dd></>}
          </dl>
        </section>
        <section>
          <h3>{t('act.title')}</h3>
          <div className="row">{(Object.keys(can) as Act[]).map(a => <button type="button" key={a} disabled={!can[a]} className={a === 'cancel' ? 'danger' : undefined} onClick={() => openAct(a)}>{t(('act.' + a) as Key)}</button>)}</div>
        </section>
        <section>
          <h3>{t('detail.timeline')}</h3>
          <div className="table-wrap"><table><tbody>{data.events.map((e: any) => (
            <tr key={e.id}><td className="num">{fmtDate(e.created_at)}</td><td><strong>{String(e.type).replace(/_/g, ' ')}</strong></td><td>{e.staff ? `${t('col.by')} ${e.staff}` : e.actor ?? ''}</td><td className="muted wrap-text">{Object.keys(e.data ?? {}).length ? JSON.stringify(e.data).slice(0, 160) : ''}</td></tr>))}</tbody></table></div>
        </section>
        {data.offers.length > 0 && <section><h3>{t('detail.offers')}</h3><div className="table-wrap"><table><tbody>{data.offers.map((f: any) => <tr key={f.id}><td>#{f.rank}</td><td>{f.driver}</td><td>{f.status}</td><td className="num">{f.bid_da ? `${fmtNum(f.bid_da)} ${t('common.da')}` : '—'}</td><td className="num">{fmtDate(f.offered_at)}</td></tr>)}</tbody></table></div></section>}
        {data.problems.length > 0 && <section><h3>{t('detail.problems')}</h3>{data.problems.map((p: any) => <p key={p.id}><Status s={p.status} /> <strong>{tx('reason.' + p.reason, p.reason)}</strong> <span className="wrap-text">{p.note}</span>{p.resolution && <span className="muted"> → {p.resolution}</span>}</p>)}</section>}
        {data.ratings.length > 0 && <section><h3>{t('detail.ratings')}</h3>{data.ratings.map((r: any, i: number) => <p key={i}><strong>{'★'.repeat(r.stars)}</strong> {r.rater} → {r.rated} <span className="wrap-text">{r.comment}</span></p>)}</section>}
        {data.photos?.length > 0 && <section><h3>{t('detail.photos')}</h3><div className="docs">{data.photos.map((p: any) => <DocPhoto key={p.id} id={p.id} label={tx('doc.' + p.kind, p.kind)} />)}</div></section>}
        {data.cash.length > 0 && <section><h3>{t('detail.cash')}</h3>{data.cash.map((c: any) => <p key={c.id} className="num">{tx('cash.' + c.type)} · {fmtNum(c.amount_da)} {t('common.da')}</p>)}</section>}
      </>)}
      {act && o && (
        <ActionDialog title={t(('act.' + act) as Key)} help={t(('act.' + act + '.help') as Key)} needReason={act !== 'correct_address'} danger={act === 'cancel'} onClose={() => setAct(null)} onSubmit={run}>
          {act === 'correct_address' && <>
            <Field label={t('addr.which')}><select value={which} onChange={e => { const w = e.target.value as 'pickup' | 'dropoff'; setWhich(w); setAddr({ ...((w === 'pickup' ? o.pickup_address : o.dropoff_address) ?? {}) }); }}>
              <option value="dropoff">{t('detail.dropoff')}</option><option value="pickup" disabled={o.status === 'picked_up'}>{t('detail.pickup')}</option></select></Field>
            <div className="grid2">{ADDR.map(k => <Field key={k} label={t(('addr.' + k) as Key)}><input value={addr[k] ?? ''} maxLength={200} onChange={e => setAddr({ ...addr, [k]: e.target.value })} /></Field>)}</div>
          </>}
        </ActionDialog>
      )}
    </Modal>
  );
}
