import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { progress } from '../study';
import { Back, Fire, MenuBook, School, Insights } from '../icons';

// A number that counts up to its value when it appears.
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (to === 0) { setN(0); return; }
    const start = performance.now(); let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - start) / 700); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}

// The same "My progress" as the phone app: streak, pages this week, finished documents, subjects and a 7-day chart.
export function ProgressPage() {
  const nav = useNavigate();
  const p = useMemo(() => progress(), []);
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setGrown(true), 80); return () => window.clearTimeout(t); }, []);
  const max = Math.max(1, ...p.last7.map((d) => d.pages));
  const cards = [
    { icon: <Fire />, value: p.streak, label: 'day streak', tone: 'amber' },
    { icon: <MenuBook />, value: p.weekPages, label: p.weekPages === 1 ? 'page this week' : 'pages this week', tone: 'green' },
    { icon: <Insights />, value: p.finished, label: p.finished === 1 ? 'document finished' : 'documents finished', tone: 'blue' },
    { icon: <School />, value: p.subjects, label: p.subjects === 1 ? 'subject studied' : 'subjects studied', tone: 'purple' },
  ];
  return (
    <div>
      <div className="section-head" style={{ marginTop: 24 }}>
        <button className="icon-btn" aria-label="Back" onClick={() => nav('/profile')}><Back /></button>
        <h2>My progress</h2>
      </div>
      {!p.anything && <div className="empty" style={{ paddingTop: 20 }}><h3>Nothing to show yet</h3><p>Read a few pages and your streak, pages and chart appear here.</p></div>}
      <div className="progress-cards">
        {cards.map((c, i) => (
          <div key={c.label} className={`card pcard rise tone-${c.tone}`} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="pcard-ico">{c.icon}</span>
            <b className="poppins"><CountUp to={c.value} /></b><small>{c.label}</small>
          </div>
        ))}
      </div>
      <div className="card chart rise" style={{ animationDelay: '300ms' }}>
        <h3>Pages read, last 7 days</h3>
        <div className="bars">
          {p.last7.map((d, i) => (
            <div key={d.day} className="bar-col" title={`${d.pages} pages`}>
              <em>{d.pages || ''}</em>
              <span className="bar-track"><i style={{ height: grown ? `${Math.max(d.pages ? 6 : 0, (d.pages / max) * 100)}%` : '0%', transitionDelay: `${i * 60}ms` }} className={i === 6 ? 'today' : ''} /></span>
              <small>{d.label}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
