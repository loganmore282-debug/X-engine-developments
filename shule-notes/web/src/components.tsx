import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchBytes, getToken } from './api';
import { useAuth, useLibrary } from './store';
import type { Note } from './types';
import { Bookmark } from './icons';

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

const TINTS: [RegExp, string][] = [
  [/bio/i, '#2e7d32'], [/chem/i, '#6a1b9a'], [/phys/i, '#1565c0'], [/math/i, '#ef6c00'], [/engl|liter|lang/i, '#ad1457'],
  [/hist|geo|social|cre|ire|relig/i, '#8d6e63'], [/ict|comput|tech/i, '#00838f'], [/agri|nutri|entre/i, '#558b2f'],
];
export function tintOf(name: string | null): string {
  if (!name) return '#17694b';
  const hit = TINTS.find(([re]) => re.test(name));
  if (hit) return hit[1];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 36%)`;
}

export function pagesLabel(n: number) { return n === 1 ? '1 page' : `${n} pages`; }
export function sizeLabel(bytes: number) { return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }

// One document in a list: a coloured cover, title, details and a bookmark.
export function NoteCard({ note, onOpen, index = 0, showClass = true }: { note: Note; onOpen: () => void; index?: number; showClass?: boolean }) {
  const { subjectName, saved, toggleSaved } = useLibrary();
  const subject = subjectName(note.subjectId);
  const on = saved.has(note.id);
  const [pop, setPop] = useState(false);
  const color = tintOf(subject);
  return (
    <div className="card note-card rise" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} role="button" tabIndex={0}
      onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <div className="cover" style={{ background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 55%, #000))` }}>
        <span className="big">{(subject || note.title).slice(0, 1).toUpperCase()}</span>
        <span>PDF</span>
      </div>
      <div className="grow">
        <h3>{note.title}</h3>
        {note.description && <div className="muted" style={{ fontSize: 13, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note.description}</div>}
        <div className="meta">
          {subject && <span className="pill" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>{subject}</span>}
          {note.kind === 'past-paper' && <span>Past paper</span>}
          {showClass && note.classLevel && <span>{note.classLevel}</span>}
          <span>{pagesLabel(note.pageCount)}</span>
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
