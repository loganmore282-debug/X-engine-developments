import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useLibrary } from '../store';
import { NoteCard, NoteSkeleton, Sheet, readRecent, tintOf, pagesLabel } from '../components';
import { Bell, Chevron, Close, Search } from '../icons';

type Sort = 'new' | 'views' | 'az';

// The same Home as the phone app: greeting, class, search, announcement, "Continue reading", subjects, notes.
export function HomePage() {
  const { user, setClass } = useAuthWithClass();
  const { notes, subjects, announcements, loading, error, reload, subjectName, levels } = useLibrary();
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | 'notes' | 'past-paper'>('all');
  const [sort, setSort] = useState<Sort>('new');
  const [everyClass, setEveryClass] = useState(false);
  const [classSheet, setClassSheet] = useState(false);
  const [dismissed, setDismissed] = useState<string>(() => localStorage.getItem('shule_dismissed_announcement') || '');

  const cls = user?.classLevel || null;
  const knownClasses = useMemo(() => new Set(levels.flatMap((g) => g.levels.map((l) => l.id))), [levels]);
  // The student's class, notes for every class, and notes whose class is not in the list.
  const inClass = useMemo(() => notes.filter((n) => everyClass || !cls || !n.classLevel || n.classLevel === cls || !knownClasses.has(n.classLevel)), [notes, cls, everyClass, knownClasses]);
  const subjectsInScope = useMemo(() => subjects.filter((s) => inClass.some((n) => n.subjectId === s.id)), [subjects, inClass]);
  const hasBoth = new Set(inClass.map((n) => n.kind)).size > 1;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = inClass.filter((n) => (!subjectId || n.subjectId === subjectId) && (kind === 'all' || n.kind === kind)
      && (!q || n.title.toLowerCase().includes(q) || n.description.toLowerCase().includes(q) || (subjectName(n.subjectId) || '').toLowerCase().includes(q)));
    list = [...list].sort(sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : sort === 'views' ? (a, b) => b.views - a.views : (a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return list;
  }, [inClass, subjectId, kind, query, sort, subjectName]);

  const lastRead = readRecent().map((r) => ({ r, note: notes.find((n) => n.id === r.id) })).find((x) => x.note);
  const announcement = announcements[0] && announcements[0].id !== dismissed ? announcements[0] : null;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <section className="hero rise">
        <div className="row"><div className="grow"><h1>{hello}, {user?.name.split(' ')[0]}</h1><p>What are you studying today?</p></div>
          <button className="icon-btn hero-bell" style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.3)' }} aria-label="Notifications" onClick={() => nav('/inbox')}>
            <Bell />{announcements.some((a) => a.id !== dismissed) && <span style={{ position: 'absolute', marginTop: -18, marginLeft: 16, width: 10, height: 10, borderRadius: 5, background: '#ffb020' }} />}
          </button></div>
        <button className="class-chip" onClick={() => setClassSheet(true)}><b>{cls || 'Choose class'}</b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg></button>
      </section>
      <div className="searchbar"><Search /><input className="input" placeholder="Search notes and past papers" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes and past papers" /></div>

      {announcement && (
        <div className="announce"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9c1.5 1 1.5 5 0 6" /></svg>
          <div className="grow"><b>{announcement.title}</b>{announcement.message}</div>
          <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Dismiss" onClick={() => { setDismissed(announcement.id); localStorage.setItem('shule_dismissed_announcement', announcement.id); }}><Close /></button></div>
      )}

      {lastRead && !query && (
        <button className="card continue" onClick={() => nav(`/note/${lastRead.note!.id}`)}>
          <div className="cover" style={{ width: 46, height: 60, background: tintOf(subjectName(lastRead.note!.subjectId)) }}><span className="big" style={{ fontSize: 18 }}>{lastRead.note!.title.slice(0, 1).toUpperCase()}</span></div>
          <div className="grow"><div className="muted" style={{ fontSize: 13 }}>Continue reading</div><b className="poppins">{lastRead.note!.title}</b>
            <div className="muted" style={{ fontSize: 13 }}>Page {lastRead.r.page} of {lastRead.r.pageCount || lastRead.note!.pageCount}</div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--line)', marginTop: 8 }}><div style={{ height: 4, borderRadius: 2, background: 'var(--primary)', width: `${Math.min(100, (lastRead.r.page / Math.max(1, lastRead.r.pageCount || lastRead.note!.pageCount)) * 100)}%` }} /></div></div>
          <Chevron width={22} height={22} /></button>
      )}

      {subjectsInScope.length > 0 && (
        <><div className="section-head"><h2>Subjects</h2></div>
          <div className="chips">
            <button className={`chip ${subjectId === null ? 'on' : ''}`} onClick={() => setSubjectId(null)}>All</button>
            {subjectsInScope.map((s) => <button key={s.id} className={`chip ${subjectId === s.id ? 'on' : ''}`} onClick={() => setSubjectId(subjectId === s.id ? null : s.id)}>{s.name}</button>)}
          </div></>
      )}

      <div className="section-head">
        <h2>{everyClass || !cls ? 'All notes' : `Notes for ${cls}`}</h2>
        <span className="muted count">{visible.length} {visible.length === 1 ? 'document' : 'documents'}</span>
        <select className="chip" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ height: 38 }}>
          <option value="new">Newest</option><option value="views">Most read</option><option value="az">A to Z</option>
        </select>
      </div>
      {hasBoth && <div className="chips">{(['all', 'notes', 'past-paper'] as const).map((k) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'notes' ? 'Notes' : 'Past papers'}</button>)}</div>}

      {loading && notes.length === 0 ? <div className="grid">{[0, 1, 2, 3].map((i) => <NoteSkeleton key={i} />)}</div>
        : error && notes.length === 0 ? <div className="empty"><h3>We could not load your notes</h3><p>{error}</p><button className="btn" onClick={reload}>Try again</button></div>
        : visible.length === 0 ? <div className="empty"><h3>{query ? 'Nothing matches your search' : cls && !everyClass ? `No notes for ${cls} yet` : 'No notes yet'}</h3><p>{query ? 'Try other words.' : 'New notes and past papers appear here as soon as they are added.'}</p>
            {cls && !everyClass && !query && <button className="btn outline" onClick={() => setEveryClass(true)}>Show every class</button>}</div>
        : <div className="grid">{visible.map((n, i) => <NoteCard key={n.id} note={n} index={i} showClass={everyClass || !cls} onOpen={() => nav(`/note/${n.id}`)} />)}</div>}
      {everyClass && <div className="center" style={{ marginTop: 20 }}><button className="btn outline small" onClick={() => setEveryClass(false)}>Back to {cls}</button></div>}
      <div className="muted center" style={{ fontSize: 13, marginTop: 24 }}>{notes.length > 0 && `${notes.length} documents in the library · ${notes.reduce((a, n) => a + n.pageCount, 0)} pages`}</div>

      {classSheet && <Sheet title="Choose your class" onClose={() => setClassSheet(false)}>
        {levels.map((g) => <div key={g.id} className="level-group"><h4>{g.name}</h4><div className="level-grid">{g.levels.map((l) => <button key={l.id} className={`chip ${cls === l.id ? 'on' : ''}`} onClick={() => { setClass(l.id); setSubjectId(null); setEveryClass(false); setClassSheet(false); }}>{l.name}</button>)}</div></div>)}
      </Sheet>}
    </div>
  );
}

import { useAuth as useAuthBase } from '../store';
function useAuthWithClass() { const a = useAuthBase(); return { user: a.user, setClass: (c: string) => a.setClass(c).catch(() => {}) }; }
export { pagesLabel };
