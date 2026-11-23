import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API, api, fetchBytes } from '../api';
import { useAuth, useLibrary, useToast, remember, save } from '../store';
import { Avatar, NoteCard, Sheet } from '../components';
import { Android, Back, Bell, Call, Camera, Campaign, ChatBubble, CheckCircle, Chevron, Description, Edit, ErrorIcon, Feedback, Gift, Help, Hourglass, Insights, Logout, Palette, Premium, PrivacyTip, Receipt, School, Security, Share, Trash } from '../icons';
import type { AppConfig, PaymentRecord, User } from '../types';
import { PaySheet, untilLabel, useAccess } from '../Pay';

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
  const { announcements, notices, config } = useLibrary();
  const nav = useNavigate();
  const [help, setHelp] = useState(false);
  // The owner's news and the student's own sign-in alerts, newest first.
  const items = [...announcements, ...(notices || [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return (
    <div>
      <div className="section-head" style={{ marginTop: 24 }}><button className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}><Back /></button><h2>Notifications</h2></div>
      {items.length === 0 ? <div className="empty"><h3>You are all caught up</h3><p>News from Shule Notes and alerts about your account appear here.</p></div>
        : items.map((a, i) => {
          const security = a.kind === 'security';
          return (
            <div key={(security ? 's' : 'a') + a.id} className={`card notice rise ${security ? 'security' : ''}`} style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <span className="notice-ico">{security ? <Security /> : <Campaign />}</span>
              <div className="grow">
                <div className="notice-title"><b className="poppins">{a.title}</b>{a.own && <span className="tag">This device</span>}</div>
                <p>{a.message}</p>
                <div className="notice-foot">
                  <span className="muted">{whenLabel(a.createdAt)}</span>
                  {security && !a.own && <button className="link-btn" onClick={() => setHelp(true)}>Get help</button>}
                </div>
              </div>
            </div>
          );
        })}
      {help && <Sheet title="Was this not you?" onClose={() => setHelp(false)}>
        <p className="muted">Contact us now. We will reset your password and sign out every other device.</p>
        <ContactList config={config} />
        <div className="actions"><button className="btn" onClick={() => setHelp(false)}>Close</button></div>
      </Sheet>}
    </div>
  );
}

function whenLabel(iso: string) {
  const d = new Date(iso); const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function ContactList({ config }: { config: AppConfig }) {
  const wa = (config.supportWhatsapp || '').replace(/[^\d]/g, '');
  if (!config.supportPhone && !config.supportWhatsapp && !config.supportEmail) return <p>Contact details have not been added yet. Please ask your teacher or school.</p>;
  return (
    <div className="card settings">
      {config.supportWhatsapp && <a className="row-link" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer"><span className="tile t-wa"><ChatBubble /></span><span className="grow">WhatsApp<small className="muted block">{config.supportWhatsapp}</small></span><Chevron width={18} /></a>}
      {config.supportPhone && <a className="row-link" href={`tel:${config.supportPhone.replace(/[^\d+]/g, '')}`}><span className="tile t-blue"><Call /></span><span className="grow">Call<small className="muted block">{config.supportPhone}</small></span><Chevron width={18} /></a>}
      {config.supportEmail && <a className="row-link" href={`mailto:${config.supportEmail}`}><span className="tile t-teal"><Help /></span><span className="grow">Email<small className="muted block">{config.supportEmail}</small></span><Chevron width={18} /></a>}
    </div>
  );
}

// Profile > Payment history: every pass bought (or given), with a clear status and the total paid.
export function PaymentsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<PaymentRecord[] | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api<{ payments: PaymentRecord[] }>('/payments/mine').then((r) => setRows(r.payments || [])).catch((e) => setError((e as Error).message)); };
  useEffect(load, []);
  const ugx = (n: number) => 'UGX ' + n.toLocaleString('en-US');
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const look = (p: PaymentRecord) => p.gift ? { cls: 't-purple', icon: <Gift />, label: 'Gift' }
    : p.status === 'paid' ? { cls: 't-green', icon: <CheckCircle />, label: 'Paid' }
    : p.status === 'failed' ? { cls: 't-red', icon: <ErrorIcon />, label: 'Did not go through' }
    : p.status === 'expired' ? { cls: 't-grey', icon: <ErrorIcon />, label: 'Not completed' }
    : { cls: 't-amber', icon: <Hourglass />, label: 'Waiting' };
  const total = (rows || []).filter((p) => p.status === 'paid' && !p.gift).reduce((a, p) => a + p.amount, 0);
  return (
    <div>
      <div className="section-head" style={{ marginTop: 24 }}>
        <button className="icon-btn" aria-label="Back" onClick={() => nav('/profile')}><Back /></button>
        <h2>Payment history</h2>
      </div>
      {error && !rows && <div className="empty"><h3>Could not load</h3><p>{error}</p><button className="btn" onClick={load}>Try again</button></div>}
      {!rows && !error && <div className="center" style={{ padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
      {rows && rows.length === 0 && <div className="empty"><h3>No payments yet</h3><p>When you buy a pass with mobile money, it appears here with its date and amount.</p></div>}
      {rows && rows.length > 0 && <>
        <div className="card pay-total rise"><small>Total paid</small><b className="poppins">{ugx(total)}</b><span>{rows.filter((p) => p.status === 'paid').length} {rows.filter((p) => p.status === 'paid').length === 1 ? 'pass' : 'passes'}</span></div>
        <div className="card settings">
          {rows.map((p) => { const l = look(p); return (
            <div key={p.id} className="pay-row">
              <span className={`tile ${l.cls}`}>{l.icon}</span>
              <span className="grow"><b>{p.planName}</b><small className="muted block">{date(p.createdAt)}</small>{p.status === 'paid' && p.accessUntil && <small className="muted block">Gave access until {date(p.accessUntil)}</small>}</span>
              <span className="pay-amt"><b>{p.gift ? 'Free' : ugx(p.amount)}</b><small className={l.cls}>{l.label}</small></span>
            </div>
          ); })}
        </div>
      </>}
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
  const access = useAccess();
  const [paySheet, setPaySheet] = useState(false);
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
  async function shareApp() {
    const data = { title: 'Shule Notes', text: 'Notes and exams for every class, with an AI helper.', url: window.location.origin };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.url); toast('Link copied. Send it to a friend.'); }
    } catch { /* the student closed the share sheet */ }
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
        {access.enabled && <button onClick={() => setPaySheet(true)}><span className="tile t-green"><Premium /></span><span className="grow">My pass</span><span className="muted trail">{access.active ? `Until ${untilLabel(access.until!)}` : 'Get a pass'}</span><Chevron width={18} /></button>}
        {access.enabled && <button onClick={() => nav('/payments')}><span className="tile t-teal"><Receipt /></span><span className="grow">Payment history</span><Chevron width={18} /></button>}
        <button onClick={() => nav('/')}><span className="tile t-blue"><School /></span><span className="grow">My class</span><span className="muted trail">{cls || 'Not chosen'}</span><Chevron width={18} /></button>
        <button onClick={() => nav('/progress')}><span className="tile t-purple"><Insights /></span><span className="grow">My progress</span><Chevron width={18} /></button>
      </div>
      <div className="group-label">App</div>
      <div className="card settings">
        <button onClick={() => setSheet('theme')}><span className="tile t-pink"><Palette /></span><span className="grow">Appearance</span><span className="muted trail">{theme === 'system' ? 'System default' : theme === 'light' ? 'Light' : 'Dark'}</span><Chevron width={18} /></button>
        <button onClick={() => nav('/inbox')}><span className="tile t-amber"><Bell /></span><span className="grow">Notifications</span><Chevron width={18} /></button>
        <a className="row-link" href={`${API}/download/`} target="_blank" rel="noopener noreferrer"><span className="tile t-green"><Android /></span><span className="grow">Get the Android app</span><Chevron width={18} /></a>
      </div>
      <div className="group-label">Get help</div>
      <div className="card settings">
        {config.supportWhatsapp && <a className="row-link" href={`https://wa.me/${config.supportWhatsapp.replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer"><span className="tile t-wa"><ChatBubble /></span><span className="grow">Chat with us on WhatsApp</span><Chevron width={18} /></a>}
        {config.supportPhone && <a className="row-link" href={`tel:${config.supportPhone.replace(/[^\d+]/g, '')}`}><span className="tile t-blue"><Call /></span><span className="grow">Call us</span><span className="muted trail">{config.supportPhone}</span><Chevron width={18} /></a>}
        {(config.supportEmail || config.supportHours || (!config.supportPhone && !config.supportWhatsapp)) && <button onClick={() => setSheet('help')}><span className="tile t-teal"><Help /></span><span className="grow">Help and support</span><Chevron width={18} /></button>}
        <button onClick={() => { setErr(''); setMessage(''); setSheet('feedback'); }}><span className="tile t-amber"><Feedback /></span><span className="grow">Send feedback</span><Chevron width={18} /></button>
        <button onClick={shareApp}><span className="tile t-green"><Share /></span><span className="grow">Share Shule Notes</span><Chevron width={18} /></button>
      </div>
      <div className="group-label">About</div>
      <div className="card settings">
        <a className="row-link" href={`${API}/terms`} target="_blank" rel="noopener noreferrer"><span className="tile t-grey"><Description /></span><span className="grow">Terms of use</span><Chevron width={18} /></a>
        <a className="row-link" href={`${API}/privacy`} target="_blank" rel="noopener noreferrer"><span className="tile t-grey"><PrivacyTip /></span><span className="grow">Privacy policy</span><Chevron width={18} /></a>
      </div>
      <button className="btn danger-outline wide" style={{ marginTop: 28 }} onClick={() => setSheet('logout')}><Logout width={20} height={20} /> Log out</button>
      <div className="center"><button className="link-row" style={{ background: 'none', border: 0, color: 'var(--muted)', marginTop: 10 }} onClick={() => { setPassword(''); setErr(''); setSheet('delete'); }}>Delete account</button></div>
      <div className="muted center" style={{ fontSize: 13, marginTop: 4 }}>Shule Notes · Website</div>
      </div>

      {paySheet && <PaySheet onClose={() => setPaySheet(false)} />}
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
