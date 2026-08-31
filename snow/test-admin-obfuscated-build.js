const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('admin/index.html', 'utf8');

const API_BASE = 'https://mylifeismyhappiness.onrender.com';

function mockResponse(path, body) {
  return { path, body };
}

const routes = {
  'POST /admin/check-key': { status: 'success', token: 'OWNERKEY', username: 'owner', role: 'owner' },
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
    { id: 't2', type: 'mission_salary', amount: 750, description: 'Mission Center salary', createdAt: new Date().toISOString(), userId: 'u1' },
    { id: 't3', type: 'mission_deposit_reward', amount: 7500, description: 'Mission Center deposit reward', createdAt: new Date().toISOString(), userId: 'u1' },
  ] },
  'GET /admin/users': { status: 'success', users: [
    { id: 'u1', phone: '+256700000001', publicId: '000001', referralCode: 'abC123', walletBalance: 10000, totalInvested: 30000, totalEarned: 5000, status: 'active' },
  ], count: 1 },
  'POST /admin/deposits/list': { status: 'success', deposits: [
    { id: 'dep1', userId: 'u1', accountPhone: '+256700000001', method: 'automatic', amount: 30000, status: 'pending', ref: 'MZ001', createdAt: new Date().toISOString() },
    { id: 'dep2', userId: 'u1', accountPhone: '+256700000001', method: 'manual', network: 'MTN Mobile Money', assignedNumber: '+256770000001', amount: 50000, status: 'review', reviewReason: 'Multiple pending orders matched this SMS (same number + amount)', ref: 'M001', createdAt: new Date().toISOString() },
  ], counts: {}, processedByDay: [], processedAmount: 0 },
  'POST /admin/deposit/force-credit': { status: 'success', message: 'Force-credited UGX 50,000 to the user' },
  'POST /admin/deposit/manual/reject': { status: 'success' },
  'POST /admin/manual-numbers/list': { status: 'success', numbers: [
    { id: 'm1', network: 'MTN Mobile Money', number: '+256770000001', holderName: 'Snow MTN 1', active: true, order: 1 },
    { id: 'm2', network: 'Airtel Money', number: '+256750000001', holderName: 'Snow Airtel 1', active: true, order: 1 },
  ] },
  'POST /admin/manual-numbers/save': { status: 'success' },
  'POST /admin/manual-numbers/delete': { status: 'success' },
  'POST /admin/settings/update': { status: 'success' },
  'POST /admin/manual-numbers/analytics': { status: 'success', days: 14,
    totals: { smsForwarded: 12, credited: 9, unmatched: 2, ambiguous: 0, mismatch: 1, duplicate: 0,
      unparsed: 0, ignored: 0, assigned: 11, expired: 2, amount: 450000, deliveryMsSum: 9000,
      deliverySamples: 12, deliveryMsMax: 4200, realMoneySms: 12, successRate: 75,
      avgDeliveryMs: 750, numbersOnline: 1, numbersTotal: 2 },
    numbers: [
      { id: 'm1', number: '+256770000001', holderName: 'Snow MTN 1', network: 'MTN Mobile Money',
        active: true, health: 'healthy', healthLabel: 'Online', lastSeenAt: Date.now(),
        lastHeartbeatAt: Date.now(), lastSmsAt: Date.now(), device: 'Samsung SM-A047F',
        appVersion: '1.6', forwardingActive: true, battery: 73,
        smsForwarded: 12, credited: 9, unmatched: 2, ambiguous: 0, mismatch: 1, duplicate: 0,
        unparsed: 0, ignored: 0, assigned: 11, expired: 2, amount: 450000,
        realMoneySms: 12, successRate: 75, fillRate: 81.8, avgDeliveryMs: 750, maxDeliveryMs: 4200,
        daily: [{ day: '2026-08-31', smsForwarded: 12, credited: 9, unmatched: 2, ambiguous: 0,
          mismatch: 1, duplicate: 0, unparsed: 0, assigned: 11, expired: 2, amount: 450000,
          avgDeliveryMs: 750, maxDeliveryMs: 4200 }] },
      { id: 'm2', number: '+256750000001', holderName: 'Snow Airtel 1', network: 'Airtel Money',
        active: true, health: 'offline', healthLabel: 'Offline', lastSeenAt: null,
        lastHeartbeatAt: null, lastSmsAt: null, device: '', appVersion: '', forwardingActive: false,
        battery: null, smsForwarded: 0, credited: 0, unmatched: 0, ambiguous: 0, mismatch: 0,
        duplicate: 0, unparsed: 0, ignored: 0, assigned: 0, expired: 0, amount: 0,
        realMoneySms: 0, successRate: null, fillRate: null, avgDeliveryMs: null, maxDeliveryMs: null,
        daily: [] },
    ] },
  'POST /admin/withdrawals/list': { status: 'success', counts: { pending: 1 }, payoutMode: 'automatic',
    withdrawals: [{ id: 'w1', userId: 'u1', amount: 20000, net: 17000, status: 'pending',
      phone: '+256770000000', network: 'MTN', holder: 'JOHN DOE', createdAt: new Date().toISOString() }] },
  'GET /admin/products': { status: 'success', products: [
    { key: 'qing-shuang', name: 'Snow Qing Shuang', price: 30000, cycle: 150, expectedReturn: 900000, active: true },
  ] },
  'GET /admin/promocodes/list': { status: 'success', codes: [
    { id: 'c1', code: 'AB12CDEF', reward: 5000, uses: 0, maxUses: 1, active: true, createdAt: new Date().toISOString() },
  ] },
  'POST /admin/user/referral-chain': { status: 'success',
    user: { id: 'u1', phone: '+256700000001', referralCode: 'abC123', status: 'active', totalInvested: 30000 },
    root: { id: 'r0', phone: '+256700000099', referralCode: 'root99', status: 'active', totalInvested: 0 },
    upline: [
      { id: 'r1', phone: '+256700000002', referralCode: 'xYz789', status: 'active', totalInvested: 50000 },
      { id: 'r0', phone: '+256700000099', referralCode: 'root99', status: 'active', totalInvested: 0 },
    ],
    cycleDetected: false,
    downline: [
      { id: 'd1', phone: '+256700000003', referralCode: 'dn0001', status: 'active', totalInvested: 10000, level: 1, referredBy: 'u1' },
    ],
    downlineCountByLevel: { 1: 1 },
    downlineTruncated: false,
  },
  'GET /admin/referrals/list': { status: 'success', referrals: [
    { id: 'u1', phone: '+256700000001', referrerId: 'r1', referrerCode: 'xYz789', invested: 30000, status: 'active' },
  ] },
  'POST /admin/user/detail': { status: 'success',
    user: { id: 'u1', phone: '+256700000001', publicId: '000001', referralCode: 'abC123', walletBalance: 10000,
      totalDeposited: 30000, totalInvested: 30000, totalWithdrawn: 0, totalEarned: 5000, teamCommission: 0,
      referredBy: null, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, checkinStreak: 3, status: 'active',
      hasPayoutPin: true, registrationDone: true },
    investments: [], transactions: [], withdrawals: [], bankAccounts: [], teamDeposits: 0,
  },
  'POST /admin/user/reset-payout-pin': { status: 'success' },
  'POST /admin/user/reconcile-checkin': { status: 'success', before: { checkinStreak: 2 }, after: { checkinStreak: 3 }, changed: true, lastCheckin: '2026-08-26' },
  'POST /admin/user/attach-referrer': { status: 'success', commissionTriggered: false },
  'GET /admin/admins/list': { status: 'success', admins: [
    { username: 'mary', active: false, createdAt: new Date().toISOString(), lastLoginAt: null },
  ] },
  'GET /admin/audit-log': { status: 'success', log: [] },
  'POST /admin/analytics': { status: 'success', kpis: {
    depAmount: 900000, witAmount: 300000, investedAmount: 400000, commissionsPaid: 20000,
    depositsByTimeOfDay: { morning: 100000, afternoon: 200000, evening: 300000, night: 50000 },
  } },
  'POST /admin/analytics/abuse': { status: 'success', events: [] },
  'GET /admin/badges': { status: 'success', pendingWithdrawals: 2 },
  'GET /admin/users/recount': { status: 'success', updated: 0 },
  'GET /admin/integrity': { status: 'success', checked: 1, mismatches: [
    { userId: 'u1', phone: '+256700000001', walletBalance: 10000, ledgerSum: 5000, diff: 5000 },
  ] },
  'POST /admin/products/clear': { status: 'success', removed: 1 },
  'POST /admin/products/sync-pricing': { status: 'success', synced: 1 },
  'POST /admin/promocodes/generate': { status: 'success', code: 'ab3Kx', reward: 5000 },
  'GET /admin/banner': { status: 'success', image: '' },
  'GET /admin/help-banner': { status: 'success', image: '' },
  'GET /admin/announcement-image': { status: 'success', image: '' },
  'GET /admin/about-content': { status: 'success', blocks: [] },
  'GET /admin/push/list': { status: 'success', count: 0 },
  'POST /admin/promocodes/deactivate': { status: 'success' },
  'POST /admin/admins/reactivate': { status: 'success' },
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

  // Users: open a user row's detail modal, exercise PIN reset + streak reconcile
  doc.querySelector('.tab[data-tab="users"]').click();
  await sleep(250);
  const userRow = doc.querySelector('#userRows tr[data-uid]');
  if (!userRow) errors.push('no user row found to open detail modal');
  else {
    userRow.click();
    await sleep(250);
    const pinInput = doc.getElementById('pinNew');
    if (!pinInput) errors.push('pinNew input not found in user detail modal');
    else {
      pinInput.value = '13579';
      doc.getElementById('resetPinBtn')?.click();
      await sleep(250);
    }
  }
  // Re-open (modal closes itself on success) to test reconcile-streak
  const userRow2 = doc.querySelector('#userRows tr[data-uid]');
  if (userRow2) {
    userRow2.click();
    await sleep(250);
    doc.getElementById('reconcileStreakBtn')?.click();
    await sleep(250);
  }
  // Re-open once more to test attach-referrer (fixture has referredBy:null)
  const userRow3 = doc.querySelector('#userRows tr[data-uid]');
  if (userRow3) {
    userRow3.click();
    await sleep(250);
    const attachCode = doc.getElementById('attachRefCode');
    if (!attachCode) errors.push('attachRefCode input not found (expected since referredBy is null)');
    else { attachCode.value = 'xYz789'; doc.getElementById('attachRefBtn')?.click(); await sleep(250); }
  }
  // Re-open once more to test the new "View referral chain" tool (full
  // upline-to-root + downline, distinct from the L1/L2/L3 team counts)
  const userRow4 = doc.querySelector('#userRows tr[data-uid]');
  if (userRow4) {
    userRow4.click();
    await sleep(250);
    const chainBtn = doc.getElementById('viewChainBtn');
    if (!chainBtn) errors.push('viewChainBtn not found in user detail modal');
    else {
      chainBtn.click();
      await sleep(250);
      const modalText = doc.getElementById('modalRoot')?.textContent || '';
      if (!modalText.includes('Referral chain')) errors.push('referral chain modal did not render (no "Referral chain" heading)');
      if (!modalText.includes('root99')) errors.push('referral chain modal missing root referral code from fixture');
      if (!modalText.includes('dn0001')) errors.push('referral chain modal missing downline entry from fixture');
      // Clicking a downline row should navigate back into that person's own detail modal.
      const downlineRow = doc.querySelector('#modalRoot [data-uid="d1"]');
      if (!downlineRow) errors.push('downline row for d1 not found/clickable in chain modal');
      else {
        downlineRow.click();
        await sleep(250);
        if (!doc.getElementById('viewChainBtn')) errors.push('clicking a downline row did not open that user\'s own detail modal');
      }
    }
  }
  // Integrity audit's "Open user" link on a mismatch row
  doc.querySelector('.tab[data-tab="users"]').click();
  await sleep(200);
  doc.getElementById('auditBtn')?.click();
  await sleep(250);
  const openUserBtn = doc.querySelector('[data-openuser]');
  if (openUserBtn) { openUserBtn.click(); await sleep(200); }

  // ── Round 60 findings ──
  let confirmCalls = [];
  window.confirm = (msg) => { confirmCalls.push(msg); return true; };

  // Push tooltip no longer claims a nonexistent one-tap Approve action
  const pushBtn = doc.getElementById('pushBtn');
  if (!pushBtn) errors.push('pushBtn not found');
  else if (/one-tap/i.test(pushBtn.title)) errors.push('pushBtn tooltip still claims a one-tap Approve action: ' + pushBtn.title);

  // Auto-approve wording no longer overstates per-request spacing
  doc.querySelector('.tab[data-tab="settings"]').click();
  await sleep(200);
  const settingsHtml2 = doc.getElementById('content').innerHTML;
  if (/spaced by the same interval/i.test(settingsHtml2)) errors.push('Auto-approve copy still claims requests are spaced by the interval');
  if (!/back-to-back/i.test(settingsHtml2)) errors.push('Auto-approve copy missing the corrected back-to-back wording');

  // Gift codes: Deactivate now confirms
  doc.querySelector('.tab[data-tab="promocodes"]').click();
  await sleep(200);
  const offBtn = doc.querySelector('[data-off]');
  if (!offBtn) errors.push('no gift-code Deactivate button found (fixture should have produced one)');
  else {
    confirmCalls = [];
    offBtn.click();
    await sleep(200);
    if (confirmCalls.length !== 1) errors.push('gift-code Deactivate did not prompt confirm() exactly once: ' + confirmCalls.length);
  }

  // Admins: Reactivate now confirms
  doc.querySelector('.tab[data-tab="admins"]').click();
  await sleep(200);
  const reactBtn = doc.querySelector('[data-react]');
  if (!reactBtn) errors.push('no admin Reactivate button found (fixture should have produced one)');
  else {
    confirmCalls = [];
    reactBtn.click();
    await sleep(200);
    if (confirmCalls.length !== 1) errors.push('admin Reactivate did not prompt confirm() exactly once: ' + confirmCalls.length);
  }

  // TX_LABELS covers Mission Center transaction types (rendered, not just present in source)
  doc.querySelector('.tab[data-tab="transactions"]').click();
  await sleep(250);
  const txHtml = doc.getElementById('content').innerHTML;
  if (!txHtml.includes('Mission Center salary')) errors.push('Transactions tab does not render the mission_salary label');
  if (!txHtml.includes('Mission Center deposit reward')) errors.push('Transactions tab does not render the mission_deposit_reward label');
  if (/\bmission_salary\b/.test(txHtml) || /\bmission_deposit_reward\b/.test(txHtml)) errors.push('Transactions tab fell through to the raw type string instead of a label');

  // ── Manual deposits: Deposits tab Method column + Needs Review queue ──
  doc.querySelector('.tab[data-tab="deposits"]').click();
  await sleep(250);
  const depHtml = doc.getElementById('content').innerHTML;
  if (!depHtml.includes('Needs Review')) errors.push('Deposits tab missing the Needs Review subtab');
  const reviewSubtab = doc.querySelector('[data-df="review"]');
  if (!reviewSubtab) errors.push('review subtab button not found');
  else {
    reviewSubtab.click();
    await sleep(150);
    const rows = doc.getElementById('depRows');
    if (!rows || !rows.textContent.includes('MTN Mobile Money')) errors.push('Needs Review tab does not show the manual deposit\'s network/number');
    if (!rows || !rows.textContent.includes('Multiple pending orders')) errors.push('Needs Review tab does not show the reviewReason');
    const approveBtn = doc.querySelector('[data-force]');
    const rejectBtn = doc.querySelector('[data-mreject]');
    if (!approveBtn) errors.push('Approve button missing on a review-status manual deposit');
    else if (approveBtn.textContent !== 'Approve') errors.push('review-status deposit button should read "Approve", got: ' + approveBtn.textContent);
    if (!rejectBtn) errors.push('Reject button missing on a review-status manual deposit');
    else {
      window.confirm = () => true;
      rejectBtn.click();
      await sleep(200);
    }
  }

  // ── Settings: Manual payments section (deposit-method toggle + numbers CRUD) ──
  doc.querySelector('.tab[data-tab="settings"]').click();
  await sleep(250);
  const settingsHtml3 = doc.getElementById('content').innerHTML;
  if (!settingsHtml3.includes('Manual payments')) errors.push('Settings: Manual payments section missing');
  if (!settingsHtml3.includes('Payment numbers')) errors.push('Settings: Payment numbers card missing');
  if (!settingsHtml3.includes('Snow MTN 1') || !settingsHtml3.includes('Snow Airtel 1')) errors.push('Settings: payment numbers from fixture not rendered');
  const depMethodManualRadio = doc.getElementById('depMethodManual');
  const saveDepMethodBtn = doc.getElementById('saveDepMethod');
  if (!depMethodManualRadio || !saveDepMethodBtn) errors.push('Settings: deposit-method radio/save button missing');
  else {
    depMethodManualRadio.checked = true;
    saveDepMethodBtn.click();
    await sleep(200);
  }
  const mnSaveBtn = doc.querySelector('[data-mn-save="0"]');
  if (!mnSaveBtn) errors.push('Settings: no per-number Save button found');
  else {
    mnSaveBtn.click();
    await sleep(250);
  }
  const mnAddBtn = doc.getElementById('mnAddBtn');
  if (!mnAddBtn) errors.push('Settings: Add payment number button missing');
  else {
    const before = doc.querySelectorAll('#manualNumbersList .panel-card').length;
    mnAddBtn.click();
    const after = doc.querySelectorAll('#manualNumbersList .panel-card').length;
    if (after !== before + 1) errors.push('Add payment number did not append a new editable row');
  }
  const mnDelBtn = doc.querySelector('[data-mn-del]');
  if (!mnDelBtn) errors.push('Settings: no per-number Delete button found for an existing (saved) number');
  else {
    window.confirm = () => true;
    mnDelBtn.click();
    await sleep(250);
  }

  // Manual payouts: the same tab must stop offering to send through MarzPay
  // and start asking the admin to record a payment they already made.
  doc.querySelector('.tab[data-tab="withdrawals"]').click();
  await sleep(250);
  const witAuto = doc.getElementById('content').innerHTML;
  if (!witAuto.includes('Send via MarzPay')) errors.push('Withdrawals: automatic mode should offer "Send via MarzPay"');
  if (!doc.getElementById('witSync')) errors.push('Withdrawals: automatic mode should show the Sync MarzPay button');

  routes['POST /admin/withdrawals/list'] = Object.assign({}, routes['POST /admin/withdrawals/list'], { payoutMode: 'manual' });
  doc.querySelector('.tab[data-tab="dashboard"]').click();
  await sleep(200);
  doc.querySelector('.tab[data-tab="withdrawals"]').click();
  await sleep(250);
  const witManual = doc.getElementById('content').innerHTML;
  if (!witManual.includes('Mark as paid')) errors.push('Withdrawals: manual mode should offer "Mark as paid"');
  if (witManual.includes('Send via MarzPay')) errors.push('Withdrawals: manual mode still offers "Send via MarzPay"');
  if (!witManual.includes('Payments are set to Manual')) errors.push('Withdrawals: manual-mode explanation missing');
  if (doc.getElementById('witSync')) errors.push('Withdrawals: manual mode should not show the Sync MarzPay button');

  // Payment-number activity lives on the Analytics tab.
  doc.querySelector('.tab[data-tab="analytics"]').click();
  await sleep(400);
  const an = doc.getElementById('content').innerHTML;
  if (!an.includes('Payment number activity')) errors.push('Analytics: payment-number section missing');
  if (!an.includes('Snow MTN 1')) errors.push('Analytics: number holder name missing');
  if (!an.includes('Samsung SM-A047F')) errors.push('Analytics: device name missing');
  if (!an.includes('75%')) errors.push('Analytics: success rate missing');
  if (!an.includes('Online')) errors.push('Analytics: health pill missing');
  if (!an.includes('Offline')) errors.push('Analytics: offline number not shown');
  if (an.includes('NaN') || an.includes('undefined')) errors.push('Analytics: NaN/undefined leaked into the numbers section');
  const dayToggle = doc.querySelector('[data-numtoggle]');
  if (!dayToggle) errors.push('Analytics: daily-breakdown toggle missing');
  else {
    dayToggle.click();
    await sleep(400);
    const opened = doc.getElementById('content').innerHTML;
    if (!opened.includes('Hide daily breakdown')) errors.push('Analytics: daily breakdown did not expand');
  }
  if (!doc.getElementById('numDays')) errors.push('Analytics: day-range selector missing');

  // Withdrawals can be pinned independently of deposits.
  doc.querySelector('.tab[data-tab="settings"]').click();
  await sleep(300);
  const setHtml = doc.getElementById('content').innerHTML;
  if (!doc.getElementById('witMethodManual') || !doc.getElementById('witMethodAuto') || !doc.getElementById('witMethodFollow'))
    errors.push('Settings: withdrawal-method radios missing');
  if (!setHtml.includes('Follow the payment method above')) errors.push('Settings: follow option label missing');

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.forEach(e => console.log(' -', e));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
