import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fetchBytes } from '../api';
import { useAuth, useLibrary, useToast, remember, save } from '../store';
import { Avatar, NoteCard, Sheet } from '../components';
import { Bell, Camera, Chat, Chevron, Edit, Logout, Palette, Trash, User as UserIcon } from '../icons';
import type { User } from '../types';

export function SavedPage() {
  const { notes, saved } = useLibrary();
  const nav = useNavigate();
  const list = notes.filter((n) => saved.has(n.id));
  return (
    <div>
      <div className="section-head" style={{ marginTop: 24 }}><h2>Saved</h2><span className="muted">{list.length} {list.length === 1 ? 'document' : 'documents'}</span></div>
      {list.length === 0 ? <div className="empty"><h3>Nothing saved yet</h3><p>Tap the bookmark on any note to keep it here.</p></div>
        : <div className="grid">{list.map((n, i) => <NoteCard key={n.id} note={n} index={i} onOpen={() => nav(`/note/${n.id}`)} />)}</div>}
    </div>
  );
}

export function InboxPage() {
  const { announcements } = useLibrary();
  return (
    <div>
      <div className="section-head" style={{ marginTop: 24 }}><h2>Notifications</h2></div>
      {announcements.length === 0 ? <div className="empty"><h3>No notifications yet</h3><p>Messages from the Shule Notes team appear here.</p></div>
        : announcements.map((a, i) => <div key={a.id} className="card rise" style={{ padding: 16, marginBottom: 10, animationDelay: `${i * 50}ms` }}><b className="poppins">{a.title}</b><p style={{ margin: '6px 0 0' }}>{a.message}</p><div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{new Date(a.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>)}
    </div>
  );
}

type Theme = 'system' | 'light' | 'dark';
export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

export function ProfilePage() {
  const { user, setName, signOut, deleteAccount, setUser } = useAuth();
  const { config } = useLibrary();
  const { toast } = useToast();
  const nav = useNavigate();
  const [sheet, setSheet] = useState<null | 'name' | 'photo' | 'theme' | 'help' | 'delete' | 'feedback' | 'logout'>(null);
  const [name, setNameValue] = useState(user?.name || '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(''); const [kind, setKind] = useState('problem');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [theme, setThemeState] = useState<Theme>(() => remember<Theme>('shule_theme', 'system'));
  const file = useRef<HTMLInputElement>(null);
  const cls = user?.classLevel;
  useMemo(() => 0, []);

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true); setErr('');
    try { await fn(); if (ok) toast(ok); setSheet(null); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  // A photo is shrunk to a 512 pixel square in the browser before it is sent.
  async function pickPhoto(f: File) {
    const bitmap = await createImageBitmap(f);
    const edge = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 512, 512);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.85));
    const form = new FormData(); form.append('photo', blob, 'photo.jpg');
    const token = (await import('../api')).getToken();
    const r = await fetch(`${(await import('../api')).API}/auth/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Could not save your photo');
    setUser(data.user as User);
  }
  if (!user) return null;
  return (
    <div className="profile-layout">
      <div className="card profile-card rise">
        <button className="avatar" style={{ border: 0, padding: 0, position: 'relative', overflow: 'visible' }} onClick={() => setSheet('photo')} aria-label="Change profile photo">
          <Avatar /><span style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, background: 'var(--primary)', color: '#fff', display: 'grid', placeItems: 'center', border: '2px solid var(--surface)' }}><Camera width={14} height={14} /></span>
        </button>
        <div className="grow"><h2 style={{ fontSize: 21 }}>{user.name}</h2><div className="muted">{user.phone}</div>{cls && <span className="pill" style={{ marginTop: 6 }}>{cls}</span>}</div>
        <button className="icon-btn" style={{ background: 'var(--primary-soft)', color: 'var(--on-primary-soft)' }} aria-label="Edit name" onClick={() => { setNameValue(user.name); setErr(''); setSheet('name'); }}><Edit /></button>
      </div>

      <div className="profile-rest">
      <div className="group-label">Study</div>
      <div className="card settings">
        <button onClick={() => nav('/')}><UserIcon /><span className="grow">My class</span><span className="muted">{cls || 'Not chosen'}</span><Chevron width={18} /></button>
        <button onClick={() => setSheet('theme')}><Palette /><span className="grow">Appearance</span><span className="muted">{theme === 'system' ? 'System default' : theme === 'light' ? 'Light' : 'Dark'}</span><Chevron width={18} /></button>
        <button onClick={() => nav('/inbox')}><Bell /><span className="grow">Notifications</span><Chevron width={18} /></button>
      </div>
      <div className="group-label">Help and about</div>
      <div className="card settings">
        <button onClick={() => setSheet('help')}><Chat /><span className="grow">Help and support</span><Chevron width={18} /></button>
        <button onClick={() => { setErr(''); setMessage(''); setSheet('feedback'); }}><Edit /><span className="grow">Send feedback</span><Chevron width={18} /></button>
      </div>
      <button className="btn danger-outline wide" style={{ marginTop: 28 }} onClick={() => setSheet('logout')}><Logout width={20} height={20} /> Log out</button>
      <div className="center"><button className="link-row" style={{ background: 'none', border: 0, color: 'var(--muted)', marginTop: 10 }} onClick={() => { setPassword(''); setErr(''); setSheet('delete'); }}>Delete account</button></div>
      <div className="muted center" style={{ fontSize: 13, marginTop: 4 }}>Shule Notes · Website</div>
      </div>

      {sheet === 'name' && <Sheet title="Edit your name" onClose={() => setSheet(null)}>
        {err && <div className="banner-error">{err}</div>}
        <label className="field"><span>Full name</span><input className="input" value={name} onChange={(e) => setNameValue(e.target.value)} autoFocus /></label>
        <div className="actions"><button className="btn outline" onClick={() => setSheet(null)}>Cancel</button><button className="btn" disabled={busy || !name.trim()} onClick={() => run(() => setName(name), 'Name updated')}>{busy ? 'Saving…' : 'Save'}</button></div>
      </Sheet>}
      {sheet === 'photo' && <Sheet title="Profile photo" onClose={() => setSheet(null)}>
        {err && <div className="banner-error">{err}</div>}
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => pickPhoto(f), 'Profile photo updated'); }} />
        <div className="settings card"><button onClick={() => file.current?.click()}><Camera /><span className="grow">{busy ? 'Saving…' : 'Choose a photo'}</span></button>
          {user.avatarVersion > 0 && <button style={{ color: 'var(--danger)' }} onClick={() => run(async () => { const r = await api<{ user: User }>('/auth/avatar/remove', { body: {} }); setUser(r.user); }, 'Photo removed')}><Trash /><span className="grow">Remove my photo</span></button>}</div>
      </Sheet>}
      {sheet === 'theme' && <Sheet title="Appearance" onClose={() => setSheet(null)}>
        {(['system', 'light', 'dark'] as Theme[]).map((t) => <button key={t} className={`chip ${theme === t ? 'on' : ''}`} style={{ width: '100%', justifyContent: 'flex-start', height: 50, marginBottom: 8 }} onClick={() => { setThemeState(t); save('shule_theme', t); applyTheme(t); setSheet(null); }}>{t === 'system' ? 'System default' : t === 'light' ? 'Light' : 'Dark'}</button>)}
      </Sheet>}
      {sheet === 'help' && <Sheet title="Help and support" onClose={() => setSheet(null)}>
        <p className="muted">Questions, a problem with a note, or a forgotten password? Reach us here.</p>
        {config.supportPhone && <p><b>Call:</b> <a href={`tel:${config.supportPhone}`}>{config.supportPhone}</a></p>}
        {config.supportWhatsapp && <p><b>WhatsApp:</b> <a href={`https://wa.me/${config.supportWhatsapp.replace(/[^\d]/g, '')}`}>{config.supportWhatsapp}</a></p>}
        {config.supportEmail && <p><b>Email:</b> <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a></p>}
        {config.supportHours && <p className="muted">{config.supportHours}</p>}
        <div className="actions"><button className="btn" onClick={() => setSheet(null)}>Close</button></div>
      </Sheet>}
      {sheet === 'feedback' && <Sheet title="Send feedback" onClose={() => setSheet(null)}>
        <p className="muted">Something not working, or an idea to make it better? Tell us.</p>
        <div className="chips">{[['problem', 'Problem'], ['idea', 'Idea'], ['other', 'Other']].map(([v, l]) => <button key={v} className={`chip ${kind === v ? 'on' : ''}`} onClick={() => setKind(v)}>{l}</button>)}</div>
        {err && <div className="banner-error">{err}</div>}
        <textarea className="input" style={{ height: 120, padding: 14, resize: 'vertical' }} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 1000))} placeholder="Your message" />
        <div className="actions"><button className="btn outline" onClick={() => setSheet(null)}>Cancel</button><button className="btn" disabled={busy} onClick={() => run(async () => { if (message.trim().length < 5) throw new Error('Please write a little more'); await api('/feedback', { body: { type: kind, message, appVersion: 'web', device: navigator.userAgent.slice(0, 80) } }); }, 'Thank you. We read every message.')}>{busy ? 'Sending…' : 'Send'}</button></div>
      </Sheet>}
      {sheet === 'logout' && <Sheet title="Log out?" onClose={() => setSheet(null)}>
        <p className="muted">You will need your phone number and password to sign in again.</p>
        <div className="actions"><button className="btn outline" onClick={() => setSheet(null)}>Cancel</button><button className="btn" onClick={() => { signOut(); nav('/'); }}>Log out</button></div>
      </Sheet>}
      {sheet === 'delete' && <Sheet title="Delete your account?" onClose={() => setSheet(null)}>
        <p className="muted">This removes your account, your photo and your saved notes for good. Enter your password to confirm.</p>
        {err && <div className="banner-error">{err}</div>}
        <label className="field"><span>Password</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></label>
        <div className="actions"><button className="btn outline" onClick={() => setSheet(null)}>Cancel</button><button className="btn" style={{ background: 'var(--danger)', color: '#fff' }} disabled={busy || !password} onClick={() => run(async () => { await deleteAccount(password); nav('/'); })}>{busy ? 'Deleting…' : 'Delete account'}</button></div>
      </Sheet>}
    </div>
  );
}
export { fetchBytes };
