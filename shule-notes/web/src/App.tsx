import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppProviders, useAuth, useLibrary, remember } from './store';
import { Avatar } from './components';
import { ChooseClass, Intro, SignIn, SignUp } from './pages/Auth';
import { HomePage } from './pages/Home';
import { InboxPage, ProfilePage, SavedPage, applyTheme, PaymentsPage } from './pages/Other';
const ReaderPage = lazy(() => import('./pages/Reader').then((m) => ({ default: m.ReaderPage })));
import { useMotion } from './motion';
import { LogoBuild } from './LogoBuild';
import { Bell, Bookmark, BookmarkFilled, Home as HomeIcon, HomeFilled, User as UserIcon, UserFilled } from './icons';
import { ProgressPage } from './pages/Progress';
import { SubjectPage } from './pages/Subject';
import { useUnread } from './unread';
import { API } from './api';

// The logo builds itself EVERY time the site is opened (owner: "it should appear every time I visit").
const SPLASH_MS = 3500;

function Splash() {
  return <div className="splash" role="status"><LogoBuild /></div>;
}

// Shown for a moment while the reader (the biggest part of the site) arrives, if it was not already fetched in the background.
function ReaderLoading() {
  return <div className="reader"><div className="reader-top"><div className="shimmer" style={{ width: 160, height: 18, borderRadius: 8, margin: '14px 12px' }} /></div><div className="pages"><div className="pages-in"><div className="sheet-page" style={{ width: 'min(860px, 92vw)', aspectRatio: '0.707' }}><div className="shimmer" /></div></div></div></div>;
}

// The three tabs (a tab switch fades and rises; a deeper page slides in), and which tab the sliding marker sits under.
const TABS = ['/', '/saved', '/profile'];
function navIndex(path: string) { return path === '/saved' ? 1 : path === '/profile' || path === '/progress' || path === '/payments' ? 2 : 0; }

function Shell() {
  const nav = useNavigate();
  const { announcements } = useLibrary();
  const location = useLocation();
  const unread = useUnread();
  // Typing on a phone: the keyboard covers the bottom bar anyway, so it steps aside and comes back cleanly when the
  // keyboard closes (some phone browsers otherwise leave it floating mid-screen or hidden after the keyboard goes).
  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)));
    const onIn = (e: FocusEvent) => { if (isField(e.target)) document.body.classList.add('typing'); };
    const onOut = () => window.setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('typing'); }, 120);
    document.addEventListener('focusin', onIn); document.addEventListener('focusout', onOut);
    return () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut); document.body.classList.remove('typing'); };
  }, []);
  // Moving between Home, Saved and Profile: the new page fades in and starts at the top (Home restores its own place).
  useEffect(() => { if (location.pathname !== '/') window.scrollTo(0, 0); }, [location.pathname]);
  return (
    <div className="shell">
      <header className="topbar"><div className="topbar-in">
        <NavLink to="/" className="brand"><img src="/logo-mark.png" alt="" /><span>Shule<b>Notes</b></span></NavLink>
        <nav className="nav-links"><NavLink to="/" end>Home</NavLink><NavLink to="/saved">Saved</NavLink><NavLink to="/profile">Profile</NavLink></nav>
        <span className="grow" />
        <button className={`icon-btn bell ${unread ? 'ring' : ''}`} aria-label={unread ? 'Notifications, new message' : 'Notifications'} onClick={() => nav('/inbox')} style={{ position: 'relative' }}><Bell />{unread && <i className="bell-dot" />}</button>
        <button className="icon-btn" aria-label="Your profile" onClick={() => nav('/profile')} style={{ width: 'auto', height: 'auto', padding: 0 }}><Avatar size={38} /></button>
      </div></header>
      <main className={`main ${TABS.includes(location.pathname) ? 'tab-enter' : 'page-enter'}`} key={location.pathname}><Outlet /></main>
      <footer className="app-foot"><div className="app-foot-in">
        <span className="brand small"><img src="/logo-mark.png" alt="" /><span>Shule<b>Notes</b></span></span>
        <span className="grow" />
        <a href={`${API}/download/`}>Get the Android app</a><Link to="/profile">Help and support</Link><a href={`${API}/privacy`} target="_blank" rel="noreferrer">Privacy</a><a href={`${API}/terms`} target="_blank" rel="noreferrer">Terms</a>
      </div></footer>
      <nav className="bottom-nav" style={{ ['--i' as string]: navIndex(location.pathname) }}>
        <NavLink to="/" end className={({ isActive }) => (isActive || location.pathname.startsWith('/subject/') ? 'active' : '')}>{({ isActive }) => { const on = isActive || location.pathname.startsWith('/subject/'); return <>{on ? <HomeFilled /> : <HomeIcon />}Home</>; }}</NavLink>
        <NavLink to="/saved">{({ isActive }) => <>{isActive ? <BookmarkFilled /> : <Bookmark />}Saved</>}</NavLink>
        <NavLink to="/profile">{({ isActive }) => <>{isActive ? <UserFilled /> : <UserIcon />}Profile</>}</NavLink>
      </nav>
    </div>
  );
}

function Gate() {
  const { user, ready } = useAuth();
  const [seenIntro, setSeenIntro] = useState(() => localStorage.getItem('shule_intro_seen') === '1');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [splash, setSplash] = useState(true);
  // After signing out, the sign-in screen comes back (not the create-account one the student used before).
  useEffect(() => { if (!user) setMode('in'); }, [user]);
  // Logging out (or being signed out) brings the introduction back before the sign-in screen (owner's request).
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (user) { wasSignedIn.current = true; return; }
    if (wasSignedIn.current) { wasSignedIn.current = false; try { localStorage.removeItem('shule_intro_seen'); } catch { /* private mode */ } setSeenIntro(false); }
  }, [user]);
  useEffect(() => { const t = window.setTimeout(() => setSplash(false), SPLASH_MS); return () => window.clearTimeout(t); }, []);
  if (!ready || splash) return <Splash />;
  if (!user) {
    if (!seenIntro) return <Intro onDone={() => { localStorage.setItem('shule_intro_seen', '1'); setSeenIntro(true); }} />;
    return mode === 'in' ? <SignIn onRegister={() => setMode('up')} /> : <SignUp onSignIn={() => setMode('in')} />;
  }
  if (!user.classLevel) return <ChooseClass />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/subject/:id" element={<SubjectPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
      </Route>
      <Route path="/note/:id" element={<Suspense fallback={<ReaderLoading />}><ReaderPage /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  useMotion();
  useEffect(() => { applyTheme(remember<'system' | 'light' | 'dark'>('shule_theme', 'system')); }, []);
  return <BrowserRouter><AppProviders><Gate /></AppProviders></BrowserRouter>;
}
