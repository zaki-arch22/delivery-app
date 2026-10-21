import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { errText } from './api';
import { t, tx, Key } from './i18n';

// Loads data and reloads on demand. A slower, older answer can never overwrite a newer one.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current; setLoading(true); setError(null);
    fn().then(d => { if (n === seq.current) setData(d); }, e => { if (n === seq.current) setError(errText(e)); }).finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="ghost" aria-label={t('common.close')} onClick={onClose}>×</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
);

const TONE: Record<string, string> = { searching: 'info', assigned: 'info', picked_up: 'info', delivered: 'good', failed: 'bad', cancelled: 'muted', expired: 'muted', active: 'good', pending_approval: 'warn', rejected: 'bad', suspended: 'bad', deleted: 'muted', open: 'warn', in_progress: 'info', resolved: 'good' };
export const Status = ({ s }: { s: string }) => <span className={'pill ' + (TONE[s] ?? 'muted')}>{tx('status.' + s, s)}</span>;
export const Pill = ({ tone, children }: { tone: 'good' | 'bad' | 'warn' | 'info' | 'muted'; children: ReactNode }) => <span className={'pill ' + tone}>{children}</span>;

export const ErrorBox = ({ error }: { error: string | null }) => (error ? <div role="alert" className="error">{error}</div> : null);
export const Empty = () => <p className="empty">{t('common.empty')}</p>;
export const Loading = () => <p className="muted">{t('common.loading')}</p>;

export function Pager({ page, count, onPage }: { page: number; count: number; onPage: (p: number) => void }) {
  return (
    <div className="pager">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('common.prev')}</button>
      <span>{page}</span>
      <button type="button" disabled={count < 50} onClick={() => onPage(page + 1)}>{t('common.next')}</button>
    </div>
  );
}

// A dialog for any staff action that needs a reason (saved in the audit trail). `extra` can add more fields.
export function ActionDialog({ title, help, onClose, onSubmit, needReason = true, reasonLabel = 'common.reason', children, submitLabel = 'common.confirm', danger }: {
  title: string; help?: string; onClose: () => void; onSubmit: (reason: string) => Promise<unknown>; needReason?: boolean; reasonLabel?: Key; children?: ReactNode; submitLabel?: Key; danger?: boolean;
}) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (needReason && reason.trim().length < 3) { setError(tx('err.BAD_TEXT')); return; }
    setBusy(true); setError(null);
    try { await onSubmit(reason.trim()); onClose(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      {help && <p className="help">{help}</p>}
      {children}
      {needReason && <Field label={t(reasonLabel)} hint={t('common.reasonHint')}><textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} rows={3} /></Field>}
      <ErrorBox error={error} />
      <div className="row end">
        <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className={danger ? 'danger' : 'primary'} disabled={busy} onClick={go}>{t(submitLabel)}</button>
      </div>
    </Modal>
  );
}

export const addressText = (a: Record<string, string> | null | undefined) =>
  !a ? '—' : ['street', 'commune', 'building', 'entrance', 'floor', 'apartment', 'landmark', 'notes'].map(k => a[k]).filter(Boolean).join(' · ') || '—';
