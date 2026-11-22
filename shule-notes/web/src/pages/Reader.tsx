import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api, fetchBytes } from '../api';
import { useLibrary, useToast, remember, save } from '../store';
import { Cover, readRecent, writeRecent, pagesLabel } from '../components';
import { Back, Bookmark, Close, Minus, Plus, Search, Send, Spark } from '../icons';
import type { ChatTurn, Note } from '../types';
import { PaySheet } from '../Pay';

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
  const { notes, subjectName } = useLibrary();
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
        const bytes = await fetchBytes(`/notes/${id}/file`, (f) => live && setProgress(f), ctl.signal);
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
  useEffect(() => { if (doc && page) { const t = window.setTimeout(() => writeRecent({ id, page, pageCount: doc.numPages, at: Date.now() }), 600); return () => window.clearTimeout(t); } }, [doc, page, id]);

  const goTo = (p: number, smooth = true) => {
    const el = scroller.current?.querySelector(`[data-page="${p}"]`) as HTMLElement | null;
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
  };
  const marked = marks.includes(`${id}:${page}`);
  const toggleMark = () => { const key = `${id}:${page}`; const next = marked ? marks.filter((m) => m !== key) : [...marks, key]; setMarks(next); save(MARKS, next); toast(marked ? 'Bookmark removed' : `Page ${page} bookmarked`); };

  const total = doc?.numPages || note?.pageCount || 0;
  return (
    <div className={`reader ${drawer ? 'with-drawer' : ''}`}>
      <div className="reader-top">
        <button className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}><Back /></button>
        {note && <span className="reader-meta" style={{ margin: 0 }}><Cover subject={subjectName(note.subjectId)} size="sm" /></span>}
        <h1>{note?.title || 'Document'}</h1>
        <span className="reader-meta">{doc ? `Page ${page} of ${total}` : ''}<span className="zoom-label">{Math.round(zoom * 100)}%</span></span>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))}><Minus /></button>
        <button className="icon-btn" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(2)))}><Plus /></button>
        <button className={`icon-btn bookmark ${marked ? 'on' : ''}`} aria-label={marked ? 'Remove page bookmark' : 'Bookmark this page'} onClick={toggleMark}><Bookmark /></button>
        <button className="icon-btn" aria-label="Search in this document" onClick={() => setDrawer(drawer === 'search' ? null : 'search')}><Search /></button>
      </div>
      <div className="progressbar"><i style={{ width: `${total ? (page / total) * 100 : 0}%` }} /></div>

      <div className="pages" ref={scroller}>
        {locked && <div className="empty lock-page"><div className="lock-big"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></div><h3>This document needs a pass</h3><p>Choose a pass to read it, search inside it and ask the AI helper about it.</p><button className="btn" onClick={() => setPaySheet(true)}>Choose a pass</button></div>}
        {!doc && !error && !locked && (
          <div className="pages-in">{[0, 1].map((i) => <div key={i} className="sheet-page" style={{ width, aspectRatio: String(first) }}><div className="shimmer" /></div>)}
            {progress > 0 && <div className="muted" style={{ fontSize: 13 }}>Downloading {Math.round(progress * 100)}%</div>}</div>
        )}
        {error && <div className="empty"><h3>We could not open this document</h3><p>{error}</p><button className="btn" onClick={() => window.location.reload()}>Try again</button></div>}
        {doc && <div className="pages-in">{Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} index={i} width={width} ratio={ratios[i] || first} onSeen={onSeen} onRatio={onRatio} />)}</div>}
      </div>

      {doc && <div className="page-chip">{page} / {total}</div>}
      <div className="reader-fab">{note?.hasAiContext !== false && <button className="fab" onClick={() => setDrawer('ai')}><Spark width={20} height={20} /> Ask AI</button>}</div>

      {paySheet && <PaySheet reason="Pay once with mobile money and read everything for as long as the pass lasts." onClose={() => setPaySheet(false)} onPaid={() => setReloadKey((k) => k + 1)} />}
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

function AiDrawer({ note, noteId, onClose }: { note: Note | null; noteId: string; onClose: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);
  async function ask(question: string) {
    const q = question.trim(); if (!q || busy) return;
    const history = turns.slice(-8); setTurns([...turns, { role: 'user', content: q }]); setText(''); setBusy(true);
    try {
      const r = await api<{ answer: string }>('/ai/ask', { body: { noteId, question: q, history } });
      setTurns((t) => [...t, { role: 'assistant', content: r.answer }]);
    } catch (e) { setTurns((t) => [...t, { role: 'assistant', content: (e as Error).message }]); } finally { setBusy(false); }
  }
  const starters = ['Summarise this document in a few lines', 'What are the key points I must remember?', 'Give me three practice questions'];
  return (
    <div className="drawer">
      <div className="drawer-head"><Spark width={22} height={22} style={{ color: 'var(--amber)' }} /><b className="poppins grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Ask about {note?.title || 'this document'}</b><button className="icon-btn" aria-label="Close" onClick={onClose}><Close /></button></div>
      <div className="drawer-body">
        {turns.length === 0 && <><p className="muted">Ask anything about this document. The answer comes from what is written in it.</p>{starters.map((s) => <button key={s} className="starter" onClick={() => ask(s)}>{s}</button>)}</>}
        {turns.map((t, i) => <div key={i} className={`bubble ${t.role === 'user' ? 'user' : 'ai'}`}>{t.content}</div>)}
        {busy && <div className="bubble ai"><span className="dots"><span /><span /><span /></span></div>}
        <div ref={end} />
      </div>
      <form className="ask-row" onSubmit={(e: FormEvent) => { e.preventDefault(); ask(text); }}>
        <input className="input" placeholder="Type your question" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <button className="btn" style={{ width: 52, padding: 0 }} disabled={busy || !text.trim()} aria-label="Send"><Send width={20} height={20} /></button>
      </form>
    </div>
  );
}
