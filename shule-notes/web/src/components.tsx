import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchBytes, getToken } from './api';
import { useAuth, useLibrary } from './store';
import type { Note } from './types';
import { Bookmark } from './icons';
import { SubjectIcon, subjectVars } from './subjectLook';

// A modal sheet that slides up (centred on a big screen). Closes on Escape or a tap outside.
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Drawn on the page itself (not inside the screen that opened it), so it always sits above the bottom bar.
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

// The student's photo, or the Shule Notes logo until they set one (the photo needs the sign-in token, so it is fetched, not linked).
export function Avatar({ size = 68 }: { size?: number }) {
  const { user } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const version = user?.avatarVersion || 0;
  useEffect(() => {
    let revoked: string | null = null; let live = true;
    setUrl(null);
    if (version > 0 && getToken()) {
      fetchBytes(`/auth/avatar?v=${version}`).then((b) => { if (live) { revoked = URL.createObjectURL(new Blob([b])); setUrl(revoked); } }).catch(() => {});
    }
    return () => { live = false; if (revoked) URL.revokeObjectURL(revoked); };
  }, [version]);
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="Your profile photo" /> : <img className="logo" src="/logo-mark.png" alt="Shule Notes logo" />}
    </div>
  );
}

export function pagesLabel(n: number) { return n === 1 ? '1 page' : `${n} pages`; }
export function sizeLabel(bytes: number) { return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }

// The picture on a document: the subject's own drawing on a soft gradient of the subject's colour.
export function Cover({ subject, size = 'md', label }: { subject: string | null; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <div className={`cover sv ${size}`} style={subjectVars(subject) as CSSProperties}>
      <SubjectIcon name={subject} size={size === 'lg' ? 40 : size === 'sm' ? 24 : 32} />
      {label && <span>{label}</span>}
    </div>
  );
}

// One document in a list: its cover, title, details and a bookmark.
export function NoteCard({ note, onOpen, index = 0, showClass = true }: { note: Note; onOpen: () => void; index?: number; showClass?: boolean }) {
  const { subjectName, saved, toggleSaved } = useLibrary();
  const subject = subjectName(note.subjectId);
  const on = saved.has(note.id);
  const [pop, setPop] = useState(false);
  return (
    <div className="card note-card rise sv" style={{ animationDelay: `${Math.min(index, 8) * 45}ms`, ...(subjectVars(subject) as CSSProperties) }} role="button" tabIndex={0}
      onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <Cover subject={subject} label={note.kind === 'past-paper' ? 'PAPER' : 'NOTES'} />
      <div className="grow">
        <h3>{note.title}</h3>
        {note.description && <div className="muted desc">{note.description}</div>}
        <div className="meta">
          {subject && <span className="pill tag">{subject}</span>}
          {note.kind === 'past-paper' && <span className="dot-sep">Past paper</span>}
          {showClass && note.classLevel && <span className="dot-sep">{note.classLevel}</span>}
          <span className="dot-sep">{pagesLabel(note.pageCount)}</span>
        </div>
      </div>
      <button className={`icon-btn bookmark ${on ? 'on' : ''} ${pop ? 'pop' : ''}`} aria-label={on ? 'Remove from saved' : 'Save note'}
        onClick={(e) => { e.stopPropagation(); const nowOn = toggleSaved(note.id); if (nowOn) { setPop(true); window.setTimeout(() => setPop(false), 480); } }}>
        <Bookmark />
      </button>
    </div>
  );
}

export function NoteSkeleton() {
  return <div className="card" style={{ display: 'flex', gap: 14, padding: 12 }}><div className="shimmer" style={{ width: 66, height: 88, borderRadius: 14 }} /><div className="grow"><div className="shimmer" style={{ height: 16, width: '70%', borderRadius: 6, marginTop: 6 }} /><div className="shimmer" style={{ height: 12, width: '95%', borderRadius: 6, marginTop: 12 }} /><div className="shimmer" style={{ height: 12, width: '50%', borderRadius: 6, marginTop: 10 }} /></div></div>;
}

// Remembers the last documents and pages, so "Continue reading" can offer them and the reader can reopen at the page.
export interface Recent { id: string; page: number; pageCount: number; at: number }
export function readRecent(): Recent[] { try { return JSON.parse(localStorage.getItem('shule_recent') || '[]'); } catch { return []; } }
export function writeRecent(r: Recent) {
  try { localStorage.setItem('shule_recent', JSON.stringify([r, ...readRecent().filter((x) => x.id !== r.id)].slice(0, 12))); } catch { /* private mode */ }
}
