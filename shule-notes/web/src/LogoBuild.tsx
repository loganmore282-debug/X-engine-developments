// The launch animation: the Shule Notes logo BUILDS ITSELF, part by part, in the order the owner described it:
//   1. the spiral notebook (its outline is drawn, it fills, the spiral rings slide out of the binding, the page corner peels open a little),
//   2. the interlocking monogram "SN" (the S is painted in, the N rises beneath it, they lock together),
//   3. the graduation cap (it drops in, settles, and its tassel swings),
//   4. the brand name "ShuleNotes" (letter by letter), then a soft light sweeps across.
// The shapes are the owner's real logo traced into vectors (logoParts.ts), so the finished frame IS the logo.
import { LOGO, LOGO_SIZE } from './logoParts';

const LETTERS = Array.from({ length: 10 }, (_, i) => `L${i}`);
const stops = (g?: [string, string][]) => (g || []).map(([o, c]) => <stop key={o} offset={o} stopColor={c} />);

export function LogoBuild({ instant = false, label = 'Shule Notes' }: { instant?: boolean; label?: string }) {
  const L = LOGO;
  const path = (k: string, cls: string, extra: Record<string, unknown> = {}) => <path key={k} className={cls} d={L[k].d} fill={L[k].fill} fillRule="evenodd" {...extra} />;
  const b = L.body.bbox;
  const n = L.N.bbox;
  return (
    <svg className={`lb ${instant ? 'lb-done' : ''}`} viewBox={`0 0 ${LOGO_SIZE[0]} ${LOGO_SIZE[1]}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id="lb-body" gradientUnits="userSpaceOnUse" x1="0" y1={b[1]} x2="0" y2={b[3]}>{stops(L.body.grad)}</linearGradient>
        <linearGradient id="lb-n" gradientUnits="userSpaceOnUse" x1={n[0]} y1={n[3]} x2={n[2]} y2={n[1]}>{stops(L.N.grad)}</linearGradient>
        <linearGradient id="lb-shine" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.5" stopColor="#fff" stopOpacity="0.55" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lb-floor"><stop offset="0" stopColor="#0b3d2b" stopOpacity="0.28" /><stop offset="1" stopColor="#0b3d2b" stopOpacity="0" /></radialGradient>
        <clipPath id="lb-clip"><path d={L.body.d} fillRule="evenodd" /></clipPath>
      </defs>

      {/* a soft shadow under the notebook, it settles when the cap lands */}
      <ellipse className="lb-floor" cx="486" cy="676" rx="236" ry="20" fill="url(#lb-floor)" />

      {/* 1 · the spiral notebook */}
      {['ring0', 'ring1', 'ring2'].map((k, i) => path(k, `lb-ring lb-ring${i}`))}
      <path className="lb-outline" d={L.body.d} pathLength={1} fill="none" stroke="#0bb89a" strokeWidth="4" strokeLinejoin="round" />
      <path className="lb-body" d={L.body.d} fill="url(#lb-body)" fillRule="evenodd" />
      <g className="lb-curl">{path('curlGreen', 'lb-curl-a')}{path('curlWhite', 'lb-curl-b')}</g>

      {/* 2 · the interlocking monogram */}
      <g className="lb-mono">
        {path('line1', 'lb-line lb-line1')}{path('line2', 'lb-line lb-line2')}
        <path className="lb-n" d={L.N.d} fill="url(#lb-n)" fillRule="evenodd" />
        {path('S', 'lb-s')}
      </g>

      {/* 3 · the graduation cap */}
      <g className="lb-cap">
        {path('board', 'lb-board')}
        {path('stripe', 'lb-stripe')}
        {path('tassel', 'lb-tassel')}
      </g>

      {/* a light sweeps over the finished mark */}
      <g clipPath="url(#lb-clip)"><g transform="skewX(-18)"><rect className="lb-shine" x="40" y="100" width="150" height="620" fill="url(#lb-shine)" /></g></g>

      {/* 4 · the brand name */}
      <g className="lb-name">
        {LETTERS.map((k, i) => <path key={k} className="lb-letter" style={{ ['--i' as string]: i }} d={L[k].d} fill={L[k].fill} fillRule="evenodd" />)}
      </g>
    </svg>
  );
}
