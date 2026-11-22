// Looking ahead: the moment a student points at (or touches) a document, its PDF starts downloading, so by the time they
// click it is usually already here. The server is told it is only a look-ahead (so it is not counted as a read).
import { API, getToken } from './api';

const cache = new Map<string, Promise<ArrayBuffer>>();

export function prefetchNote(id: string) {
  const token = getToken();
  if (!token || cache.has(id)) return;
  const p = fetch(`${API}/notes/${id}/file?prefetch=1`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); });
  p.catch(() => cache.delete(id)); // a locked or missing document: the reader will say so itself
  cache.set(id, p);
  if (cache.size > 3) cache.delete(cache.keys().next().value as string);
}

// The reader asks for it once; a second visit asks the server again (a 304 when nothing changed).
export function takePrefetched(id: string): Promise<ArrayBuffer> | null {
  const p = cache.get(id) || null;
  cache.delete(id);
  return p;
}

// The reader (and pdf.js, the largest part of the site) is loaded in the background as soon as Home is on screen.
let readerLoaded = false;
export function preloadReader() {
  if (readerLoaded) return;
  readerLoaded = true;
  const go = () => { import('./pages/Reader').catch(() => { readerLoaded = false; }); };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  idle ? idle(go) : window.setTimeout(go, 800);
}
