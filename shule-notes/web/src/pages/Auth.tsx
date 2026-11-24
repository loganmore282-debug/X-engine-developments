import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useLibrary, useToast } from '../store';
import type { Slide } from '../types';
import type { AppConfig } from '../types';
import { Sheet } from '../components';
import { API } from '../api';
import { Words, confetti } from '../motion';
import { Check, Visibility, VisibilityOff } from '../icons';
import { SubjectIcon, subjectVars } from '../subjectLook';

const BUILT_IN: Slide[] = [
  { id: 'b1', title: 'Every note in one place', text: 'Notes and exams for your class, added the moment they are ready.', imageUrl: '/intro/1.jpg' },
  { id: 'b2', title: 'Stuck? Ask the AI helper', text: 'Open any page and ask a question. The answer comes from the document you are reading.', imageUrl: '/intro/2.jpg' },
  { id: 'b3', title: 'Study anywhere', text: 'Read on your phone, tablet or computer, and carry on exactly where you stopped.', imageUrl: '/intro/3.jpg' },
  { id: 'b4', title: 'Be ready for every exam', text: 'Practise with exams for your class, then watch your streak and progress grow every day.', imageUrl: '/intro/4.jpg' },
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
      {slides.map((s, n) => <div key={s.id} className={`intro-slide ${n === i ? 'on' : ''}`} style={{ backgroundImage: s.imageUrl ? `url(${s.imageUrl}), linear-gradient(160deg,#1f7f59,#0b2f22)` : 'linear-gradient(160deg,#1f7f59,#0b2f22)' }} />)}
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
        <h2><Words text={slides[i].title} /></h2>
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
          <h2>Notes, exams and an AI helper, in one place.</h2>
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
          {show ? <VisibilityOff /> : <Visibility />}
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
        <h1>Create your account</h1><p className="sub">Notes, exams and an AI study helper.</p>
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

// After the first sign-in: pick the class, so Home shows the right notes. One level at a time (Primary / O-Level / A-Level),
// big class tiles, and a live preview of what that class will get (real counts from the library, never invented).
export function ChooseClass({ onDone }: { onDone?: () => void }) {
  const { setClass, user } = useAuth();
  const { levels, notes, subjects } = useLibrary();
  const { toast } = useToast();
  const [groups, setGroups] = useState(levels);
  const [picked, setPicked] = useState(user?.classLevel || '');
  const [busy, setBusy] = useState(false);
  const [gi, setGi] = useState(0);
  useEffect(() => { if (!groups.length) api<{ groups: typeof groups }>('/levels', { auth: false }).then((r) => setGroups(r.groups)).catch(() => {}); }, [groups.length]);
  // Open on the level of the class already chosen (changing class later), else on the first level.
  useEffect(() => { const at = groups.findIndex((g) => g.levels.some((l) => l.id === picked)); if (at >= 0) setGi(at); }, [groups.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const known = useMemo(() => new Set(groups.flatMap((g) => g.levels.map((l) => l.id))), [groups]);
  const summary = useMemo(() => {
    if (!picked) return null;
    const list = notes.filter((n) => !n.classLevel || n.classLevel === picked || !known.has(n.classLevel));
    const subs = subjects.filter((s) => list.some((n) => n.subjectId === s.id));
    return { docs: list.length, exams: list.filter((n) => n.kind === 'past-paper').length, subs };
  }, [picked, notes, subjects, known]);
  const first = (user?.name || '').trim().split(/\s+/)[0];
  const group = groups[Math.min(gi, Math.max(groups.length - 1, 0))];
  async function go() {
    if (!picked) return;
    setBusy(true);
    try { await setClass(picked); confetti(); onDone?.(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <div className="card auth-card cc-card">
        {first && <div className="cc-hello">Welcome, {first}</div>}
        <h1>Which class are you in?</h1>
        <p className="sub">We will show the notes and exams for your class. You can change it any time.</p>
        {groups.length > 0 && (
          <div className="cc-tabs" role="tablist" style={{ ['--n' as string]: groups.length, ['--i' as string]: gi }}>
            <i className="cc-thumb" />
            {groups.map((g, n) => (
              <button key={g.id} role="tab" aria-selected={n === gi} className={n === gi ? 'on' : ''} onClick={() => setGi(n)}>
                <b>{g.name}</b><small>{g.levels.length > 1 ? `${g.levels[0].short} – ${g.levels[g.levels.length - 1].short}` : g.levels[0]?.short}</small>
              </button>
            ))}
          </div>
        )}
        {group && (
          <div className="cc-grid" key={group.id}>
            {group.levels.map((l, n) => (
              <button key={l.id} className={`cc-disc ${picked === l.id ? 'on' : ''}`} style={{ animationDelay: `${n * 35}ms` }} aria-pressed={picked === l.id} onClick={() => setPicked(l.id)}>
                <b>{l.short}</b><small>{l.name}</small>
                {picked === l.id && <span className="cc-tick"><Check width={14} height={14} /></span>}
              </button>
            ))}
          </div>
        )}
        <div className="cc-preview" key={picked || 'none'} aria-live="polite">
          {!picked ? <p className="muted">Pick your class to see what is waiting for you.</p> : summary && summary.docs > 0 ? (
            <>
              <div className="cc-preview-top"><b>{picked}</b><span>{summary.docs} {summary.docs === 1 ? 'document' : 'documents'}{summary.exams ? ` · ${summary.exams} ${summary.exams === 1 ? 'exam' : 'exams'}` : ''} · {summary.subs.length} {summary.subs.length === 1 ? 'subject' : 'subjects'}</span></div>
              <div className="cc-subjects">
                {summary.subs.slice(0, 5).map((s) => <span key={s.id} className="cc-sub sv" style={subjectVars(s.name) as CSSProperties} title={s.name}><SubjectIcon name={s.name} size={24} /></span>)}
                {summary.subs.length > 5 && <span className="cc-more">+{summary.subs.length - 5}</span>}
              </div>
            </>
          ) : <div className="cc-preview-top"><b>{picked}</b><span>New notes and exams for this class appear here the moment they are added.</span></div>}
        </div>
        <button className="btn wide" style={{ marginTop: 18 }} disabled={!picked || busy} onClick={go}>{busy ? 'Saving…' : picked ? `Start with ${picked}` : 'Choose your class'}</button>
      </div>
    </div>
  );
}
export function useGoHome() { const nav = useNavigate(); return () => nav('/', { replace: true }); }
