import { useMemo, useState } from 'react';
import { useAuth, useLibrary } from './store';

// "Show notes from every class" is remembered for the session, so Home and a subject's page always agree on what is shown.
const KEY = 'shule_every_class';
export function useEveryClass(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } });
  return [on, (v) => { setOn(v); try { sessionStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ } }];
}

// What the student sees: their class, notes for every class, and notes whose class is not in the list (as in the phone app).
export function useClassScope(everyClass: boolean) {
  const { user } = useAuth();
  const { notes, subjects, levels } = useLibrary();
  const cls = user?.classLevel || null;
  const known = useMemo(() => new Set(levels.flatMap((g) => g.levels.map((l) => l.id))), [levels]);
  const inClass = useMemo(() => notes.filter((n) => everyClass || !cls || !n.classLevel || n.classLevel === cls || !known.has(n.classLevel)), [notes, cls, everyClass, known]);
  const subjectsInScope = useMemo(() => subjects.filter((s) => inClass.some((n) => n.subjectId === s.id)), [subjects, inClass]);
  return { cls, inClass, subjectsInScope };
}

