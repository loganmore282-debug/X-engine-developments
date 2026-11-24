import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useLibrary } from '../store';
import { Cover, NoteCard, NoteSkeleton, Sheet, readRecent, pagesLabel } from '../components';
import { SubjectIcon, subjectVars } from '../subjectLook';
import { Chevron, Close, ExpandMore, Search, Bell } from '../icons';
import { PaySheet, untilLabel, useAccess } from '../Pay';
import { preloadReader } from '../prefetch';
import { useClassScope, useEveryClass } from '../scope';
import { useUnread } from '../unread';

type Sort = 'new' | 'views' | 'az';

// The same Home as the phone app: greeting, class, search, announcement, "Continue reading", subjects, notes.
export function HomePage() {
  const { user, setClass } = useAuthWithClass();
  const { notes, subjects, loading, error, reload, subjectName, levels } = useLibrary();
  const nav = useNavigate();
  // The student's place on Home (filters and scroll) is kept for the session, so coming back from a document lands exactly where they left.
  const saved = useRef<{ query: string; kind: 'all' | 'notes' | 'past-paper'; sort: Sort; y: number }>(
    (() => { try { return JSON.parse(sessionStorage.getItem('shule_home') || 'null') || { query: '', kind: 'all', sort: 'new', y: 0 }; } catch { return { query: '', kind: 'all', sort: 'new', y: 0 }; } })());
  const [query, setQuery] = useState(saved.current.query);
  const [kind, setKind] = useState<'all' | 'notes' | 'past-paper'>(saved.current.kind);
  const [sort, setSort] = useState<Sort>(saved.current.sort);
  const [everyClass, setEveryClass] = useEveryClass();
  const [classSheet, setClassSheet] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const access = useAccess();
  const unread = useUnread();

  const scrollTo = useRef(saved.current.y);
  useEffect(() => { preloadReader(); }, []);
  useEffect(() => { try { sessionStorage.setItem('shule_home', JSON.stringify({ query, kind, sort, y: window.scrollY })); } catch { /* private mode */ } }, [query, kind, sort]);
  useEffect(() => {
    const onScroll = () => { try { const cur = JSON.parse(sessionStorage.getItem('shule_home') || '{}'); sessionStorage.setItem('shule_home', JSON.stringify({ ...cur, y: window.scrollY })); } catch { /* ignore */ } };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Once the notes are on screen, go back to where the student was.
  useLayoutEffect(() => { if (scrollTo.current > 0 && notes.length > 0) { window.scrollTo(0, scrollTo.current); scrollTo.current = 0; } }, [notes.length]);

  // The student's class, notes for every class, and notes whose class is not in the list (shared with a subject's own page).
  const { cls, inClass, subjectsInScope } = useClassScope(everyClass);
  const hasBoth = new Set(inClass.map((n) => n.kind)).size > 1;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = inClass.filter((n) => (kind === 'all' || n.kind === kind)
      && (!q || n.title.toLowerCase().includes(q) || n.description.toLowerCase().includes(q) || (subjectName(n.subjectId) || '').toLowerCase().includes(q)));
    list = [...list].sort(sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : sort === 'views' ? (a, b) => b.views - a.views : (a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return list;
  }, [inClass, kind, query, sort, subjectName]);

  const lastRead = readRecent().map((r) => ({ r, note: notes.find((n) => n.id === r.id) })).find((x) => x.note);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const totalPages = notes.reduce((a, n) => a + n.pageCount, 0);
  const progressOf = lastRead ? Math.min(100, (lastRead.r.page / Math.max(1, lastRead.r.pageCount || lastRead.note!.pageCount)) * 100) : 0;
  const countIn = (id: string) => inClass.filter((n) => n.subjectId === id).length;

  return (
    <div>
      {/* On a phone there is no top bar (like an app): our logo sits top left and the bell top right, above the green header. */}
      <div className="m-top">
        <img src="/logo-mark.png" alt="Shule Notes" className="m-logo" />
        <span className="m-word">Shule<b>Notes</b></span>
        <span className="grow" />
        <button className={`m-bell ${unread ? 'ring' : ''}`} aria-label={unread ? 'Notifications, new message' : 'Notifications'} onClick={() => nav('/inbox')}><Bell />{unread && <i className="bell-dot" />}</button>
      </div>
      <section className="hero rise">
        <div className="hero-deco" aria-hidden="true"><i /><i /><i /></div>
        <div className="hero-main">
          <div className="eyebrow">{hello}</div>
          <h1>{user?.name.split(' ')[0]}, what are you studying today?</h1>
          <div className="hero-chips">
          <button className="class-chip" onClick={() => setClassSheet(true)} aria-label="Change class"><span className="muted-on-dark">Class</span><b>{cls || 'Choose class'}</b><ExpandMore width={18} height={18} /></button>
          {access.enabled && <button className={`class-chip pass-chip ${access.active ? 'on' : ''}`} onClick={() => setPaySheet(true)}>{access.active ? <><span className="muted-on-dark">Pass</span><b>until {untilLabel(access.until!)}</b></> : <b>Get a pass</b>}</button>}
          </div>
          <div className="searchbar"><Search /><input className="input" placeholder="Search notes and exams" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes and exams" />
            {query && <button className="icon-btn clear" aria-label="Clear search" onClick={() => setQuery('')}><Close /></button>}</div>
        </div>
        <aside className="hero-side">
          {lastRead ? (
            <button className="glass resume" onClick={() => nav(`/note/${lastRead.note!.id}`)}>
              <span className="glass-label">Continue reading</span>
              <span className="resume-row"><Cover subject={subjectName(lastRead.note!.subjectId)} size="sm" /><span className="grow"><b className="poppins">{lastRead.note!.title}</b>
                <small>Page {lastRead.r.page} of {lastRead.r.pageCount || lastRead.note!.pageCount}</small></span><Chevron width={20} height={20} /></span>
              <span className="meter"><i style={{ width: `${progressOf}%` }} /></span>
            </button>
          ) : <div className="glass"><span className="glass-label">Your library</span><span className="poppins big-line">Open any document and it will wait here, on the page where you stopped.</span></div>}
          <div className="stats">
            <div><b>{inClass.length}</b><small>documents for you</small></div>
            <div><b>{subjectsInScope.length}</b><small>subjects</small></div>
            <div><b>{totalPages}</b><small>pages to read</small></div>
          </div>
        </aside>
      </section>

      {lastRead && !query && (
        <button className="card continue mobile-only" onClick={() => nav(`/note/${lastRead.note!.id}`)}>
          <Cover subject={subjectName(lastRead.note!.subjectId)} size="sm" />
          <div className="grow"><div className="muted" style={{ fontSize: 13 }}>Continue reading</div><b className="poppins">{lastRead.note!.title}</b>
            <div className="muted" style={{ fontSize: 13 }}>Page {lastRead.r.page} of {lastRead.r.pageCount || lastRead.note!.pageCount}</div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--line)', marginTop: 8 }}><div style={{ height: 4, borderRadius: 2, background: 'var(--primary)', width: `${progressOf}%` }} /></div></div>
          <Chevron width={22} height={22} /></button>
      )}

      {subjectsInScope.length > 0 && !query && (
        <><div className="section-head"><h2>Subjects</h2><span className="muted count">{subjectsInScope.length} {subjectsInScope.length === 1 ? 'subject' : 'subjects'}</span></div>
          {/* A grid (matrix), so every subject is in view without sideways scrolling; a tap opens that subject's own page. */}
          <div className="subject-grid">
            {subjectsInScope.map((s, i) => (
              <button key={s.id} className="subject-tile sv rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms`, ...(subjectVars(s.name) as CSSProperties) }} onClick={() => nav(`/subject/${s.id}`)}>
                <span className="s-ico"><SubjectIcon name={s.name} size={30} /></span>
                <b>{s.name}</b><small>{countIn(s.id)} {countIn(s.id) === 1 ? 'document' : 'documents'}</small>
                <Chevron className="s-go" width={18} height={18} />
              </button>
            ))}
          </div></>
      )}

      <div className="section-head">
        <h2>{everyClass || !cls ? 'All notes' : `Notes for ${cls}`}</h2>
        <span className="muted count">{visible.length} {visible.length === 1 ? 'document' : 'documents'}</span>
        <select className="chip" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ height: 38 }}>
          <option value="new">Newest</option><option value="views">Most read</option><option value="az">A to Z</option>
        </select>
      </div>
      {hasBoth && <div className="chips">{(['all', 'notes', 'past-paper'] as const).map((k) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'notes' ? 'Notes' : 'Exams'}</button>)}</div>}

      {loading && notes.length === 0 ? <div className="grid">{[0, 1, 2, 3].map((i) => <NoteSkeleton key={i} />)}</div>
        : error && notes.length === 0 ? <div className="empty"><h3>We could not load your notes</h3><p>{error}</p><button className="btn" onClick={reload}>Try again</button></div>
        : visible.length === 0 ? <div className="empty"><h3>{query ? 'Nothing matches your search' : cls && !everyClass ? `No notes for ${cls} yet` : 'No notes yet'}</h3><p>{query ? 'Try other words.' : 'New notes and exams appear here as soon as they are added.'}</p>
            {cls && !everyClass && !query && <button className="btn outline" onClick={() => setEveryClass(true)}>Show every class</button>}</div>
        : <div className="grid">{visible.map((n, i) => <NoteCard key={n.id} note={n} index={i} showClass={everyClass || !cls} onOpen={() => nav(`/note/${n.id}`)} />)}</div>}
      {everyClass && <div className="center" style={{ marginTop: 20 }}><button className="btn outline small" onClick={() => setEveryClass(false)}>Back to {cls}</button></div>}

      {paySheet && <PaySheet onClose={() => setPaySheet(false)} />}
      {classSheet && <Sheet title="Choose your class" onClose={() => setClassSheet(false)}>
        {levels.map((g) => <div key={g.id} className="level-group"><h4>{g.name}</h4><div className="level-grid">{g.levels.map((l) => <button key={l.id} className={`chip ${cls === l.id ? 'on' : ''}`} onClick={() => { setClass(l.id); setEveryClass(false); setClassSheet(false); }}>{l.name}</button>)}</div></div>)}
      </Sheet>}
    </div>
  );
}

import { useAuth as useAuthBase } from '../store';
function useAuthWithClass() { const a = useAuthBase(); return { user: a.user, setClass: (c: string) => a.setClass(c).catch(() => {}) }; }
export { pagesLabel };
