import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLibrary } from './store';

// Has the owner posted something the student has not opened in the bell yet?
const SEEN_KEY = 'shule_inbox_seen';
export function useUnread() {
  const { announcements, notices } = useLibrary();
  const location = useLocation();
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY) || 0));
  // Opening the notifications page marks everything as read.
  useEffect(() => { if (location.pathname === '/inbox') { const now = Date.now(); localStorage.setItem(SEEN_KEY, String(now)); setSeen(now); } }, [location.pathname]);
  return [...announcements, ...(notices || []).filter((n) => !n.own)].some((a) => new Date(a.createdAt).getTime() > seen);
}

