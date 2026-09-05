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
    openingCountdownEnabled: false, openingCountdownAt: 0,
    autoApproveWithdrawalsEnabled: false, autoApproveIntervalSec: 10, autoApproveMaxAmount: 0,
    telegramGroup: '', telegramChannel: '', supportTelegram: '', whatsappGroup: '', whatsappContact: '',
    supportHours: '', rulesText: '', aboutText: '', brandTagline: '',
    manualPayReminderMtn: '1: Dial *165#\n2: Select 1 Send Money\n3: Select 1 Mobile User\n4: Enter number {{number}}\n5: Enter Amount {{amount}}\n6: Enter Reason\n7: Enter your PIN code',
    manualPayReminderAirtel: '',
  } },
  'GET /admin/banner': { status: 'success', image: '' },
  'GET /admin/stats': { status: 'success', stats: {
    totalUsers: 12, activeUsers: 11, bannedUsers: 1, walletTotal: 500000, depositAmount: 900000,
    withdrawAmount: 300000, investedAmount: 400000, activeInvestments: 3, pendingDepCount: 1, pendingWitCount: 2,
  } },
  'GET /admin/marzpay/balance': { status: 'success', amount: 4523891, formatted: 'UGX 4,523,891', currency: 'UGX', accountStatus: 'active' },
  'POST /admin/transactions/list': { status: 'success', transactions: [
    { id: 't1', type: 'deposit', amount: 30000, description: 'Wallet recharge', ref: 'B123', createdAt: new Date().toISOString(), userId: 'u1' },
    { id: 't2', type: 'mission_salary', amount: 750, description: 'Mission Center salary', createdAt: new Date().toISOString(), userId: 'u1' },
    { id: 't3', type: 'mission_deposit_reward', amount: 7500, description: 'Mission Center deposit reward', createdAt: new Date().toISOString(), userId: 'u1' },
  ] },
  'GET /admin/users': { status: 'success', users: [
    { id: 'u1', phone: '+256700000001', publicId: '000001', referralCode: 'abC123', walletBalance: 10000, totalInvested: 30000, totalEarned: 5000, status: 'active' },
    // A root member with no referrer -- never appears in
    // /admin/referrals/list's own rows (that list only carries people who
    // WERE referred by someone), which is exactly the real gap Round 146's
    // widened referral search closes: this user must still be findable by
    // searching their own phone/code in the Referrals tab.
    { id: 'r9', phone: '+256700000099', publicId: '000099', referralCode: 'root99', walletBalance: 0, totalInvested: 0, totalEarned: 0, status: 'active', referredBy: null, teamL1Count: 4, teamL2Count: 2, teamL3Count: 1 },
  ], count: 2 },
  'POST /admin/deposits/list': { status: 'success', deposits: [
    { id: 'dep1', userId: 'u1', accountPhone: '+256700000001', phone: '+256709998877', method: 'automatic', amount: 30000, status: 'pending', ref: 'MZ001', createdAt: new Date().toISOString() },
    { id: 'dep2', userId: 'u1', accountPhone: '+256700000001', senderPhone: '+256701112233', method: 'manual', network: 'MTN Mobile Money', assignedNumber: '+256770000001', amount: 50000, status: 'review', reviewReason: 'Multiple pending orders matched this SMS (same number + amount)', ref: 'M001', createdAt: new Date().toISOString() },
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
  'POST /admin/manual-sms-log/list': { status: 'success', rows: [
    { id: 'sms1', reason: 'unmatched', receivingNumber: '+256770000001', amount: 30000,
      sender: '+256701234567', raw: 'RECEIVED. TID 999. UGX 30,000 from 701234567, JANE.',
      device: 'Samsung SM-A047F', appVersion: '1.9', createdAt: new Date().toISOString() },
  ] },
  'POST /admin/manual-sms-log/resolve': { status: 'success' },
  'POST /admin/manual-reversals/list': { status: 'success', rows: [
    { id: 'rev1', amount: 30000, receivingNumber: '+256770000001', payerPhone: '+256700000010',
      raw: 'JOHN DOE, 256700000010 has initiated a reversal of UGX 30,000 wrongly sent to you.',
      applied: true, ambiguous: false, matchedUserId: 'u1', resolved: false, createdAt: new Date().toISOString() },
    { id: 'rev2', amount: 10000, receivingNumber: '+256770000001', payerPhone: '+256700000040',
      raw: 'SHARED PAYER, 256700000040 has initiated a reversal of UGX 10,000 wrongly sent to you.',
      applied: false, ambiguous: true, matchedUserId: null, resolved: false, createdAt: new Date().toISOString() },
  ] },
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
    ],
    unknownNumbers: [
      { number: '+256770000009', smsForwarded: 3, credited: 0, unmatched: 0, ambiguous: 0,
        mismatch: 0, duplicate: 0, unparsed: 0, ignored: 0, assigned: 0, expired: 0,
        amount: 15000, lastSeenAt: Date.now() },
    ] },
  'POST /admin/withdrawals/list': { status: 'success', counts: { pending: 1 }, payoutMode: 'automatic',
    withdrawals: [{ id: 'w1', userId: 'u1', amount: 20000, net: 17000, status: 'pending',
      phone: '+256770000000', network: 'MTN', holder: 'JOHN DOE', createdAt: new Date().toISOString() }] },
  'GET /admin/products': { status: 'success', products: [
    { key: 'qing-shuang', name: 'Snow Qing Shuang', price: 30000, cycle: 150, expectedReturn: 900000, active: true },
  ] },
  'GET /admin/promocodes/list': { status: 'success', codes: [
    { id: 'c1', code: 'AB12CDEF', minReward: 100.5, maxReward: 500.5, uses: 0, totalClaimed: 0, maxUses: 1, active: true, createdAt: new Date().toISOString() },
    { id: 'c2', code: 'ZZ99CLAIMED', minReward: 100, maxReward: 500, uses: 3, totalClaimed: 812.77, maxUses: null, active: true, createdAt: new Date().toISOString() },
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
    // Round 147: owner "l want to see numbers of his team and total
    // deposits" -- the real aggregate figure, not just level counts.
    teamDeposits: 245000,
  },
  'GET /admin/referrals/list': { status: 'success', referrals: [
    { id: 'u1', phone: '+256700000001', referrerId: 'r1', referrerCode: 'xYz789', invested: 30000, status: 'active' },
  ] },
  'POST /admin/user/detail': { status: 'success',
    user: { id: 'u1', phone: '+256700000001', publicId: '000001', referralCode: 'abC123', walletBalance: 10000,
      totalDeposited: 30000, totalInvested: 30000, totalWithdrawn: 0, totalEarned: 5000, teamCommission: 1500,
      referredBy: null, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, checkinStreak: 3, status: 'active',
      hasPayoutPin: true, registrationDone: true },
    investments: [], transactions: [], withdrawals: [], bankAccounts: [], teamDeposits: 0,
    deposits: [
      { id: 'dep1', userId: 'u1', method: 'manual', network: 'MTN Mobile Money', assignedNumber: '+256770000001', senderPhone: '+256701112233', amount: 50000, status: 'matched', createdAt: new Date().toISOString() },
      { id: 'dep2', userId: 'u1', provider: 'marzpay', phone: '+256709998877', amount: 30000, status: 'pending', createdAt: new Date().toISOString() },
    ],
    // Round 143: real per-source breakdown of totalEarned (5000 = the
    // sum of all 7 below), replacing the previously-opaque "Cashback
    // earned" figure with a labeled composition.
    earnedBreakdown: { cashback: 3000, commission: 1500, team_reward: 0, promocode: 0, checkin: 500, mission_salary: 0, mission_deposit_reward: 0 },
  },
  'POST /admin/user/reset-payout-pin': { status: 'success' },
  'POST /admin/user/reconcile-checkin': { status: 'success', before: { checkinStreak: 2 }, after: { checkinStreak: 3 }, changed: true, lastCheckin: '2026-08-26' },
  'POST /admin/user/attach-referrer': { status: 'success', commissionTriggered: false },
  'GET /admin/admins/list': { status: 'success', admins: [
    { username: 'mary', active: false, createdAt: new Date().toISOString(), lastLoginAt: null },
  ] },
  'GET /admin/audit-log': { status: 'success', log: [] },
  'POST /admin/analytics': { status: 'success', period: 30,
    kpis: {
      depositsAmount: 900000, depositsCount: 3, withdrawalsAmount: 300000, withdrawalsCount: 2,
      netFlow: 600000, totalUsers: 5, newUsers: 2, activeInvestors: 3,
      investedAmount: 400000, commissionsPaid: 20000, teamRewardsPaid: 5000,
    },
    byHour: Array.from({ length: 24 }, (_, h) => ({
      h, depAmt: h === 9 ? 900000 : 0, depCnt: h === 9 ? 3 : 0, witAmt: h === 14 ? 300000 : 0, witCnt: h === 14 ? 2 : 0,
    })),
    bands: { morning: { dep: 900000, wit: 0 }, afternoon: { dep: 0, wit: 300000 }, evening: { dep: 0, wit: 0 }, night: { dep: 0, wit: 0 } },
    byDay: [{ day: '2026-09-03', dep: 900000, wit: 300000, users: 2 }],
    peakDepositHour: 9, peakWithdrawHour: 14, busiestBand: 'morning',
    forecast: {
      withdrawals: { estimate: 300000, likelyWithdrawerCount: 1, trendReference: 300000 },
      deposits: { estimate: 400000, organicTrend: 900000, maturingReinvestEstimate: 0, maturingCount: 0, reinvestRatePct: 35, pipelineEstimate: 0, pipelineUserCount: 0, conversionRatePct: 20 },
    },
    staffApprovals: {
      byStaff: [{ actor: 'mary', approvals: 2, declines: 1, amountApproved: 100000, amountDeclined: 20000, totalHandled: 3, sharePct: 100, lastAt: Date.now() }],
      timeline: [{ actor: 'mary', action: 'approved', phone: '+256700000001', amount: 50000, at: Date.now() }],
    },
    topReferrers: [{ phone: '+256700000002', team: 3, earned: 15000 }],
    topDepositors: [{ phone: '+256700000001', amount: 900000 }],
    biggestWithdrawals: [{ phone: '+256700000003', amount: 300000 }],
  },
  'POST /admin/analytics/abuse': { status: 'success', period: 30, minCount: 3,
    repeatedFailedDeposits: [{ userId: 'u9', phone: '+256700000009', count: 4, lastAt: Date.now(), samples: [{ amount: 20000, reason: 'timeout' }] }],
    repeatedInsufficientWithdrawals: [],
    repeatedCheckinAlreadyClaimed: [],
    giftcodeGuessing: [],
  },
  'GET /admin/badges': { status: 'success', pendingWithdrawals: 2, unmatchedSms: 1 },
  'GET /admin/users/recount': { status: 'success', updated: 0 },
  'GET /admin/integrity': { status: 'success', checked: 1, mismatches: [
    { userId: 'u1', phone: '+256700000001', walletBalance: 10000, ledgerSum: 5000, diff: 5000 },
  ] },
  'POST /admin/products/clear': { status: 'success', removed: 1 },
  'POST /admin/products/sync-pricing': { status: 'success', synced: 1 },
  'POST /admin/promocodes/generate': { status: 'success', code: 'ab3Kx', minReward: 100, maxReward: 500 },
  'GET /admin/banner': { status: 'success', image: '' },
  'GET /admin/help-banner': { status: 'success', image: '' },
  'GET /admin/announcement-image': { status: 'success', image: '' },
  'GET /admin/manual-pay-images': { status: 'success', selector: '', hero: '' },
  'POST /admin/manual-pay-image/set': { status: 'success' },
  'POST /admin/manual-pay-image/clear': { status: 'success' },
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

  // Simulates a device that already had push notifications enabled in an
  // earlier session -- openShell()'s new resyncPushToken() call (fixing
  // the owner-reported duplicate-notification bug) must run against this
  // without crashing, and must not clear/corrupt an existing token just
  // because Firebase Messaging itself isn't available in this jsdom
  // harness (no `firebase` global is stubbed here at all).
  window.localStorage.setItem('snow_admin_push_token', 'existing-token-abc');

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
  if (window.localStorage.getItem('snow_admin_push_token') !== 'existing-token-abc')
    errors.push('resyncPushToken() altered/cleared an existing push token when Firebase Messaging was unavailable, instead of leaving it alone');

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

  // Round 146: owner asked to be able to search a phone number in the
  // Referrals tab and see its team + total team deposits. The referral-
  // relationship list alone (/admin/referrals/list) only ever lists
  // people who WERE referred -- a root member with their own team (like
  // the fixture's r9 above) never appears in it. The search must find
  // ANY member, not just referred ones.
  doc.querySelector('.tab[data-tab="referrals"]').click();
  await sleep(300);
  const refSearchInput = doc.getElementById('refSearch');
  if (!refSearchInput) errors.push('Referrals: search input missing');
  else {
    // No search term -- unaffected, the original relationship table.
    const unfilteredHtml = doc.getElementById('refTableWrap').innerHTML;
    if (!unfilteredHtml.includes('+256700000001') || !unfilteredHtml.includes('Referred user'))
      errors.push('Referrals: default (no-search) relationship table missing/wrong');
    if (unfilteredHtml.includes('+256700000099'))
      errors.push('Referrals: the root fixture user should not appear in the default relationship table (they were never referred)');

    // Search by the ROOT user's own phone -- someone with no referrer at
    // all, invisible to the old referred-only search.
    refSearchInput.value = '256700000099';
    refSearchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(150);
    const rootSearchHtml = doc.getElementById('refTableWrap').innerHTML;
    if (!rootSearchHtml.includes('+256700000099')) errors.push('Referrals: searching a root (non-referred) member\'s phone found nothing');
    if (!rootSearchHtml.includes('4 / 2 / 1')) errors.push('Referrals: search result did not show the matched member\'s real Team L1/L2/L3 counts');
    const hintAfterSearch = (doc.getElementById('refSearchHint') || {}).textContent || '';
    if (!/1 match/i.test(hintAfterSearch)) errors.push('Referrals: search hint did not report exactly 1 match');

    // Search by REFERRAL CODE instead of phone -- must also work.
    refSearchInput.value = 'root99';
    refSearchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(150);
    const codeSearchHtml = doc.getElementById('refTableWrap').innerHTML;
    if (!codeSearchHtml.includes('+256700000099')) errors.push('Referrals: searching by referral code found nothing');

    // Clicking a search-result row jumps straight into the referral-chain
    // view (Round 147) -- real team member phone numbers PLUS the real
    // aggregate "Team's total deposits" figure, not the plain profile
    // modal's own counts-only summary.
    const resultRow = doc.querySelector('#refTableWrap tr[data-chain-uid]');
    if (!resultRow) errors.push('Referrals: no clickable row rendered for a real search match');
    else {
      resultRow.click();
      await sleep(250);
      const modalHtml = (doc.getElementById('modalRoot') || {}).innerHTML || '';
      if (!modalHtml.includes('Referral chain')) errors.push('Referrals: clicking a search result did not open the referral-chain view');
      if (!modalHtml.includes("Team's total deposits") || !modalHtml.includes('245,000')) errors.push('Referrals: referral-chain view is missing the real aggregate team-deposits figure');
      if (!modalHtml.includes('+256700000003')) errors.push('Referrals: referral-chain view is missing the real downline member\'s own phone number');
      const closeBtn = doc.querySelector('.modal-close');
      if (closeBtn) closeBtn.click();
      await sleep(100);
    }

    // A query matching nobody shows a clear empty state, not a blank table.
    refSearchInput.value = 'zzz-no-such-member';
    refSearchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(150);
    const noMatchHtml = doc.getElementById('refTableWrap').innerHTML;
    if (!/no matching member/i.test(noMatchHtml)) errors.push('Referrals: an unmatched search should show a clear "no matching member" state');

    // Clear the search back out for hygiene (doesn't affect later checks,
    // but avoids leaving the tab in a searched state for anyone reading
    // logs).
    refSearchInput.value = '';
    refSearchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(100);
  }

  // Round 140: owner asked for MarzPay's own available balance on the
  // Dashboard tab -- a live external check, distinct from the DB-derived
  // "Wallet balances" stat right above it.
  doc.querySelector('.tab[data-tab="dashboard"]').click();
  await sleep(350);
  const dashHtml = doc.getElementById('content').innerHTML;
  if (!dashHtml.includes('MarzPay available balance')) errors.push('Dashboard: MarzPay balance card missing');
  if (!dashHtml.includes('4,523,891')) errors.push('Dashboard: MarzPay balance amount missing/not rendered');
  if (!dashHtml.includes('Account status: active')) errors.push('Dashboard: MarzPay account status missing');

  // MarzPay unreachable (provider down / not configured) must degrade
  // gracefully -- an error message in the card, not a broken Dashboard.
  routes['GET /admin/marzpay/balance'] = { status: 'error', message: 'The payment provider is busy right now. Please try again in a moment.' };
  doc.querySelector('.tab[data-tab="analytics"]').click();
  await sleep(150);
  doc.querySelector('.tab[data-tab="dashboard"]').click();
  await sleep(350);
  const dashHtmlDown = doc.getElementById('content').innerHTML;
  if (!dashHtmlDown.includes('payment provider is busy')) errors.push('Dashboard: MarzPay balance error state not shown when the provider is unreachable');
  if (dashHtmlDown.includes('NaN') || dashHtmlDown.includes('undefined')) errors.push('Dashboard: MarzPay balance error state leaked NaN/undefined');
  routes['GET /admin/marzpay/balance'] = { status: 'success', amount: 4523891, formatted: 'UGX 4,523,891', currency: 'UGX', accountStatus: 'active' };

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

  // Opening countdown -- new pre-launch gate toggle, sits right next to
  // Maintenance mode (owner: "just near maintenance mode").
  if (!doc.getElementById('sOpenCd')) errors.push('Settings: opening-countdown checkbox missing');
  if (!doc.getElementById('sOpenCdAt')) errors.push('Settings: opening-countdown datetime input missing');
  if (!settingsHtml.includes('Opening countdown')) errors.push('Settings: opening-countdown card missing');
  const openCdBox = doc.getElementById('sOpenCd');
  if (openCdBox) {
    openCdBox.checked = true;
    doc.getElementById('sOpenCdAt').value = '2027-01-01T09:00';
    doc.getElementById('saveRates')?.click();
    await sleep(200);
  }

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

  // Gift codes: generate one, min/max reward range (Round 137: no more
  // fixed reward -- the panel now sends minReward/maxReward).
  doc.querySelector('.tab[data-tab="promocodes"]').click();
  await sleep(200);
  const codesHtml = doc.getElementById('content').innerHTML;
  if (!codesHtml.includes('Min reward')) errors.push('Gift codes: min-reward field missing');
  if (!codesHtml.includes('Max reward')) errors.push('Gift codes: max-reward field missing');
  if (!codesHtml.includes('Expires after (seconds')) errors.push('Gift codes: seconds-based expiry field missing');
  if (!codesHtml.includes('100.50')) errors.push('Gift codes: existing code\'s reward range (min, with cents) missing');
  if (!codesHtml.includes('500.50')) errors.push('Gift codes: existing code\'s reward range (max, with cents) missing');
  // Round 139: owner asked for the total actually claimed on each code,
  // shown alongside it in the panel.
  if (!codesHtml.includes('Total claimed')) errors.push('Gift codes: Total claimed column header missing');
  if (!codesHtml.includes('Not claimed yet')) errors.push('Gift codes: unclaimed code should say "Not claimed yet", not a blank/zero cell');
  if (!codesHtml.includes('812.77')) errors.push('Gift codes: a claimed code\'s real total-claimed amount is missing');
  const cMinReward = doc.getElementById('cMinReward'), cMaxReward = doc.getElementById('cMaxReward');
  if (cMinReward && cMaxReward) {
    cMinReward.value = '100'; cMaxReward.value = '500';
    doc.getElementById('cDuration').value = '30';
    doc.getElementById('genBtn')?.click();
    await sleep(300);
    const genOut = doc.getElementById('genOut')?.innerHTML || '';
    if (!genOut.includes('a random amount between')) errors.push('Gift codes: generation confirmation should describe a random range, not a fixed amount');
    if (!genOut.includes('30 seconds')) errors.push('Gift codes: generation confirmation should show the seconds-based expiry');
  } else errors.push('Gift codes: min/max reward inputs not found for generation');

  // Users: open a user row's detail modal, exercise PIN reset + streak reconcile
  doc.querySelector('.tab[data-tab="users"]').click();
  await sleep(250);
  const userRow = doc.querySelector('#userRows tr[data-uid]');
  if (!userRow) errors.push('no user row found to open detail modal');
  else {
    userRow.click();
    await sleep(250);
    // Round 143: owner-reported "money piling up unknowingly" traced to a
    // misleading "Cashback earned" label -- now relabelled with a real,
    // server-computed per-source breakdown right underneath it.
    const modalHtml = doc.getElementById('modalRoot').innerHTML;
    if (!modalHtml.includes('Total earned (all sources)')) errors.push('User detail: relabelled "Total earned (all sources)" missing');
    if (modalHtml.includes('Cashback earned')) errors.push('User detail: old misleading "Cashback earned" label still present');
    if (!modalHtml.includes('already included above')) errors.push('User detail: Team commission is-already-included note missing');
    if (!/Investment cashback[\s\S]{0,40}3,000/.test(modalHtml)) errors.push('User detail: cashback breakdown line/amount missing');
    if (!/Referral commission[\s\S]{0,40}1,500/.test(modalHtml)) errors.push('User detail: commission breakdown line/amount missing');
    if (!/Check-in[\s\S]{0,40}500/.test(modalHtml)) errors.push('User detail: check-in breakdown line/amount missing');
    if (modalHtml.includes('NaN') || modalHtml.includes('undefined')) errors.push('User detail: NaN/undefined leaked into the earnings breakdown');
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
  // Close it -- left open otherwise, which used to give later modalRoot
  // checks (e.g. the Deposits tab's button-vs-row-click test) a false
  // positive: they'd see a modal already open from THIS click, not one
  // their own action just opened.
  doc.querySelector('.modal-close')?.click();

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
  // Owner: "let me see even user number he used to send besides account
  // and method" -- a new "Paid from" column, distinct from the account's
  // own registered phone, showing whichever field the deposit actually
  // carries (phone for automatic, senderPhone for manual). dep1 (default
  // 'pending' subtab) is the automatic-provider case.
  if (!depHtml.includes('Paid from')) errors.push('Deposits: "Paid from" column header missing');
  const depRowsInitial = doc.getElementById('depRows');
  if (!depRowsInitial || !depRowsInitial.textContent.includes('+256709998877')) errors.push('Deposits: automatic deposit\'s sender phone (fixture dep1.phone) not shown in "Paid from"');
  // Owner: "l can tap on a deposit to see user details just like those
  // when a user is tapped in user list" -- same clickable-row pattern the
  // Withdrawals tab already has. dep1's status ('pending') also renders a
  // Force-credit button in the same row, so clicking THAT specifically
  // must NOT also open the user modal underneath it.
  window.confirm = () => false; // decline the "credit this deposit?" confirm the click below triggers
  const forceCreditBtnOnRow = doc.querySelector('#depRows [data-force]');
  if (!forceCreditBtnOnRow) errors.push('Deposits: expected a Force-credit button on the pending dep1 row for this button-vs-row-click check');
  else {
    forceCreditBtnOnRow.click();
    if (doc.getElementById('modalRoot') && !doc.getElementById('modalRoot').classList.contains('hidden'))
      errors.push('Deposits: clicking the Force-credit button also opened the user-detail modal (stopPropagation missing)');
  }
  const depRow1 = doc.querySelector('#depRows tr[data-uid]');
  if (!depRow1) errors.push('Deposits: no clickable row (missing data-uid) on the pending dep1 row');
  else {
    depRow1.click();
    await sleep(150);
    const modalHtml = (doc.getElementById('modalRoot') || {}).innerHTML || '';
    if (!modalHtml.includes('abC123')) errors.push('Deposits: tapping the deposit row did not open the user-detail modal for its userId (fixture referralCode abC123 not found)');
    // Owner: "l can see people's deposits in details such that l see the
    // deposits they made and to which number and from which number at
    // what time" -- the modal's own new Deposits section, built from the
    // fixture's 2 deposits (one manual, one automatic).
    if (!modalHtml.includes('Deposits (2)')) errors.push('User-detail modal: Deposits section count missing/wrong');
    if (!modalHtml.includes('+256770000001')) errors.push('User-detail modal: manual deposit\'s "Paid to" (assignedNumber) not shown');
    if (!modalHtml.includes('+256701112233')) errors.push('User-detail modal: manual deposit\'s "Paid from" (senderPhone) not shown');
    if (!modalHtml.includes('Automatic (MarzPay)')) errors.push('User-detail modal: automatic deposit\'s "Paid to" should read "Automatic (MarzPay)" (no real admin-side number exists for that path)');
    if (!modalHtml.includes('+256709998877')) errors.push('User-detail modal: automatic deposit\'s "Paid from" (phone) not shown');
    const modalCloseBtn = doc.querySelector('.modal-close');
    if (modalCloseBtn) modalCloseBtn.click();
  }
  const reviewSubtab = doc.querySelector('[data-df="review"]');
  if (!reviewSubtab) errors.push('review subtab button not found');
  else {
    reviewSubtab.click();
    await sleep(150);
    const rows = doc.getElementById('depRows');
    if (!rows || !rows.textContent.includes('MTN Mobile Money')) errors.push('Needs Review tab does not show the manual deposit\'s network/number');
    if (!rows || !rows.textContent.includes('Multiple pending orders')) errors.push('Needs Review tab does not show the reviewReason');
    if (!rows || !rows.textContent.includes('+256701112233')) errors.push('Deposits: manual deposit\'s sender phone (fixture dep2.senderPhone) not shown in "Paid from"');
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
  // Owner: "l am trying to saved them in admin panel but they change to
  // +2567..." -- the fixture stores '+256770000001' (canonical, matching
  // what cleanPhone() actually writes); the editable input must show it
  // back in local "07..." form, never the raw +256 the server stores/
  // matches on.
  const mnNumberInput0 = doc.querySelector('[data-mn-number="0"]');
  if (!mnNumberInput0) errors.push('Settings: payment-number input missing');
  else if (mnNumberInput0.value !== '0770000001') errors.push('Settings: payment-number input shows ' + mnNumberInput0.value + ', expected local-format 0770000001');
  // Round 145: the old exclusive 3-way depMethod radio (Automatic MarzPay/
  // LipaPay/Manual) became 2 independent checkboxes (PAY A/PAY B, either
  // or both can be on at once) plus a gateway sub-radio for PAY A only.
  const depPayAOn = doc.getElementById('depPayAOn');
  const depPayBOn = doc.getElementById('depPayBOn');
  const saveDepMethodBtn = doc.getElementById('saveDepMethod');
  if (!depPayAOn || !depPayBOn || !saveDepMethodBtn) errors.push('Settings: PAY A/PAY B toggle or save button missing');
  else {
    depPayAOn.checked = false;
    depPayBOn.checked = true;
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

  // Round 102: LipaPay as a 2nd real automatic provider.
  routes['POST /admin/withdrawals/list'] = Object.assign({}, routes['POST /admin/withdrawals/list'], { payoutMode: 'lipapay' });
  doc.querySelector('.tab[data-tab="dashboard"]').click();
  await sleep(200);
  doc.querySelector('.tab[data-tab="withdrawals"]').click();
  await sleep(250);
  const witLipa = doc.getElementById('content').innerHTML;
  if (!witLipa.includes('Send via LipaPay')) errors.push('Withdrawals: lipapay mode should offer "Send via LipaPay"');
  if (witLipa.includes('Send via MarzPay')) errors.push('Withdrawals: lipapay mode should not offer "Send via MarzPay"');
  if (!doc.getElementById('witSync')) errors.push('Withdrawals: lipapay mode should still show the Sync button (it is an automatic provider too)');

  // Round 136: Space8-level analytics richness (owner: "space8 analytics
  // are not here") -- period selector, tomorrow's estimate, hourly/daily
  // charts, top referrers/depositors/biggest withdrawals, staff approvals,
  // and categorized suspicious-activity tables (owner-only).
  doc.querySelector('.tab[data-tab="analytics"]').click();
  await sleep(400);
  let an = doc.getElementById('content').innerHTML;
  if (!an.includes('30 days')) errors.push('Analytics: period selector missing');
  if (!an.includes("Tomorrow's estimate")) errors.push('Analytics: forecast card missing');
  if (!an.includes('1 plan(s) likely maturing')) errors.push('Analytics: withdrawal forecast detail missing');
  if (!an.includes('Deposits (3)')) errors.push('Analytics: deposits KPI count missing');
  if (!an.includes('Net flow')) errors.push('Analytics: net-flow KPI missing');
  if (!an.includes('Task Center rewards paid')) errors.push('Analytics: team-rewards KPI missing');
  if (!an.includes('busiest')) errors.push('Analytics: busiest time-of-day band not highlighted');
  if (!an.includes('Daily trend')) errors.push('Analytics: daily trend chart missing');
  if (!an.includes('Top referrers')) errors.push('Analytics: top referrers table missing');
  if (!an.includes('+256700000002')) errors.push('Analytics: top referrer row missing');
  if (!an.includes('Top depositors')) errors.push('Analytics: top depositors table missing');
  if (!an.includes('Biggest withdrawals')) errors.push('Analytics: biggest withdrawals table missing');
  if (!an.includes('Staff withdrawal approvals')) errors.push('Analytics: staff approvals table missing');
  if (!an.includes('mary')) errors.push('Analytics: staff approvals row missing real staff username');
  if (!an.includes('Suspicious activity')) errors.push('Analytics: owner-only suspicious-activity section missing');
  if (!an.includes('Repeated failed deposits')) errors.push('Analytics: repeated-failed-deposits table missing');
  if (!an.includes('+256700000009')) errors.push('Analytics: repeated-offender row missing');
  if (an.includes('NaN') || an.includes('undefined')) errors.push('Analytics: NaN/undefined leaked into the analytics section');
  const perBtn = [...doc.querySelectorAll('[data-per]')].find(b => b.textContent.includes('7 days'));
  if (!perBtn) errors.push('Analytics: 7-day period button missing');
  else {
    routes['POST /admin/analytics'] = Object.assign({}, routes['POST /admin/analytics'], { period: 7 });
    routes['POST /admin/analytics/abuse'] = Object.assign({}, routes['POST /admin/analytics/abuse'], { period: 7 });
    perBtn.click();
    await sleep(400);
    const an7 = doc.getElementById('content').innerHTML;
    if (!an7.includes('last 7 days')) errors.push('Analytics: switching to 7-day period did not refetch/re-render');
  }

  // Payment-number activity lives on the same Analytics tab.
  an = doc.getElementById('content').innerHTML;
  if (!an.includes('Payment number activity')) errors.push('Analytics: payment-number section missing');
  if (!an.includes('Snow MTN 1')) errors.push('Analytics: number holder name missing');
  if (!an.includes('0770000001')) errors.push('Analytics: number card shows the raw +256 form, not local 0770000001');
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
  // A number a phone reports but nobody saved must be impossible to miss.
  if (!an.includes('Messages from numbers you have not saved')) errors.push('Analytics: unknown-number warning missing');
  if (!an.includes('+256770000009')) errors.push('Analytics: unknown number itself not listed');

  // Withdrawals can be pinned independently of deposits.
  doc.querySelector('.tab[data-tab="settings"]').click();
  await sleep(300);
  const setHtml = doc.getElementById('content').innerHTML;
  if (!doc.getElementById('witMethodManual') || !doc.getElementById('witMethodMarz') || !doc.getElementById('witMethodLipa') || !doc.getElementById('witMethodFollow'))
    errors.push('Settings: withdrawal-method radios missing');
  // Round 145: PAY A/PAY B are independent checkboxes now, not a 3-way
  // exclusive radio -- MarzPay/LipaPay stay a 2-way radio, but only
  // choosing PAY A's own automatic gateway, not whether manual is on too.
  if (!doc.getElementById('depPayAOn') || !doc.getElementById('depPayBOn') || !doc.getElementById('depGatewayMarz') || !doc.getElementById('depGatewayLipa'))
    errors.push('Settings: PAY A/PAY B toggles or gateway radios missing');
  if (!setHtml.includes('Follow the payment method above')) errors.push('Settings: follow option label missing');
  // Manual-pay screen images (2 independent slots) + the payment-reminder
  // templates, both new this round.
  if (!doc.getElementById('mpSelectorImgFile') || !doc.getElementById('mpHeroImgFile'))
    errors.push('Settings: manual-pay image upload inputs missing');
  const mpReminderMtn = doc.getElementById('mpReminderMtn');
  const mpReminderAirtel = doc.getElementById('mpReminderAirtel');
  if (!mpReminderMtn || !mpReminderAirtel) errors.push('Settings: payment-reminder textareas missing');
  else if (!mpReminderMtn.value.includes('Dial *165#')) errors.push('Settings: MTN reminder default not prefilled from settings fixture');
  if (!doc.getElementById('saveMpReminder')) errors.push('Settings: Save payment reminder button missing');
  else { doc.getElementById('saveMpReminder').click(); await sleep(200); }

  // The unmatched-SMS review list lives on the Deposits tab.
  doc.querySelector('.tab[data-tab="deposits"]').click();
  await sleep(400);
  const depHtml2 = doc.getElementById('content').innerHTML;
  if (!depHtml2.includes('Unmatched SMS')) errors.push('Deposits: Unmatched SMS card missing');
  if (!depHtml2.includes('+256701234567')) errors.push('Deposits: sender from the fixture not rendered');
  if (!depHtml2.includes('No pending order was waiting')) errors.push('Deposits: reason label not rendered');
  const smsResolveBtn = doc.querySelector('[data-smsresolve]');
  if (!smsResolveBtn) errors.push('Deposits: Mark resolved button missing');
  else {
    window.confirm = () => true;
    smsResolveBtn.click();
    await sleep(300);
  }
  const smsBadge = doc.getElementById('smsBadge');
  if (!smsBadge || smsBadge.classList.contains('hidden')) errors.push('Nav: Deposits unmatched-SMS badge not shown for the fixture');

  // MTN deposit-reversal fraud alerts card, same Deposits tab.
  if (!depHtml2.includes('Deposit reversal alerts')) errors.push('Deposits: reversal alerts card missing');
  if (!depHtml2.includes('Auto-debited')) errors.push('Deposits: applied-reversal outcome label not rendered');
  if (!depHtml2.includes('Matched multiple members')) errors.push('Deposits: ambiguous-reversal outcome label not rendered');
  if (!depHtml2.includes('+256700000010')) errors.push('Deposits: reversal payer phone not rendered');
  const revRow = doc.querySelector('#revAlertsWrap tr[data-uid="u1"]');
  if (!revRow) errors.push('Deposits: applied-reversal row missing its clickable data-uid');
  else {
    revRow.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(300);
    const modalHtml = doc.getElementById('modalRoot') ? doc.getElementById('modalRoot').innerHTML : '';
    if (!modalHtml || !modalHtml.includes('u1') && !modalHtml.toLowerCase().includes('user')) errors.push('Deposits: clicking a reversal-alert row did not open the user-detail modal');
    doc.querySelector('.modal-close')?.click();
    await sleep(150);
  }

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.forEach(e => console.log(' -', e));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
