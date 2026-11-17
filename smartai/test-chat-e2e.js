'use strict';
// The customer-service chat, end to end against the REAL server (in-memory database): profiles, keys, encrypted messages, ticks, unread, notices, limits; then the real
// member app and the real admin panel in a browser talking to each other.
//   node test-chat-e2e.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), vm = require('vm');
process.chdir(__dirname);
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 300), FRONT = 4450 + Math.floor(Math.random() * 200), ADMINP = 4700 + Math.floor(Math.random() * 200);
const AK = 'chat-e2e-admin-key-123456';
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = AK; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-chat-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + AK } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const staticServer = dir => http.createServer((req, res) => {
  if (req.url.startsWith('/k7x2/')) {
    const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
  }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(dir, path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, buf) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); });
});
// the two copies of the encryption code must be the same text
const block = src => { const a = src.indexOf('/* CHATCRYPTO BEGIN'), b = src.indexOf('/* CHATCRYPTO END */'); return a >= 0 && b > a ? src.slice(a, b + 20) : ''; };
const memberBlock = block(read('user-src/original_module.js')), adminBlock = block(read('admin-src/index.html'));
const sandbox = { crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, String, Array, JSON }; vm.createContext(sandbox); vm.runInContext(memberBlock + '\nthis.CHAT = CHAT;', sandbox);
const CHAT = sandbox.CHAT;
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

(async () => {
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  ok(memberBlock.length > 500 && memberBlock === adminBlock, 'the member app and the admin panel carry the very same encryption code');
  // ---- profiles and the admin key
  let r = await J('GET', '/public/chat-config'); ok(r.s === 200 && r.j.agents.length === 0 && r.j.adminKey === null && r.j.online === false, 'at first: no profiles, no key, nobody online', r.j);
  const adminPair = await CHAT.newPair();
  r = await J('POST', '/admin/chat/key', { kid: adminPair.kid, jwk: adminPair.pub }, null, true); ok(r.j.status === 'success', 'the owner publishes the panel\'s PUBLIC key', r.j);
  r = await J('POST', '/admin/chat/key', { kid: 'deadbeefdeadbeef', jwk: adminPair.pub }, null, true); ok(r.s === 400, 'a key id that does not match the key is refused');
  const other = await CHAT.newPair(); r = await J('POST', '/admin/chat/key', { kid: other.kid, jwk: other.pub }, null, true); ok(r.s === 409 && r.j.code === 'KEY_EXISTS', 'replacing the key has to be asked for explicitly');
  r = await J('POST', '/admin/chat/key', { kid: adminPair.kid, jwk: Object.assign({}, adminPair.pub, { d: 'SECRET' }) }, null, true); ok(r.j.status === 'success' && !JSON.stringify([...fm.__stores.meta.values()]).includes('SECRET'), 'only the public part of a key is ever kept');
  r = await J('POST', '/admin/chat/agent/save', { name: 'Sarah', photo: jpg }, null, true); ok(r.j.status === 'success' && r.j.agents.length === 1, 'the owner adds a profile (name + picture)', r.j);
  const A1 = r.j.agents[0].id;
  r = await J('POST', '/admin/chat/agent/save', { name: '<b>Daniel</b>' }, null, true); const A2 = r.j.agents.find(a => a.id !== A1).id; ok(r.j.agents.find(a => a.id === A2).name === 'Daniel' && r.j.agents.find(a => a.id === A2).photo === '', 'a second profile; markup in a name is stripped; a picture is optional');
  r = await J('POST', '/admin/chat/agent/save', { name: 'X', photo: 'javascript:alert(1)' }, null, true); ok(r.s === 400, 'a picture that is not a PNG, JPG or WebP data picture is refused');
  r = await J('POST', '/admin/chat/agent/save', { name: '' }, null, true); ok(r.s === 400, 'a profile needs a name');
  r = await J('POST', '/admin/chat/agent/save', { id: A2, name: 'Daniel K' }, null, true); ok(r.j.agents.find(a => a.id === A2).name === 'Daniel K', 'a profile can be renamed');
  r = await J('GET', '/public/chat-config'); ok(r.j.agents.length === 2 && r.j.adminKey && r.j.adminKey.kid === adminPair.kid && !('d' in r.j.adminKey.jwk), 'members get the profiles and the panel\'s public key');
  r = await J('GET', '/admin/chat/agents'); ok(r.s === 401, 'the admin routes are closed without the admin key');
  // ---- a member writes
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const tok = su.j.token, uid = su.j.uid;
  const mk = await CHAT.newPair();
  r = await J('POST', '/chat/key', { kid: mk.kid, jwk: mk.pub }, tok); ok(r.j.status === 'success', 'the member registers this phone\'s public key');
  r = await J('POST', '/chat/key', { kid: other.kid, jwk: mk.pub }, tok); ok(r.s === 400, 'a key cannot be registered under another key\'s id');
  r = await J('POST', '/chat/key', { kid: mk.kid, jwk: mk.pub }); ok(r.s === 401, 'a chat key needs a signed-in member');
  const SECRET = 'my wallet pin is 482913 and my secret words';
  const seal = (text, ad, rec) => CHAT.seal(JSON.stringify({ t: text }), ad, rec);
  let env = await seal(SECRET, uid + '|member|' + A1, [{ kid: adminPair.kid, jwk: adminPair.pub }, { kid: mk.kid, jwk: mk.pub }]); env.agentId = A1;
  r = await J('POST', '/chat/send', env, tok); ok(r.j.status === 'success' && r.j.id, 'the member sends a message to Sarah', r.j);
  const t1 = r.j.at;
  const dump = JSON.stringify([...fm.__stores.chatMessages.values(), ...fm.__stores.chatThreads.values()]);
  ok(!dump.includes('482913') && !dump.includes('secret words') && !dump.includes(SECRET), 'the server\'s own database holds NO readable word of it (only ciphertext)');
  ok(JSON.stringify(env).length < 1500 && env.wraps.length === 2, 'a message is small and locked for exactly two keys: the panel and the member\'s phone');
  r = await J('POST', '/chat/send', Object.assign({}, env, { agentId: 'nope' }), tok); ok(r.s === 404, 'a message to a profile that does not exist is refused');
  r = await J('POST', '/chat/send', Object.assign({}, env, { ct: 'AAAA' }), tok); ok(r.s === 400, 'a malformed message is refused');
  r = await J('POST', '/chat/send', Object.assign({}, env, { wraps: [] }), tok); ok(r.s === 400, 'a message locked for no key is refused');
  r = await J('POST', '/chat/send', Object.assign({}, env, { ct: 'A'.repeat(7000) }), tok); ok(r.s === 400, 'an oversized message is refused');
  r = await J('POST', '/chat/send', env); ok(r.s === 401, 'a message needs a signed-in member');
  // ---- the admin inbox
  r = await J('GET', '/admin/chat/summary', null, null, true); ok(r.j.unread === 1 && r.j.threads === 1 && r.j.latestUser === uid, 'the panel is told: one unread message', r.j);
  r = await J('GET', '/admin/chat/threads', null, null, true); const th = r.j.threads[0];
  ok(r.j.threads.length === 1 && th.userId === uid && th.unread === 1 && th.lastAgentId === A1 && th.lastFrom === 'member' && th.phone.endsWith(phone.slice(1)) && th.memberOnline === true, 'one thread for the member, unread, via Sarah, member online', th);
  const pv = await CHAT.open(th.last, uid + '|member|' + A1, adminPair.kid, adminPair.priv); ok(JSON.parse(pv).t === SECRET, 'the panel (and only the panel) opens it');
  ok(await CHAT.open(th.last, uid + '|member|' + A1, other.kid, other.priv) === null, 'any other key finds nothing locked for it');
  let thrown = false; try { await CHAT.open(th.last, uid + '|member|' + A2, adminPair.kid, adminPair.priv); } catch (_) { thrown = true; } ok(thrown, 'the same message cannot be passed off in another conversation');
  // a second message, via ANOTHER profile: still ONE thread in the panel
  env = await seal('And a question for Daniel', uid + '|member|' + A2, [{ kid: adminPair.kid, jwk: adminPair.pub }, { kid: mk.kid, jwk: mk.pub }]); env.agentId = A2; r = await J('POST', '/chat/send', env, tok); ok(r.j.status === 'success', 'the same member writes to another profile');
  await sleep(1100); // the 3-second send debounce is per route in other places; chat has none, but keep ordering stable
  r = await J('GET', '/admin/chat/threads', null, null, true); ok(r.j.threads.length === 1 && r.j.threads[0].unread === 2 && r.j.threads[0].lastAgentId === A2, 'whichever profile they pick, the panel keeps ONE thread (2 unread), and the reply goes to the latest profile by default');
  r = await J('GET', '/admin/chat/thread?userId=' + uid, null, null, true);
  ok(r.j.messages.length === 2 && r.j.memberKeys.length === 1 && r.j.memberKeys[0].kid === mk.kid && r.j.phone.endsWith(phone.slice(1)), 'the panel gets both messages and the member\'s public key to lock a reply for', r.j.messages.length);
  // ---- ticks: sent, delivered, read
  let h = await J('GET', '/chat/history?agentId=' + A1, null, tok); const m1 = h.j.messages[0];
  ok(h.j.messages.length === 1 && m1.at === t1 && h.j.adminReadAt === 0 && h.j.adminSeenAt >= t1, 'the member sees the message with its ticks: the panel has fetched it (delivered), nobody has opened it yet (not read)', { read: h.j.adminReadAt, seen: h.j.adminSeenAt, at: m1.at });
  ok(h.j.online === true, 'the panel being open shows as online to the member');
  r = await J('POST', '/admin/chat/read', { userId: uid }, null, true); h = await J('GET', '/chat/history?agentId=' + A1, null, tok);
  ok(h.j.adminReadAt >= t1 && (await J('GET', '/admin/chat/summary', null, null, true)).j.unread === 0, 'the admin opens the chat: the message is READ and the count drops to 0');
  // ---- the reply
  const mkeys = (await J('GET', '/admin/chat/thread?userId=' + uid, null, null, true)).j.memberKeys;
  env = await seal('Hello, I am looking into it now.', uid + '|admin|' + A1, mkeys.map(k => ({ kid: k.kid, jwk: k.jwk })).concat([{ kid: adminPair.kid, jwk: adminPair.pub }])); env.userId = uid; env.agentId = A1;
  r = await J('POST', '/admin/chat/send', env, null, true); ok(r.j.status === 'success', 'the admin replies (as Sarah, the profile the member wrote to)', r.j);
  const dump2 = JSON.stringify([...fm.__stores.chatMessages.values()]); ok(!dump2.includes('looking into it'), 'the reply is ciphertext in the database too');
  r = await J('GET', '/chat/summary', null, tok); ok(r.j.unread[A1] === 1 && !r.j.unread[A2], 'the member sees ONE unread reply on Sarah (not on Daniel)', r.j);
  h = await J('GET', '/chat/history?agentId=' + A1, null, tok); const reply = h.j.messages.find(m => m.from === 'admin');
  ok(h.j.messages.length === 2 && reply && JSON.parse(await CHAT.open(reply, uid + '|admin|' + A1, mk.kid, mk.priv)).t === 'Hello, I am looking into it now.', 'the member opens the reply with the phone\'s own key');
  ok(h.j.messages.every(m => m.agentId === A1), 'a profile\'s chat holds only what was said to it');
  r = await J('POST', '/chat/read', { agentId: A1 }, tok); r = await J('GET', '/chat/summary', null, tok); ok(!r.j.unread[A1], 'the member reads it: the count goes');
  let td = (await J('GET', '/admin/chat/thread?userId=' + uid, null, null, true)).j; const replyAt = td.messages.find(m => m.from === 'admin').at;
  ok(td.memberReadAt >= replyAt && td.memberSeenAt >= replyAt, 'the panel sees its reply as delivered and read (the two blue ticks)', { r: td.memberReadAt, s: td.memberSeenAt, at: replyAt });
  r = await J('POST', '/admin/chat/send', Object.assign({}, env, { userId: 'nobody-here' }), null, true); ok(r.s === 404, 'a reply to a member with no chat is refused');
  // ---- limits and safety
  let last; for (let i = 0; i < 22; i++) { const e2 = await seal('x' + i, uid + '|member|' + A1, [{ kid: adminPair.kid, jwk: adminPair.pub }]); e2.agentId = A1; last = await J('POST', '/chat/send', e2, tok); if (last.s === 429) break; }
  ok(last.s === 429, 'sending more than 20 messages a minute is slowed down');
  const ban = await J('POST', '/auth/signup', { phone: '0772222222', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, ban.j.token);
  await J('POST', '/admin/user/ban', { userId: ban.j.uid, banned: true }, null, true).catch(() => {});
  // ---- a profile is deleted
  r = await J('POST', '/admin/chat/agent/delete', { id: A2 }, null, true); ok(r.j.agents.length === 1, 'the owner deletes a profile');
  r = await J('GET', '/public/chat-config'); ok(r.j.agents.length === 1 && r.j.agents[0].id === A1, 'members no longer see it');
  const su3 = await J('POST', '/auth/signup', { phone: '0775556666', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su3.j.token);
  env = await seal('hello', su3.j.uid + '|member|' + A2, [{ kid: adminPair.kid, jwk: adminPair.pub }]); env.agentId = A2; r = await J('POST', '/chat/send', env, su3.j.token); ok(r.s === 404, 'and can no longer write to it');
  r = await J('GET', '/admin/chat/thread?userId=' + uid, null, null, true); ok(r.j.messages.some(m => m.agentId === A2), 'but what was said to it stays in the panel');
  // ---- deleting the account removes the chat
  r = await J('POST', '/admin/user/delete', { userId: uid }, null, true);
  ok([...fm.__stores.chatMessages.values()].filter(m => m.threadId === uid).length === 0 && !fm.__stores.chatThreads.has(uid) && !fm.__stores.chatMembers.has(uid), 'deleting the member\'s account deletes their chat, their thread and their keys', r.j);

  // ===================== the real apps, in a browser =====================
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const front = staticServer(path.join(__dirname, 'user')), adm = staticServer(path.join(__dirname, 'admin'));
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r)); await new Promise(r => adm.listen(ADMINP, '127.0.0.1', r));
  // fresh chat state for the browser part
  for (const c of ['chatMessages', 'chatThreads', 'chatMembers', 'chatAgents']) fm.__stores[c].clear(); fm.__stores.meta.delete('chatKey');
  const phone2 = '0773334444', su2 = await J('POST', '/auth/signup', { phone: phone2, password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su2.j.token);
  const errs = [];
  // -- admin
  const actx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const ap = await actx.newPage(); ap.on('pageerror', e => errs.push('admin: ' + String(e.message).slice(0, 200))); ap.on('dialog', d => d.accept('backup-pass-123'));
  await ap.goto('http://127.0.0.1:' + ADMINP + '/'); await sleep(500);
  await ap.fill('#keyInput', AK); await ap.click('#loginBtn'); await ap.waitForSelector('#shell:not(.hidden)', { timeout: 10000 });
  await ap.click('[data-tab="chat"]'); await ap.waitForSelector('#chMake', { timeout: 8000 });
  ok(true, 'admin: the Chat tab asks the owner to create the chat key (nothing is turned on by itself)');
  await ap.click('#chMake'); await ap.waitForSelector('details.ch-tools', { timeout: 8000 });
  ok((await J('GET', '/public/chat-config')).j.adminKey !== null, 'admin: the key is made in the browser and only its public half reaches the server');
  const stored = await ap.evaluate(() => JSON.parse(localStorage.getItem('smartai_chat_admin_key_v1') || 'null')); ok(stored && stored.priv && stored.priv.d, 'admin: the private key stays in this browser');
  await ap.evaluate(() => { document.querySelector('details.ch-tools').open = true; }); await ap.click('#chAgAdd');
  await ap.fill('#chAgName', 'Sarah');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EIwESMolGFdFQIAJ/HAhEWXz2GAAAAAElFTkSuQmCC', 'base64');
  await ap.setInputFiles('#chAgFile', { name: 'sarah.png', mimeType: 'image/png', buffer: png }); await sleep(500);
  await ap.click('#chAgSave'); await sleep(900);
  ok((await J('GET', '/public/chat-config')).j.agents.length === 1 && /^data:image\/jpeg;base64,/.test((await J('GET', '/public/chat-config')).j.agents[0].photo), 'admin: a profile is saved with its picture (cropped square, small JPEG)');
  // -- member
  const mctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await mctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const mp = await mctx.newPage(); mp.on('pageerror', e => errs.push('member: ' + String(e.message).slice(0, 200)));
  const until = async (pg, fn, arg, ms) => { try { await pg.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (_) { return false; } };
  await mp.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(mp, () => document.getElementById('authScreen').style.display === 'flex');
  await mp.fill('#fPhone', phone2.replace(/^0/, '')); await mp.fill('#fPass', 'secret12'); await mp.click('#authGo');
  ok(await until(mp, () => document.getElementById('app').style.display === 'block', null, 15000), 'member: signs in');
  await mp.evaluate(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} try { stopAccountPoll(); } catch (e) {} window._smartaiNavMs = 0; });
  await mp.evaluate(() => openOverlay('support')); await until(mp, () => document.querySelectorAll('#supAgents .sup-ag').length === 1);
  ok(await mp.evaluate(() => { const b = document.querySelector('#supAgents .sup-ag'); return !!b && b.textContent.includes('Sarah') && !!b.querySelector('img') && b.querySelector('.sup-ag-dot').classList.contains('on'); }), 'member: Support shows Sarah\'s picture and name, with the green online dot (the admin panel is open)');
  await mp.click('#supAgents .sup-ag'); await until(mp, () => document.getElementById('ovChat').classList.contains('show'));
  ok(await mp.evaluate(() => document.getElementById('chatName').textContent === 'Sarah' && /end-to-end encrypted/.test(document.getElementById('chatBody').textContent)), 'member: the chat page opens, says it is end-to-end encrypted');
  await mp.fill('#chatInput', 'Hello Sarah, my withdrawal is pending'); await mp.click('#chatSend');
  ok(await until(mp, () => document.querySelectorAll('#chatList .cm.me').length === 1 && !document.querySelector('#chatList .cm-tk[viewBox] circle')), 'member: the message appears, then its clock turns into a tick');
  // -- the admin sees it, with a notice
  ok(await until(ap, () => { const b = document.getElementById('cBadge'); return b && !b.classList.contains('hidden') && b.textContent === '1'; }, null, 15000), 'admin: the Chat tab shows a red 1');
  await until(ap, () => document.querySelectorAll('#chThreads .ch-row').length === 1, null, 12000);
  ok(await ap.evaluate(() => { const r = document.querySelector('#chThreads .ch-row'); return r.classList.contains('unr') && /Hello Sarah, my withdrawal is pending/.test(r.textContent) && /via Sarah/.test(r.textContent) && !!r.querySelector('.ch-n'); }), 'admin: the inbox row shows the member, the opened message, "via Sarah" and an unread count');
  const memberTicks = () => mp.evaluate(() => { const t = document.querySelector('#chatList .cm.me .cm-tk'); return t ? (t.classList.contains('rd') ? 'read' : (t.querySelectorAll('path').length && t.innerHTML.indexOf('M7.2') > 0 ? 'delivered' : 'sent')) : 'none'; });
  await sleep(3500); ok(['delivered'].includes(await memberTicks()), 'member: two grey ticks once the admin panel has it (delivered), not blue yet', await memberTicks());
  await ap.click('#chThreads .ch-row'); await until(ap, () => document.querySelectorAll('#chMsgs .ch-m').length === 1);
  ok(await ap.evaluate(() => /Hello Sarah, my withdrawal is pending/.test(document.getElementById('chMsgs').textContent)), 'admin: opening the thread decrypts the message (only here)');
  await sleep(3500); ok(await memberTicks() === 'read', 'member: the ticks turn blue when the admin opens the chat (read)', await memberTicks());
  await ap.fill('#chInput', 'Hi, I am checking it for you now.'); await ap.click('#chSend');
  ok(await until(mp, () => document.querySelectorAll('#chatList .cm.ag').length === 1, null, 12000) && await mp.evaluate(() => /checking it for you now/.test(document.querySelector('#chatList .cm.ag').textContent)), 'member: the reply arrives within seconds, under Sarah, decrypted on the phone');
  await sleep(500); ok(await ap.evaluate(() => document.querySelectorAll('#chMsgs .ch-m.me .ch-tk').length === 1), 'admin: its own reply carries ticks');
  // -- the backup of the key
  await ap.click('[data-tab="chat"]'); await sleep(900);
  ok(await ap.evaluate(() => !!document.getElementById('chBackup')), 'admin: the key backup button is there');
  // used-ID silence is covered in test-manual-pay.js; errors:
  ok(errs.length === 0, 'no script error in either app' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'the server logged no error' + (serverErrors.length ? ': ' + serverErrors.slice(0, 3).join(' | ') : ''));
  await mp.screenshot({ path: path.join(require('os').tmpdir(), 'chat-member.png') }); await ap.screenshot({ path: path.join(require('os').tmpdir(), 'chat-admin.png') });
  await browser.close(); front.close(); adm.close();
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: customer-service chat end to end (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FAIL:', e.stack || e.message); process.exit(1); });
