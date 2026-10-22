import { RefObject, useEffect, useRef, useState } from 'react';
import { api, qs } from './api';
import { t, tx } from './i18n';
import type { Go } from './live';

// On a phone, wide tables become one card per row: each cell is labelled with its column name (read from the table's
// header), so nothing is cut or squeezed. Works for every table of every page, including ones that load later.
export function useCardTables(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current; if (!el) return;
    const label = () => el.querySelectorAll('table').forEach(tb => {
      const heads = Array.from(tb.querySelectorAll('thead th')).map(th => th.textContent?.trim() ?? '');
      tb.querySelectorAll('tbody tr').forEach(tr => Array.from(tr.children).forEach((td, i) => { if (heads[i] && td.getAttribute('data-label') !== heads[i]) td.setAttribute('data-label', heads[i]); }));
    });
    label();
    const mo = new MutationObserver(() => label());
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  });
}

// One search box for everything: an order reference, a phone number or a person's name (staff_search).
export function Search({ go }: { go: Go }) {
  const [q, setQ] = useState(''), [res, setRes] = useState<any[] | null>(null), [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null), seq = useRef(0);
  useEffect(() => {
    const v = q.trim(); if (v.length < 2) { setRes(null); return; }
    const n = ++seq.current;
    const h = window.setTimeout(() => api<{ results: any[] }>('/staff_search' + qs({ q: v })).then(r => { if (n === seq.current) { setRes(r.results); setOpen(true); } }, () => {}), 300);
    return () => window.clearTimeout(h);
  }, [q]);
  useEffect(() => { if (!open) return; const k = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', k); return () => document.removeEventListener('mousedown', k); }, [open]);
  const pick = (r: any) => { setOpen(false); setQ(''); if (r.type === 'order') go('orders', { orderId: r.id }); else go('trust', { profileId: r.id }); };
  return (
    <div className="search" ref={box}>
      <input type="search" value={q} maxLength={40} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} onChange={e => setQ(e.target.value)} onFocus={() => res && setOpen(true)} />
      {open && res && (
        <div className="search-res" role="listbox" aria-label={t('search.placeholder')}>
          {!res.length ? <p className="muted">{t('search.none')}</p> : res.map(r => (
            <button type="button" role="option" aria-selected="false" key={r.type + r.id} onClick={() => pick(r)}>
              <span className="pill info">{t(r.type === 'order' ? 'search.order' : r.type === 'driver' ? 'search.driver' : 'search.user')}</span>
              <strong>{r.label}</strong><span className="muted">{r.type === 'order' ? tx('status.' + r.sub, r.sub) : r.sub ?? ''}</span>
            </button>))}
        </div>)}
    </div>
  );
}
