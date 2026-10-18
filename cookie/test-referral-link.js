'use strict';
// The shared referral link is <origin>/h5/#/pages/login/reset?inviteCode=<code>, and opening it lands on Sign Up with the code filled in.
const fs = require('node:fs'), assert = require('node:assert/strict'), vm = require('node:vm');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/const link = code \? `\$\{shareOrigin\(\)\}\/h5\/#\/pages\/login\/reset\?inviteCode=\$\{encodeURIComponent\(code\)\}` : ''/.test(mod), 'the Share page builds the new link');
ok(!/share\.html\?v=\$\{/.test(mod), 'and no longer the old share.html form');
// the real capture function, run against each link form
const a = mod.indexOf('function captureReferralFromUrl(){'); let d = 0, i = mod.indexOf('{', a); for (; i < mod.length; i++) { if (mod[i] === '{') d++; else if (mod[i] === '}' && --d === 0) break; }
const fnSrc = mod.slice(a, i + 1);
function open(url) {
  const u = new URL(url), box = { value: '' }, tabs = [];
  const c = { location: { search: u.search, hash: u.hash, pathname: u.pathname }, URLSearchParams, STATE: {}, $: () => box, showAuthTab: t => tabs.push(t), decodeURIComponent };
  vm.createContext(c); vm.runInContext(fnSrc + '\ncaptureReferralFromUrl();', c);
  return { code: box.value, tab: tabs[0], state: c.STATE.refCode };
}
const cur = open('https://muoj.mydomain.com/h5/#/pages/login/reset?inviteCode=ac365fda');
ok(cur.code === 'ac365fda' && cur.tab === 'register' && cur.state === 'ac365fda', 'the new link fills the code and opens Sign Up');
ok(open('https://x.com/h5/#/pages/login/reset?inviteCode=QcNBht').code === 'QcNBht', 'the code keeps its case');
ok(open('https://x.com/h5/#/pages/login/reset?inviteCode=a%20b').code === 'a b', 'an encoded code is decoded');
ok(open('https://x.com/?ref=OLD1').code === 'OLD1', 'older ?ref= links still work');
ok(open('https://x.com/#pages/register/?ref=OLD2').code === 'OLD2', 'older #pages/register links still work');
ok(open('https://x.com/share.html?v=1&code=OLD3').code === 'OLD3', 'older share.html links still work');
ok(open('https://x.com/refCode=OLD4').code === 'OLD4', 'older /refCode= links still work');
ok(open('https://x.com/h5/').code === '' && open('https://x.com/h5/').tab === undefined, 'no code, nothing filled');
const nginx = fs.readFileSync(__dirname + '/deploy/make-nginx.js', 'utf8'), stat = fs.readFileSync(__dirname + '/static-server.js', 'utf8');
ok(/location = \/h5\/ \{\n(?:\s+if \(\$cookie_tg_bot\)[^\n]*\n)?\s+try_files \$cookie_bot_html \/index\.html =404;/.test(nginx) && /location = \/h5 \{ return 301 \/h5\/; \}/.test(nginx), 'nginx opens the app at /h5/');
ok(/pathname === '\/h5' \|\| pathname === '\/h5\/'\) pathname = '\/index\.html'/.test(stat), 'the built-in server opens the app at /h5/');
console.log(`PASS: referral link (${n} checks)`);
