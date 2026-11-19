// App-wide contexts: preferences (language, RTL, display units) and authentication.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AR } from './ar';
import { makeUnits, type DepthUnit, type Units } from './units';
import type { User } from './types';
import { canWrite, initDb, setCurrentUser } from '../db/repo';
import * as auth from '../db/auth';

type Lang = 'en' | 'ar';
interface Prefs { lang: Lang; setLang(l: Lang): void; t(s: string): string; depthUnit: DepthUnit; setDepthUnit(u: DepthUnit): void; U: Units }
const PrefsCtx = createContext<Prefs>(null!);
export const usePrefs = () => useContext(PrefsCtx);

const stored = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (stored('dd.lang', 'en') === 'ar' ? 'ar' : 'en'));
  const [depthUnit, setUnitState] = useState<DepthUnit>(() => (stored('dd.unit', 'ft') === 'm' ? 'm' : 'ft'));
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = useCallback((l: Lang) => { localStorage.setItem('dd.lang', l); setLangState(l); }, []);
  const setDepthUnit = useCallback((u: DepthUnit) => { localStorage.setItem('dd.unit', u); setUnitState(u); }, []);
  const t = useCallback((s: string) => (lang === 'ar' ? AR[s] ?? s : s), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, depthUnit, setDepthUnit, U: makeUnits(depthUnit) }), [lang, setLang, t, depthUnit, setDepthUnit]);
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

interface AuthState {
  status: 'loading' | 'ready' | 'error'; error: string | null; user: User | null; setup: boolean;
  canWrite: boolean; isAdmin: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<void>;
  signOut(): Promise<void>;
}
const AuthCtx = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUserState] = useState<User | null>(null);
  const [setup, setSetup] = useState(false);
  const setUser = useCallback((u: User | null) => { setCurrentUser(u); setUserState(u); }, []);

  useEffect(() => {
    (async () => {
      try {
        await initDb();
        setUser(await auth.currentSession());
        setSetup(await auth.needsSetup());
        setStatus('ready');
      } catch (e) { setError((e as Error).message ?? String(e)); setStatus('error'); }
    })();
  }, [setUser]);

  const value = useMemo<AuthState>(() => ({
    status, error, user, setup, canWrite: canWrite(user?.role), isAdmin: user?.role === 'admin',
    signIn: async (email, password) => setUser(await auth.signIn(email, password)),
    signUp: async (email, password, name) => { setUser(await auth.signUp(email, password, name)); setSetup(false); },
    signOut: async () => { await auth.signOut(); setUser(null); },
  }), [status, error, user, setup, setUser]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
