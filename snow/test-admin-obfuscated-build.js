const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('admin/index.html', 'utf8');

const API_BASE = 'https://mylifeismyhappiness.onrender.com';

function mockResponse(path, body) {
  return { path, body };
}

const routes = {
  'POST /admin/check-key': { status: 'success', token: 'OWNERKEY' },
  'GET /admin/settings': { status: 'success', settings: {
    minDeposit: 30000, minWithdraw: 8000, welcomeBonus: 5000, dailyCheckin: 500,
    withdrawFeePct: 15, commL1: 27, commL2: 2, commL3: 1, returnMultiple: 30, cycleDays: 150,
    maxWithdrawalsPerDay: 2, requireInvestToWithdraw: true, maintenanceMode: false, maintenanceMsg: '',
    autoApproveWithdrawalsEnabled: false, autoApproveIntervalSec: 10, autoApproveMaxAmount: 0,
    telegramGroup: '', telegramChannel: '', supportTelegram: '', whatsappGroup: '', whatsappContact: '',
    supportHours: '', rulesText: '', aboutText: '', brandTagline: '',
  } },
  'GET /admin/banner': { status: 'success', image: '' },
  'GET /admin/stats': { status: 'success', stats: {
    totalUsers: 12, activeUsers: 11, bannedUsers: 1, walletTotal: 500000, depositAmount: 900000,
    withdrawAmount: 300000, investedAmount: 400000, activeInvestments: 3, pendingDepCount: 1, pendingWitCount: 2,
  } },
  'POST /admin/transactions/list': { status: 'success', transactions: [
    { id: 't1', type: 'deposit', amount: 30000, description: 'Wallet recharge', ref: 'B123', createdAt: new Date().toISOString(), userId: 'u1' },
  ] },
  'GET /admin/users': { status: 'success', users: [
    { id: 'u1', phone: '+256700000001', publicId: '000001', referralCode: 'abC123', walletBalance: 10000, totalInvested: 30000, totalEarned: 5000, status: 'active' },
  ], count: 1 },
  'POST /admin/deposits/list': { status: 'success', deposits: [] },
  'POST /admin/withdrawals/list': { status: 'success', withdrawals: [], counts: {} },
  'GET /admin/products': { status: 'success', products: [
    { key: 'qing-shuang', name: 'Snow Qing Shuang', price: 30000, cycle: 150, expectedReturn: 900000, active: true },
  ] },
  'GET /admin/promocodes/list': { status: 'success', codes: [] },
  'GET /admin/referrals/list': { status: 'success', referrals: [
    { id: 'u1', phone: '+256700000001', referredBy: 'xYz789', invested: 30000, status: 'active' },
  ] },
  'GET /admin/admins/list': { status: 'success', admins: [] },
  'GET /admin/audit-log': { status: 'success', log: [] },
  'POST /admin/analytics': { status: 'success', kpis: {
    depAmount: 900000, witAmount: 300000, investedAmount: 400000, commissionsPaid: 20000,
    depositsByTimeOfDay: { morning: 100000, afternoon: 200000, evening: 300000, night: 50000 },
  } },
  'POST /admin/analytics/abuse': { status: 'success', events: [] },
  'GET /admin/badges': { status: 'success', pendingWithdrawals: 2 },
  'GET /admin/users/recount': { status: 'success', updated: 0 },
  'GET /admin/integrity': { status: 'success', checked: 1, mismatches: [] },
  'POST /admin/products/clear': { status: 'success', removed: 1 },
  'POST /admin/products/sync-pricing': { status: 'success', synced: 1 },
  'POST /admin/promocodes/generate': { status: 'success', code: 'ab3Kx', reward: 5000 },
  'GET /admin/banner': { status: 'success', image: '' },
};

function routeKey(method, path) { return `${method} ${path}`; }

const dom = new JSDOM(html, {
  url: API_BASE + '/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  resources: 'usable',
  beforeParse(window) {
    // jsdom doesn't implement the Streams API / fetch Response the loader
    // IIFE needs (window.DecompressionStream / window.Response) -- bridge
    // Node's own globals in before any <script> in the page runs.
    window.DecompressionStream = DecompressionStream;
    window.Response = Response;
    window.navigator.serviceWorker = {
      register: () => Promise.reject(new Error('no sw in jsdom test')),
      addEventListener: () => {},
      controller: null,
    };
  },
});
const { window } = dom;

const errors = [];
window.onerror = (msg, src, line, col, err) => { errors.push('window.onerror: ' + msg + ' @' + line + ':' + col); };
window.addEventListener('unhandledrejection', e => { errors.push('unhandledrejection: ' + (e.reason && e.reason.stack || e.reason)); });

window.fetch = async (url, opts) => {
  opts = opts || {};
  const u = new URL(url, API_BASE);
  const method = (opts.method || 'GET').toUpperCase();
  const key = routeKey(method, u.pathname);
  if (!(key in routes)) {
    errors.push('UNMOCKED FETCH: ' + key);
    return { ok: false, status: 404, json: async () => ({ status: 'error', message: 'unmocked: ' + key }) };
  }
  const body = routes[key];
  return { ok: true, status: 200, json: async () => body };
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await sleep(300); // let the module script's DecompressionStream loader + inline eval settle
  const doc = window.document;

  // Log in as owner (blank username, raw key)
  const keyInput = doc.getElementById('keyInput');
  const loginBtn = doc.getElementById('loginBtn');
  if (!keyInput || !loginBtn) { errors.push('login form not found in DOM'); }
  else {
    keyInput.value = 'whatever';
    loginBtn.click();
    await sleep(400);
  }

  const shellVisible = !doc.getElementById('shell').classList.contains('hidden');
  console.log('shell visible after login:', shellVisible);
  if (!shellVisible) errors.push('shell did not become visible after login');

  const tabsToClick = ['dashboard', 'analytics', 'users', 'deposits', 'withdrawals', 'products', 'promocodes', 'transactions', 'referrals', 'settings', 'admins', 'auditlog'];
  for (const t of tabsToClick) {
    const btn = doc.querySelector(`.tab[data-tab="${t}"]`);
    if (!btn) { errors.push('tab button missing: ' + t); continue; }
    btn.click();
    await sleep(250);
    const content = doc.getElementById('content');
    const text = content ? content.textContent : '';
    console.log(`tab ${t}: content length ${text.length}, sample: ${JSON.stringify(text.slice(0, 60))}`);
  }

  // Confirm Banners tab button no longer exists at all
  const bannersBtn = doc.querySelector('.tab[data-tab="banners"]');
  if (bannersBtn) errors.push('BANNERS TAB STILL PRESENT (should be removed)');

  // Confirm Settings tab rendered the Home banner card, not the old announcement/notification cards
  doc.querySelector('.tab[data-tab="settings"]').click();
  await sleep(250);
  const settingsHtml = doc.getElementById('content').innerHTML;
  if (!settingsHtml.includes('Home banner')) errors.push('Settings: Home banner card missing');
  if (settingsHtml.includes('Send notification')) errors.push('Settings: broadcast notification card still present');
  if (settingsHtml.includes('Announcement dialog')) errors.push('Settings: announcement dialog card still present');
  if (settingsHtml.includes('Restrict withdrawal request hours')) errors.push('Settings: withdrawal-hours block still present');

  window.confirm = () => true;
  window.prompt = () => null;

  // Products: Clear all + Sync pricing
  doc.querySelector('.tab[data-tab="products"]').click();
  await sleep(200);
  doc.getElementById('clearProd')?.click();
  await sleep(200);
  doc.getElementById('syncProdPricing')?.click();
  await sleep(200);

  // Users: Recalculate totals + Integrity audit
  doc.querySelector('.tab[data-tab="users"]').click();
  await sleep(200);
  doc.getElementById('recountBtn')?.click();
  await sleep(200);
  doc.getElementById('auditBtn')?.click();
  await sleep(200);

  // Gift codes: generate one
  doc.querySelector('.tab[data-tab="promocodes"]').click();
  await sleep(200);
  const cReward = doc.getElementById('cReward');
  if (cReward) { cReward.value = '5000'; doc.getElementById('genBtn')?.click(); await sleep(300); }

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.forEach(e => console.log(' -', e));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
