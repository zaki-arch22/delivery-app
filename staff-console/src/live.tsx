import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { fmtDate, t, tx } from './i18n';
import type { Page } from './App';

// Staff alerts (owner's wish, Oct 2026): ONLY the important things (emergencies, reports, automatic checks, money disputes and
// late seller payments, decisions waiting). The console asks the server every 8 seconds (get_staff_alerts). Opening the bell
// marks them seen on the server for this staff member (mark_alerts_seen), so the red counter disappears on every device.
// Emergencies and money problems also pop up on screen when they arrive. The dashboard numbers refresh every 30 seconds.
export interface Alert { key: string; at: string; kind: 'sos' | 'money' | 'check' | 'report' | 'driver' | 'topup' | 'appeal'; reason: string | null; order_id: string | null; ref: string | null;
  profile_id: string | null; name: string | null; handled: boolean; page: Page; level: 'danger' | 'warn' | 'info'; unseen: boolean }
export type Go = (p: Page, o?: { orderId?: string; driverId?: string; profileId?: string }) => void;
interface Live { alerts: Alert[]; unseen: number; markSeen: () => void; dash: any | null; online: boolean; refreshDash: () => void }
const Ctx = createContext<Live>({ alerts: [], unseen: 0, markSeen: () => {}, dash: null, online: true, refreshDash: () => {} });
export const useLive = () => useContext(Ctx);

const ALERTS_MS = 8000, DASH_MS = 30000;

export function LiveProvider({ children, go }: { children: ReactNode; go: Go }) {
  const [alerts, setAlerts] = useState<Alert[]>([]), [unseen, setUnseen] = useState(0), [dash, setDash] = useState<any>(null), [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<Alert[]>([]);
  const known = useRef<Set<string> | null>(null);
  const pull = useCallback(async () => {
    try {
      const r = await api<{ alerts: Alert[]; unseen: number }>('/get_staff_alerts');
      setOnline(true); setAlerts(r.alerts); setUnseen(r.unseen);
      if (known.current) { const loud = r.alerts.filter(a => a.level === 'danger' && !a.handled && !known.current!.has(a.key)); if (loud.length) setToasts(p => [...loud, ...p].slice(0, 4)); }
      known.current = new Set(r.alerts.map(a => a.key));
    } catch { setOnline(false); }
  }, []);
  const refreshDash = useCallback(() => { api('/get_dashboard').then(setDash, () => {}); }, []);
  const markSeen = useCallback(() => { setUnseen(0); setAlerts(a => a.map(x => ({ ...x, unseen: false }))); api('/mark_alerts_seen', {}).catch(() => {}); }, []);
  useEffect(() => {
    pull(); refreshDash();
    const a = window.setInterval(pull, ALERTS_MS), b = window.setInterval(refreshDash, DASH_MS);
    return () => { window.clearInterval(a); window.clearInterval(b); };
  }, [pull, refreshDash]);
  useEffect(() => { if (!toasts.length) return; const x = window.setTimeout(() => setToasts(p => p.slice(0, -1)), 15000); return () => window.clearTimeout(x); }, [toasts]);
  return (
    <Ctx.Provider value={{ alerts, unseen, markSeen, dash, online, refreshDash }}>
      {children}
      <div className="toasts" aria-live="assertive">
        {toasts.map(a => (
          <div key={a.key} className={'toast ' + a.level}>
            <strong>{alertTitle(a)}</strong>{a.ref && <span className="num"> · {a.ref}</span>}
            <div className="muted">{alertDetail(a)}</div>
            <div className="row">
              <button type="button" className="primary" onClick={() => { openAlert(a, go); setToasts(p => p.filter(x => x.key !== a.key)); }}>{t('todo.open')}</button>
              <button type="button" className="ghost" aria-label={t('common.close')} onClick={() => setToasts(p => p.filter(x => x.key !== a.key))}>×</button>
            </div>
          </div>))}
      </div>
    </Ctx.Provider>
  );
}

export const alertTitle = (a: Alert) => tx('alert.' + a.kind, a.kind);
export const alertDetail = (a: Alert) => (a.reason ? tx('reason.' + a.reason, tx('rule.' + a.reason, a.reason)) : a.name ?? '');
// Where an alert leads: the order itself when there is one (problems, SOS), else the page where it is handled.
export function openAlert(a: Alert, go: Go) {
  if (a.kind === 'money') return go('settlements');
  if (a.order_id && (a.kind === 'sos' || a.kind === 'check' || a.kind === 'report')) return go('orders', { orderId: a.order_id });
  if (a.kind === 'appeal') return go('trust', { profileId: a.profile_id ?? undefined });
  if (a.kind === 'topup') return go('wallets', { driverId: a.profile_id ?? undefined });
  go(a.page);
}

export function AlertList({ alerts, go, limit }: { alerts: Alert[]; go: Go; limit?: number }) {
  if (!alerts.length) return <p className="empty">{t('alerts.none')}</p>;
  return (
    <ul className="feed">
      {alerts.slice(0, limit ?? alerts.length).map(a => (
        <li key={a.key} className={'feed-item ' + a.level + (a.handled ? ' done' : '')}>
          <span className="dot" aria-hidden="true" />
          <button type="button" className="feed-main" onClick={() => openAlert(a, go)}>
            <span className="feed-title"><strong>{alertTitle(a)}</strong>{a.ref ? <span className="num"> · {a.ref}</span> : null}{a.unseen ? <span className="new-tag">{t('alerts.new')}</span> : null}</span>
            <span className="muted">{fmtDate(a.at)}{alertDetail(a) ? ' · ' + alertDetail(a) : ''}</span>
          </button>
          <span className={'pill ' + (a.handled ? 'good' : a.level === 'danger' ? 'bad' : 'warn')}>{a.handled ? t('alerts.handled') : t('alerts.open')}</span>
        </li>))}
    </ul>
  );
}

// The bell in the top bar: the number of NEW alerts. Opening it shows them (new first) and marks them all seen.
export function Bell({ go }: { go: Go }) {
  const { alerts, unseen, markSeen, online } = useLive();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Alert[]>([]);   // the list as it was when opened (so "new" stays visible while reading)
  useEffect(() => { if (!open) return; const k = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', k); return () => document.removeEventListener('mousedown', k); }, [open]);
  const toggle = () => { if (!open) { setShown(alerts); if (unseen) markSeen(); } setOpen(!open); };
  const fresh = shown.filter(a => a.unseen), older = shown.filter(a => !a.unseen);
  const pick: Go = (p, o) => { setOpen(false); go(p, o); };
  return (
    <div className="bell-wrap" ref={ref}>
      <span className={'live ' + (online ? 'on' : 'off')} title={online ? t('live.on') : t('live.off')}><span className="dot" aria-hidden="true" /><span className="live-text">{online ? t('live.on') : t('live.off')}</span></span>
      <button type="button" className="bell" aria-expanded={open} aria-label={`${t('alerts.title')}: ${unseen}`} onClick={toggle}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {unseen > 0 && <span className="badge" aria-hidden="true">{unseen > 99 ? '99+' : unseen}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label={t('alerts.title')}>
          <div className="panel-head"><h3>{t('alerts.title')}</h3><button type="button" className="ghost close-x" aria-label={t('common.close')} onClick={() => setOpen(false)}>×</button></div>
          <p className="muted small">{t('alerts.help')}</p>
          {fresh.length > 0 && <><div className="feed-head">{t('alerts.new')} ({fresh.length})</div><AlertList alerts={fresh} go={pick} /></>}
          <div className="feed-head">{t('alerts.earlier')}</div>
          <AlertList alerts={older} go={pick} limit={40} />
        </div>)}
    </div>
  );
}
