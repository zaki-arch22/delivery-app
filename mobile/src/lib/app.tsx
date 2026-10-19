import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Client } from '../core/api';
import { Session, SessionState } from '../core/session';
import { KeyStore, secureStore } from '../core/storage';
import { deviceLang, isLang, isRtl, Key, Lang, translate } from '../i18n';
import { apiUrl } from './config';

export interface Services { client: Client; session: Session; store: KeyStore }
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

export function makeServices(store: KeyStore = secureStore(), url = apiUrl(), fetchFn?: typeof fetch): Services {
  const client = new Client(url, store, fetchFn);
  return { client, session: new Session(client), store };
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
