import { useMemo, useState, type CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLibrary } from '../store';
import { NoteCard, NoteSkeleton } from '../components';
import { SubjectIcon, subjectVars } from '../subjectLook';
import { Back, Close, Search } from '../icons';
import { useClassScope, useEveryClass } from '../scope';

type Sort = 'new' | 'views' | 'az';

// One subject on its own page: its documents first, with its own search, type chips and sort. Opened from the subject grid on Home.
export function SubjectPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { subjects, loading, subjectName } = useLibrary();
  const [everyClass] = useEveryClass();
  const { cls, inClass } = useClassScope(everyClass);
  const subject = subjects.find((s) => s.id === id);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'notes' | 'past-paper'>('all');
  const [sort, setSort] = useState<Sort>('new');

  const mine = useMemo(() => inClass.filter((n) => n.subjectId === id), [inClass, id]);
  const hasBoth = new Set(mine.map((n) => n.kind)).size > 1;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = mine.filter((n) => (kind === 'all' || n.kind === kind) && (!q || n.title.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)));
    return [...list].sort(sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : sort === 'views' ? (a, b) => b.views - a.views : (a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  }, [mine, kind, query, sort]);
  const pages = mine.reduce((a, n) => a + n.pageCount, 0);

  // A subject that does not exist (an old link): back to Home.
  if (!subject && !loading && subjects.length > 0) return <Navigate to="/" replace />;
  const name = subject?.name || subjectName(id || null) || 'Subject';
  const back = () => (window.history.length > 1 ? nav(-1) : nav('/'));

  return (
    <div>
      <section className="subject-hero sv rise" style={subjectVars(name) as CSSProperties}>
        <button className="back-btn" aria-label="Back" onClick={back}><Back width={20} height={20} /> Back</button>
        <div className="subject-hero-row">
          <span className="s-ico big"><SubjectIcon name={name} size={40} /></span>
          <div className="grow">
            <h1>{name}</h1>
            <p>{mine.length} {mine.length === 1 ? 'document' : 'documents'}{pages > 0 ? ` · ${pages} pages` : ''}</p>
          </div>
        </div>
      </section>

      <div className="searchbar flat"><Search /><input className="input" placeholder="Search this subject" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search in ${name}`} />
        {query && <button className="icon-btn clear" aria-label="Clear search" onClick={() => setQuery('')}><Close /></button>}</div>

      <div className="section-head">
        <h2>{kind === 'past-paper' ? 'Exams' : kind === 'notes' ? 'Notes' : 'All documents'}</h2>
        <span className="muted count">{visible.length} {visible.length === 1 ? 'document' : 'documents'}</span>
        <select className="chip" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ height: 38 }}>
          <option value="new">Newest</option><option value="views">Most read</option><option value="az">A to Z</option>
        </select>
      </div>
      {hasBoth && <div className="chips">{(['all', 'notes', 'past-paper'] as const).map((k) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'notes' ? 'Notes' : 'Exams'}</button>)}</div>}

      {loading && mine.length === 0 ? <div className="grid">{[0, 1].map((i) => <NoteSkeleton key={i} />)}</div>
        : visible.length === 0 ? <div className="empty"><h3>{query ? 'Nothing matches your search' : `No ${kind === 'past-paper' ? 'exams' : kind === 'notes' ? 'notes' : 'documents'} in ${name} yet`}</h3><p>{query ? 'Try other words.' : 'New documents appear here as soon as they are added.'}</p></div>
        : <div className="grid">{visible.map((n, i) => <NoteCard key={n.id} note={n} index={i} showClass={everyClass || !cls} onOpen={() => nav(`/note/${n.id}`)} />)}</div>}
    </div>
  );
}
