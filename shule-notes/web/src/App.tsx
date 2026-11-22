import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, Outlet, useNavigate } from 'react-router-dom';
import { AppProviders, useAuth, useLibrary, remember } from './store';
import { Avatar } from './components';
import { ChooseClass, Intro, SignIn, SignUp } from './pages/Auth';
import { Landing } from './pages/Landing';
import { HomePage } from './pages/Home';
import { InboxPage, ProfilePage, SavedPage, applyTheme } from './pages/Other';
import { ReaderPage } from './pages/Reader';
import { Bell, Bookmark, Home as HomeIcon, User as UserIcon } from './icons';
import { API } from './api';

function Splash() {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: '#fff' }}><img src="/logo-full.png" alt="Shule Notes" style={{ width: 'min(300px, 62vw)', animation: 'rise .5s both' }} /></div>;
}

function Shell() {
  const nav = useNavigate();
  const { announcements } = useLibrary();
  return (
    <div className="shell">
      <header className="topbar"><div className="topbar-in">
        <NavLink to="/" className="brand"><img src="/logo-mark.png" alt="" /><span>Shule<b>Notes</b></span></NavLink>
        <nav className="nav-links"><NavLink to="/" end>Home</NavLink><NavLink to="/saved">Saved</NavLink><NavLink to="/profile">Profile</NavLink></nav>
        <span className="grow" />
        <button className="icon-btn" aria-label="Notifications" onClick={() => nav('/inbox')} style={{ position: 'relative' }}><Bell />{announcements.length > 0 && <i style={{ position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5, background: '#ffb020' }} />}</button>
        <button className="icon-btn" aria-label="Your profile" onClick={() => nav('/profile')} style={{ width: 'auto', height: 'auto', padding: 0 }}><Avatar size={38} /></button>
      </div></header>
      <main className="main page-enter"><Outlet /></main>
      <footer className="app-foot"><div className="app-foot-in">
        <span className="brand small"><img src="/logo-mark.png" alt="" /><span>Shule<b>Notes</b></span></span>
        <span className="grow" />
        <a href={`${API}/download/`}>Get the Android app</a><Link to="/profile">Help and support</Link><a href={`${API}/privacy`} target="_blank" rel="noreferrer">Privacy</a><a href={`${API}/terms`} target="_blank" rel="noreferrer">Terms</a>
      </div></footer>
      <nav className="bottom-nav">
        <NavLink to="/" end><HomeIcon />Home</NavLink><NavLink to="/saved"><Bookmark />Saved</NavLink><NavLink to="/profile"><UserIcon />Profile</NavLink>
      </nav>
    </div>
  );
}

function Gate() {
  const { user, ready } = useAuth();
  const nav = useNavigate();
  const [seenIntro, setSeenIntro] = useState(() => localStorage.getItem('shule_intro_seen') === '1');
  const [splash, setSplash] = useState(true);
  useEffect(() => { const t = window.setTimeout(() => setSplash(false), 900); return () => window.clearTimeout(t); }, []);
  // A phone sees the story-style introduction once, before the landing page; a computer goes straight to the landing page.
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
  if (!ready || splash) return <Splash />;
  if (!user) {
    if (narrow && !seenIntro) return <Intro onDone={() => { localStorage.setItem('shule_intro_seen', '1'); setSeenIntro(true); }} />;
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn onRegister={() => nav('/signup')} />} />
        <Route path="/signup" element={<SignUp onSignIn={() => nav('/signin')} />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }
  if (!user.classLevel) return <ChooseClass />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="/note/:id" element={<ReaderPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  useEffect(() => { applyTheme(remember<'system' | 'light' | 'dark'>('shule_theme', 'system')); }, []);
  return <BrowserRouter><AppProviders><Gate /></AppProviders></BrowserRouter>;
}
