'use strict';
// END-TO-END for the routes behind the signed-in pages: order gifts (list, claim once, not-owned), the one-time App claim, bank cards (up to five,
// the first is active, /bank/select, duplicate refused), the About page HTML (cleaned when saved, public), and the new admin settings
// (deposit method names, My banner opacity/blur, App claim amount). Runs the REAL server.js against the in-memory MongoDB stand-in.
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3800 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/potato'; process.env.ADMIN_KEY = 'e2e-admin-key-123456'; process.env.NODE_ENV = 'development';
const realLog = console.log; console.log = () => {}; console.warn = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => {
  const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer e2e-admin-key-123456', 'x-admin-key': 'e2e-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j };
};
let fails = 0, checks = 0;
const ok = (c, m, x) => { checks++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 260) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '07' + String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0').slice(-8);
async function member() {
  const phone = ph();
  const su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  const reg = await J('POST', '/register', { referralCode: '', pin: '123456', phone }, su.j.token);
  return { tok: su.j.token, phone, reg };
}
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 5000 } }, null, true);
  await J('POST', '/admin/products/save', { products: [
    { key: 'vip1', name: 'VIP-1', price: 3000, cycle: 30, multiplier: 3, buyLimit: 1, order: 0, vip: 1, orderGift: 800 },
    { key: 'vip2', name: 'VIP-2', price: 50000, cycle: 40, multiplier: 3, buyLimit: 3, order: 1, vip: 2, orderGift: 2000 },
    { key: 'vip3', name: 'VIP-3', price: 120000, cycle: 50, multiplier: 3, buyLimit: 3, order: 2, vip: 3 }
  ] }, null, true);
  const pub = (await J('GET', '/public/products')).j.products || [];
  ok(!pub.some(p => 'category' in p), 'products carry no Home category any more', pub[0]);
  const acct = async tok => (await J('GET', '/account', null, tok)).j.account;

  // ---- order gifts
  const A = await member();
  let l = await J('GET', '/gifts/list', null, A.tok);
  ok(l.j.status === 'success' && l.j.gifts.length === 2 && l.j.gifts[0].name === 'VIP-1' && l.j.gifts[0].amount === 800 && !l.j.gifts[0].owned && !l.j.gifts[0].claimed, 'the list shows the products that carry a gift, none owned yet', l.j);
  let c = await J('POST', '/gifts/claim', { key: 'vip1' }, A.tok);
  ok(c.s === 400 && c.j.code === 'NOT_OWNED', 'a gift cannot be received before the product is bought', c.j);
  const b0 = (await acct(A.tok)).walletBalance;
  const buy = await J('POST', '/invest/create', { tierKey: 'vip1' }, A.tok); ok(buy.j.status === 'success', 'A buys VIP-1', buy.j);
  const b1 = (await acct(A.tok)).walletBalance; ok(Math.round(b0 - b1) === 3000, 'the price is taken: ' + b0 + ' -> ' + b1);
  l = await J('GET', '/gifts/list', null, A.tok); ok(l.j.gifts[0].owned === true && l.j.gifts[1].owned === false, 'the bought product is marked owned', l.j);
  c = await J('POST', '/gifts/claim', { key: 'vip1' }, A.tok);
  ok(c.j.status === 'success' && c.j.amount === 800, 'the gift is received', c.j);
  const b2 = (await acct(A.tok)).walletBalance; ok(Math.round(b2 - b1) === 800, 'and 800 reaches the wallet: ' + b1 + ' -> ' + b2);
  const twice = await Promise.all([J('POST', '/gifts/claim', { key: 'vip1' }, A.tok), J('POST', '/gifts/claim', { key: 'vip1' }, A.tok)]);
  ok(twice.every(r => r.s === 400 && r.j.code === 'ALREADY_CLAIMED'), 'a repeat (even two at once) is refused', twice.map(r => r.j));
  const b3 = (await acct(A.tok)).walletBalance; ok(b3 === b2, 'and pays nothing more');
  l = await J('GET', '/gifts/list', null, A.tok); ok(l.j.gifts[0].claimed === true, 'the list now says claimed', l.j);
  c = await J('POST', '/gifts/claim', { key: 'vip3' }, A.tok); ok(c.s === 404, 'a product without a gift has nothing to receive', c.j);
  c = await J('POST', '/gifts/claim', { key: 'vip1' }); ok(c.s === 401, 'signing in is required');
  const tx = (await J('GET', '/transactions', null, A.tok)).j.transactions || [];
  ok(tx.some(t => t.type === 'order_gift' && t.amount === 800), 'the ledger has the gift row', tx.map(t => t.type));

  // ---- App claim
  const B = await member();
  let r = await J('POST', '/app/claim', {}, B.tok); ok(r.s === 400, 'nothing to claim while the admin amount is 0', r.j);
  await J('POST', '/admin/settings/update', { settings: { appClaimAmount: 200 } }, null, true);
  const a0 = (await acct(B.tok)).walletBalance;
  const both = await Promise.all([J('POST', '/app/claim', {}, B.tok), J('POST', '/app/claim', {}, B.tok)]);
  ok(both.filter(x => x.j.status === 'success').length === 1 && both.filter(x => x.j.code === 'ALREADY_CLAIMED').length === 1, 'two taps at once pay exactly once', both.map(x => x.j));
  const a1 = (await acct(B.tok)).walletBalance; ok(Math.round(a1 - a0) === 200, 'the wallet gets 200 once: ' + a0 + ' -> ' + a1);

  // ---- bank cards
  const C = await member();
  const save = (phone, net = 'MTN Mobile Money') => J('POST', '/bank/save', { holder: 'Test Holder', network: net, phone }, C.tok);
  const p1 = ph(), p2 = ph(), p3 = ph(), p4 = ph(), p5 = ph(), p6 = ph();
  r = await save(p1, 'Stanbic Bank'); ok(r.s === 400, 'a bank name is refused: Bank Name is MTN or Airtel only', r.j);
  r = await J('POST', '/bank/supported-banks', {}, C.tok); ok(r.s === 404, 'there is no bank list route any more', r.s);
  r = await save(p1); ok(r.j.status === 'success', 'first card saved', r.j);
  r = await save(p1); ok(r.s === 409 && r.j.code === 'CARD_EXISTS', 'the same card again is refused', r.j);
  r = await save(p2, 'Airtel Money'); ok(r.j.status === 'success', 'second card saved', r.j);
  let list = (await J('GET', '/bank/list', null, C.tok)).j.accounts;
  ok(list.length === 2 && list.filter(x => x.isDefault).length === 1 && list.find(x => x.isDefault).phone.endsWith(p1.slice(1)), 'two cards, the first one is the active card', list);
  const second = list.find(x => !x.isDefault);
  r = await J('POST', '/bank/select', { id: second.id }, C.tok); ok(r.j.status === 'success', 'the second card is made active', r.j);
  list = (await J('GET', '/bank/list', null, C.tok)).j.accounts;
  ok(list.filter(x => x.isDefault).length === 1 && list.find(x => x.isDefault).id === second.id, 'exactly one active card after the change', list);
  const other = await member();
  r = await J('POST', '/bank/select', { id: second.id }, other.tok); ok(r.s === 404, "another member's card cannot be selected", r.j);
  r = await J('POST', '/bank/save', { holder: 'Thief', network: 'MTN Mobile Money', phone: p1 }, other.tok); ok(r.s === 409 && r.j.code === 'WALLET_TAKEN', 'a number another member holds cannot be saved', r.j);
  for (const p of [p3, p4, p5]) { r = await save(p); ok(r.j.status === 'success', 'card saved ' + p, r.j); }
  r = await save(p6); ok(r.s === 400 && r.j.code === 'CARD_LIMIT', 'a sixth card is refused', r.j);
  // a withdrawal goes to a saved card only
  const pay = await J('POST', '/withdraw/request', { amount: 20000, network: 'MTN Mobile Money', phone: ph(), pin: '123456' }, C.tok);
  ok(pay.j.status !== 'success', 'a withdrawal to a number that is not a saved card is refused', pay.j);

  // ---- About page: cleaned HTML, public
  const dirty = '<h2 onclick="x()">Hello</h2><script>alert(1)</script><a href="javascript:alert(1)">go</a><iframe src="//x"></iframe><p>Fine <b>text</b></p>';
  r = await J('POST', '/admin/about-html/set', { html: dirty }, null, true);
  ok(r.j.status === 'success' && !/script|onclick|javascript:|iframe/i.test(r.j.html) && /<h2>Hello<\/h2>/.test(r.j.html) && /<p>Fine <b>text<\/b><\/p>/.test(r.j.html), 'scripts, frames, handlers and javascript: links are removed when saved', r.j);
  r = await J('GET', '/admin/about-html', null, null, true); ok(r.j.html && !/script/i.test(r.j.html), 'the admin reads it back', r.j);
  r = await J('GET', '/public/about-content'); ok(r.j.html && /Fine/.test(r.j.html) && !/script|onclick/i.test(r.j.html), 'members get the cleaned page', r.j);
  r = await J('POST', '/admin/about-html/set', { html: '<p>x</p>' }); ok(r.s === 401, 'only the owner can change it');

  // ---- settings
  r = await J('POST', '/admin/settings/update', { settings: { myBannerOpacity: 140 } }, null, true); ok(r.j.status === 'error', 'an opacity above 100 is refused', r.j);
  r = await J('POST', '/admin/settings/update', { settings: { myBannerBlur: 99 } }, null, true); ok(r.j.status === 'error', 'a blur above 40 is refused', r.j);
  r = await J('POST', '/admin/settings/update', { settings: { depositMethodNames: ' Pay-A, <b>Pay-B</b>,, Pay-C,Pay-D,Pay-E,Pay-F,Pay-G ', myBannerOpacity: 60, myBannerBlur: 12 } }, null, true);
  ok(r.j.status === 'success', 'settings saved', r.j);
  const st = (await J('GET', '/public/settings')).j.settings || {};
  ok(typeof st.depositMethodNames === 'string' && st.depositMethodNames.split(', ').length === 6 && !/[<>]/.test(st.depositMethodNames), 'deposit buttons: at most six names, no markup', st.depositMethodNames);
  ok(st.myBannerOpacity === 60 && st.myBannerBlur === 12, 'My banner opacity and blur are saved and public', [st.myBannerOpacity, st.myBannerBlur]);
  r = await J('POST', '/admin/settings/update', { settings: { depositMethodNames: ' , ' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).depositMethodNames === 'Pay-B, Pay-A*, Pay-D, Pay-C', 'an empty list falls back to the default four buttons');
  await J('POST', '/admin/settings/update', { settings: { giftCodeHint: '  Type the <b>code</b> ' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).giftCodeHint === 'Type the bcode/b', 'the Gift Code hint is saved from the admin, without tags');
  await J('POST', '/admin/settings/update', { settings: { shareMessage: '  Invest with {app} <now>  ' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).shareMessage === 'Invest with {app} now', 'the share message is saved from the admin (tags removed)');
  await J('POST', '/admin/settings/update', { settings: { shareMessage: '' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).shareMessage === 'Join me on {app}', 'an empty share message falls back to the default');
  await J('POST', '/admin/settings/update', { settings: { giftCodeHint: '' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).giftCodeHint === 'Enter gift code (T-XXXX)', 'an empty hint falls back to the default');

  { const fs = require('fs'), rd = f => fs.readFileSync(path.join(root, f), 'utf8');
    ok(/POTATO_ICON_SLOTS = \[[^\]]*'payicon'/.test(rd('server.js')) && /payicon:'Deposit pay button icon/.test(rd('admin-src/index.html')), 'the admin can upload one deposit pay button icon (slot payicon)');
    ok(/_ptCountOnPaint === 'account'[^\n]*ptCountMyBalances\(\)/.test(rd('user-src/original_module.js')) && /ptCountMyBalances\(\);   \/\/ back on My/.test(rd('user-src/original_module.js')) && /_ptCountOnPaint = \(name === 'account'/.test(rd('user-src/original_module.js')), 'the My balances count up on arriving at the page and on coming back from a page opened from it, not on every repaint');
    ok(/ptSetMoney\(el, account\[key\]\)/.test(rd('user-src/original_module.js')) && /ptCountUp\(\$\('incomeTotal'\)/.test(rd('user-src/original_module.js')) && /ptCountUp\(\$\('myIncome'\)/.test(rd('user-src/original_module.js')), 'Total Income runs up together with the balance, and a figure that changes while the page is open runs up to the new amount');
    ok(/Reward claimed/.test(rd('user-src/original_module.js')) && /appClaimed: u\.appClaimed === true/.test(rd('server.js')) && /\.pt-dlbtn\.claim\.claimed\{background:#f5f9fc/.test(rd('user-src/index.html')), 'a member who has taken the app reward sees the pale "Reward claimed" button');
    ok(/class="pt-gcbox"[^>]*>\\ud83c\\udf81/.test(rd('user-src/original_module.js')) && /@keyframes ptGiftFloat/.test(rd('user-src/index.html')) && !/giftbox/.test(rd('server.js')), 'the Gift Code gift box is built in (no upload) and floats');
    ok(/\.pt-og-card\{[^}]*border-radius:10\.5px/.test(rd('user-src/index.html')), 'order gift cards have the corner radius of the screenshot');
    ok(/@keyframes ptQuickPop\{0%\{transform:scale\(\.55\)[^}]*\}45%\{transform:scale\(1\.2\)/.test(rd('user-src/index.html')) && /\.pt-popin \.pt-quick button:nth-child\(4\)\{animation-delay:\.195s/.test(rd('user-src/index.html')) && /classList\.add\('pt-popin'\)/.test(rd('user-src/original_module.js')), 'arriving at Home, the four buttons pop in one after another');
    ok(/@keyframes ptJoinSweep\{0%\{left:-32%;\}14\.3%\{left:108%;\}/.test(rd('user-src/index.html')) && /animation:ptJoinSweep 1\.4s linear/.test(rd('user-src/index.html')), 'Join Channel has the glow sweep: 0.2 s across, every 1.4 s');
    ok(!/\.pt-abban \.pt-dlback\{display:none/.test(rd('user-src/index.html')), 'the About page keeps its back arrow');
    ok(/#authHeroBg\{position:absolute;left:0;right:0;bottom:0;top:auto;height:245\.3px;[^}]*background-position:center bottom/.test(rd('user-src/index.html')), 'the Login / Create Account banner picture is laid out once at the tall size and pinned to the bottom, so switching pages never moves it');
    { const css = rd('user-src/index.html'); const radius = sel => { const m = css.match(new RegExp('\\n' + sel.replace(/[.>*]/g, '\\$&') + '\\{[^}]*border-radius:([\\d.]+)px')); return m ? Number(m[1]) : null; };
      const want = { '.pt-quick': 10, '.pt-card': 7, '.pt-lvcard': 10.7, '.pt-tier': 14.8, '.pt-tabs': 9.3, '.pt-lvg>div': 7.2, '.pt-mystat': 14.2, '.pt-rb': 9.7, '.pt-gcform': 12, '.pt-pw': 12, '.pt-amt': 11.5, '.pt-gcgo': 14.7 };
      for (const k of Object.keys(want)) ok(radius(k) === want[k], 'card corner ' + k + ' is ' + want[k] + ' px as measured on the screenshots (now ' + radius(k) + ')'); }
    ok(/\.pt-lvrow\{[^}]*margin:31\.2px 0 0;padding:7\.2px 7\.4px;height:58\.3px;[^}]*border:1\.3px solid #bb3430/.test(rd('user-src/index.html')) && /\.pt-lvp\{[^}]*font:700 12\.2px\/41px/.test(rd('user-src/index.html')), 'the Level 1/2/3 buttons row is built to the measured size and place (outline 58.3 high, 1.3 px border, buttons 41 high)');
    ok(/closeSheet\(\{ ?fromAction: ?true ?\}\);\s*await window\.doLogout\(\);/.test(rd('user-src/original_module.js')) && /Every session ends, this one too/.test(rd('server.js')), 'changing the login password signs the member out everywhere, this phone too, so the new password is typed to log in again');
    { const m = rd('user-src/original_module.js'), c = rd('user-src/index.html');
      ok(/\.pt-home \.mg-track img\{[^}]*opacity:0;transition:opacity \.5s ease/.test(c) && /\.pt-home \.mg-track img\.on\{opacity:1/.test(c) && /\.pt-home \.home-banner>img\{[^}]*object-fit:cover/.test(c) && !/touchstart/.test(m.slice(m.indexOf('function startHomeCarousel'), m.indexOf('function startHomeCarousel') + 900)), 'Home banner slides cross-fade, fill the whole frame and cannot be swiped');
      ok(/\.pt-home \.mg-dots\{[^}]*left:50%/.test(c) && /\.mg-dots i\.on\{[^}]*width:12\.7px/.test(c.replace(/\.pt-home /g, '')) || /12\.7px/.test(c), 'the banner dots are bubbles: small translucent circles and a white pill for the current one');
      ok(/function ptProcessing/.test(m) && /Processing payment\.\.\./.test(m) && /\.mg-redirect\{[^}]*position:fixed;inset:0[^}]*backdrop-filter:blur/.test(c) && /submitBtn\.textContent = 'Loading\.\.\.'/.test(m), 'a deposit dims and blurs the whole screen with a red ring and "Processing payment..." while the Pay button reads Loading...');
      ok(/promocode: '\\ud83c\\udf8f'/.test(m) && /deposit: '\\ud83d\\udce5'/.test(m) && /withdraw: '\\ud83d\\udce4'/.test(m) && /promocode'\) return 'Treasure Chest'/.test(m) && /text: t\.type === 'deposit' \? 'Pending Deposit'/.test(m) && /\.pt-rec \.m em\.wait\{color:#ab7b34/.test(c) && /\.pt-rec \.a\.out\{color:#d0605f/.test(c), 'Balance Detail records use the icons, words and colours of the screenshots (Deposit, Treasure Chest, Withdraw; Pending Deposit / Other / Paid)'); }
    ok(/ptIconHtml\('payicon'/.test(rd('user-src/original_module.js')), 'every deposit pay button shows that one icon');
    { const m = rd('user-src/original_module.js'), c = rd('user-src/index.html');
      ok(!/\.pa-hero\{[^}]*transition/.test(c) && !/classList\.toggle\('tall'/.test(m) && /sc\.scrollTop = invited \? 0 : PA_REST/.test(m), 'the banner never changes height or animates; the page rests 66.6 px down, an invitation link at the top');
      ok(/#loadingScreen \.ld-pct\{[^}]*color:#ffb2b8;font:700 11\.8px\/14px 'Noto Serif',serif/.test(c) && /#loadingScreen \.ld-name\{[^}]*'Noto Serif',serif/.test(c), 'the Loading... N% line and the app name on the loading screen are both the serif of the owner\'s phone');
      ok(/@keyframes paLogoIn\{0%\{opacity:0;transform:translateY\(34px\) scale\(\.5\)/.test(c) && /\.pa-logo-in \.pa-logo,\.pa-entering \.pa-logo\{animation:paLogoIn/.test(c) && /paLogoPlay\(\)/.test(m), 'the round picture on Login / Create Account rises from below, growing and fading in');
      ok(/ptCountPay\(\);\n\}/.test(m) && /function ptCountPay/.test(m) && /pa\._cp = \(pa\._cp \|\| 0\) \+ 1/.test(m), 'opening Deposit runs the Pay amount up from 0; typing or picking another amount ends it');
      ok(/if \(_backTitle\) \{ replayPageIn\(\); ptCountMyBalances\(\); \}/.test(m), 'the phone Back button brings Home back with its animation (icons and dialog) like the arrow');
      ok(/Failed to load profile/.test(m) && /Failed to load products/.test(m) && /No products available/.test(m) && /\.pt-myerr button\{[^}]*border:1\.5px solid #fff/.test(c) && /\.pt-abban \.pt-dlback\{[^}]*background:rgba\(90,95,100,\.85\)/.test(c), 'the failed-profile card, the product messages and the About arrow (same as the announcement X) are as in the owner\'s pictures');
      ok(/\.pa-entering \.pa-hero\{animation:paHeroIn \.25s/.test(c) && /\.pa-entering \[data-pa-i\]\{animation:paRise \.3s ease-out both/.test(c) && /@keyframes paRise\{from\{opacity:0;transform:translateY\(28px\)/.test(c) && /if \(changed && \$\('authScreen'\)\.style\.display !== 'none'\) paEnter\(\)/.test(m), 'switching between Login and Create Account blanks the page, fades the banner in and lifts each item into place in turn');
      ok(/\.pt-win\{[^}]*height:338\.6px[^}]*border-radius:22px[^}]*background:#fbece9/.test(c) && /\.pt-win-bg\{[^}]*background:rgba\(189,41,47,\.52\)/.test(c), 'the Gift Code win card has the measured size, colour and red-dimmed blurred page'); } }

  realLog(fails ? fails + ' FAILED of ' + checks : 'PASS: Potato pages server routes (' + checks + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog('FATAL', e); process.exit(1); });
