import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, qs } from './api';
import { fmtDate, fmtNum, t, tx } from './i18n';

// Live activity for staff: the console asks the server every few seconds what happened since its last look (get_staff_feed)
// and refreshes the counters (get_dashboard). Serious events (SOS, disputed or late seller payments) also pop up.
export interface FeedItem { key: string; at: string; kind: string; order_id: string | null; ref: string | null; data: any; level: 'info' | 'warn' | 'danger' }
interface Live { items: FeedItem[]; unseen: number; markSeen: () => void; dash: any | null; online: boolean; refreshDash: () => void }
const Ctx = createContext<Live>({ items: [], unseen: 0, markSeen: () => {}, dash: null, online: true, refreshDash: () => {} });
export const useLive = () => useContext(Ctx);

const FEED_MS = 8000, DASH_MS = 30000;

export function LiveProvider({ children, onOpenOrder }: { children: ReactNode; onOpenOrder: (id: string) => void }) {
  const [items, setItems] = useState<FeedItem[]>([]), [seen, setSeen] = useState<string>(''), [dash, setDash] = useState<any>(null), [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<FeedItem[]>([]);
  const since = useRef<string | null>(null), first = useRef(true);
  const pull = useCallback(async () => {
    try {
      const r = await api<{ now: string; items: FeedItem[] }>('/get_staff_feed' + qs({ since: since.current }));
      since.current = r.now; setOnline(true);
      if (r.items.length) {
        setItems(prev => { const known = new Set(prev.map(i => i.key)); return [...r.items.filter(i => !known.has(i.key)), ...prev].slice(0, 150); });
        if (!first.current) { const loud = r.items.filter(i => i.level === 'danger'); if (loud.length) setToasts(prev => [...loud, ...prev].slice(0, 4)); }
      }
      first.current = false;
    } catch { setOnline(false); }
  }, []);
  const refreshDash = useCallback(() => { api('/get_dashboard').then(setDash, () => {}); }, []);
  useEffect(() => {
    pull(); refreshDash();
    const a = window.setInterval(pull, FEED_MS), b = window.setInterval(refreshDash, DASH_MS);
    return () => { window.clearInterval(a); window.clearInterval(b); };
  }, [pull, refreshDash]);
  useEffect(() => { if (!toasts.length) return; const x = window.setTimeout(() => setToasts(p => p.slice(0, -1)), 12000); return () => window.clearTimeout(x); }, [toasts]);
  const unseen = items.filter(i => i.at > seen && i.level !== 'info').length;
  const markSeen = () => setSeen(items[0]?.at ?? new Date().toISOString());
  return (
    <Ctx.Provider value={{ items, unseen, markSeen, dash, online, refreshDash }}>
      {children}
      <div className="toasts" aria-live="assertive">
        {toasts.map(i => (
          <div key={i.key} className={'toast ' + i.level}>
            <strong>{feedTitle(i)}</strong>{i.ref && <span className="num"> · {i.ref}</span>}
            <div className="row">
              {i.order_id && <button type="button" onClick={() => { onOpenOrder(i.order_id!); setToasts(p => p.filter(x => x.key !== i.key)); }}>{t('live.open')}</button>}
              <button type="button" className="ghost" aria-label={t('common.close')} onClick={() => setToasts(p => p.filter(x => x.key !== i.key))}>×</button>
            </div>
          </div>))}
      </div>
    </Ctx.Provider>
  );
}

export const feedTitle = (i: FeedItem) => tx('feed.' + i.kind, i.kind);
// One short line of detail for an event (amounts, reasons, names), never anything secret.
export function feedDetail(i: FeedItem): string {
  const d = i.data ?? {};
  if (d.amount_da != null) return `${fmtNum(d.amount_da)} ${t('common.da')}`;
  if (d.offered_da != null) return `${fmtNum(d.offered_da)} ${t('common.da')}`;
  if (d.price_da != null) return `${fmtNum(d.price_da)} ${t('common.da')}`;
  if (d.reason) return tx('reason.' + d.reason, tx('reason.delivery_failed:' + d.reason, String(d.reason)));
  if (d.rule) return tx('rule.' + d.rule, d.rule);
  if (d.name) return String(d.name);
  if (d.outcome) return tx('settle.' + d.outcome, d.outcome);
  return '';
}

export function FeedList({ items, onOpenOrder, limit }: { items: FeedItem[]; onOpenOrder: (id: string) => void; limit?: number }) {
  if (!items.length) return <p className="empty">{t('live.empty')}</p>;
  return (
    <ul className="feed">
      {items.slice(0, limit ?? items.length).map(i => (
        <li key={i.key} className={'feed-item ' + i.level}>
          <span className="dot" aria-hidden="true" />
          <div className="feed-main">
            <div><strong>{feedTitle(i)}</strong>{i.level === 'danger' && <span className="sr-only"> (!)</span>} {i.ref && (i.order_id ? <button type="button" className="link num" onClick={() => onOpenOrder(i.order_id!)}>{i.ref}</button> : <span className="num">{i.ref}</span>)}</div>
            <div className="muted">{fmtDate(i.at)}{feedDetail(i) ? ' · ' + feedDetail(i) : ''}</div>
          </div>
        </li>))}
    </ul>
  );
}

// The bell in the top bar: how many warnings and alerts arrived since the last look, and the list.
export function Bell({ onOpenOrder }: { onOpenOrder: (id: string) => void }) {
  const { items, unseen, markSeen, online } = useLive();
  const [open, setOpen] = useState(false);
  return (
    <div className="bell-wrap">
      <span className={'live ' + (online ? 'on' : 'off')} title={online ? t('live.on') : t('live.off')}><span className="dot" aria-hidden="true" />{online ? t('live.on') : t('live.off')}</span>
      <button type="button" className="bell" aria-expanded={open} aria-label={`${t('live.bell')}: ${unseen}`} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {unseen > 0 && <span className="badge" aria-hidden="true">{unseen > 99 ? '99+' : unseen}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label={t('live.title')}>
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>{t('live.title')}</h3><button type="button" className="link" onClick={markSeen}>{t('live.seen')}</button></div>
          <FeedList items={items} limit={40} onOpenOrder={id => { setOpen(false); onOpenOrder(id); }} />
        </div>)}
    </div>
  );
}
