'use strict';
// Team screen: a level's member list is refreshed (not frozen for the session) and a failed fetch is
// never stored as "no members". Drives source (and --built) in JSDOM.
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mysoda.p-colasoda.com/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  w.eval("STATE.page='network'; STATE.account={referralCode:'ABCD'}; STATE.teamStats={referralCode:'ABCD',commRates:{l1:20,l2:5,l3:1},team:{l1:1,l2:0,l3:0},totalTeam:1,teamDeposits:0,levelCommission:{}}");
  let calls = 0, mode = 'ok', people = [{ id: 'a', phone: '0771234567', invested: 0, createdAt: null }];
  w.api = async () => { calls++; return mode === 'ok' ? { status: 'success', members: people } : { status: 'error', message: 'Could not load your team' }; };
  w.eval('paintNetwork()'); await new Promise(r => setTimeout(r, 20));
  const box = () => d.getElementById('teamMembersBox').textContent.replace(/\s+/g, ' ').trim();
  ok(d.querySelectorAll('.v-member').length === 1 && calls === 1, 'first open fetches and shows the member');
  // a second member joins: reopening after the list is stale refetches it
  people = [...people, { id: 'b', phone: '0779999999', invested: 0, createdAt: null }];
  w.eval('_teamMembersAt = {}'); w.eval('paintNetwork()'); await new Promise(r => setTimeout(r, 20));
  ok(d.querySelectorAll('.v-member').length === 2 && calls === 2, 'a stale list is refetched and the new member appears');
  // a fresh list is shown at once without another fetch
  w.eval('paintNetwork()'); await new Promise(r => setTimeout(r, 20));
  ok(calls === 2 && d.querySelectorAll('.v-member').length === 2, 'a fresh list is not refetched');
  // a failed fetch keeps the held list, never turning it into "no members"
  mode = 'fail'; w.eval('_teamMembersAt = {}'); w.eval('paintNetwork()'); await new Promise(r => setTimeout(r, 20));
  ok(d.querySelectorAll('.v-member').length === 2 && !/No members/.test(box()), 'a failed refresh keeps the list on screen');
  // a level never loaded and failing shows the retry line, not "No members at this level yet"
  w.eval('STATE.teamMembers={1:null,2:null,3:null}; _teamMembersAt = {}; _teamMembersFailed = {}');
  await w.switchTeamLevel(2);
  ok(box() === 'Could not load your team' && !/No members/.test(box()), 'a failed first load says it could not load, not "No members": ' + box());
  mode = 'ok'; people = [];
  await w.switchTeamLevel(2);
  ok(/No members at this level yet/.test(box()), 'a real empty level still says so');
  // server: the cards read the live team
  ok(/team: \{ l1: n1, l2: n2, l3: n3 \}/.test(server) && /async function wholeTeamStats/.test(server), 'server /team/stats reads live level counts');
  console.log('test-team: ' + n + ' checks passed' + (built ? ' (built)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
