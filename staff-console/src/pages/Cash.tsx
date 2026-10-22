import { useState } from 'react';
import { api, errText, qs } from '../api';
import { fmtDate, fmtNum, t, tx, useLang } from '../i18n';
import { ActionDialog, Empty, ErrorBox, Field, Loading, useLoad } from '../ui';

export function Cash({ driverId }: { driverId?: string }) {
  useLang();
  const [sel, setSel] = useState<string | undefined>(driverId);
  const holders = useLoad(() => api<{ drivers: any[] }>('/list_drivers' + qs({ holding_cash: true })), []);
  return (
    <>
      <h1>{t('cash.title')}</h1>
      <div className="split">
        <div className="card list">
          <h3>{t('cash.holders')}</h3>
          <ErrorBox error={holders.error} />
          {holders.loading ? <Loading /> : !holders.data?.drivers.length ? <Empty /> : holders.data.drivers.map(d => (
            <button type="button" key={d.id} aria-pressed={sel === d.id} onClick={() => setSel(d.id)}><span>{d.display_name}</span><strong className="num">{fmtNum(d.cash_held_da)} {t('common.da')}</strong></button>))}
        </div>
        <div>{sel ? <DriverCash key={sel} id={sel} onChange={holders.reload} /> : <div className="card"><p className="muted">{t('cash.pick')}</p></div>}</div>
      </div>
    </>
  );
}

function DriverCash({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api<any>('/get_driver_cash' + qs({ profile_id: id })), [id]);
  const [amount, setAmount] = useState(''), [note, setNote] = useState(''), [msg, setMsg] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const [adj, setAdj] = useState(false), [adjAmount, setAdjAmount] = useState(''), [rev, setRev] = useState<any>(null);
  const done = () => { reload(); onChange(); };
  const handover = async () => {
    setErr(null); setMsg(null);
    if (!/^\d+$/.test(amount) || Number(amount) <= 0) { setErr(tx('err.BAD_NUMBER')); return; }
    try { const r = await api<any>('/record_cash_handover', { driver_profile_id: id, amount_da: Number(amount), note: note.trim() || undefined }); setMsg(`${t('cash.receipt')} ${r.receipt} · ${fmtNum(r.amount_da)} ${t('common.da')}`); setAmount(''); setNote(''); done(); }
    catch (e) { setErr(errText(e)); }
  };
  if (loading && !data) return <div className="card"><Loading /></div>;
  if (error) return <div className="card"><ErrorBox error={error} /></div>;
  const reversed = new Set<number>(data.entries.filter((e: any) => e.reverses_id).map((e: any) => e.reverses_id));
  return (
    <>
      <div className="card">
        <h2>{data.driver}</h2>
        <div className="row"><div><div className="muted">{t('cash.balance')}</div><div className="big num">{fmtNum(data.balance_da)} {t('common.da')}</div></div>
          <div><div className="muted">{t('col.limit')}</div><div className="num">{data.cash_limit_da == null ? '—' : `${fmtNum(data.cash_limit_da)} ${t('common.da')}`}</div></div></div>
      </div>
      <div className="card">
        <h3>{t('cash.handover')}</h3><p className="help">{t('cash.handoverHelp')}</p>
        {msg && <div className="ok-msg" role="status">{msg}</div>}<ErrorBox error={err} />
        <div className="grid2"><Field label={t('cash.amount')}><input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label={t('common.note')}><input value={note} maxLength={300} onChange={e => setNote(e.target.value)} /></Field></div>
        <div className="row"><button type="button" className="primary" onClick={handover}>{t('cash.handover')}</button><button type="button" onClick={() => { setAdjAmount(''); setAdj(true); }}>{t('cash.adjust')}</button></div>
      </div>
      <div className="card">
        <h3>{t('cash.entries')}</h3>
        {!data.entries.length ? <Empty /> : <div className="table-wrap"><table>
          <thead><tr><th>{t('col.created')}</th><th>{t('col.type')}</th><th>{t('col.amount')}</th><th>{t('col.ref')}</th><th>{t('common.note')}</th><th>{t('col.by')}</th><th /></tr></thead>
          <tbody>{data.entries.map((e: any) => (
            <tr key={e.id}><td className="num">{fmtDate(e.created_at)}</td><td>{tx(e.type === 'handover' ? 'cash.handover_t' : 'cash.' + e.type, e.type)} <span className="muted">#{e.id}</span></td>
              <td className="num"><strong>{e.amount_da > 0 ? '+' : ''}{fmtNum(e.amount_da)}</strong></td><td>{e.ref ?? ''}</td><td className="wrap-text">{e.note}</td><td>{e.staff ?? ''}</td>
              <td>{reversed.has(e.id) ? <span className="muted">{t('cash.reversed')}</span> : !e.reverses_id && <button type="button" onClick={() => setRev(e)}>{t('cash.reverse')}</button>}</td></tr>))}</tbody>
        </table></div>}
      </div>
      {adj && <ActionDialog title={t('cash.adjust')} help={t('cash.adjustHelp')} reasonLabel="common.note" onClose={() => setAdj(false)}
        onSubmit={async n => { const v = Number(adjAmount); if (!/^[+-]?\d+$/.test(adjAmount) || v === 0) throw Object.assign(new Error(''), { code: 'BAD_NUMBER' }); await api('/add_cash_adjustment', { driver_profile_id: id, amount_da: v, note: n }); done(); }}>
        <Field label={t('cash.amount')}><input value={adjAmount} placeholder="+500 / -500" onChange={e => setAdjAmount(e.target.value.replace(/[^\d+-]/g, ''))} /></Field>
      </ActionDialog>}
      {rev && <ActionDialog title={`${t('cash.reverse')} #${rev.id} (${fmtNum(-rev.amount_da)} ${t('common.da')})`} help={t('cash.adjustHelp')} reasonLabel="common.note" danger onClose={() => setRev(null)}
        onSubmit={async n => { await api('/add_cash_adjustment', { driver_profile_id: id, reverses_id: rev.id, note: n }); done(); }} />}
    </>
  );
}
