import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useLibrary, useToast } from '../store';
import type { Slide } from '../types';
import type { AppConfig } from '../types';
import { Sheet } from '../components';
import { API } from '../api';

const BUILT_IN: Slide[] = [
  { id: 'b1', title: 'Every note in one place', text: 'Notes and past papers for your class, added the moment they are ready.', imageUrl: '/intro/1.jpg' },
  { id: 'b2', title: 'Stuck? Ask the AI helper', text: 'Open any page and ask a question. The answer comes from the document you are reading.', imageUrl: '/intro/2.jpg' },
  { id: 'b3', title: 'Study anywhere', text: 'Read on your phone, tablet or computer, and carry on exactly where you stopped.', imageUrl: '/intro/3.jpg' },
];

// Shown once, before the first sign-in. The owner's slides come from the server (made in the admin panel);
// if there are none, or they cannot be fetched, the built-in ones are used.
export function Intro({ onDone }: { onDone: () => void }) {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    let live = true;
    const timeout = new Promise<null>((r) => window.setTimeout(() => r(null), 2500));
    Promise.race([api<{ configured: boolean; slides: Slide[] }>('/onboarding', { auth: false }), timeout]).then((r) => {
      if (!live) return;
      if (r && r.configured) { if (r.slides.length === 0) onDone(); else setSlides(r.slides.map((s) => ({ ...s, imageUrl: s.imageUrl ? API + s.imageUrl : null }))); }
      else setSlides(BUILT_IN);
    }).catch(() => live && setSlides(BUILT_IN));
    return () => { live = false; };
  }, [onDone]);
  // Moves on by itself every five seconds, like a story.
  useEffect(() => {
    if (!slides) return;
    const id = window.setTimeout(() => setI((n) => (n < slides.length - 1 ? n + 1 : n)), 5000);
    return () => window.clearTimeout(id);
  }, [slides, i]);
  if (!slides) return <div className="intro" style={{ alignItems: 'center', justifyContent: 'center' }}><img src="/logo-mark.png" width={88} alt="" /></div>;
  const last = i === slides.length - 1;
  return (
    <div className="intro">
      {slides.map((s, n) => <div key={s.id} className={`intro-slide ${n === i ? 'on' : ''}`} style={{ backgroundImage: s.imageUrl ? `url(${s.imageUrl})` : 'linear-gradient(160deg,#1f7f59,#0b2f22)' }} />)}
      <div className="intro-fade" />
      <div className="intro-top">
        <div className="intro-bars">{slides.map((s, n) => <i key={s.id} className={n < i ? 'done' : n === i ? 'on' : ''} />)}</div>
        <div className="row" style={{ marginTop: 14 }}>
          <img src="/logo-mark.png" width={30} alt="" /><b className="poppins">ShuleNotes</b>
          <span className="grow" />
          {!last && <button className="skip" onClick={onDone}>Skip</button>}
        </div>
      </div>
      <div className="intro-bottom" key={i}>
        <h2>{slides[i].title}</h2>
        <p>{slides[i].text}</p>
        <button className="btn wide" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? 'Get started' : 'Continue'}</button>
      </div>
    </div>
  );
}

// The sign-in screens: on a computer a green panel on the left says what the app is, the form is on the right.
function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-split">
      <aside className="auth-aside">
        <div className="hero-deco" aria-hidden="true"><i /><i /><i /></div>
        <div className="aside-logo"><img src="/logo-full.png" alt="Shule Notes" /></div>
        <div className="aside-copy">
          <h2>Notes, past papers and an AI helper, in one place.</h2>
          <ul>
            <li><span>1</span>Everything for your class, sorted by subject</li>
            <li><span>2</span>Ask the AI helper about the page you are reading</li>
            <li><span>3</span>Carry on exactly where you stopped, on any device</li>
          </ul>
        </div>
        <small>© {new Date().getFullYear()} Shule Notes</small>
      </aside>
      <div className="auth-main">
        {children}
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, label = 'Password' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field"><span>{label}</span>
      <div style={{ position: 'relative' }}>
        <input className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="current-password" />
        <button type="button" className="icon-btn" style={{ position: 'absolute', right: 6, top: 5 }} onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{show && <path d="M3 3l18 18" />}</svg>
        </button>
      </div>
    </label>
  );
}

export function SignIn({ onRegister }: { onRegister: () => void }) {
  const { signIn } = useAuth();
  const { toast } = useToast();
  const [phone, setPhone] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [config, setConfig] = useState<AppConfig>({});
  useEffect(() => { api<{ config: AppConfig }>('/config', { auth: false }).then((r) => setConfig(r.config)).catch(() => {}); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !password) { setError('Enter your phone number and password'); return; }
    setBusy(true); setError('');
    try { await signIn(phone, password); } catch (err) { setError((err as Error).message); toast((err as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <AuthShell>
      <form className="card auth-card" onSubmit={submit}>
        <img className="auth-logo mobile-only" src="/logo-full.png" alt="Shule Notes" />
        <h1>Welcome back</h1><p className="sub">Sign in to carry on studying.</p>
        {error && <div className="banner-error">{error}</div>}
        <label className="field"><span>Phone number</span><input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0772 123 456" /></label>
        <PasswordField value={password} onChange={setPassword} />
        <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 16 }}><button type="button" className="link-row" style={{ margin: 0, padding: 0, background: 'none', border: 0, color: 'var(--primary)', fontWeight: 600 }} onClick={() => setHelp(true)}>Forgot password?</button></div>
        <button className="btn wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="link-row">New to Shule Notes? <button type="button" onClick={onRegister}>Create an account</button></div>
      </form>
      {help && <Sheet title="Forgot your password?" onClose={() => setHelp(false)}>
        <p className="muted">Passwords are reset by our team. Reach us and we will set a new one for you.</p>
        {config.supportPhone && <p><b>Call:</b> <a href={`tel:${config.supportPhone}`}>{config.supportPhone}</a></p>}
        {config.supportWhatsapp && <p><b>WhatsApp:</b> <a href={`https://wa.me/${config.supportWhatsapp.replace(/[^\d]/g, '')}`}>{config.supportWhatsapp}</a></p>}
        {config.supportEmail && <p><b>Email:</b> <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a></p>}
        {config.supportHours && <p className="muted">{config.supportHours}</p>}
        <div className="actions"><button className="btn" onClick={() => setHelp(false)}>Close</button></div>
      </Sheet>}
    </AuthShell>
  );
}

export function SignUp({ onSignIn }: { onSignIn: () => void }) {
  const { signUp } = useAuth();
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter your name');
    if (!phone.trim()) return setError('Enter your phone number');
    if (password.length < 6) return setError('Use at least 6 characters for your password');
    setBusy(true); setError('');
    try { await signUp(name, phone, password); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <AuthShell>
      <form className="card auth-card" onSubmit={submit}>
        <img className="auth-logo mobile-only" src="/logo-full.png" alt="Shule Notes" />
        <h1>Create your account</h1><p className="sub">Notes, past papers and an AI study helper.</p>
        {error && <div className="banner-error">{error}</div>}
        <label className="field"><span>Full name</span><input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Phone number</span><input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0772 123 456" /></label>
        <PasswordField value={password} onChange={setPassword} />
        <button className="btn wide" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <div className="link-row">Already have an account? <button type="button" onClick={onSignIn}>Sign in</button></div>
      </form>
    </AuthShell>
  );
}

// After the first sign-in: pick the class, so Home shows the right notes.
export function ChooseClass({ onDone }: { onDone?: () => void }) {
  const { setClass, user } = useAuth();
  const { levels } = useLibrary();
  const { toast } = useToast();
  const [groups, setGroups] = useState(levels);
  const [picked, setPicked] = useState(user?.classLevel || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!groups.length) api<{ groups: typeof groups }>('/levels', { auth: false }).then((r) => setGroups(r.groups)).catch(() => {}); }, [groups.length]);
  async function go() {
    if (!picked) return;
    setBusy(true);
    try { await setClass(picked); onDone?.(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <div className="card auth-card" style={{ maxWidth: 560 }}>
        <h1>Which class are you in?</h1><p className="sub">We will show the notes and past papers for your class.</p>
        {groups.map((g) => <div key={g.id} className="level-group"><h4>{g.name}</h4><div className="level-grid">{g.levels.map((l) => <button key={l.id} className={`chip ${picked === l.id ? 'on' : ''}`} onClick={() => setPicked(l.id)}>{l.name}</button>)}</div></div>)}
        <button className="btn wide" style={{ marginTop: 22 }} disabled={!picked || busy} onClick={go}>{busy ? 'Saving…' : 'Continue'}</button>
      </div>
    </div>
  );
}
export function useGoHome() { const nav = useNavigate(); return () => nav('/', { replace: true }); }
