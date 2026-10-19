import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Client } from '../core/api';
import { Session, SessionState } from '../core/session';
import { Notice as LiveNotice, Realtime } from '../core/realtime';
import { StepQueue } from '../core/queue';
import { KeyStore, secureStore } from '../core/storage';
import { deviceLang, isLang, isRtl, Key, Lang, translate } from '../i18n';
import { apiUrl, wsUrl } from './config';
import { tracking } from './tracker';
import { photoBlob } from './photos';

export interface Services { client: Client; session: Session; store: KeyStore; realtime: Realtime | null; queue: StepQueue }
interface AppCtx {
  services: Services;
  ready: boolean;                 // the stored login (if any) has been checked
  state: SessionState;
  lang: Lang; rtl: boolean;
  setLang(l: Lang): Promise<void>;
  t(key: Key, vars?: Record<string, string | number>): string;
}
const Ctx = createContext<AppCtx | null>(null);
const LANG_KEY = 'lang';

export function makeServices(store: KeyStore = secureStore(), url = apiUrl(), fetchFn?: typeof fetch, WS: typeof WebSocket | null = typeof WebSocket === 'undefined' ? null : WebSocket, retryMs?: number): Services {
  const client = new Client(url, store, fetchFn);
  return { client, session: new Session(client), store, realtime: WS ? new Realtime(client, store, wsUrl(url), WS) : null, queue: new StepQueue(client, store, retryMs, photoBlob) };
}

// Holds the login state and the chosen language for the whole app. Tests pass their own services.
export function AppProvider({ services: given, children }: { services?: Services; children: React.ReactNode }) {
  const services = useRef(given ?? makeServices()).current;
  const [state, setState] = useState<SessionState>(services.session.state);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>(deviceLang());

  useEffect(() => services.session.subscribe(setState) as unknown as () => void, [services]);
  useEffect(() => {
    let live = true;
    (async () => {
      const saved = await services.store.get(LANG_KEY).catch(() => null);
      if (live && isLang(saved)) setLangState(saved);
      // Resume a stored login without a new SMS code. Offline: stay logged in and let screens retry.
      await services.session.restore().catch(() => false);
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [services]);

  // One live connection for the active profile (contract G1): restarted on every switch, stopped on logout.
  const activeId = state.active?.id ?? null;
  useEffect(() => {
    const rt = services.realtime; if (!rt) return;
    if (activeId) { rt.start(activeId).catch(() => {}); services.queue.flush().catch(() => {}); } else rt.stop();   // waiting job steps go out as soon as a driver is logged in
    return () => { rt.stop(); tracking.stop(); };   // a switch or logout takes the driver offline on the server too
  }, [services, activeId]);

  const setLang = useCallback(async (l: Lang) => { setLangState(l); await services.store.set(LANG_KEY, l).catch(() => {}); }, [services]);
  const t = useCallback((k: Key, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);
  const value = useMemo(() => ({ services, ready, state, lang, rtl: isRtl(lang), setLang, t }), [services, ready, state, lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

// Runs `f` for every live notification of the active profile (screens use it to refresh at once instead of waiting).
export function useNotices(f: (n: LiveNotice) => void) {
  const { services } = useApp();
  const ref = React.useRef(f); ref.current = f;
  useEffect(() => { const rt = services.realtime; if (!rt) return; const off = rt.onNotice(n => ref.current(n)); return () => { off(); }; }, [services]);
}
