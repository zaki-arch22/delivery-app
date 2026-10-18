import { useState } from 'react';
import { api, errText } from '../api';
import { t, tx, useLang } from '../i18n';
import { ActionDialog, Empty, ErrorBox, Field, Loading, Pill, useLoad } from '../ui';

// Accepts what geojson.io gives (FeatureCollection / Feature) or a bare Polygon, and returns the Polygon.
export function extractPolygon(text: string): any | null {
  try {
    const j = JSON.parse(text);
    const g = j?.type === 'FeatureCollection' ? j.features?.find((f: any) => f?.geometry?.type === 'Polygon')?.geometry : j?.type === 'Feature' ? j.geometry : j;
    return g?.type === 'Polygon' && Array.isArray(g.coordinates) ? { type: 'Polygon', coordinates: g.coordinates } : null;
  } catch { return null; }
}
export const rectangle = (s: number, w: number, n: number, e: number) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

export function Zones() {
  useLang();
  const { data, error, loading, reload } = useLoad(() => api<{ zones: any[] }>('/list_zones'), []);
  const [toggle, setToggle] = useState<any>(null), [mode, setMode] = useState<'rect' | 'paste'>('rect');
  const [name, setName] = useState(''), [box, setBox] = useState({ s: '', w: '', n: '', e: '' }), [geo, setGeo] = useState(''), [err, setErr] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  const create = async () => {
    setErr(null); setMsg(null);
    let polygon: any;
    if (mode === 'rect') { const v = [box.s, box.w, box.n, box.e].map(Number); if (v.some(x => !Number.isFinite(x)) || v[0] >= v[2] || v[1] >= v[3]) { setErr(tx('err.BAD_POLYGON')); return; } polygon = rectangle(v[0], v[1], v[2], v[3]); }
    else { polygon = extractPolygon(geo); if (!polygon) { setErr(t('zones.badJson')); return; } }
    try { await api('/create_zone', { name: name.trim(), polygon }); setMsg(t('zones.newClosed')); setName(''); setGeo(''); setBox({ s: '', w: '', n: '', e: '' }); reload(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <>
      <h1>{t('zones.title')}</h1>
      <div className="card">
        <ErrorBox error={error} />
        {loading ? <Loading /> : !data?.zones.length ? <Empty /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('zones.name')}</th><th>{t('col.area')}</th><th>{t('col.status')}</th><th /></tr></thead>
            <tbody>{data.zones.map(z => (
              <tr key={z.id}><td><strong>{z.name}</strong></td><td className="num">{z.area_km2}</td><td>{z.is_open ? <Pill tone="good">{t('zones.open')}</Pill> : <Pill tone="muted">{t('zones.closed')}</Pill>}</td>
                <td><button type="button" className={z.is_open ? undefined : 'primary'} onClick={() => setToggle(z)}>{t(z.is_open ? 'zones.closeBtn' : 'zones.openBtn')}</button></td></tr>))}</tbody>
          </table></div>)}
      </div>
      <div className="card">
        <h2>{t('zones.create')}</h2>
        <p className="help">{t('zones.newClosed')}</p>
        {msg && <div className="ok-msg" role="status">{msg}</div>}<ErrorBox error={err} />
        <Field label={t('zones.name')}><input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></Field>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'rect'} onClick={() => setMode('rect')}>{t('zones.rect')}</button>
          <button type="button" role="tab" aria-selected={mode === 'paste'} onClick={() => setMode('paste')}>{t('zones.paste')}</button>
        </div>
        {mode === 'rect' ? (
          <div className="grid2">{(['s', 'n', 'w', 'e'] as const).map(k => <Field key={k} label={t(k === 's' ? 'zones.south' : k === 'n' ? 'zones.north' : k === 'w' ? 'zones.west' : 'zones.east')}><input inputMode="decimal" value={box[k]} onChange={e => setBox({ ...box, [k]: e.target.value.replace(/[^\d.-]/g, '') })} /></Field>)}</div>
        ) : (
          <Field label="GeoJSON" hint={t('zones.geoHelp')}><textarea rows={6} value={geo} maxLength={60000} onChange={e => setGeo(e.target.value)} /></Field>
        )}
        <button type="button" className="primary" onClick={create}>{t('zones.create')}</button>
      </div>
      {toggle && <ActionDialog title={`${t(toggle.is_open ? 'zones.closeBtn' : 'zones.openBtn')} · ${toggle.name}`} help={t(toggle.is_open ? 'zones.closeWarn' : 'zones.openWarn')} needReason={false} danger={toggle.is_open}
        onClose={() => setToggle(null)} onSubmit={async () => { await api('/set_zone_open', { zone_id: toggle.id, open: !toggle.is_open }); reload(); }} />}
    </>
  );
}
