import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Sheet } from './components';
import { useAuth, useLibrary, useToast } from './store';
import type { Payment, Plan, User } from './types';

const ugx = (n: number) => 'UGX ' + n.toLocaleString('en-GB');

// Whether payments are on, and whether this student has a pass right now. The server is what really decides;
// this only decides what to show.
export function useAccess() {
  const { user } = useAuth();
  const { config } = useLibrary();
  const until = user?.accessUntil ? new Date(user.accessUntil) : null;
  // When a pass ends while the page is open, everything locks again by itself.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const ms = until.getTime() - Date.now();
    if (ms <= 0 || ms > 2147000000) return;
    const id = window.setTimeout(() => tick((n) => n + 1), ms + 500);
    return () => window.clearTimeout(id);
  }, [until?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = !!until && until.getTime() > Date.now();
  return { enabled: !!config.paymentsEnabled, active, until, locked: (free?: boolean) => !!config.paymentsEnabled && !active && !free };
}

export function untilLabel(d: Date) {
  const ms = d.getTime() - Date.now();
  if (ms < 24 * 3600000) return `today at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function lengthLabel(minutes: number) {
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours of reading`;
  const days = Math.round(minutes / 1440);
  return days === 1 ? '24 hours of reading' : `${days} days of reading`;
}

// Choose a pass, enter the mobile money number, approve on the phone, and the access appears by itself.
export function PaySheet({ onClose, onPaid, reason }: { onClose: () => void; onPaid?: () => void; reason?: string }) {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [picked, setPicked] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [step, setStep] = useState<'choose' | 'waiting' | 'done' | 'failed'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [result, setResult] = useState<Payment | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    api<{ enabled: boolean; plans: Plan[] }>('/payments/plans').then((r) => {
      setPlans(r.plans); setEnabled(r.enabled);
      const middle = r.plans[Math.min(2, r.plans.length - 1)];
      if (middle) setPicked(middle.id);
    }).catch((e) => setError((e as Error).message));
  }, []);

  const plan = plans?.find((p) => p.id === picked);

  async function pay() {
    if (!plan) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ payment: Payment }>('/payments/start', { body: { planId: plan.id, phone } });
      setPaymentId(r.payment.id); setStep('waiting');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  // While waiting: ask every 3 seconds (the server asks MarzPay) for up to 3 minutes.
  useEffect(() => {
    if (step !== 'waiting' || !paymentId) return;
    let tries = 0;
    const id = window.setInterval(async () => {
      tries += 1;
      try {
        const r = await api<{ payment: Payment; user: User | null }>(`/payments/${paymentId}/status`);
        if (!alive.current) return;
        if (r.payment.status === 'paid') { window.clearInterval(id); if (r.user) setUser(r.user); setResult(r.payment); setStep('done'); onPaid?.(); }
        else if (r.payment.status === 'failed') { window.clearInterval(id); setResult(r.payment); setStep('failed'); }
      } catch { /* a blip: try again */ }
      if (tries >= 60) { window.clearInterval(id); if (alive.current) { setResult(null); setStep('failed'); } }
    }, 3000);
    return () => window.clearInterval(id);
  }, [step, paymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet title={step === 'done' ? 'You are in' : step === 'waiting' ? 'Approve on your phone' : 'Choose a pass'} onClose={step === 'waiting' ? () => { toast('We will unlock your access as soon as the payment arrives.'); onClose(); } : onClose}>
      {step === 'choose' && <>
        {reason && <p className="muted" style={{ marginTop: -6 }}>{reason}</p>}
        {!plans && !error && <div className="center"><div className="spinner" style={{ margin: '24px auto' }} /></div>}
        {plans && !enabled && <div className="banner-error">Payments are not open yet. Please try again later.</div>}
        {error && <div className="banner-error">{error}</div>}
        {plans && <div className="plan-list">{plans.map((p) => (
          <button key={p.id} type="button" className={`plan ${picked === p.id ? 'on' : ''}`} onClick={() => setPicked(p.id)}>
            <span className="plan-radio" />
            <span className="grow"><b className="poppins">{p.name}</b><small>{lengthLabel(p.minutes)}</small></span>
            <b className="plan-price poppins">{ugx(p.price)}</b>
          </button>))}</div>}
        {plans && <label className="field" style={{ marginTop: 16 }}><span>MTN or Airtel mobile money number</span>
          <input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0772 123 456" /></label>}
        <div className="sticky-pay">
          <button className="btn wide" disabled={busy || !plan || !enabled} onClick={pay}>{busy ? 'Starting…' : plan ? `Pay ${ugx(plan.price)}` : 'Pay'}</button>
          <p className="muted center" style={{ fontSize: 12.5, margin: '10px 0 0' }}>You will get a prompt on this number to approve with your PIN. Paying again adds time on top of what you have left.</p>
        </div>
      </>}
      {step === 'waiting' && <div className="center" style={{ padding: '10px 0 6px' }}>
        <div className="spinner" style={{ margin: '8px auto 18px', width: 40, height: 40 }} />
        <p style={{ fontSize: 17, margin: '0 0 6px' }}><b>Check your phone</b></p>
        <p className="muted" style={{ margin: 0 }}>Enter your mobile money PIN to approve {plan ? ugx(plan.price) : 'the payment'}. This page updates by itself.</p>
        <button className="btn outline small" style={{ marginTop: 18 }} onClick={onClose}>Close, I will approve later</button>
      </div>}
      {step === 'done' && <div className="center" style={{ padding: '6px 0' }}>
        <div className="done-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg></div>
        <p style={{ fontSize: 17, margin: '14px 0 4px' }}><b>Payment received</b></p>
        <p className="muted" style={{ margin: 0 }}>{result?.accessUntil ? `Your pass lasts until ${untilLabel(new Date(result.accessUntil))}.` : 'Your pass is active.'}</p>
        <button className="btn wide" style={{ marginTop: 18 }} onClick={onClose}>Start reading</button>
      </div>}
      {step === 'failed' && <div className="center" style={{ padding: '6px 0' }}>
        <p style={{ fontSize: 17, margin: '6px 0 4px' }}><b>{result ? 'The payment did not go through' : 'We did not see the payment'}</b></p>
        <p className="muted" style={{ margin: 0 }}>{result?.message || 'If you approved it, your access appears within a minute or two. If not, nothing was taken.'}</p>
        <button className="btn wide" style={{ marginTop: 18 }} onClick={() => { setStep('choose'); setError(''); }}>Try again</button>
      </div>}
    </Sheet>
  );
}

// A small badge on documents the student cannot open yet.
export function LockBadge() {
  return <span className="lock-badge" title="Needs a pass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>;
}
