// The server and admin pieces behind the new Team / My / Home screens:
// per-level commission totals, the profile-logo image slot, and the ticker text setting.
'use strict';
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

// 1. /team/stats adds what each level has paid, from the ledger's own commissionLevel (0 = Level 1)
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice ' + a); return src.slice(i, j); };
const route = grab("app.get('/team/stats'", "app.post('/team/milestone/claim'");
const finiteMoney = v => Number.isFinite(Number(v)) ? Number(v) : 0;
function runStats(rows) {
  let handler;
  const app = { get: (p, h) => { if (p === '/team/stats') handler = h; } };
  const db = { collection: name => ({
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ referralCode: 'ABC', teamL1Count: 3, teamL2Count: 1, teamL3Count: 0, teamCommission: 0 }) }) }),
    where: (f, _o, v) => { const f1 = { f, v }; const q = { conds: [f1], where(ff, _oo, vv) { q.conds.push({ f: ff, v: vv }); return q; }, get: async () => {
      const list = name === 'transactions' ? rows.filter(r => q.conds.every(c => r[c.f] === c.v)) : [];
      return { forEach: cb => list.forEach(r => cb({ data: () => r })), docs: list.map(r => ({ data: () => r })) }; } }; return q; },
  }) };
  new Function('app', 'db', 'verifyAuth', 'getSettings', 'wholeTeamDeposits', 'activeL1Count', 'TEAM_MILESTONES', 'TEAM_DEPOSIT_MILESTONES', 'finiteMoney', 'console', route)(
    app, db, async () => 'u1', async () => ({ commL1: 26, commL2: 2, commL3: 1 }), async () => 5000, async () => 0, [], [], finiteMoney, console);
  let body; const res = { json: b => { body = b; }, status() { return res; } };
  return handler({ headers: {} }, res).then(() => body);
}
(async () => {
  const rows = [
    { userId: 'u1', type: 'commission', commissionLevel: 0, amount: 1000 },
    { userId: 'u1', type: 'commission', commissionLevel: 0, amount: 500 },
    { userId: 'u1', type: 'commission', commissionLevel: 1, amount: 200 },
    { userId: 'u1', type: 'commission', commissionLevel: 2, amount: 50 },
    { userId: 'u2', type: 'commission', commissionLevel: 0, amount: 9999 },   // someone else's
    { userId: 'u1', type: 'deposit', amount: 77777 },                           // not a commission
  ];
  const r = await runStats(rows);
  ok(r.status === 'success', 'stats still answer');
  assert.deepStrictEqual(r.levelCommission, { l1: 1500, l2: 200, l3: 50 }); n++;
  ok(r.totalTeam === 4 && r.teamDeposits === 5000, 'the older fields are untouched');
  const empty = await runStats([]);
  assert.deepStrictEqual(empty.levelCommission, { l1: 0, l2: 0, l3: 0 }); n++;

  // 2. profile logo slot: stored, served to members and to the admin
  ok(/const SODA_IMAGE_SLOTS = \[[^\]]*'profilelogo'/.test(src), 'profilelogo is a known image slot');
  ok(/publicJson\(req, res, \{ status: 'success', logo, authhero, banner2, banner3, checkinbanner, profilelogo \}/.test(src), 'members get it from /public/soda-images');
  ok(/res\.json\(\{ status: 'success', logo, authhero, banner2, banner3, checkinbanner, profilelogo \}\)/.test(src), 'and the admin panel reads it');
  ok(/id="profileLogoFile"/.test(adm) && /wireSodaImageSlot\('profilelogo'/.test(adm), 'the admin panel can upload and remove it');
  ok(!/checkinBannerFile/.test(adm), 'the removed Check-in banner upload is gone from admin');

  // 3. the Home ticker line is an admin setting that members receive
  ok(/tickerText: ''/.test(src), 'tickerText is a real setting (empty = built-in sentence)');
  ok(/id="sTickerText"/.test(adm) && /tickerText:\$\('sTickerText'\)\.value\.trim\(\)/.test(adm), 'the admin saves it');
  console.log(`PASS: screen data (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
