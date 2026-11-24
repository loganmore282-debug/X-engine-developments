// The motion layer: small, purposeful animations that make the site feel alive without ever slowing it down.
// Everything here animates only transform and opacity (the GPU does the work) and switches itself OFF for people who
// asked their phone or computer for less motion (prefers-reduced-motion).
import { useEffect, useRef, useState } from 'react';

export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Things that glide in as they come into view, with a small stagger inside each group. They are tagged here (not in every
// screen) so any new card or tile gets the same behaviour. Anything React re-renders with a new className simply shows.
const AUTO_REVEAL = '.subject-tile, .note-card, .notice, .pay-row, .profile-row, .card.row, .stat-card, .pay-total, .level-group, .menu-row';

// Cards that lean towards the pointer (mouse only: a finger has no hover).
const TILT = '.subject-tile, .note-card';

export function useMotion() {
  useEffect(() => {
    if (prefersReducedMotion()) { document.documentElement.classList.add('no-motion'); return; }
    const root = document.documentElement;
    const cleanups: Array<() => void> = [];

    // 1. Reveal on scroll ------------------------------------------------------------------------------------------
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const el = e.target as HTMLElement; el.classList.add('in'); io!.unobserve(el); window.setTimeout(() => el.style.setProperty('--d', '0ms'), 1400); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 }) : null;
    const tag = (scope: ParentNode) => {
      if (!io) return;
      scope.querySelectorAll<HTMLElement>(AUTO_REVEAL).forEach((el) => {
        if (el.classList.contains('reveal') || el.closest('.sheet, .overlay, .reader')) return;
        const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
        const i = Math.max(0, siblings.indexOf(el));
        el.classList.remove('rise');
        el.style.animationDelay = '';
        el.style.setProperty('--d', `${Math.min(i, 9) * 55}ms`);
        el.classList.add('reveal');
        io.observe(el);
      });
    };
    tag(document.body);
    const mo = new MutationObserver((list) => {
      for (const m of list) m.addedNodes.forEach((n) => { if (n instanceof HTMLElement) { tag(n.parentElement || n); } });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    cleanups.push(() => { mo.disconnect(); io?.disconnect(); });

    // 2. Ripple under a finger or click, on buttons and chips ---------------------------------------------------------
    const onDown = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('.btn, .chip, .class-chip');
      if (!t || (t as HTMLButtonElement).disabled) return;
      const r = t.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      t.appendChild(s);
      window.setTimeout(() => s.remove(), 650);
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    cleanups.push(() => document.removeEventListener('pointerdown', onDown));

    // 3. Tilt + light on cards, and a soft spotlight following the pointer over the header ------------------------------
    let tilted: HTMLElement | null = null;
    const reset = (el: HTMLElement | null) => { if (el) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.style.removeProperty('--gx'); el.style.removeProperty('--gy'); el.classList.remove('tilting'); } };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const target = e.target as HTMLElement | null;
      const hero = target?.closest<HTMLElement>('.hero');
      if (hero) { const r = hero.getBoundingClientRect(); hero.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`); hero.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`); }
      const el = target?.closest<HTMLElement>(TILT) || null;
      if (el !== tilted) { reset(tilted); tilted = el; }
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.classList.add('tilting');
      el.style.setProperty('--ry', `${(x - 0.5) * 9}deg`);
      el.style.setProperty('--rx', `${(0.5 - y) * 9}deg`);
      el.style.setProperty('--gx', `${x * 100}%`);
      el.style.setProperty('--gy', `${y * 100}%`);
    };
    const onLeave = () => { reset(tilted); tilted = null; };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    cleanups.push(() => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', onLeave); });

    // 4. Gentle parallax: the header's shapes drift slower than the page ----------------------------------------------
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { root.style.setProperty('--sy', `${Math.min(window.scrollY, 900)}px`); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener('scroll', onScroll));

    return () => cleanups.forEach((c) => c());
  }, []);
}

// A number that counts up to its value (once, when it first appears, and again smoothly when it changes).
export function CountUp({ value, duration = 800 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(value); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, duration]);
  return <>{shown.toLocaleString('en-US')}</>;
}

// A short burst of confetti (the moment a class is chosen, a payment goes through). Removes itself.
export function confetti(x = window.innerWidth / 2, y = window.innerHeight * 0.4) {
  if (prefersReducedMotion()) return;
  const colours = ['#17694b', '#0bb89a', '#f2b33d', '#4c8df6', '#e8618c', '#8d6bf0'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    const angle = (Math.PI * 2 * i) / 34 + Math.random() * 0.5;
    const dist = 90 + Math.random() * 150;
    p.style.cssText = `left:${x}px;top:${y}px;background:${colours[i % colours.length]};--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 60}px;--r:${Math.random() * 720 - 360}deg;--s:${0.7 + Math.random() * 0.8};animation-delay:${Math.random() * 90}ms`;
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  window.setTimeout(() => wrap.remove(), 1700);
}

// A heading whose words rise one after another (the introduction slides).
export function Words({ text, step = 55, from = 0 }: { text: string; step?: number; from?: number }) {
  return <>{text.split(' ').map((w, i) => <span key={i} className="word" style={{ animationDelay: `${from + i * step}ms` }}>{w}</span>)}</>;
}
