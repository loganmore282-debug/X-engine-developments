import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, API, ApiError, getToken, setToken } from './api';
import type { AppConfig, Announcement, LevelGroup, Note, Subject, User } from './types';

// ---- small helpers for what the browser remembers (bookmarks, last place, theme) ----
export function remember<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// ---- messages that float in from the top and leave by themselves ----
interface ToastApi { toast: (message: string, kind?: 'ok' | 'error') => void }
const ToastCtx = createContext<ToastApi>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

// ---- who is signed in ----
interface AuthApi {
  user: User | null; ready: boolean;
  signIn: (phone: string, password: string) => Promise<void>;
  signUp: (name: string, phone: string, password: string) => Promise<void>;
  signOut: () => void;
  setClass: (classLevel: string) => Promise<void>;
  setName: (name: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  setUser: (u: User) => void;
}
const AuthCtx = createContext<AuthApi>(null as unknown as AuthApi);
export const useAuth = () => useContext(AuthCtx);

// ---- the library: subjects, notes, classes, announcements; refreshed when the owner changes anything ----
interface LibraryApi {
  subjects: Subject[]; notes: Note[]; levels: LevelGroup[]; announcements: Announcement[]; notices: Announcement[]; config: AppConfig;
  loading: boolean; error: string | null; reload: () => Promise<void>;
  subjectName: (id: string | null) => string | null;
  saved: Set<string>; toggleSaved: (id: string) => boolean;
}
const LibCtx = createContext<LibraryApi>(null as unknown as LibraryApi);
export const useLibrary = () => useContext(LibCtx);

export function AppProviders({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ id: number; message: string; kind: 'ok' | 'error' } | null>(null);
  const toast = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now();
    setToastMsg({ id, message, kind });
    window.setTimeout(() => setToastMsg((t) => (t && t.id === id ? null : t)), 3200);
  }, []);

  const [library, setLibrary] = useState<{ subjects: Subject[]; notes: Note[]; levels: LevelGroup[]; announcements: Announcement[]; notices: Announcement[]; config: AppConfig }>(() => { const l = remember('shule_library', { subjects: [], notes: [], levels: [], announcements: [], notices: [] as Announcement[], config: {} }); return { ...l, notices: l.notices || [] }; });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(remember<string[]>('shule_saved', [])));

  // Find out who is signed in (the saved token may have expired).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (getToken()) {
        try { const r = await api<{ user: User }>('/auth/me'); if (!cancelled) setUserState(r.user); }
        catch (e) { if (e instanceof ApiError && e.status === 401) setToken(null); }
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const signOut = useCallback(() => {
    const t = getToken();
    setToken(null); setUserState(null);
    save('shule_library', { subjects: [], notes: [], levels: [], announcements: [], notices: [], config: {} });
    setLibrary({ subjects: [], notes: [], levels: [], announcements: [], notices: [], config: {} });
    // Told to the server afterwards, so leaving is instant.
    if (t) fetch(`${API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
  }, []);
  useEffect(() => {
    const onExpired = (e: Event) => { signOut(); toast((e as CustomEvent<string>).detail || 'Please sign in again', 'error'); };
    window.addEventListener('shule:expired', onExpired);
    return () => window.removeEventListener('shule:expired', onExpired);
  }, [signOut, toast]);

  const auth = useMemo<AuthApi>(() => ({
    user, ready, setUser: setUserState, signOut,
    signIn: async (phone, password) => { const r = await api<{ token: string; user: User }>('/auth/login', { body: { phone, password }, auth: false }); setToken(r.token); setUserState(r.user); },
    signUp: async (name, phone, password) => { const r = await api<{ token: string; user: User }>('/auth/register', { body: { name, phone, password }, auth: false }); setToken(r.token); setUserState(r.user); },
    setClass: async (classLevel) => { const r = await api<{ user: User }>('/auth/class-level', { body: { classLevel } }); setUserState(r.user); },
    setName: async (name) => { const r = await api<{ user: User }>('/auth/update-profile', { body: { name } }); setUserState(r.user); },
    deleteAccount: async (password) => { await api('/auth/delete-account', { body: { password } }); setToken(null); setUserState(null); },
  }), [user, ready, signOut]);

  // ---- the library ----
  const reload = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    try {
      const [subjects, notes, levels, announcements, config, notices] = await Promise.all([
        api<{ subjects: Subject[] }>('/subjects'),
        api<{ notes: Note[] }>('/notes'),
        api<{ groups: LevelGroup[] }>('/levels', { auth: false }).catch(() => ({ groups: library.levels })),
        api<{ announcements: Announcement[] }>('/announcements').catch(() => ({ announcements: library.announcements })),
        api<{ config: AppConfig }>('/config', { auth: false }).catch(() => ({ config: library.config })),
        // The student's own sign-in alerts (separate from the owner's announcements).
        api<{ notices: Announcement[] }>('/notices').catch(() => ({ notices: library.notices || [] })),
      ]);
      const next = { subjects: subjects.subjects, notes: notes.notes, levels: levels.groups, announcements: announcements.announcements, notices: notices.notices || [], config: config.config };
      setLibrary(next); save('shule_library', next); setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [library.levels, library.announcements, library.notices, library.config]);

  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => { if (user) reloadRef.current(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every 15 seconds while the page is open: has the owner changed anything? One tiny request; reload only if so.
  useEffect(() => {
    if (!user) return;
    let last = -1;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api<{ revision: number }>('/sync', { auth: false });
        if (last >= 0 && r.revision !== last) { reloadRef.current(); api<{ user: User }>('/auth/me').then((m) => setUserState(m.user)).catch(() => {}); }
        last = r.revision;
      } catch { /* offline: try again next time */ }
    };
    tick();
    const id = window.setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lib = useMemo<LibraryApi>(() => ({
    ...library, loading, error, reload,
    subjectName: (id) => library.subjects.find((s) => s.id === id)?.name ?? null,
    saved,
    toggleSaved: (id) => {
      const next = new Set(saved); const on = !next.has(id);
      on ? next.add(id) : next.delete(id);
      setSaved(next); save('shule_saved', [...next]); return on;
    },
  }), [library, loading, error, reload, saved]);

  return (
    <ToastCtx.Provider value={{ toast }}>
      <AuthCtx.Provider value={auth}>
        <LibCtx.Provider value={lib}>
          {children}
          {toastMsg && <div className="toast-wrap"><div className={`toast ${toastMsg.kind === 'error' ? 'error' : ''}`} key={toastMsg.id}>{toastMsg.message}</div></div>}
        </LibCtx.Provider>
      </AuthCtx.Provider>
    </ToastCtx.Provider>
  );
}
