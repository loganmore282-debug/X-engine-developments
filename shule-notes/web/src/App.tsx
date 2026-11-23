import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppProviders, useAuth, useLibrary, remember } from './store';
import { Avatar } from './components';
import { ChooseClass, Intro, SignIn, SignUp } from './pages/Auth';
import { HomePage } from './pages/Home';
import { InboxPage, ProfilePage, SavedPage, applyTheme } from './pages/Other';
const ReaderPage = lazy(() => import('./pages/Reader').then((m) => ({ default: m.ReaderPage })));
import { Bell, Bookmark, BookmarkFilled, Close, Campaign, Home as HomeIcon, HomeFilled, User as UserIcon, UserFilled } from './icons';
import { ProgressPage } from './pages/Progress';
import { API } from './api';

function Splash() {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: '#fff' }}><img src="/logo-full.png" alt="Shule Notes" style={{ width: 'min(300px, 62vw)', animation: 'rise .5s both' }} /></div>;
}

// Shown for a moment while the reader (the biggest part of the site) arrives, if it was not already fetched in the background.
function ReaderLoading() {
  return <div className="reader"><div className="reader-top"><div className="shimmer" style={{ width: 160, height: 18, borderRadius: 8, margin: '14px 12px' }} /></div><div className="pages"><div className="pages-in"><div className="sheet-page" style={{ width: 'min(860px, 92vw)', aspectRatio: '0.707' }}><div className="shimmer" /></div></div></div></div>;
}

// Has the owner posted something the student has not opened in the bell yet?
const SEEN_KEY = 'shule_inbox_seen';
function useUnread() {
  const { announcements } = useLibrary();
  const location = useLocation();
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY) || 0));
  // Opening the notifications page marks everything as read.
  useEffect(() => { if (location.pathname === '/inbox') { const now = Date.now(); localStorage.setItem(SEEN_KEY, String(now)); setSeen(now); } }, [location.pathname]);
  return announcements.some((a) => new Date(a.createdAt).getTime() > seen);
}

// A new message from the owner slides in from the top for a few seconds (like a phone notification), then it waits in the bell.
// It is never placed inside the page itself.
function AnnouncementToast() {
  const { announcements } = useLibrary();
  const nav = useNavigate();
  const [shown, setShown] = useState<string | null>(null);
  const latest = announcements[0];
  useEffect(() => {
    if (!latest) return;
    const seen = localStorage.getItem('shule_toasted') || '';
    if (seen === latest.id) return;
    localStorage.setItem('shule_toasted', latest.id);
    setShown(latest.id);
    const t = window.setTimeout(() => setShown(null), 8000);
    return () => window.clearTimeout(t);
  }, [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!latest || shown !== latest.id) return null;
  return (
    <div className="ann-toast-wrap">
      <div className="ann-toast" role="status" onClick={() => { setShown(null); nav('/inbox'); }}>
        <span className="ann-ico"><Campaign /></span>
        <span className="grow"><b>{latest.title}</b><small>{latest.message}</small></span>
        <button className="icon-btn" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); setShown(null); }}><Close /></button>
      </div>
    </div>
  );
}

function Shell() {
  const nav = useNavigate();
  const { announcements } = useLibrary();
  const location = useLocation();
  const unread = useUnread();
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
      <main className="main page-enter" key={location.pathname}><Outlet /></main>
      <footer className="app-foot"><div className="app-foot-in">
        <span className="brand small"><img src="/logo-mark.png" alt="" /><span>Shule<b>Notes</b></span></span>
        <span className="grow" />
        <a href={`${API}/download/`}>Get the Android app</a><Link to="/profile">Help and support</Link><a href={`${API}/privacy`} target="_blank" rel="noreferrer">Privacy</a><a href={`${API}/terms`} target="_blank" rel="noreferrer">Terms</a>
      </div></footer>
      <nav className="bottom-nav">
        <NavLink to="/" end>{({ isActive }) => <>{isActive ? <HomeFilled /> : <HomeIcon />}Home</>}</NavLink>
        <NavLink to="/saved">{({ isActive }) => <>{isActive ? <BookmarkFilled /> : <Bookmark />}Saved</>}</NavLink>
        <NavLink to="/profile">{({ isActive }) => <>{isActive ? <UserFilled /> : <UserIcon />}Profile</>}</NavLink>
      </nav>
      <AnnouncementToast />
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
  useEffect(() => { const t = window.setTimeout(() => setSplash(false), 900); return () => window.clearTimeout(t); }, []);
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
        <Route path="/progress" element={<ProgressPage />} />
      </Route>
      <Route path="/note/:id" element={<Suspense fallback={<ReaderLoading />}><ReaderPage /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  useEffect(() => { applyTheme(remember<'system' | 'light' | 'dark'>('shule_theme', 'system')); }, []);
  return <BrowserRouter><AppProviders><Gate /></AppProviders></BrowserRouter>;
}
