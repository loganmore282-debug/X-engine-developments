import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { API, api } from '../api';
import type { AppConfig } from '../types';
import { SubjectIcon, subjectVars } from '../subjectLook';
import { Bookmark, Search, Spark } from '../icons';

const SUBJECTS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'English', 'History', 'Geography', 'Computer', 'Agriculture', 'Economics'];

// What a phone looks like with the app on it: drawn here with the real subject pictures (our own artwork), no photo needed.
function PhoneMock() {
  const docs = [['Photosynthesis', 'Biology', 'Notes · 12 pages'], ['The Periodic Table', 'Chemistry', 'Notes · 9 pages'], ['Algebra Past Paper 2024', 'Mathematics', 'Past paper · 6 pages']];
  return (
    <div className="phone" aria-hidden="true">
      <div className="phone-bar" />
      <div className="phone-hero"><small>Good morning</small><b>What are you studying today?</b><div className="phone-search"><Search width={16} height={16} /> Search notes and past papers</div></div>
      <div className="phone-tiles">{['Biology', 'Physics', 'Mathematics'].map((s) => <span key={s} className="sv" style={subjectVars(s) as CSSProperties}><i><SubjectIcon name={s} size={22} /></i>{s}</span>)}</div>
      {docs.map(([t, s, m]) => (
        <div key={t} className="phone-card sv" style={subjectVars(s) as CSSProperties}>
          <i className="cover sm"><SubjectIcon name={s} size={22} /></i><span><b>{t}</b><small>{m}</small></span><Bookmark width={16} height={16} />
        </div>
      ))}
      <div className="phone-ai"><Spark width={16} height={16} /> Ask AI</div>
    </div>
  );
}

const FEATURES = [
  { t: 'Notes and past papers for your class', d: 'Pick your class once. Everything new for it appears the moment it is added, sorted by subject.', icon: 'M4 5h12a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3zM8 9h7M8 13h5' },
  { t: 'An AI study helper that reads with you', d: 'Open a page and ask a question. The answer comes from the document in front of you, not from guesswork.', icon: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z' },
  { t: 'Find anything inside a document', d: 'Search the words inside any note, jump straight to the page and bookmark the pages you want to revisit.', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4' },
  { t: 'Carry on exactly where you stopped', d: 'Your last page is remembered, on the website and in the app, so revision never starts from page one again.', icon: 'M5 12h14M13 6l6 6-6 6' },
];

export function Landing() {
  const [config, setConfig] = useState<AppConfig>({});
  useEffect(() => { api<{ config: AppConfig }>('/config', { auth: false }).then((r) => setConfig(r.config)).catch(() => {}); }, []);
  const download = `${API}/download/`;
  return (
    <div className="landing">
      <header className="land-top"><div className="land-in">
        <Link to="/" className="brand"><img src="/logo-mark.png" alt="" /><span>Shule<b>Notes</b></span></Link>
        <span className="grow" />
        <a className="land-link hide-sm" href="#features">Features</a>
        <a className="land-link hide-sm" href="#how">How it works</a>
        <a className="land-link hide-sm" href={download}>Get the app</a>
        <Link to="/signin" className="btn small outline">Sign in</Link>
        <Link to="/signup" className="btn small">Create account</Link>
      </div></header>

      <section className="land-hero"><div className="land-in two">
        <div className="land-copy rise">
          <span className="eyebrow-pill"><Spark width={14} height={14} /> Notes · Past papers · AI helper</span>
          <h1>Study smarter,<br />anywhere you are.</h1>
          <p>Shule Notes puts the notes and past papers for your class in one place, with an AI helper that answers from the very page you are reading.</p>
          <div className="land-cta">
            <Link to="/signup" className="btn">Create a free account</Link>
            <a href={download} className="btn outline">Get the Android app</a>
          </div>
          <div className="land-trust"><span>Primary 1 to Senior 6</span><span>Phone, tablet and computer</span><span>Same account everywhere</span></div>
        </div>
        <div className="land-art rise" style={{ animationDelay: '120ms' }}><PhoneMock /><div className="orb o1" /><div className="orb o2" /></div>
      </div></section>

      <section className="land-strip"><div className="land-in"><span>Subjects covered</span>
        <div className="strip-row">{SUBJECTS.map((s) => <b key={s} className="sv" style={subjectVars(s) as CSSProperties}><SubjectIcon name={s} size={20} />{s}</b>)}</div></div></section>

      <section id="features" className="land-sec"><div className="land-in">
        <h2 className="land-h">Everything a student needs to revise well</h2>
        <p className="land-sub">Simple, quick and made for the way students in Uganda study.</p>
        <div className="feat-grid">{FEATURES.map((f, i) => (
          <article key={f.t} className="card feat rise" style={{ animationDelay: `${i * 70}ms` }}>
            <span className="feat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={f.icon} /></svg></span>
            <h3>{f.t}</h3><p>{f.d}</p></article>
        ))}</div>
      </div></section>

      <section id="how" className="land-sec alt"><div className="land-in">
        <h2 className="land-h">Ready in a minute</h2>
        <div className="steps">
          {[['1', 'Create your account', 'Your name, phone number and a password. No email needed.'], ['2', 'Choose your class', 'We show the notes and past papers for your class only.'], ['3', 'Read, search and ask', 'Open a document, search inside it and ask the AI helper when you are stuck.']].map(([n, t, d]) => (
            <div key={n} className="step"><span className="step-n">{n}</span><h3>{t}</h3><p>{d}</p></div>))}
        </div>
      </div></section>

      <section className="land-sec"><div className="land-in"><div className="cta-band">
        <div><h2>Start studying today</h2><p>Free to join. Use it on the website, or install the Android app and carry your notes in your pocket.</p></div>
        <div className="land-cta"><Link to="/signup" className="btn light">Create account</Link><a href={download} className="btn ghost">Download the app</a></div>
      </div></div></section>

      <footer className="land-foot"><div className="land-in">
        <div className="foot-brand"><Link to="/" className="brand"><img src="/logo-mark.png" alt="" /><span>Shule<b>Notes</b></span></Link><p>Notes, past papers and an AI study helper for every class.</p></div>
        <div className="foot-links">
          <b>Product</b><a href="#features">Features</a><a href={download}>Android app</a><Link to="/signin">Sign in</Link>
        </div>
        <div className="foot-links">
          <b>Help</b>
          {config.supportWhatsapp && <a href={`https://wa.me/${config.supportWhatsapp.replace(/[^\d]/g, '')}`}>WhatsApp us</a>}
          {config.supportPhone && <a href={`tel:${config.supportPhone}`}>{config.supportPhone}</a>}
          {config.supportEmail && <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>}
          <a href={`${API}/privacy`}>Privacy policy</a><a href={`${API}/terms`}>Terms of use</a>
        </div>
      </div><div className="land-in copy">© {new Date().getFullYear()} Shule Notes. All rights reserved.</div></footer>
    </div>
  );
}
