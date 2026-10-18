import { Fragment, useEffect, useState } from 'react';
import { api, errText } from '../api';
import { fmtDate, fmtNum, t, useLang, Key } from '../i18n';
import { Empty, ErrorBox, Field, Loading, useLoad } from '../ui';

const FIELDS = ['base_da', 'per_km_da', 'medium_extra_da', 'large_extra_da', 'car_extra_da', 'min_percent', 'max_percent'] as const;
type F = Record<(typeof FIELDS)[number], string>;
const up10 = (n: number) => Math.ceil(n / 10) * 10, down10 = (n: number) => Math.floor(n / 10) * 10;
// Same formula as the server, shown only as an illustration.
export function example(f: Record<string, number>, km: number) {
  const rec = up10(f.base_da + f.per_km_da * Math.ceil(km));
  return { rec, min: Math.min(rec, up10((rec * f.min_percent) / 100)), max: Math.max(rec, down10((rec * f.max_percent) / 100)) };
}

export function Prices() {
  useLang();
  const { data, error, loading, reload } = useLoad(() => api<{ active: any; history: any[] }>('/get_pricing'), []);
  const empty: F = { base_da: '', per_km_da: '', medium_extra_da: '0', large_extra_da: '0', car_extra_da: '0', min_percent: '80', max_percent: '150' };
  const [f, setF] = useState<F>(empty), [km, setKm] = useState('3'), [err, setErr] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data?.active) setF(Object.fromEntries(FIELDS.map(k => [k, String(data.active[k])])) as F); }, [data]);
  const nums = Object.fromEntries(FIELDS.map(k => [k, Number(f[k])])) as Record<string, number>;
  const valid = FIELDS.every(k => /^\d+$/.test(f[k]));
  const ex = valid && Number(km) > 0 ? example(nums, Number(km)) : null;
  const save = async () => { setErr(null); setMsg(null); if (!valid) { setErr(t('err.BAD_NUMBER')); return; } try { const r = await api<{ version: number }>('/create_pricing_version', nums); setMsg(`${t('prices.version')} ${r.version} ✓`); reload(); } catch (e) { setErr(errText(e)); } };
  return (
    <>
      <h1>{t('prices.title')}</h1>
      <div className="card">
        <h2>{t('prices.active')}</h2>
        <ErrorBox error={error} />
        {loading ? <Loading /> : !data?.active ? <p className="error">{t('prices.none')}</p> : (
          <dl className="kv">{FIELDS.map(k => <Fragment key={k}><dt>{t(('prices.' + k) as Key)}</dt><dd className="num">{fmtNum(data.active[k])}{k.endsWith('percent') ? ' %' : ' ' + t('common.da')}</dd></Fragment>)}
            <dt>{t('prices.version')}</dt><dd>{data.active.version} · {fmtDate(data.active.created_at)}</dd></dl>)}
      </div>
      <div className="card">
        <h2>{t('prices.new')}</h2>
        <p className="help">{t('prices.note')}</p>
        {msg && <div className="ok-msg" role="status">{msg}</div>}<ErrorBox error={err} />
        <div className="grid2">{FIELDS.map(k => <Field key={k} label={t(('prices.' + k) as Key)}><input inputMode="numeric" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') })} /></Field>)}</div>
        <div className="help">
          <strong>{t('prices.example')}</strong>
          <div className="row"><Field label={t('prices.km')}><input inputMode="decimal" value={km} onChange={e => setKm(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            {ex && <span>{t('prices.recommended')}: <strong className="num">{fmtNum(ex.rec)} {t('common.da')}</strong> · {t('prices.range')} <span className="num">{fmtNum(ex.min)}–{fmtNum(ex.max)} {t('common.da')}</span></span>}</div>
        </div>
        <button type="button" className="primary" onClick={save}>{t('common.save')}</button>
      </div>
      {data && data.history.length > 1 && <div className="card"><h2>{t('prices.history')}</h2>
        {data.history.filter(h => !h.active).map(h => <p key={h.version} className="muted">{t('prices.version')} {h.version} · {fmtDate(h.created_at)} · {h.base_da} + {h.per_km_da}/km</p>)}</div>}
      {data && !data.history.length && !loading && <Empty />}
    </>
  );
}
