import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errText, setOnExpired, setToken } from './api';
import { Lang, setLang, t, useLang, Key } from './i18n';
import { ErrorBox, Field } from './ui';
import { Orders } from './pages/Orders';
import { Problems } from './pages/Problems';
import { Drivers } from './pages/Drivers';
import { Cash } from './pages/Cash';
import { Ratings } from './pages/Ratings';
import { Trust } from './pages/Trust';
import { Zones } from './pages/Zones';
import { Prices } from './pages/Prices';
import { Dashboard } from './pages/Dashboard';
import { Settlements } from './pages/Settlements';
import { Wallets } from './pages/Wallets';
import { Customers } from './pages/Customers';
import { Audit } from './pages/Audit';
import { Bell, LiveProvider, useLive } from './live';
import { LiveOps } from './pages/LiveOps';
import { DayLog } from './pages/DayLog';
import { Search, useCardTables } from './shell';

export type Page = 'dashboard' | 'live' | 'log' | 'orders' | 'problems' | 'trust' | 'drivers' | 'customers' | 'settlements' | 'wallets' | 'cash' | 'ratings' | 'zones' | 'prices' | 'audit';
export interface Nav { go: (p: Page, opts?: { orderId?: string; driverId?: string; profileId?: string; day?: string }) => void }
// The menu, grouped by what staff do: watch, operate, money, trust, settings.
const GROUPS: { title: Key; pages: Page[] }[] = [
  { title: 'navg.overview', pages: ['dashboard', 'live', 'log'] },
  { title: 'navg.operations', pages: ['orders', 'problems', 'drivers', 'customers'] },
  { title: 'navg.money', pages: ['settlements', 'wallets', 'cash'] },
  { title: 'navg.trust', pages: ['trust', 'ratings', 'audit'] },
  { title: 'navg.settings', pages: ['zones', 'prices'] },
];
// How many things wait in a page (from the dashboard counters), shown next to its name.
function count(p: Page, d: any): { n: number; bad?: boolean; calm?: boolean } | null {
  if (!d) return null;
  const n = p === 'problems' ? d.cases.problems_open : p === 'drivers' ? d.people.drivers_pending : p === 'settlements' ? d.money.settle_disputed + d.money.settle_overdue
    : p === 'wallets' ? d.money.topups_pending : p === 'trust' ? d.cases.appeals : p === 'live' ? d.orders.searching_now + d.orders.active_now : 0;
  return n ? { n, bad: p === 'settlements' || (p === 'problems' && d.cases.sos_24h > 0), calm: p === 'live' } : null;
}
function SideNav({ page, nav, logout, open }: { page: Page; nav: Nav; logout: () => void; open: boolean }) {
  const { dash } = useLive();
  return (
    <nav className={'side' + (open ? ' open' : '')} aria-label="Main">
      <div className="brand">{t('app.title')}</div>
      {GROUPS.map(g => (
        <div key={g.title} className="nav-group">
          <div className="nav-title" aria-hidden="true">{t(g.title)}</div>
          {g.pages.map(p => { const c = count(p, dash); const label = t(('nav.' + p) as Key); return (
            <button type="button" key={p} aria-label={label} title={c ? `${label}: ${c.n}` : label} aria-current={page === p ? 'page' : undefined} onClick={() => nav.go(p)}>
              <span>{label}</span>{c && <span className={'badge' + (c.bad ? ' bad' : c.calm ? ' calm' : '')} aria-hidden="true">{c.n}</span>}
            </button>); })}
        </div>))}
      <div className="spacer" />
      <button type="button" onClick={logout}>{t('nav.logout')}</button>
    </nav>
  );
}
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
  const [page, setPage] = useState<Page>('dashboard'), [orderId, setOrderId] = useState<string | undefined>(), [driverId, setDriverId] = useState<string | undefined>(), [profileId, setProfileId] = useState<string | undefined>();
  const [visit, setVisit] = useState(0);   // opening a page again (from an alert) starts it fresh
  const [day, setDay] = useState<string | undefined>(), [menu, setMenu] = useState(false);   // menu: the phone's slide-in menu
  const out = useCallback((why: Key | null) => { setToken(null); setStaff(null); setNotice(why); setPage('dashboard'); setOrderId(undefined); setDriverId(undefined); setProfileId(undefined); }, []);
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
  const nav: Nav = { go: (p, o) => { setPage(p); setOrderId(o?.orderId); setDriverId(o?.driverId); setProfileId(o?.profileId); setDay(o?.day); setVisit(v => v + 1); setMenu(false); window.scrollTo?.(0, 0); } };
  const logout = async () => { await api('/staff_logout', {}).catch(() => {}); out(null); };
  return <Shell staff={staff} page={page} nav={nav} logout={logout} menu={menu} setMenu={setMenu} visit={visit}>
          {page === 'live' && <LiveOps nav={nav} />}
          {page === 'log' && <DayLog nav={nav} day={day} />}
          {page === 'dashboard' && <Dashboard nav={nav} />}
          {page === 'orders' && <Orders nav={nav} openId={orderId} />}
          {page === 'problems' && <Problems nav={nav} />}
          {page === 'trust' && <Trust nav={nav} profileId={profileId} />}
          {page === 'drivers' && <Drivers nav={nav} />}
          {page === 'customers' && <Customers nav={nav} />}
          {page === 'settlements' && <Settlements nav={nav} />}
          {page === 'wallets' && <Wallets driverId={driverId} />}
          {page === 'cash' && <Cash driverId={driverId} />}
          {page === 'ratings' && <Ratings nav={nav} />}
          {page === 'audit' && <Audit />}
          {page === 'zones' && <Zones />}
          {page === 'prices' && <Prices />}
  </Shell>;
}

// The frame around every page: the menu (a side bar on a computer, a slide-in menu on a phone), the top bar with the search
// box, the alerts bell and the languages.
function Shell({ staff, page, nav, logout, menu, setMenu, visit, children }: { staff: { name: string }; page: Page; nav: Nav; logout: () => void; menu: boolean; setMenu: (v: boolean) => void; visit: number; children: React.ReactNode }) {
  const main = useRef<HTMLElement>(null);
  useCardTables(main);
  return (
    <LiveProvider go={nav.go}>
      <div className={'shell' + (menu ? ' menu-open' : '')}>
        <header className="mobile-bar">
          <button type="button" className="burger" aria-label={t('nav.menu')} aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
          <span className="brand">{t('app.title')}</span>
        </header>
        {menu && <div className="nav-overlay" onClick={() => setMenu(false)} aria-hidden="true" />}
        <SideNav page={page} nav={nav} logout={logout} open={menu} />
        <main className="main" key={page + ':' + visit} ref={main}>
          <div className="topbar"><Search go={nav.go} /><div className="row topbar-right"><span className="muted who">{staff.name}</span><Bell go={nav.go} /><LangSwitch /></div></div>
          {children}
        </main>
      </div>
    </LiveProvider>
  );
}
