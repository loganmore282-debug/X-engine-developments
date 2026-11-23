import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api, fetchBytes } from '../api';
import { useLibrary, useToast, remember, save } from '../store';
import { Cover, readRecent, writeRecent, pagesLabel } from '../components';
import { recordPage } from '../study';
import { Back, Bookmark, BookmarkFilled, Lock, Close, Minus, Plus, Search, Send, Spark } from '../icons';
import type { ChatTurn, Note } from '../types';
import { PaySheet } from '../Pay';
import { takePrefetched } from '../prefetch';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// One page: a pale sheet with a sweep of light, replaced by the drawn page as soon as it is ready.
// Only pages near the screen are drawn (and they are drawn again, sharp, when the zoom changes).
function Page({ doc, index, width, ratio, onSeen, onRatio }: { doc: pdfjs.PDFDocumentProxy; index: number; width: number; ratio: number; onSeen: (index: number, visibleFraction: number) => void; onRatio: (index: number, ratio: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const near = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '1200px 0px' });
    const seen = new IntersectionObserver(([e]) => onSeen(index, e.intersectionRatio), { threshold: [0, 0.25, 0.5, 0.75, 1] });
    near.observe(el); seen.observe(el);
    return () => { near.disconnect(); seen.disconnect(); };
  }, [index, onSeen]);
  useEffect(() => {
    if (!near || !canvas.current) return;
    let task: pdfjs.RenderTask | null = null; let live = true;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      onRatio(index, base.width / base.height);
      const scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2.5);
      const viewport = page.getViewport({ scale });
      const c = canvas.current!; c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
      task = page.render({ canvasContext: c.getContext('2d')!, viewport });
      try { await task.promise; if (live) setDrawn(true); } catch { /* cancelled by a newer zoom */ }
    })();
    return () => { live = false; task?.cancel(); };
  }, [near, doc, index, width, onRatio]);
  return (
    <div ref={box} className="sheet-page" data-page={index + 1} style={{ width, aspectRatio: String(ratio) }}>
      {!drawn && <div className="shimmer" />}
      <canvas ref={canvas} aria-label={`Page ${index + 1}`} style={{ opacity: drawn ? 1 : 0 }} />
    </div>
  );
}

const MARKS = 'shule_page_marks';

export function ReaderPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { notes, subjectName, levels } = useLibrary();
  const { toast } = useToast();
  const [note, setNote] = useState<Note | null>(() => notes.find((n) => n.id === id) || null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [ratios, setRatios] = useState<number[]>([]);
  const [drawer, setDrawer] = useState<null | 'search' | 'ai'>(null);
  const [marks, setMarks] = useState<string[]>(() => remember<string[]>(MARKS, []));
  const scroller = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(() => Math.min(window.innerWidth, 1200));
  const visible = useRef<Map<number, number>>(new Map());

  useEffect(() => { if (!note) api<{ note: Note }>(`/notes/${id}`).then((r) => setNote(r.note)).catch(() => {}); }, [id, note]);

  // Load the PDF (progress shown); the server already put the footer on every page.
  useEffect(() => {
    let live = true; const ctl = new AbortController(); let loaded: pdfjs.PDFDocumentProxy | null = null;
    setDoc(null); setError(''); setProgress(0); setLocked(false);
    (async () => {
      try {
        // A copy fetched ahead (on hover or touch) is used straight away; it still counts as a read.
        const early = takePrefetched(id);
        let bytes: ArrayBuffer | null = null;
        if (early) { bytes = await early.catch(() => null); if (bytes) api(`/notes/${id}/opened`, { body: {} }).catch(() => {}); }
        if (!bytes) bytes = await fetchBytes(`/notes/${id}/file`, (f) => live && setProgress(f), ctl.signal);
        loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
        if (!live) { loaded.destroy(); return; }
        setDoc(loaded);
      } catch (e) {
        if (!live || (e as Error).name === 'AbortError') return;
        if ((e as { status?: number }).status === 402) { setLocked(true); setPaySheet(true); }
        else setError((e as Error).message || 'This document could not be opened.');
      }
    })();
    return () => { live = false; ctl.abort(); loaded?.destroy(); };
  }, [id, reloadKey]);

  useEffect(() => {
    const onResize = () => setAreaWidth(scroller.current?.clientWidth || window.innerWidth);
    onResize(); window.addEventListener('resize', onResize);
    const t = window.setTimeout(onResize, 60);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, [doc, drawer]);

  const width = Math.round(Math.min(areaWidth - 24, 860) * zoom);
  const first = ratios[0] || 0.707;
  const onRatio = useCallback((i: number, r: number) => setRatios((old) => { if (old[i] && Math.abs(old[i] - r) < 0.002) return old; const n = old.slice(); n[i] = r; return n; }), []);
  const onSeen = useCallback((i: number, fraction: number) => {
    visible.current.set(i + 1, fraction);
    let best = 0; let bestFraction = -1;
    visible.current.forEach((f, p) => { if (f > bestFraction) { best = p; bestFraction = f; } });
    if (best && bestFraction > 0) setPage(best);
  }, []);

  // Reopen where the student stopped.
  const restored = useRef(false);
  useEffect(() => {
    if (!doc || restored.current) return;
    const last = readRecent().find((r) => r.id === id);
    if (last && last.page > 1) window.setTimeout(() => goTo(last.page, false), 250);
    restored.current = true;
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  // A page counts as read once the student rests on it for a moment (feeds "My progress").
  useEffect(() => { if (doc && page) { const t = window.setTimeout(() => recordPage(id, page, doc.numPages, note?.subjectId || null), 1500); return () => window.clearTimeout(t); } }, [doc, page, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (doc && page) { const t = window.setTimeout(() => writeRecent({ id, page, pageCount: doc.numPages, at: Date.now() }), 600); return () => window.clearTimeout(t); } }, [doc, page, id]);

  const goTo = (p: number, smooth = true) => {
    const el = scroller.current?.querySelector(`[data-page="${p}"]`) as HTMLElement | null;
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
  };
  const marked = marks.includes(`${id}:${page}`);
  const toggleMark = () => { const key = `${id}:${page}`; const next = marked ? marks.filter((m) => m !== key) : [...marks, key]; setMarks(next); save(MARKS, next); toast(marked ? 'Bookmark removed' : `Page ${page} bookmarked`); };

  const total = doc?.numPages || note?.pageCount || 0;

  // Keyboard, like a real reader: arrows / PageUp / PageDown turn pages, + and - zoom, / searches, A asks the AI, B bookmarks, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') { if (drawer) setDrawer(null); else if (!paySheet) nav(-1); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || !doc) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); goTo(Math.min(total, page + 1)); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); goTo(Math.max(1, page - 1)); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(1); }
      else if (e.key === 'End') { e.preventDefault(); goTo(total); }
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(2)));
      else if (e.key === '-') setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)));
      else if (e.key === '/') { e.preventDefault(); setDrawer('search'); }
      else if (e.key === 'a' && note?.hasAiContext !== false) setDrawer('ai');
      else if (e.key === 'b') toggleMark();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className={`reader ${drawer ? 'with-drawer' : ''}`}>
      <div className="reader-top">
        <button className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}><Back /></button>
        {note && <span className="reader-meta" style={{ margin: 0 }}><Cover subject={subjectName(note.subjectId)} size="sm" /></span>}
        <h1>{note?.title || 'Document'}</h1>
        <span className="reader-meta">{doc ? `Page ${page} of ${total}` : ''}<span className="zoom-label">{Math.round(zoom * 100)}%</span></span>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))}><Minus /></button>
        <button className="icon-btn" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(2)))}><Plus /></button>
        <button className={`icon-btn bookmark ${marked ? 'on' : ''}`} aria-label={marked ? 'Remove page bookmark' : 'Bookmark this page'} onClick={toggleMark}>{marked ? <BookmarkFilled /> : <Bookmark />}</button>
        <button className="icon-btn" aria-label="Search in this document" onClick={() => setDrawer(drawer === 'search' ? null : 'search')}><Search /></button>
      </div>
      <div className="progressbar"><i style={{ width: `${total ? (page / total) * 100 : 0}%` }} /></div>

      <div className="pages" ref={scroller}>
        {locked && <div className="empty lock-page"><div className="lock-big"><Lock /></div><h3>{note?.classLevel ? `This needs a ${note.classLevel} pass` : 'This document needs a pass'}</h3><p>{note?.classLevel ? `A pass opens one class. Choose a ${note.classLevel} pass to read this, search inside it and ask the AI helper about it.` : 'Choose a pass to read it, search inside it and ask the AI helper about it.'}</p><button className="btn" onClick={() => setPaySheet(true)}>Choose a pass</button></div>}
        {!doc && !error && !locked && (
          <div className="pages-in">{[0, 1].map((i) => <div key={i} className="sheet-page" style={{ width, aspectRatio: String(first) }}><div className="shimmer" /></div>)}
            {progress > 0 && <div className="muted" style={{ fontSize: 13 }}>Downloading {Math.round(progress * 100)}%</div>}</div>
        )}
        {error && <div className="empty"><h3>We could not open this document</h3><p>{error}</p><button className="btn" onClick={() => window.location.reload()}>Try again</button></div>}
        {doc && <div className="pages-in">{Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} index={i} width={width} ratio={ratios[i] || first} onSeen={onSeen} onRatio={onRatio} />)}</div>}
      </div>

      {doc && <div className="page-chip">{page} / {total}</div>}
      <div className="reader-fab">{note?.hasAiContext !== false && <button className="fab" onClick={() => setDrawer('ai')}><Spark width={20} height={20} /> Ask AI</button>}</div>

      {paySheet && <PaySheet classLevel={note?.classLevel && levels.some((g) => g.levels.some((l) => l.id === note.classLevel)) ? note.classLevel : null} onClose={() => setPaySheet(false)} onPaid={() => setReloadKey((k) => k + 1)} />}
      {drawer === 'search' && <SearchDrawer noteId={id} onClose={() => setDrawer(null)} onGo={(p) => { goTo(p); if (window.innerWidth < 760) setDrawer(null); }} />}
      {drawer === 'ai' && <AiDrawer note={note} noteId={id} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function SearchDrawer({ noteId, onClose, onGo }: { noteId: string; onClose: () => void; onGo: (page: number) => void }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { api<{ pages: string[] }>(`/notes/${noteId}/pages`).then((r) => setPages(r.pages || [])).catch((e) => setError((e as Error).message)); }, [noteId]);
  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2 || !pages) return [];
    const out: { page: number; before: string; match: string; after: string }[] = [];
    pages.forEach((text, i) => {
      const at = text.toLowerCase().indexOf(term);
      if (at >= 0) out.push({ page: i + 1, before: text.slice(Math.max(0, at - 40), at).replace(/\s+/g, ' '), match: text.slice(at, at + term.length), after: text.slice(at + term.length, at + term.length + 60).replace(/\s+/g, ' ') });
    });
    return out;
  }, [q, pages]);
  return (
    <div className="drawer">
      <div className="drawer-head"><input className="input" style={{ height: 44 }} autoFocus placeholder="Search in this document" value={q} onChange={(e) => setQ(e.target.value)} /><button className="icon-btn" aria-label="Close" onClick={onClose}><Close /></button></div>
      <div className="drawer-body">
        {error && <div className="muted">{error}</div>}
        {!pages && !error && <div className="center"><div className="spinner" style={{ margin: '30px auto' }} /></div>}
        {pages && q.trim().length < 2 && <p className="muted">Type at least two letters.</p>}
        {pages && q.trim().length >= 2 && hits.length === 0 && <p className="muted">Nothing found.</p>}
        {hits.map((h) => <button key={h.page} className="hit" onClick={() => onGo(h.page)}><b>Page {h.page}</b><div className="muted" style={{ fontSize: 14 }}>…{h.before}<mark>{h.match}</mark>{h.after}…</div></button>)}
        {hits.length > 0 && <p className="muted" style={{ fontSize: 13 }}>{hits.length} {hits.length === 1 ? 'page' : 'pages'} · {pagesLabel(pages!.length)} searched</p>}
      </div>
    </div>
  );
}

// While the helper works: its star breathes, a line of status text changes by itself, and three placeholder lines pulse
// one after another, like the answer being drawn.
function Thinking() {
  const phrases = ['Reading the document…', 'Finding the right pages…', 'Working out the answer…', 'Writing it clearly…'];
  const [i, setI] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setI((n) => (n + 1) % phrases.length), 2300); return () => window.clearInterval(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bubble ai thinking" role="status" aria-live="polite">
      <div className="think-head"><Spark className="breathe" width={18} height={18} /><span key={i} className="phrase">{phrases[i]}</span></div>
      <i className="skel" style={{ width: '96%' }} /><i className="skel" style={{ width: '82%' }} /><i className="skel" style={{ width: '58%' }} />
    </div>
  );
}

// An answer types itself in, a few words at a time, instead of appearing all at once.
function Typed({ text, animate, onTick, onDone }: { text: string; animate: boolean; onTick: () => void; onDone: () => void }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) return;
    let at = 0;
    const step = Math.max(3, Math.ceil(text.length / 60));
    const id = window.setInterval(() => {
      at = Math.min(text.length, at + step);
      while (at < text.length && !/\s/.test(text[at])) at += 1; // finish the word it is in
      setN(at); onTick();
      if (at >= text.length) { window.clearInterval(id); onDone(); }
    }, 22);
    return () => window.clearInterval(id);
  }, [text, animate]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{text.slice(0, n)}</>;
}

type Turn = ChatTurn & { fresh?: boolean; error?: boolean };

function AiDrawer({ note, noteId, onClose }: { note: Note | null; noteId: string; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns.length, busy]);
  async function ask(question: string) {
    const q = question.trim(); if (!q || busy) return;
    // Only real answers go back to the server as history (an error message is not something the helper said).
    const history = turns.filter((t) => !t.error).slice(-8).map(({ role, content }) => ({ role, content }));
    setTurns([...turns, { role: 'user', content: q }]); setText(''); setBusy(true);
    try {
      const r = await api<{ answer: string }>('/ai/ask', { body: { noteId, question: q, history } });
      setTurns((t) => [...t, { role: 'assistant', content: r.answer, fresh: true }]);
    } catch (e) { setTurns((t) => [...t, { role: 'assistant', content: (e as Error).message, error: true }]); } finally { setBusy(false); }
  }
  const starters = ['Summarise this document in a few lines', 'What are the key points I must remember?', 'Give me three practice questions'];
  return (
    <div className="drawer">
      <div className="drawer-head"><Spark width={22} height={22} style={{ color: 'var(--amber)' }} /><b className="poppins grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Ask about {note?.title || 'this document'}</b><button className="icon-btn" aria-label="Close" onClick={onClose}><Close /></button></div>
      <div className="drawer-body">
        {turns.length === 0 && <><p className="muted">Ask anything about this document. The answer comes from what is written in it.</p>{starters.map((s) => <button key={s} className="starter" onClick={() => ask(s)}>{s}</button>)}</>}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role === 'user' ? 'user' : 'ai'} ${t.error ? 'err' : ''}`}>
            {t.fresh ? <Typed text={t.content} animate onTick={() => end.current?.scrollIntoView({ behavior: 'auto', block: 'end' })} onDone={() => setTurns((all) => all.map((x, j) => (j === i ? { ...x, fresh: false } : x)))} /> : t.content}
          </div>
        ))}
        {busy && <Thinking />}
        <div ref={end} />
      </div>
      <form className="ask-row" onSubmit={(e: FormEvent) => { e.preventDefault(); ask(text); }}>
        <input className="input" placeholder="Type your question" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <button className="btn" style={{ width: 52, padding: 0 }} disabled={busy || !text.trim()} aria-label="Send"><Send width={20} height={20} /></button>
      </form>
    </div>
  );
}
