'use strict';
// Payout cards (up to five, the first is active, MTN / Airtel only), the Gift Code words, and the About page article.
// Server wiring is read from server.js (the routes themselves are exercised on the real server by test-smartai-pages.js and test-smartai-app.js);
// the phone's second cleaning of the About article runs in jsdom; the pages themselves are driven in a real browser by test-smartai-app.js.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };

// Server: cards are added (up to five), one active, another can be made active; the wallet number is checked.
ok(/const BANK_CARD_LIMIT = 5;/.test(server) && /app\.post\('\/bank\/select'/.test(server), 'server keeps up to five cards and can change the active one');
ok(/Wrong treasure chest password/.test(server) && /Please enter the treasure chest key/.test(server), 'server chest messages');
ok(!/bank-transfer|getSupportedBanks|marzValidateBankAccount/.test(server) && !/supportedBanks/.test(source), 'the bank-transfer rail is gone: the payout account is an MTN or Airtel wallet only');

// The app: Gift Code, payout cards and the claim dialogs use the app's own wording.
ok(/id="giftCodeInput"/.test(fs.readFileSync(__dirname + '/user-src/index.html', 'utf8')) && /async function redeemGiftCode\(\)/.test(source), 'the Gift Code page has its box and its redeem function');
ok(/Enter a code/.test(source) && /btnBusyHtml\('Opening…'\)/.test(source), 'an empty code says so, and the button reads Opening… while the server answers');
ok(/function showGiftReveal\(amount\)/.test(source) && /function closeGiftReveal\(\)/.test(source), 'a redeemed code opens the treasure-chest reveal');

// About: the admin's article is cleaned again on the phone.
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const w = dom.window;
  const i = source.indexOf('function cleanAboutHtml'), j = source.indexOf('var _aboutLoaded');
  ok(i > 0 && j > i, 'the About cleaner is in the app');
  w.eval(source.slice(i, j));
  const cleaned = w.cleanAboutHtml('<h2 onclick="x()">Hi</h2><script>alert(1)</script><a href=" JaVa\nScript:alert(1)" target="_self">go</a><img src="x" onerror="y()"><iframe src="//x"></iframe><p style="background:url(javascript:alert(1))">ok</p><p>Fine <b>text</b></p>');
  ok(!/<script|onclick|onerror|javascript|iframe/i.test(cleaned) && /<h2>Hi<\/h2>/.test(cleaned) && /<p>Fine <b>text<\/b><\/p>/.test(cleaned) && /rel="noopener noreferrer"/.test(cleaned), 'the About page HTML loses scripts, frames, handlers and javascript: links but keeps normal markup: ' + cleaned);
  const keep = w.cleanAboutHtml('<div class="x" style="color:#137aef"><img src="https://example.com/a.png" alt="a"><a href="https://t.me/x" target="_blank">t</a></div>');
  ok(/class="x"/.test(keep) && /style="color:#137aef"/.test(keep) && /src="https:\/\/example\.com\/a\.png"/.test(keep) && /href="https:\/\/t\.me\/x"/.test(keep), 'ordinary classes, colours, pictures and links stay: ' + keep);
  ok(w.cleanAboutHtml('') === '' && w.cleanAboutHtml(null) === '', 'nothing in, nothing out');
  ok(/cleanAboutHtml\(r\.html\)/.test(source), 'the page shows the cleaned markup, not the raw reply');
}
console.log(`PASS: payout cards, gift code and About cleaner (${n} checks)`);
