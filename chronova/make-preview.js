// Dev-only: renders the REAL screen code against fixture data so the UI can be
// screenshotted in a sandbox with no network (Firebase's CDN import and the
// Render backend are both unreachable here). Not shipped — dist/ never sees it.
const fs = require('fs');

const FIREBASE_STUB = `
// ── preview stubs (no network in the sandbox) ──
const initializeApp = () => ({}), getApps = () => [];
const getAuth = () => ({ currentUser: null });
const createUserWithEmailAndPassword = async () => ({});
const signInWithEmailAndPassword = async () => ({});
const signInWithCustomToken = async () => ({});
const onAuthStateChanged = () => {};
const signOut = async () => {};
const updatePassword = async () => {};
const reauthenticateWithCredential = async () => {};
const EmailAuthProvider = { credential: () => ({}) };
`;

// 1x1 solid PNGs stand in for uploaded banners; object-fit stretches them.
const PNG_GOLD = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mM4rc/wHwAFRQKPGZOTAwAAAABJRU5ErkJggg==';

const PRODUCTS = [
  { key: 'casio',    label: 'Casio Edifice',      price: 25000,  expectedReturn: 750000,   cycle: 120, image: '' },
  { key: 'fossil',   label: 'Fossil Grant',       price: 50000,  expectedReturn: 1500000,  cycle: 120, image: '' },
  { key: 'tissot',   label: 'Tissot Le Locle',    price: 80000,  expectedReturn: 2400000,  cycle: 120, image: '' },
  { key: 'longines', label: 'Longines Master',    price: 150000, expectedReturn: 4500000,  cycle: 120, image: '' },
  { key: 'omega',    label: 'Omega Seamaster',    price: 200000, expectedReturn: 6000000,  cycle: 120, image: '' },
  { key: 'patek',    label: 'Patek Calatrava',    price: 500000, expectedReturn: 15000000, cycle: 120, image: '' },
];

const FIXTURES = `
// ── preview fixtures ──
api = async (path) => {
  if (path === '/settings/public') return { status: 'success', ...window.__PV.settings };
  if (path === '/products')        return { status: 'success', products: window.__PV.products };
  if (path === '/account/deposits')    return { status: 'success', deposits: window.__PV.deposits };
  if (path === '/account/withdrawals') return { status: 'success', withdrawals: window.__PV.withdrawals };
  if (path === '/account/transactions') return { status: 'success', transactions: window.__PV.txns };
  if (path === '/team/members') return { status: 'success', members: window.__PV.members };
  if (path === '/team/stats') return { status: 'success', ...window.__PV.teamStats };
  if (path === '/team/milestone/claim') return { status: 'success', amount: 25000, message: 'UGX 25,000 added to your wallet' };
  return { status: 'success' };
};
window.__PV = {
  settings: {
    minDeposit: 25000, minWithdrawal: 10000, liquidityFee: 0.17, checkinBonus: 500,
    commL1: 0.30, commL2: 0.03, commL3: 0.01,
    telegramGroup: 'https://t.me/chronova', telegramChannel: 'https://t.me/chronova_news',
    supportTelegram: 'https://t.me/chronova_help', supportHours: 'Every day, 9:00 AM – 9:00 PM',
    banners: { checkin: '${PNG_GOLD}', checkinBg: '${PNG_GOLD}', gift: '${PNG_GOLD}' },
    announcement: { enabled: true, title: 'Notice',
      body: 'Withdrawals now process automatically 7am-6pm.\\nMinimum recharge is UGX 25,000.\\nInvite friends to unlock Task Center rewards.\\nGift codes now pay a random amount.\\nContact support via WhatsApp for any issue.\\nThis sixth line should never appear.' }
  },
  products: ${JSON.stringify(PRODUCTS)},
  deposits: [
    { id: 'd1', ref: 'B2607261402110841', amount: 50000, status: 'success',    date: '07/26/2026', time: '14:02:11', phone: '0771234567', createdAt: Date.now()-3600000 },
    { id: 'd2', ref: 'B2607261348520117', amount: 25000, status: 'processing', date: '07/26/2026', time: '13:48:52', phone: '0771234567', createdAt: Date.now()-7200000 },
    { id: 'd3', ref: 'B2607250911040396', amount: 80000, status: 'failed',     date: '07/25/2026', time: '09:11:04', phone: '0700998877', createdAt: Date.now()-90000000 },
  ],
  withdrawals: [
    { id: 'w1', ref: 'B2607251820330574', amount: 100000, netAmount: 83000, status: 'success',    date: '07/25/2026', time: '18:20:33', phone: '0771234567', createdAt: Date.now()-100000000 },
    { id: 'w2', ref: 'B2607261105190238', amount: 20000,  netAmount: 16600, status: 'processing', date: '07/26/2026', time: '11:05:19', phone: '0771234567', createdAt: Date.now()-50000000 },
  ],
};
_publicSettings = window.__PV.settings;
_products = window.__PV.products;
_deposits = window.__PV.deposits;
_withdrawals = window.__PV.withdrawals;
_account = {
  name: 'Mangalita N.', phone: '+256771234567', username: 'mangalita',
  walletBalance: 137500, totalEarned: 106600, totalWithdrawn: 24000,
  totalInvested: 75000, totalDeposited: 155000,
  bankAccounts: [{ network: 'MTN', holderName: 'MANGALITA N.', phone: '769123158' }],
  lastCheckinDate: null,
};
_investments = [
  { id: 'i1', tierKey: 'tissot', tierLabel: 'Tissot Le Locle', amount: 80000, expectedReturn: 2400000, cycle: 120,
    dailyPayout: 20000, payoutsMade: 3, payoutsTotal: 120, paidOut: 60000, status: 'active',
    createdAt: Date.now() - 3 * 86400000 },
];
window.__PV.txns = [
  { type: 'commission',  amount: 15000, status: 'success', date: '07/26/2026', time: '14:02', level: 1, createdAt: Date.now() - 3600000 },
  { type: 'checkin',     amount: 500,   status: 'success', date: '07/26/2026', time: '08:15', createdAt: Date.now() - 7200000 },
  { type: 'gem_payout',  amount: 20000, status: 'success', date: '07/26/2026', time: '09:55', createdAt: Date.now() - 9000000 },
];
_txns = window.__PV.txns;
window.__PV.members = [
  { name: 'oTpi8g', phone: '256771234567', hasInvested: true,  deposited: 150000 },
  { name: 'k9Rmzc', phone: '256700998877', hasInvested: false, deposited: 0 },
];
_members = window.__PV.members;
// 12 active referrals: the 5-target is claimed, the 10-target is reached but
// not yet claimed (shows an active Claim button), everything past that is locked.
window.__PV.teamStats = {
  l1ActiveCount: 12, l1DepositTotal: 12,
  milestones: [
    { target: 5,   reward: 10000,   current: 12, achieved: true,  claimed: true  },
    { target: 10,  reward: 25000,   current: 12, achieved: true,  claimed: false },
    { target: 20,  reward: 50000,   current: 12, achieved: false, claimed: false },
    { target: 50,  reward: 120000,  current: 12, achieved: false, claimed: false },
    { target: 100, reward: 250000,  current: 12, achieved: false, claimed: false },
    { target: 200, reward: 600000,  current: 12, achieved: false, claimed: false },
    { target: 500, reward: 2000000, current: 12, achieved: false, claimed: false },
  ],
  counts: { l1: 12, l2: 3, l3: 1 },
  earned: { l1: 45000, l2: 6000, l3: 500, commissions: 51500, teamRewards: 10000 },
};
window.__render = (tab) => {
  _booting = false;
  showView('main');
  _activeTab = tab || 'home';
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + _activeTab));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
  renderHome(); renderProducts(); renderTeam(); renderAccount();
};
window.__open = (what) => {
  if (what === 'recharge') return openRechargeSheet();
  if (what === 'withdraw') return openWithdrawSheet();
  if (what === 'records')  return openRecordsPage('deposits');
  if (what === 'wrecords') return openRecordsPage('withdrawals');
  if (what === 'checkin')  return openCheckinPage();
  if (what === 'contact')  return openContactPage();
  if (what === 'mine')     return openHoldingsModal();
  if (what === 'detail')   return confirmBuy('tissot');
  if (what === 'bank')     return openBanksModal();
  if (what === 'picker')   { openBanksModal(); setTimeout(()=>document.getElementById('bkNet').click(), 60); }
  if (what === 'toast')    return toast('Coming soon');
  if (what === 'gift')     return openRedeemModal();
  if (what === 'booting')  { _booting = true; render(); }
  if (what === 'income')   return openRecordsPage('income');
  if (what === 'teammembers') return openTeamMembersModal();
  if (what === 'loginok') return toast('Login successful', true);
  if (what === 'taskcenter') return openTaskCenterPage();
  if (what === 'announcement') return maybeShowAnnouncement();
};
// Simulates the very first frame after launch: signed in, nothing loaded yet.
window.__empty = () => {
  _account = null; _investments = []; window.__PV.txns = []; _products = [];
  _teamStats = null; _deposits = []; _withdrawals = []; _publicSettings = null;
  showView('main');
  render();
  _activeTab = 'home';
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-home'));
};
document.dispatchEvent(new Event('preview-ready'));
`;

let core = fs.readFileSync('original_module.js', 'utf8');
// swap the two CDN imports for local stubs
core = core.replace(/^import[\s\S]*?firebase-auth\.js';\n/m, FIREBASE_STUB);
core += '\n' + FIXTURES;
fs.writeFileSync('preview-core.js', core);

let html = fs.readFileSync('index.html', 'utf8').split('\n');
html.splice(3, 1);                                    // drop the guard line
let s = html.join('\n');
s = s.replace(/<script data-nx-core>[\s\S]*?<\/script>/,
              '<script type="module" src="preview-core.js"></script>');
fs.writeFileSync('preview.html', s);
console.log('preview.html + preview-core.js written');
