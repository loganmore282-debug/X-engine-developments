'use strict';
// The live agent badges: six animated verified badges (one per agent level, in listed order), drawn as SVG; on the agent cards and on the corner of the profile picture on Me, with the level's name beside the number.
//   node test-agent-badges.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m); } else { fail++; console.log('  FAIL - ' + m); } };
const app = read('user-src/original_module.js'), page = read('user-src/index.html');
const a = app.indexOf('var AGENT_BADGES'), b = app.indexOf('// The member\'s own agent level, on the number card of Me');
ok(a > 0 && b > a, 'the badge maker is in the app source');
const make = reduced => { const ctx = { window: { matchMedia: () => ({ matches: reduced }) }, matchMedia: () => ({ matches: reduced }), Math, Number, String, Array }; vm.createContext(ctx); vm.runInContext(app.slice(a, b) + '\nthis.f = agentBadgeSvg; this.kinds = AGENT_BADGES;', ctx); return ctx; };
const m = make(false), still = make(true);
function wellFormed(x) {   // every opened tag is closed in order
  const st = []; const re = /<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/g; let t;
  while ((t = re.exec(x))) { if (t[4]) continue; if (t[1]) { if (st.pop() !== t[2]) return false; } else st.push(t[2]); }
  return st.length === 0;
}
ok(m.kinds.join() === 'blue,red,gold,pink,black,green', 'six badges in order: blue, red, gold, pink, black, green');
const svgs = [0, 1, 2, 3, 4, 5, 6, 11].map(i => m.f(i));
ok(svgs.every(wellFormed), 'every badge is well-formed SVG');
ok(svgs[6].replace(/bd\d+/g, "X") === svgs[0].replace(/bd\d+/g, "X"), "a seventh level starts over at the first badge");
ok(svgs[7].replace(/bd\d+/g, 'X') === svgs[5].replace(/bd\d+/g, 'X'), 'and the twelfth is the sixth again');
ok(new Set(svgs.slice(0, 6).map(s => s.replace(/bd\d+/g, 'X'))).size === 6, 'the six badges all look different');
const ids = [m.f(0), m.f(0)].map(s => (s.match(/id="(bd\d+)/g) || []).join()); ok(ids[0] !== ids[1] || !ids[0], 'two badges on one page never share a gradient or clip id');
let anims = 0, bad = 0;
svgs.slice(0, 6).forEach(s => { (s.match(/<animate[^>]*\/>/g) || []).forEach(e => {
  anims++; const v = (e.match(/ values="([^"]*)"/) || [])[1], k = (e.match(/keyTimes="([^"]*)"/) || [])[1], sp = (e.match(/keySplines="([^"]*)"/) || [])[1];
  if (v && !k && !sp && v.split(';').length === 2) return;   // the pink gradient's plain turn: two values, no easing table
  if (!v || !k || !sp) { bad++; return; }
  const n = v.split(';').length, kt = k.split(';').map(Number);
  if (kt.length !== n || sp.split(';').length !== n - 1 || kt[0] !== 0 || kt[n - 1] !== 1 || kt.some((x, i) => i && x < kt[i - 1])) bad++;
}); });
ok(anims > 30 && bad === 0, 'every animation has matching values, key times (0 to 1, rising) and easing (' + anims + ' animations)');
ok(svgs.slice(0, 6).every(s => /<animate/.test(s)), 'every badge moves');
ok([0, 1, 2, 3, 4, 5].every(i => !/<animate/.test(still.f(i))) && [0, 1, 2, 3, 4, 5].every(i => wellFormed(still.f(i))), 'with reduced motion every badge stands still');
ok(/class="bdg"/.test(svgs[0]) && /viewBox="0 0 100 100"/.test(svgs[0]), 'drawn in a square box so it scales to any size');
// Where they sit
ok(/<div class="acct-av"><div class="acct-icon" id="acctIcon"><\/div><span class="acct-badge" id="acctBadge"><\/span><\/div>/.test(page), 'Me: the badge slot sits on the profile picture');
ok(/\.acct-badge\{position:absolute;right:-\d+px;bottom:-\d+px/.test(page), 'on its lower-right corner');
ok(/class="acct-numrow"><div class="acct-num" id="acctPhone">[^<]*<\/div><span class="acct-agent" id="acctAgent"/.test(page) && /\.acct-agent\{margin-left:auto/.test(page), 'the level name is at the right end of the number row');
ok(/class="tk-badge">' \+ agentBadgeSvg\(idx\)/.test(app) && /\.tk-badge\{width:30px/.test(page), 'each agent level card carries its badge at the right end of the title row');
ok(/mineIdx >= 0 \? '<span class="tk-badge">'/.test(app), '"Your agent level" shows the badge of the level the member holds (none before that)');
ok(/setAgentMe\(ag\);/.test(app) && /setTimeout\(refreshAgentMe, 1500\)/.test(app) && /paintVip\(true\); refreshAgentMe\(\)/.test(app), 'the Me card learns the level at sign-in, on opening Me, and from the VIP Tasks page');
ok((app.match(/_agentMe = null; _agentMeAt = 0;/g) || []).length === 2, 'signing out clears the badge');
ok(/data-sig/.test(app), 'the same level is not repainted (the animation is not restarted)');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
