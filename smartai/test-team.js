'use strict';
// Team page: a level's member list is read fresh from the server every time it is opened (never frozen for the session), a failed read says so
// instead of "no members", and every row is a real figure. Drives the REAL app code in jsdom (source, and the built bundle with --built) with the
// server calls stubbed; the whole flow on a real server is in test-smartai-app.js.
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mysmartai.smartai.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [], accounts: [] }) }); w.open = () => null;
for (const s of d.scripts) {
  if (s.type === 'module' || s.src) continue;
  if (s.hasAttribute('data-nx-core')) w.eval(built ? zlib.inflateSync(Buffer.from(s.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString() : source);
  else if (s.textContent.trim()) w.eval(s.textContent);
}
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
(async () => {
  await new Promise(r => setTimeout(r, 30));
  let calls = [], mode = 'ok', people = [{ id: 'a', phone: '0771234567', phoneMasked: '077****567', invested: 30000, createdAt: Date.now() - 86400000 }];
  w.api = async p => { calls.push(p); return mode === 'ok' ? { status: 'success', members: people } : { status: 'error', message: 'Could not load your team' }; };
  const list = () => d.getElementById('teamLevelList').textContent.replace(/\s+/g, ' ').trim();
  await w.openTeamLevel(1);
  ok(calls[0] === '/team/members?level=1' && /^Level 1 \u00b7 1 member/.test(list()), 'opening a level asks the server for that level');
  ok(/1 member/.test(list()) && /077\*{4}567/.test(list()) && /UGX 30,000/.test(list()), 'a member shows the hidden number and what they invested: ' + list());
  // a second member joins: opening again asks again
  people = people.concat([{ id: 'b', phone: '0779999999', phoneMasked: '077****999', invested: 0, createdAt: null }]);
  await w.openTeamLevel(1);
  ok(calls.length === 2 && /2 members/.test(list()) && /UGX 0/.test(list()), 'opening again reads the list again, and a member who has not invested shows UGX 0: ' + list());
  // an empty level
  people = []; await w.openTeamLevel(3);
  ok(calls[2] === '/team/members?level=3' && /No Level 3 members yet/.test(list()), 'a real empty level says so');
  // a failed read is never turned into "no members"
  mode = 'fail'; await w.openTeamLevel(2);
  ok(/Could not load this list/.test(list()) && !/No Level 2 members yet/.test(list()), 'a failed read says it could not load, not "no members": ' + list());
  // server: the cards read the live team
  ok(/team: \{ l1: n1, l2: n2, l3: n3 \}/.test(server) && /async function wholeTeamStats/.test(server), 'server /team/stats reads live level counts');
  console.log('test-team: ' + n + ' checks passed' + (built ? ' (built)' : ''));
  process.exit(0);   // the app keeps its animation ticker alive, so the page never lets the process end by itself
})().catch(e => { console.error(e); process.exit(1); });
