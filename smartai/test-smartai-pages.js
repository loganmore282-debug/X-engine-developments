'use strict';
// END-TO-END for the routes behind the signed-in pages: bank cards (up to five, the first is active, /bank/select, duplicate refused), the About page
// HTML (cleaned when saved, public), and the admin settings (deposit method names, My banner opacity/blur), and that nothing from Potato's extras exists. Runs the REAL server.js against the in-memory MongoDB stand-in.
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3800 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/smartai'; process.env.ADMIN_KEY = 'e2e-admin-key-123456'; process.env.NODE_ENV = 'development';
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
    { key: 'vip1', name: 'VIP-1', price: 3000, cycle: 30, multiplier: 3, buyLimit: 1, order: 0, vip: 1 },
    { key: 'vip2', name: 'VIP-2', price: 50000, cycle: 40, multiplier: 3, buyLimit: 3, order: 1, vip: 2 },
    { key: 'vip3', name: 'VIP-3', price: 120000, cycle: 50, multiplier: 3, buyLimit: 3, order: 2, vip: 3 }
  ] }, null, true);
  const pub = (await J('GET', '/public/products')).j.products || [];
  ok(!pub.some(p => 'category' in p), 'products carry no Home category any more', pub[0]);
  const acct = async tok => (await J('GET', '/account', null, tok)).j.account;

  // ---- what is NOT here: Order Gifts, the app reward, Messages and Google Authenticator are not ChocoMCC's, so the server has no such routes
  const A = await member();
  for (const [m, pth, body] of [['GET', '/gifts/list'], ['POST', '/gifts/claim', { key: 'vip1' }], ['POST', '/app/claim', {}], ['GET', '/messages'], ['POST', '/messages/read', { messageId: 'x' }], ['GET', '/account/2fa/status'], ['POST', '/account/2fa/start', { pin: '123456' }], ['POST', '/admin/messages/save', { title: 't', body: 'b' }], ['GET', '/admin/messages/list'], ['POST', '/admin/user/reset-2fa', { userId: 'x' }]]) {
    const r0 = await J(m, pth, body, A.tok, pth.startsWith('/admin'));
    ok(r0.s === 404, m + ' ' + pth + ' does not exist (' + r0.s + ')');
  }
  const acc0 = await acct(A.tok);
  ok(!('twofaEnabled' in acc0) && !('appClaimed' in acc0), '/account carries no Google Authenticator or app-reward flag', Object.keys(acc0));
  const set0 = (await J('GET', '/public/settings')).j.settings || {};
  ok(!('requireTwofaToWithdraw' in set0) && !('appClaimAmount' in set0), 'the public settings carry neither', Object.keys(set0).filter(k => /twofa|claim/i.test(k)));
  const buyA = await J('POST', '/invest/create', { tierKey: 'vip1' }, A.tok); ok(buyA.j.status === 'success', 'a member can still buy a product', buyA.j);
  const pgot = (await J('GET', '/public/products')).j.products || [];
  ok(pgot.every(p => !('orderGift' in p)), 'products carry no order gift', pgot[0]);

  // ---- bank cards
  let r;
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
  ok(((await J('GET', '/public/settings')).j.settings || {}).depositMethodNames === 'Pay-B, Pay-A, Pay-D, Pay-C', 'an empty list falls back to the default four buttons');
  await J('POST', '/admin/settings/update', { settings: { giftCodeHint: '  Type the <b>code</b> ' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).giftCodeHint === 'Type the bcode/b', 'the Gift Code hint is saved from the admin, without tags');
  await J('POST', '/admin/settings/update', { settings: { shareMessage: '  Invest with {app} <now>  ' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).shareMessage === 'Invest with {app} now', 'the share message is saved from the admin (tags removed)');
  await J('POST', '/admin/settings/update', { settings: { shareMessage: '' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).shareMessage === 'Join me on {app}', 'an empty share message falls back to the default');
  await J('POST', '/admin/settings/update', { settings: { homeBannerTitle: '  Welcome <b>back</b>  ', homeBannerText: 'Robots work\nwhile you sleep ' } }, null, true);
  { const st2 = ((await J('GET', '/public/settings')).j.settings || {});
    ok(st2.homeBannerTitle === 'Welcome  b back /b' || st2.homeBannerTitle === 'Welcome b back /b' || (!/[<>]/.test(st2.homeBannerTitle) && /Welcome/.test(st2.homeBannerTitle) && /back/.test(st2.homeBannerTitle)), 'the Home banner title is saved from the admin without tags', st2.homeBannerTitle);
    ok(st2.homeBannerText === 'Robots work while you sleep', 'and the Home banner text, on one line', st2.homeBannerText); }
  await J('POST', '/admin/settings/update', { settings: { homeBannerTitle: 'x'.repeat(200), homeBannerText: 'y'.repeat(500) } }, null, true);
  { const st3 = ((await J('GET', '/public/settings')).j.settings || {}); ok(st3.homeBannerTitle.length === 60 && st3.homeBannerText.length === 160, 'both are capped (60 and 160 characters)'); }
  await J('POST', '/admin/settings/update', { settings: { homeBannerTitle: '', homeBannerText: '' } }, null, true);
  ok((((await J('GET', '/public/settings')).j.settings || {}).homeBannerTitle) === '', 'empty words mean nothing is drawn over the banner');
  await J('POST', '/admin/settings/update', { settings: { giftCodeHint: '' } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).giftCodeHint === 'Enter gift code (T-XXXX)', 'an empty hint falls back to the default');

  realLog(fails ? fails + ' FAILED of ' + checks : 'PASS: Smart AI pages server routes (' + checks + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog('FATAL', e); process.exit(1); });
