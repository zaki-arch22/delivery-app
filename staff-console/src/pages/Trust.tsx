import { useState } from 'react';
import { api, qs } from '../api';
import { fmtDate, t, tx, useLang } from '../i18n';
import { ActionDialog, Empty, ErrorBox, Field, Loading, Modal, Pager, Pill, useLoad } from '../ui';
import type { Nav } from '../App';
import { DocPhoto } from './Drivers';

// Rules and sanctions (backend/docs/TRUST_AND_SAFETY.md): appeals waiting for a person, every rule break, blocks and bans,
// and one profile's whole record (with other accounts that used the same phone). Every action asks for a written reason.
const STAFF_RULES = ['far_confirmation', 'wrong_item', 'damaged_by_driver', 'behaviour', 'prohibited_goods', 'other'];
const FIXED: Record<string, number> = { far_confirmation: 3, wrong_item: 4, damaged_by_driver: 4, prohibited_goods: 6 };
const TONE: Record<string, 'good' | 'bad' | 'warn' | 'info' | 'muted'> = { active: 'warn', appealed: 'info', upheld: 'bad', cancelled: 'muted' };

export function Trust({ nav, profileId }: { nav: Nav; profileId?: string }) {
  useLang();
  const [tab, setTab] = useState<'appeals' | 'all' | 'sanctions'>('appeals'), [page, setPage] = useState(1);
  const [record, setRecord] = useState<string | null>(profileId ?? null), [lookup, setLookup] = useState('');
  const [deciding, setDeciding] = useState<{ v: any; decision: 'uphold' | 'cancel' } | null>(null), [lifting, setLifting] = useState<any>(null);
  const v = useLoad(() => tab === 'sanctions' ? Promise.resolve(null) : api<{ violations: any[] }>('/list_violations' + qs({ status: tab === 'appeals' ? 'appealed' : undefined, page })), [tab, page]);
  const s = useLoad(() => tab !== 'sanctions' ? Promise.resolve(null) : api<{ sanctions: any[] }>('/list_sanctions' + qs({ active: 'true', page })), [tab, page]);
  const go = (x: typeof tab) => { setTab(x); setPage(1); };
  return (
    <>
      <h1>{t('trust.title')}</h1>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'appeals'} onClick={() => go('appeals')}>{t('trust.appeals')}</button>
        <button type="button" role="tab" aria-selected={tab === 'all'} onClick={() => go('all')}>{t('trust.violations')}</button>
        <button type="button" role="tab" aria-selected={tab === 'sanctions'} onClick={() => go('sanctions')}>{t('trust.sanctions')}</button>
      </div>
      <div className="card filters">
        <Field label={t('trust.profileId')} hint={t('trust.profileIdHint')}><input value={lookup} onChange={e => setLookup(e.target.value.trim())} /></Field>
        <button type="button" disabled={!/^[0-9a-f-]{36}$/i.test(lookup)} onClick={() => setRecord(lookup)}>{t('trust.openRecord')}</button>
      </div>
      <div className="card">
        {tab !== 'sanctions' ? (<>
          <ErrorBox error={v.error} />
          {v.loading ? <Loading /> : !v.data?.violations.length ? <Empty /> : <ViolationTable rows={v.data.violations} nav={nav} onWho={setRecord} onDecide={(x, d) => setDeciding({ v: x, decision: d })} />}
          {v.data && <Pager page={page} count={v.data.violations.length} onPage={setPage} />}
        </>) : (<>
          <ErrorBox error={s.error} />
          {s.loading ? <Loading /> : !s.data?.sanctions.length ? <Empty /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t('col.created')}</th><th>{t('trust.who')}</th><th>{t('trust.kind')}</th><th>{t('trust.until')}</th><th>{t('col.reason')}</th><th>{t('col.actions')}</th></tr></thead>
              <tbody>{s.data.sanctions.map(x => (
                <tr key={x.id}>
                  <td className="num">{fmtDate(x.created_at)}</td>
                  <td>{x.profile_id ? <button type="button" className="link" onClick={() => setRecord(x.profile_id)}>{x.who}</button> : x.who}</td>
                  <td><Pill tone={x.kind === 'ban' ? 'bad' : 'warn'}>{tx('trust.kind.' + x.kind)}</Pill> <span className="muted">{tx('trust.source.' + x.source)}</span></td>
                  <td className="num">{x.until ? fmtDate(x.until) : t(x.kind === 'ban' ? 'trust.forever' : 'trust.untilStaff')}</td>
                  <td className="wrap-text">{x.reason}</td>
                  <td><button type="button" onClick={() => setLifting(x)}>{t('trust.lift')}</button></td>
                </tr>))}</tbody>
            </table></div>)}
          {s.data && <Pager page={page} count={s.data.sanctions.length} onPage={setPage} />}
        </>)}
      </div>
      {deciding && <ActionDialog title={`${t(deciding.decision === 'uphold' ? 'trust.uphold' : 'trust.cancel')} · ${tx('rule.' + deciding.v.rule)}`} reasonLabel="trust.decisionNote"
        help={deciding.v.appeal_text ? `${t('trust.appealText')}: ${deciding.v.appeal_text}` : undefined} onClose={() => setDeciding(null)}
        onSubmit={async note => { await api('/decide_violation', { id: deciding.v.id, decision: deciding.decision, note }); v.reload(); }} />}
      {lifting && <ActionDialog title={`${t('trust.lift')} · ${lifting.who}`} onClose={() => setLifting(null)}
        onSubmit={async note => { await api('/lift_sanction', { id: lifting.id, note }); s.reload(); }} />}
      {record && <Record id={record} nav={nav} onClose={() => { setRecord(null); v.reload(); s.reload(); }} />}
    </>
  );
}

function ViolationTable({ rows, nav, onWho, onDecide }: { rows: any[]; nav: Nav; onWho?: (id: string) => void; onDecide: (v: any, d: 'uphold' | 'cancel') => void }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>{t('col.created')}</th>{onWho && <th>{t('trust.who')}</th>}<th>{t('trust.rule')}</th><th>{t('col.ref')}</th><th>{t('col.status')}</th><th>{t('col.actions')}</th></tr></thead>
      <tbody>{rows.map(x => (
        <tr key={x.id}>
          <td className="num">{fmtDate(x.created_at)}</td>
          {onWho && <td><button type="button" className="link" onClick={() => onWho(x.profile_id)}>{x.display_name}</button> <span className="muted">({x.profile_type === 'driver' ? t('col.driver') : t('col.user')})</span></td>}
          <td><strong>{tx('rule.' + x.rule, x.rule)}</strong> · {x.points} {t('trust.points')} <span className="muted">{tx('trust.source.' + x.source)}</span>
            {x.note && <div className="wrap-text">{x.note}</div>}{x.appeal_text && <div className="wrap-text">↳ {t('trust.appealText')}: {x.appeal_text}</div>}{x.decision_note && <div className="muted wrap-text">→ {x.decision_note}</div>}</td>
          <td>{x.order_id ? <button type="button" className="link" onClick={() => nav.go('orders', { orderId: x.order_id })}>{x.order_ref}</button> : '—'}</td>
          <td><Pill tone={TONE[x.status] ?? 'muted'}>{tx('vstatus.' + x.status, x.status)}</Pill></td>
          <td><div className="row">
            {x.status === 'appealed' && <button type="button" onClick={() => onDecide(x, 'uphold')}>{t('trust.uphold')}</button>}
            {['active', 'appealed'].includes(x.status) && <button type="button" className="primary" onClick={() => onDecide(x, 'cancel')}>{t('trust.cancel')}</button>}
          </div></td>
        </tr>))}</tbody>
    </table></div>
  );
}

function Record({ id, nav, onClose }: { id: string; nav: Nav; onClose: () => void }) {
  const r = useLoad(() => api<any>('/get_profile_record' + qs({ profile_id: id })), [id]);
  const [dialog, setDialog] = useState<null | 'add' | 'block' | 'ban'>(null), [deciding, setDeciding] = useState<{ v: any; decision: 'uphold' | 'cancel' } | null>(null);
  const [rule, setRule] = useState('behaviour'), [points, setPoints] = useState(3), [orderId, setOrderId] = useState(''), [hours, setHours] = useState('24');
  const d = r.data;
  return (
    <Modal title={t('trust.record')} onClose={onClose} wide>
      <ErrorBox error={r.error} />
      {r.loading || !d ? <Loading /> : (<>
        <p><strong>{d.profile.display_name}</strong> · {d.profile.type === 'driver' ? t('col.driver') : t('col.user')} · {tx('status.' + d.profile.status, d.profile.status)}
          <span className="muted"> · {d.profile.phone ?? '—'}{d.profile.phone && !d.profile.phone_verified ? ` (${t('trust.unverified')})` : ''}{d.profile.google ? ' · Google' : ''}{d.profile.national_id_last3 ? ` · ID …${d.profile.national_id_last3}` : ''}</span></p>
        <p><strong>{d.points_90d} {t('trust.points90')}</strong>{d.active_block && <> · <Pill tone="bad">{tx('trust.kind.' + d.active_block.kind)} {d.active_block.until ? '→ ' + fmtDate(d.active_block.until) : ''}</Pill></>}
          <span className="muted"> · {t('trust.devices')}: {d.devices}</span></p>
        {d.documents?.id_photo || d.documents?.selfie ? <div className="docs"><DocPhoto id={d.documents.id_photo ?? undefined} label={tx('doc.id_photo')} /><DocPhoto id={d.documents.selfie ?? undefined} label={`${t('trust.selfie')} ${d.documents.selfie_at ? fmtDate(d.documents.selfie_at) : ''}`} /></div> : null}
        {d.linked_profiles.length > 0 && <div role="alert" className="error">{t('trust.linked')}: {d.linked_profiles.map((p: any) => `${p.display_name}${p.banned ? ' (' + t('trust.kind.ban') + ')' : ''}`).join(', ')}</div>}
        <div className="row">
          <button type="button" onClick={() => setDialog('add')}>{t('trust.addViolation')}</button>
          <button type="button" onClick={() => setDialog('block')}>{t('trust.block')}</button>
          <button type="button" className="danger" onClick={() => setDialog('ban')}>{t('trust.ban')}</button>
        </div>
        <h2>{t('trust.violations')}</h2>
        {d.violations.length ? <ViolationTable rows={d.violations} nav={nav} onDecide={(v, dec) => setDeciding({ v, decision: dec })} /> : <Empty />}
        <h2>{t('trust.sanctions')}</h2>
        {d.sanctions.length ? <ul>{d.sanctions.map((x: any) => <li key={x.id}>{fmtDate(x.created_at)} · {tx('trust.kind.' + x.kind)} · {x.reason}{x.until ? ' → ' + fmtDate(x.until) : ''}{x.lifted_at ? ` · ${t('trust.lifted')}: ${x.lift_note}` : ''}</li>)}</ul> : <Empty />}
      </>)}
      {dialog === 'add' && <ActionDialog title={t('trust.addViolation')} reasonLabel="trust.note" onClose={() => setDialog(null)}
        onSubmit={async note => { await api('/add_violation', { profile_id: id, rule, points: FIXED[rule] ?? points, order_id: orderId || undefined, note }); r.reload(); }}>
        <Field label={t('trust.rule')}><select value={rule} onChange={e => setRule(e.target.value)}>{STAFF_RULES.map(x => <option key={x} value={x}>{tx('rule.' + x)}{FIXED[x] ? ` (${FIXED[x]})` : ''}</option>)}</select></Field>
        {!FIXED[rule] && <Field label={t('trust.points')}><input type="number" min={1} max={12} value={points} onChange={e => setPoints(Number(e.target.value))} /></Field>}
        <Field label={t('trust.orderId')}><input value={orderId} onChange={e => setOrderId(e.target.value.trim())} /></Field>
      </ActionDialog>}
      {dialog === 'block' && <ActionDialog title={t('trust.block')} onClose={() => setDialog(null)}
        onSubmit={async reason => { await api('/block_profile', { profile_id: id, hours: hours === 'staff' ? null : Number(hours), reason }); r.reload(); }}>
        <Field label={t('trust.duration')}><select value={hours} onChange={e => setHours(e.target.value)}>
          {['24', '72', '168', '720'].map(h => <option key={h} value={h}>{tx('trust.h' + h)}</option>)}<option value="staff">{t('trust.untilStaff')}</option></select></Field>
      </ActionDialog>}
      {dialog === 'ban' && <ActionDialog title={t('trust.ban')} help={t('trust.banHelp')} danger submitLabel="trust.banConfirm" onClose={() => setDialog(null)}
        onSubmit={async reason => { await api('/ban_account', { profile_id: id, reason }); r.reload(); }} />}
      {deciding && <ActionDialog title={t(deciding.decision === 'uphold' ? 'trust.uphold' : 'trust.cancel')} reasonLabel="trust.decisionNote" onClose={() => setDeciding(null)}
        onSubmit={async note => { await api('/decide_violation', { id: deciding.v.id, decision: deciding.decision, note }); r.reload(); }} />}
    </Modal>
  );
}
