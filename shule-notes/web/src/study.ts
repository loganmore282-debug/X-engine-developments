// What the student has read, kept on this device (like the phone app does): pages per day, finished documents and subjects.
// It feeds "My progress". Nothing here is sent anywhere.
const KEY = 'shule_study';
interface Study { days: Record<string, string[]>; finished: string[]; subjects: Record<string, string> }

const read = (): Study => { try { return { days: {}, finished: [], subjects: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { days: {}, finished: [], subjects: {} }; } };
const write = (s: Study) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Called when a student rests on a page.
export function recordPage(noteId: string, page: number, pageCount: number, subjectId: string | null) {
  const s = read();
  const today = dayKey();
  const list = s.days[today] || (s.days[today] = []);
  const mark = `${noteId}:${page}`;
  if (!list.includes(mark)) list.push(mark);
  if (pageCount > 0 && page >= pageCount && !s.finished.includes(noteId)) s.finished.push(noteId);
  if (subjectId) s.subjects[noteId] = subjectId;
  // keep the last 60 days
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
  for (const k of Object.keys(s.days)) if (k < dayKey(cutoff)) delete s.days[k];
  write(s);
}

export interface Progress { streak: number; weekPages: number; finished: number; subjects: number; last7: { day: string; label: string; pages: number }[]; anything: boolean }

export function progress(): Progress {
  const s = read();
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const last7 = days.map((d) => ({ day: dayKey(d), label: d.toLocaleDateString('en-GB', { weekday: 'short' }), pages: (s.days[dayKey(d)] || []).length }));
  // streak: consecutive days with reading, counted back from today (or from yesterday if today has none yet)
  let streak = 0; const cursor = new Date();
  if (!(s.days[dayKey(cursor)] || []).length) cursor.setDate(cursor.getDate() - 1);
  while ((s.days[dayKey(cursor)] || []).length) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return { streak, weekPages: last7.reduce((a, d) => a + d.pages, 0), finished: s.finished.length, subjects: new Set(Object.values(s.subjects)).size, last7, anything: Object.keys(s.days).length > 0 };
}
