// The server and admin pieces behind the new Team / My / Home screens:
// per-level commission totals, the profile-logo image slot, and the ticker text setting.
'use strict';
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

// 1. /team/stats adds what each level has paid, from the ledger's own commissionLevel (0 = Level 1)
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice ' + a); return src.slice(i, j); };
const route = grab("app.get('/team/stats'", "// ── MISSION CENTER — REMOVED ──");
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
  ok(/res\.json\(\{ status: 'success', logo, authhero, banner2, banner3, checkinbanner, profilelogo, loaderbg \}\)/.test(src), 'and the admin panel reads it');
  ok(/id="profileLogoFile"/.test(adm) && /wireSodaImageSlot\('profilelogo'/.test(adm), 'the admin panel can upload and remove it');
  ok(!/checkinBannerFile/.test(adm), 'the removed Check-in banner upload is gone from admin');

  // 3. the Home ticker line is an admin setting that members receive
  ok(/tickerText: ''/.test(src), 'tickerText is a real setting (empty = built-in sentence)');
  ok(/id="sTickerText"/.test(adm) && /tickerText:\$\('sTickerText'\)\.value\.trim\(\)/.test(adm), 'the admin saves it');
  // 5. production hygiene
  ok(/const DEFAULT_PRODUCTS = \[\];/.test(src), 'no built-in placeholder assets: members only see what the admin created');
  const cli = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ok(!/Soda Mini|Soda Classic|Product-1\b/.test(cli), 'no sample asset is written into the app code');
  ok(!/at midnight 00:00/.test(cli) && /All product earnings will be automatically added to your app balance\./.test(cli), 'the Home line uses the owner\'s sentence without the midnight claim Soda does not keep');
  const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
  ok(/--v-blue:#1739b8/.test(css) && !/#e30613|#1457e8/i.test(css), 'the app uses the royal blue and no red is left');
  console.log(`PASS: screen data (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });

// 4. purchase limit per member ("0/3" on the card): real /invest/create + real sanitizer
const sanSrc = (() => { let st = src.indexOf('function sanitizeProductInput('), d = 0; for (let k = src.indexOf('{', st); ; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(st, k + 1); } })();
const sanitize = new Function('MAX_MONEY_AMOUNT', 'hhmmToMin', sanSrc + '; return sanitizeProductInput;')(1e9, () => 0);
const out0 = {};
const base = { key: 'a1', name: 'A', price: 1000, cycle: 8, multiplier: 3 };
ok(sanitize({ key: 'a1', name: 'A', price: 1000, multiplier: 3 }, 0, {}) === null, 'an asset without a cycle is refused, not given a hidden 150 days');
ok(sanitize({ key: 'a1', name: 'A', price: 1000, cycle: 8 }, 0, {}) === null, 'an asset with no multiplier or total payout is refused, not given a hidden x30');
ok(sanitize({ key: 'a1', name: 'A', price: 1000, cycle: 8, expectedReturn: 3000 }, 0, {}) !== null, 'a total payout alone is enough');
ok(sanitize(base, 0, out0).buyLimit === 0, 'no limit by default');
ok(sanitize({ ...base, vip: '3' }, 0, {}).vip === 3 && sanitize(base, 0, {}).vip === 0 && sanitize({ ...base, vip: '' }, 0, {}).vip === 0, 'an asset has a VIP number, 0 by default');
ok(sanitize({ ...base, vip: '-1' }, 0, {}) === null && sanitize({ ...base, vip: '1.5' }, 0, {}) === null && sanitize({ ...base, vip: '101' }, 0, {}) === null, 'a VIP number must be a whole number from 0 to 100');
ok(sanitize({ ...base, buyLimit: '3' }, 0, {}).buyLimit === 3, 'the admin can set 3');
ok(sanitize({ ...base, buyLimit: '0' }, 0, {}).buyLimit === 0 && sanitize({ ...base, buyLimit: '' }, 0, {}).buyLimit === 0, '0 or blank = no limit');
for (const bad of ['-1', '2.5', 'abc', '5000']) ok(sanitize({ ...base, buyLimit: bad }, 0, {}) === null, 'refuses ' + bad);

const invRoute = grab("app.post('/invest/create'", "app.get('/investments'");
async function buy(limit, owned) {
  let handler; const app = { post: (p, h) => { if (p === '/invest/create') handler = h; }, get() {} };
  const user = { walletBalance: 100000, totalInvested: 0, status: 'active' };
  const investments = Array.from({ length: owned }, (_, i) => ({ userId: 'u1', tierKey: 'a1', id: 'i' + i }))
    .concat([{ userId: 'u1', tierKey: 'other' }, { userId: 'u2', tierKey: 'a1' }]);
  const tier = { key: 'a1', name: 'A', price: 10000, cycle: 30, buyLimit: limit, active: true };
  const q = coll => { const c = []; const o = { where(f, _op, v) { c.push([f, v]); return o; }, get: async () => { const rows = coll.filter(r => c.every(([f, v]) => r[f] === v)); return { size: rows.length, docs: rows.map(r => ({ data: () => r })) }; } }; return o; };
  const db = { collection: n => n === 'users' ? { doc: () => ({ get: async () => ({ exists: true, data: () => user }), update: async u => { for (const [k, v] of Object.entries(u)) user[k] = v && v.__inc !== undefined ? (user[k] || 0) + v.__inc : v; } }) }
    : n === 'investments' ? { ...q(investments), doc: () => ({ id: 'new', set: async d => { investments.push(d); }, delete: async () => {} }) }
    : { add: async () => ({}) } };
  new Function('app', 'db', 'verifyAuth', 'getProductByKey', 'productOpenState', 'getSettings', 'withLock', 'productExpectedReturn', 'FieldValue', 'nowStr', 'newStatementId', 'fmtMoney', 'grantTurntableSpins', 'console',
    invRoute)(app, db, async () => 'u1', async () => tier, () => ({ open: true }), async () => ({ cycleDays: 30 }), (_k, fn) => fn(), () => 30000,
    { increment: n => ({ __inc: n }), serverTimestamp: () => 0 }, () => ({ date: 'd', time: 't' }), () => 's', n => String(n), () => {}, console);
  let code = 200, body; const res = { status: c => { code = c; return res; }, json: b => { body = b; } };
  await handler({ headers: {}, body: { tierKey: 'a1' } }, res);
  return { code, body, user, count: investments.filter(i => i.userId === 'u1' && i.tierKey === 'a1').length };
}
(async () => {
  let r = await buy(2, 1); ok(r.body.status === 'success' && r.count === 2 && r.user.walletBalance === 90000, 'under the limit: bought and charged once');
  r = await buy(2, 2); ok(r.code === 400 && r.body.code === 'PURCHASE_LIMIT' && r.user.walletBalance === 100000 && r.count === 2, 'at the limit: refused, nothing charged, nothing created');
  r = await buy(0, 9); ok(r.body.status === 'success', 'no limit means no restriction');
  r = await buy(1, 0); ok(r.body.status === 'success', 'the first one of a limit-1 asset is fine');
  console.log(`PASS: purchase limit (${n} checks so far)`);
})().catch(e => { console.error(e); process.exit(1); });
