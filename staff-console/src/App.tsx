import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errText, setOnExpired, setToken } from './api';
import { Lang, setLang, t, useLang, Key } from './i18n';
import { ErrorBox, Field } from './ui';
import { Orders } from './pages/Orders';
import { Problems } from './pages/Problems';
import { Drivers } from './pages/Drivers';
import { Cash } from './pages/Cash';
import { Ratings } from './pages/Ratings';
import { Zones } from './pages/Zones';
import { Prices } from './pages/Prices';

export type Page = 'orders' | 'problems' | 'drivers' | 'cash' | 'ratings' | 'zones' | 'prices';
export interface Nav { go: (p: Page, opts?: { orderId?: string; driverId?: string }) => void }
const PAGES: Page[] = ['orders', 'problems', 'drivers', 'cash', 'ratings', 'zones', 'prices'];
const IDLE_MS = 15 * 60 * 1000;

export function LangSwitch() {
  const lang = useLang();
  return (
    <div className="langs" role="group" aria-label="Language">
      {(['ar', 'fr', 'en'] as Lang[]).map(l => <button type="button" key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'ar' ? 'العربية' : l === 'fr' ? 'Français' : 'English'}</button>)}
    </div>
  );
}

function Login({ onIn, notice }: { onIn: (staff: { name: string }) => void; notice: Key | null }) {
  useLang();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try { const r = await api<{ token: string; staff: { name: string } }>('/staff_login', { email, password, code }); setToken(r.token); setPassword(''); setCode(''); onIn(r.staff); }
    catch (e) { setError(errText(e)); setCode(''); } finally { setBusy(false); }
  };
  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">{t('app.title')}</div>
        <LangSwitch />
        <h1 className="mt">{t('login.title')}</h1>
        {notice && <p className="help">{t(notice)}</p>}
        <form onSubmit={e => { e.preventDefault(); submit(); }}>
          <Field label={t('login.email')}><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <Field label={t('login.password')}><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
          <Field label={t('login.code')} hint={t('login.hint')}><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required /></Field>
          <ErrorBox error={error} />
          <button type="submit" className="primary wide-btn" disabled={busy}>{t('login.submit')}</button>
        </form>
      </div>
    </main>
  );
}

export function App() {
  useLang();
  const [staff, setStaff] = useState<{ name: string } | null>(null), [notice, setNotice] = useState<Key | null>(null);
  const [page, setPage] = useState<Page>('orders'), [orderId, setOrderId] = useState<string | undefined>(), [driverId, setDriverId] = useState<string | undefined>();
  const out = useCallback((why: Key | null) => { setToken(null); setStaff(null); setNotice(why); setPage('orders'); setOrderId(undefined); setDriverId(undefined); }, []);
  useEffect(() => { setOnExpired(() => out('session.ended')); }, [out]);
  // Automatic logout after 15 minutes without activity (a console left open on an unattended computer).
  const idle = useRef<number | undefined>();
  useEffect(() => {
    if (!staff) return;
    const reset = () => { window.clearTimeout(idle.current); idle.current = window.setTimeout(() => { api('/staff_logout', {}).catch(() => {}); out('session.idle'); }, IDLE_MS); };
    const ev = ['mousedown', 'keydown', 'touchstart', 'scroll']; ev.forEach(e => window.addEventListener(e, reset)); reset();
    return () => { window.clearTimeout(idle.current); ev.forEach(e => window.removeEventListener(e, reset)); };
  }, [staff, out]);
  if (!staff) return <Login notice={notice} onIn={s => { setStaff(s); setNotice(null); }} />;
  const nav: Nav = { go: (p, o) => { setPage(p); setOrderId(o?.orderId); setDriverId(o?.driverId); } };
  const logout = async () => { await api('/staff_logout', {}).catch(() => {}); out(null); };
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">{t('app.title')}</div>
        {PAGES.map(p => <button type="button" key={p} aria-current={page === p ? 'page' : undefined} onClick={() => nav.go(p)}>{t(('nav.' + p) as Key)}</button>)}
        <div className="spacer" />
        <button type="button" onClick={logout}>{t('nav.logout')}</button>
      </nav>
      <main className="main">
        <div className="topbar"><span className="muted">{staff.name}</span><LangSwitch /></div>
        {page === 'orders' && <Orders nav={nav} openId={orderId} />}
        {page === 'problems' && <Problems nav={nav} />}
        {page === 'drivers' && <Drivers nav={nav} />}
        {page === 'cash' && <Cash driverId={driverId} />}
        {page === 'ratings' && <Ratings nav={nav} />}
        {page === 'zones' && <Zones />}
        {page === 'prices' && <Prices />}
      </main>
    </div>
  );
}
