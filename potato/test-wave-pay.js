'use strict';
// Wave payment pages (Cote d'Ivoire): a Wave channel (link + QR), the order that opens the 30 minute clock, and the claim
// (wallet number, optional transaction ID). NOTHING here credits a wallet. Real server.js source against mocks.
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf("// ── WAVE RECHARGE (Côte d'Ivoire) ──"), b = src.indexOf('// END WAVE RECHARGE', a);
ok(a >= 0 && b > a, 'Wave recharge block found');
const block = src.slice(a, b);

// ── in-memory database with just what the block uses ──
const SERVER_TS = { __ts: true };
function makeDb() {
  const cols = new Map(); let n = 0;
  const col = name => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
  const snapOf = (name, id) => { const row = col(name).get(id); return { id, exists: !!row, data: () => row && structuredClone(row), ref: refOf(name, id) }; };
  const refOf = (name, id) => ({
    id,
    get: async () => snapOf(name, id),
    set: async v => { col(name).set(id, structuredClone(v)); },
    update: async v => { const r = col(name).get(id); if (!r) throw new Error('NOT_FOUND'); Object.assign(r, structuredClone(v)); },
    updateIf: async (f, v) => { const r = col(name).get(id); if (!r) return false; for (const k of Object.keys(f)) if (r[k] !== f[k]) return false; Object.assign(r, structuredClone(v)); return true; },
    delete: async () => { col(name).delete(id); },
  });
  const query = (name, filters = []) => ({
    where: (f, o, v) => query(name, filters.concat([[f, v]])),
    limit: () => query(name, filters),
    get: async () => ({ docs: [...col(name).keys()].map(id => snapOf(name, id)).filter(s => filters.every(([f, v]) => s.data()[f] === v)), get size() { return this.docs.length; } }),
  });
  return { cols, col, collection: name => ({
    doc: id => refOf(name, id || ('id' + (++n))),
    add: async v => { const id = 'id' + (++n); col(name).set(id, structuredClone(v)); return refOf(name, id); },
    where: (f, o, v) => query(name, [[f, v]]),
    get: async () => query(name).get(),
  }) };
}
function build(db, ctx) {
  const handlers = {};
  const app = { get: (p, h) => { handlers['GET ' + p] = h; }, post: (p, h) => { handlers['POST ' + p] = h; } };
  const mk = new Function('app', 'db', 'ctx', 'FieldValue', 'tsMillis', 'currentRegionKey', 'MAX_MONEY_AMOUNT', 'fmtMoney', 'paymentAmount', 'getSettings',
    'currentRegion', 'verifyAuth', 'verifyAdmin', 'verifyOwner', 'logAdminAction', 'uniqueRef', 'nowStr', 'newStatementId', '_userBeingDeleted', 'crypto',
    block + '\nreturn { safeWaveLink, safeWaveQr, sweepManualOrders, activePayChannels, dropPayChannelsCache, waveWalletDigits };');
  const api = mk(app, db, ctx, { serverTimestamp: () => SERVER_TS }, v => (v && v.getTime ? v.getTime() : 0), () => 'et', 1e9,
    n => 'FCFA ' + n, v => Number(v), async () => ({ minDeposit: 300 }),
    () => ({ localLength: 10 }), async () => ctx.user, () => ctx.admin, () => ctx.owner, () => {}, async l => l + (++ctx.refN), () => ({ date: '01/01/2026', time: '10:00' }), () => 'S' + (++ctx.refN), new Set(), require('node:crypto'));
  return { handlers, api };
}
async function call(h, body, opts = {}) {
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; }, set() { return this; } };
  await h({ body, headers: {}, ...opts }, res);
  return out;
}
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';


const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
(async () => {
  const db = makeDb();
  const ctx = { user: 'u1', owner: true, admin: true, refN: 0 };
  const { handlers: H, api } = build(db, ctx);
  db.col('users').set('u1', { phone: '0711111111', status: 'active', walletBalance: 100, totalDeposited: 0 });
  db.col('users').set('u3', { phone: '0733333333', status: 'active', walletBalance: 0, totalDeposited: 0 });
  db.col('users').set('u2', { phone: '0722222222', status: 'active', walletBalance: 0, totalDeposited: 0 });
  eq(api.waveWalletDigits('07 69 96 81 58'), '0769968158', 'wallet number: spaces dropped, 10 digits');
  for (const bad of ['', '12345', '076996815', '07699681581', 'abc']) eq(api.waveWalletDigits(bad), '', 'refused wallet number: ' + bad);
  // ── security: nobody can slip in their own payment link or QR picture ──
  const GOOD_LINKS = ['https://pay.wave.com/m/test/', 'https://qr.wave.com/abc/def/p', 'https://wave.com/pay?x=1'];
  for (const l of GOOD_LINKS) eq(api.safeWaveLink(l), l, 'a Wave link is accepted: ' + l);
  const EVIL_LINKS = ['http://pay.wave.com/m/x', 'https://evil.com/pay.wave.com', 'https://pay.wave.com@evil.com/m/x', 'https://user:pw@pay.wave.com/m/x', 'https://wave.com.evil.com/m/x',
    'https://evilwave.com/m/x', 'https://pay.wave.com:8443/m/x', 'https://pay.wave.com\\@evil.com/', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'https://pay.wave.com/m/x y', 'https://pay.wave.com/"onmouseover="x',
    'https://xn--wave-9ua.com/m/x', '//evil.com/m/x', 'https://pay.wave.com.evil.com/', 'ftp://pay.wave.com/x', '', 'https://' + 'a'.repeat(500) + '.wave.com/'];
  for (const l of EVIL_LINKS) eq(api.safeWaveLink(l), '', 'a foreign or odd link is refused: ' + l.slice(0, 50));
  const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  eq(api.safeWaveQr(QR), QR, 'a real PNG is accepted'); eq(api.safeWaveQr(JPG), JPG, 'a real JPEG is accepted');
  for (const q of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGh0bWw+', 'data:image/png;base64,PGh0bWw+PHNjcmlwdD4=', 'data:image/jpeg;base64,' + QR.split(',')[1], 'data:image/png;base64,' + JPG.split(',')[1], 'https://evil.com/qr.png', 'data:image/png;base64,iVBORw0KGgo=<x>', ''])
    eq(api.safeWaveQr(q), '', 'a fake or foreign picture is refused: ' + q.slice(0, 50));
  // admin: a Wave channel
  let r = await call(H['POST /admin/pay-channels/save'], { name: 'Wave', kind: 'wave', payLink: 'https://pay.wave.com/m/test/', qrImage: QR, logo: LOGO });
  eq(r.code, 200, 'Wave needs no account name or number'); const w1 = r.body.id;
  eq(db.col('payChannels').get(w1).payLink, 'https://pay.wave.com/m/test/', 'the link is stored');
  for (const bad of [{ name: 'W', kind: 'wave' }, { name: 'W', kind: 'wave', payLink: 'http://insecure.example/x' }, { name: 'W', kind: 'wave', payLink: 'javascript:alert(1)' }, { name: 'W', kind: 'wave', qrImage: 'data:text/html;base64,AAAA' }, { name: 'W', kind: 'wave', qrImage: 'data:image/png;base64,' + 'A'.repeat(700000) }]) {
    r = await call(H['POST /admin/pay-channels/save'], bad); eq(r.code, 400, 'refused: ' + JSON.stringify(bad).slice(0, 70));
  }
  r = await call(H['POST /admin/pay-channels/save'], { id: w1, name: 'Wave', kind: 'wave' });
  eq(db.col('payChannels').get(w1).qrImage, QR, 'editing without a QR keeps the QR'); eq(db.col('payChannels').get(w1).payLink, 'https://pay.wave.com/m/test/', 'and the link');
  r = await call(H['GET /public/pay-channels'], {});
  eq(r.body.channels.map(c => c.kind), ['wave'], 'members get the Wave channel');
  ok(!JSON.stringify(r.body).includes('pay.wave.com') && !JSON.stringify(r.body).includes(QR), 'but not its link or QR');
  // order: no wallet yet -> no link; with the wallet -> link + QR
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1 });
  eq(r.code, 200, 'the order opens'); ok(!r.body.payLink && !r.body.qrImage, 'no link or QR before the wallet number'); const dep = r.body.depositId;
  ok(r.body.expiresAt - Date.now() > 29 * 60 * 1000, 'the 30 minute clock starts');
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, depositId: dep, wallet: '12345' });
  eq(r.code, 400, 'a short wallet number is refused');
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, depositId: dep, wallet: '0769968158' });
  eq(r.code, 200, 'the same order takes the wallet'); eq(r.body.depositId, dep, 'it is the same order');
  eq(r.body.payLink, 'https://pay.wave.com/m/test/', 'the link is handed out now'); eq(r.body.qrImage, QR, 'and the QR'); eq(r.body.wallet, '0769968158', 'with the wallet');
  eq(db.col('pendingDeposits').get(dep).channelKind, 'wave', 'order is marked wave');
  // claims
  r = await call(H['POST /deposit/manual/submit'], { depositId: dep, txId: 'a b' });
  eq(r.code, 400, 'a transaction ID with a space is refused');
  r = await call(H['POST /deposit/manual/submit'], { depositId: dep, wallet: '1' , txId: '' });
  eq(r.code, 200, 'the Open App page can send a claim with the wallet number alone (stored wallet is used)');
  const row = db.col('pendingDeposits').get(dep);
  eq(row.status, 'review', 'the claim waits for the admin'); ok(/0769968158/.test(row.pastedSms) && /sans ID/.test(row.pastedSms), 'the admin sees the wallet number');
  eq(db.col('users').get('u1').walletBalance, 100, 'nothing was credited');
  // QR page: a transaction ID, one real transfer backs one claim
  ctx.user = 'u2';
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, wallet: '0755555555' }); const dep2 = r.body.depositId;
  r = await call(H['POST /deposit/manual/submit'], { depositId: dep2, txId: 'wave-abc123' });
  eq(r.code, 200, 'the QR page sends the transaction ID'); eq(db.col('pendingDeposits').get(dep2).pastedSmsTxId, 'WAVE-ABC123', 'stored in capitals');
  ctx.user = 'u3';
  r = await call(H['POST /deposit/manual/order'], { amount: 6000, channelId: w1, wallet: '0733333333' }); const dep3 = r.body.depositId;
  r = await call(H['POST /deposit/manual/submit'], { depositId: dep3, txId: 'WAVE-ABC123' });
  eq(r.code, 409, 'the same transfer cannot back a second claim');
  r = await call(H['POST /deposit/manual/submit'], { depositId: dep2 }); eq(r.code, 404, 'someone else\'s order is refused');
  r = await call(H['POST /deposit/manual/submit'], { depositId: dep3, txId: 'OTHER-1' });
  eq(r.code, 429, 'two sends in a row are slowed down');
  // opening the pages again is a NEW order with a fresh clock; the older unsent one is closed (owner: "it shares the same time")
  ctx.user = 'u2'; db.col('pendingDeposits').set('stale', { userId: 'u2', method: 'manual', status: 'pending', amount: 5000, expiresAt: new Date(Date.now() + 60 * 1000) });
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1 });
  ok(r.code === 200 && r.body.depositId !== 'stale', 'opening the payment pages again creates a new order');
  ok(r.body.expiresAt - Date.now() > 29 * 60 * 1000, 'with its own fresh 30 minute clock, not the old one');
  eq(db.col('pendingDeposits').get('stale').status, 'failed', 'the older unsent order is closed');
  const keep = r.body.depositId; r = await call(H['POST /deposit/manual/order'], { amount: 6000, channelId: w1, depositId: keep });
  eq(r.body.depositId, keep, 'the same page re-pointing its own order keeps it (and its clock)');
  // a row changed behind the app's back (database edited directly) is never served
  r = await call(H['POST /admin/pay-channels/save'], { id: w1, name: 'Wave', kind: 'wave', payLink: 'https://evil.com/pay.wave.com' });
  eq(r.code, 400, 'a link on another site cannot be saved');
  const chRow = db.col('payChannels').get(w1), keepL = chRow.payLink, keepQ = chRow.qrImage;
  chRow.payLink = 'https://evil.com/pay'; chRow.qrImage = 'data:image/png;base64,PGh0bWw+PHNjcmlwdD4='; api.dropPayChannelsCache();
  r = await call(H['GET /public/pay-channels'], {});
  eq(r.body.channels.length, 0, 'a tampered row (foreign link, fake picture) is not offered to members at all');
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, wallet: '0722222222' });
  ok(r.code === 400 && !JSON.stringify(r.body).includes('evil.com'), 'and cannot be ordered');
  chRow.payLink = keepL; chRow.qrImage = 'data:image/png;base64,PGh0bWw+'; api.dropPayChannelsCache();
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, wallet: '0722222222' });
  ok(r.code === 200 && r.body.payLink === keepL && r.body.qrImage === '', 'a good link is served but a fake picture is dropped');
  chRow.qrImage = keepQ; api.dropPayChannelsCache();
  // coming back to the pages after leaving: the SAME open order is picked up; a closed one is never replaced by a new order
  const nOrders = () => [...db.col('pendingDeposits').keys()].length;
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, wallet: '0722222222' }); const live = r.body.depositId;
  const before = nOrders();
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, wallet: '0722222222', depositId: live, resume: true });
  ok(r.code === 200 && r.body.depositId === live && r.body.payLink, 'resume: the same order comes back with its link');
  r = await call(H['POST /deposit/manual/order'], { amount: 5000, channelId: w1, depositId: 'gone-order', resume: true });
  ok(r.code === 409 && r.body.code === 'ORDER_GONE' && nOrders() === before, 'resume of an order that is gone is refused and creates nothing');
  // wiring in the source
  const full = fs.readFileSync(__dirname + '/server.js', 'utf8');
  ok(/IMAGE_BODY_ROUTES = new Set\(\['\/admin\/pay-channels\/save'/.test(full), 'saving a Wave payment may carry a picture (the 64 KB body cap gave "La requête est trop volumineuse")');
  ok(!/wavePay/.test(full), 'there is no separate switch: Wave is the only way to recharge');
  ok(!/Telebirr|Commercial Bank|Ethiopia/i.test(block), 'no Ethiopian payment wording is left in the recharge code');
  ok(/PAYOUT_ACCOUNT_TYPES = Object\.freeze\(\{ 'Wave': 'wallet' \}\)/.test(full), 'payout accounts: Wave only');
  console.log('PASS: Wave payment channel, order and claim (' + checks + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
