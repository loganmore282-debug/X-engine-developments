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
process.env.CHAT_WAIT_MS = '1200'; process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = AK; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-chat-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
// what the time of the keys left behind: locked messages and files, stored public keys, a conversation of nothing else, and one that also holds a new message
const seed = (n, id, d) => { (fm.__stores[n] = fm.__stores[n] || new Map()).set(id, Object.assign({ _id: id }, d)); };
seed('chatMessages', 'lk1', { threadId: 'lg1', agentId: 'x', from: 'member', iv: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(40), wraps: [], at: 1000 });
seed('chatMessages', 'lk2', { threadId: 'lg2', agentId: 'x', from: 'member', iv: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(40), wraps: [], at: 1000 });
seed('chatMessages', 'nw1', { threadId: 'lg2', agentId: 'x', from: 'admin', text: 'a new plain reply', img: null, voice: null, at: 2000 });
seed('chatThreads', 'lg1', { userId: 'lg1', phone: '+256700000001', lastAt: 1000, lastFrom: 'member', lastAgentId: 'x', unreadAdmin: 1, memberReadMap: {} });
seed('chatThreads', 'lg2', { userId: 'lg2', phone: '+256700000002', lastAt: 1000, lastFrom: 'member', lastAgentId: 'x', unreadAdmin: 0, memberReadMap: {} });
seed('chatBlobs', 'a'.repeat(24), { uid: 'lg1', by: 'member', size: 40, data: 'AAAA', at: 1000 });
seed('chatBlobs', 'b'.repeat(24), { uid: 'lg2', by: 'member', size: 40, data: 'AAAA', plain: true, at: 1000 });
seed('chatMembers', 'lg1', { keys: [{ kid: 'deadbeefdeadbeef', jwk: {}, at: 1 }] });
seed('meta', 'chatKey', { jwk: {}, at: 1 });
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
// the two copies of the picture-shrinking code must be the same text
const block = src => { const a = src.indexOf('/* CHATIMG BEGIN'), b = src.indexOf('/* CHATIMG END */'); return a >= 0 && b > a ? src.slice(a, b + 20) : ''; };
const memberBlock = block(read('user-src/original_module.js')), adminBlock = block(read('admin-src/index.html'));
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

(async () => {
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  ok(memberBlock.length > 500 && memberBlock === adminBlock, 'the member app and the admin panel carry the very same picture-shrinking code');
  // ---- the start-up clean-up of everything left from the time of the keys
  for (let i = 0; i < 50 && !fm.__stores.meta.get('chatLockedPurged'); i++) await sleep(100);
  ok(!fm.__stores.chatMessages.has('lk1') && !fm.__stores.chatMessages.has('lk2') && fm.__stores.chatMessages.has('nw1'), 'start-up: the locked messages are deleted, a new plain one is kept');
  ok(!fm.__stores.chatThreads.has('lg1'), 'start-up: a conversation that held nothing else is deleted (it leaves the admin inbox)');
  ok(fm.__stores.chatThreads.has('lg2') && fm.__stores.chatThreads.get('lg2').preview === 'a new plain reply' && fm.__stores.chatThreads.get('lg2').lastFrom === 'admin', 'start-up: one that also has a new message stays, showing that message');
  ok(!fm.__stores.chatBlobs.has('a'.repeat(24)) && fm.__stores.chatBlobs.has('b'.repeat(24)), 'start-up: the locked file is deleted, a plain file is kept');
  ok(!fm.__stores.chatMembers.has('lg1') && !fm.__stores.meta.has('chatKey'), 'start-up: the stored public keys are deleted');
  fm.__stores.chatThreads.delete('lg2'); fm.__stores.chatMessages.delete('nw1'); fm.__stores.chatBlobs.delete('b'.repeat(24));   // (out of the way of the counts below)
  // ---- profiles (no keys anywhere)
  let r = await J('GET', '/public/chat-config'); ok(r.s === 200 && r.j.agents.length === 0 && !('adminKey' in r.j) && r.j.online === false, 'at first: no profiles, nobody online, and no key in the answer', r.j);
  r = await J('GET', '/admin/chat/key', null, null, true); ok(r.s === 404, 'there is no chat key route for the panel any more');
  r = await J('POST', '/admin/chat/key', { kid: 'deadbeefdeadbeef', jwk: {} }, null, true); ok(r.s === 404, 'nor a way to publish one');
  r = await J('POST', '/admin/chat/agent/save', { name: 'Sarah', photo: jpg }, null, true); ok(r.j.status === 'success' && r.j.agents.length === 1, 'the owner adds a profile (name + picture)', r.j);
  const A1 = r.j.agents[0].id;
  r = await J('POST', '/admin/chat/agent/save', { name: '<b>Daniel</b>' }, null, true); const A2 = r.j.agents.find(a => a.id !== A1).id; ok(r.j.agents.find(a => a.id === A2).name === 'Daniel' && r.j.agents.find(a => a.id === A2).photo === '', 'a second profile; markup in a name is stripped; a picture is optional');
  r = await J('POST', '/admin/chat/agent/save', { name: 'X', photo: 'javascript:alert(1)' }, null, true); ok(r.s === 400, 'a picture that is not a PNG, JPG or WebP data picture is refused');
  r = await J('POST', '/admin/chat/agent/save', { name: '' }, null, true); ok(r.s === 400, 'a profile needs a name');
  r = await J('POST', '/admin/chat/agent/save', { id: A2, name: 'Daniel K' }, null, true); ok(r.j.agents.find(a => a.id === A2).name === 'Daniel K', 'a profile can be renamed');
  r = await J('GET', '/public/chat-config'); ok(r.j.agents.length === 2 && !('adminKey' in r.j), 'members get the profiles');
  r = await J('GET', '/admin/chat/agents'); ok(r.s === 401, 'the admin routes are closed without the admin key');
  // ---- a member writes
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const tok = su.j.token, uid = su.j.uid;
  r = await J('POST', '/chat/key', { kid: 'deadbeefdeadbeef', jwk: {} }, tok); ok(r.s === 404, 'a member has no key to register any more');
  const SECRET = 'my wallet pin is 482913 and my secret words';
  const send = (agentId, text, extra, tk) => J('POST', '/chat/send', Object.assign({ agentId, text }, extra || {}), tk || tok);
  r = await send(A1, SECRET); ok(r.j.status === 'success' && r.j.id, 'the member sends a message to Sarah', r.j);
  const t1 = r.j.at;
  const stored1 = [...fm.__stores.chatMessages.values()].find(m => m.threadId === uid);
  ok(stored1 && stored1.text === SECRET && !('iv' in stored1) && !('ct' in stored1) && !('wraps' in stored1), 'the message is kept as plain text on the account (no ciphertext, no key material)', stored1);
  r = await send('nope', SECRET); ok(r.s === 404, 'a message to a profile that does not exist is refused');
  r = await send(A1, ''); ok(r.s === 400, 'an empty message is refused');
  r = await send(A1, '   \u0000  '); ok(r.s === 400, 'a message of only blanks is refused');
  r = await J('POST', '/chat/send', { agentId: A1, text: 'x', img: { id: 'not-a-blob', w: 10, h: 10, m: 'image/webp' } }, tok); ok(r.s === 400, 'a picture that does not name an uploaded file is refused');
  r = await J('POST', '/chat/send', { agentId: A1, text: 'x', img: { id: 'a'.repeat(24), w: 10, h: 10, m: 'text/html' } }, tok); ok(r.s === 400, 'a picture of a made-up type is refused');
  r = await J('POST', '/chat/send', { agentId: A1, text: 'x', voice: { id: 'a'.repeat(24), d: 9999, m: 'audio/webm' } }, tok); ok(r.s === 400, 'a voice note longer than five minutes is refused');
  r = await J('POST', '/chat/send', { agentId: A1, text: 'hi' }); ok(r.s === 401, 'a message needs a signed-in member');
  // ---- the admin inbox
  r = await J('GET', '/admin/chat/summary', null, null, true); ok(r.j.unread === 1 && r.j.threads === 1 && r.j.latestUser === uid, 'the panel is told: one unread message', r.j);
  r = await J('GET', '/admin/chat/threads', null, null, true); const th = r.j.threads[0];
  ok(r.j.threads.length === 1 && th.userId === uid && th.unread === 1 && th.lastAgentId === A1 && th.lastFrom === 'member' && th.phone.endsWith(phone.slice(1)) && th.memberOnline === true, 'one thread for the member, unread, via Sarah, member online', th);
  ok(typeof th.preview === 'string' && th.preview.length > 0 && !('last' in th), 'the inbox row carries the one-line preview itself (the panel opens nothing)', th.preview);
  // a second message, via ANOTHER profile: still ONE thread in the panel
  r = await send(A2, 'And a question for Daniel'); ok(r.j.status === 'success', 'the same member writes to another profile');
  await sleep(1100); // the 3-second send debounce is per route in other places; chat has none, but keep ordering stable
  r = await J('GET', '/admin/chat/threads', null, null, true); ok(r.j.threads.length === 1 && r.j.threads[0].unread === 2 && r.j.threads[0].lastAgentId === A2, 'whichever profile they pick, the panel keeps ONE thread (2 unread), and the reply goes to the latest profile by default');
  r = await J('GET', '/admin/chat/thread?userId=' + uid, null, null, true);
  ok(r.j.messages.length === 2 && !('memberKeys' in r.j) && r.j.messages[0].text === SECRET && r.j.messages[1].text === 'And a question for Daniel' && r.j.phone.endsWith(phone.slice(1)), 'the panel gets both messages as plain text, whichever profile they were written to', r.j.messages.length);
  // ---- ticks: sent, delivered, read
  let h = await J('GET', '/chat/history?agentId=' + A1, null, tok); const m1 = h.j.messages[0];
  ok(h.j.messages.length === 1 && m1.at === t1 && h.j.adminReadAt === 0 && h.j.adminSeenAt >= t1, 'the member sees the message with its ticks: the panel has fetched it (delivered), nobody has opened it yet (not read)', { read: h.j.adminReadAt, seen: h.j.adminSeenAt, at: m1.at });
  ok(h.j.online === true, 'the panel being open shows as online to the member');
  r = await J('POST', '/admin/chat/read', { userId: uid }, null, true); h = await J('GET', '/chat/history?agentId=' + A1, null, tok);
  ok(h.j.adminReadAt >= t1 && (await J('GET', '/admin/chat/summary', null, null, true)).j.unread === 0, 'the admin opens the chat: the message is READ and the count drops to 0');
  // ---- the reply
  const asend = (userId, agentId, text, extra) => J('POST', '/admin/chat/send', Object.assign({ userId, agentId, text }, extra || {}), null, true);
  r = await asend(uid, A1, 'Hello, I am looking into it now.'); ok(r.j.status === 'success', 'the admin replies (as Sarah, the profile the member wrote to)', r.j);
  r = await J('GET', '/chat/summary', null, tok); ok(r.j.unread[A1] === 1 && !r.j.unread[A2], 'the member sees ONE unread reply on Sarah (not on Daniel)', r.j);
  h = await J('GET', '/chat/history?agentId=' + A1, null, tok); const reply = h.j.messages.find(m => m.from === 'admin');
  ok(h.j.messages.length === 2 && reply && reply.text === 'Hello, I am looking into it now.', 'the member reads the reply (plain text, no key needed)');
  const tok2 = (await J('POST', '/auth/login', { phone, password: 'secret12' })).j.token; ok(!!tok2 && tok2 !== tok, 'the same account signs in on a SECOND device');
  const h2 = await J('GET', '/chat/history?agentId=' + A1, null, tok2); ok(h2.j.messages.length === 2 && h2.j.messages.map(m => m.text).join('|') === h.j.messages.map(m => m.text).join('|'), 'and that device shows exactly the same conversation, old messages included');
  ok(h.j.messages.every(m => m.agentId === A1), 'a profile\'s chat holds only what was said to it');
  r = await J('POST', '/chat/read', { agentId: A1 }, tok); r = await J('GET', '/chat/summary', null, tok); ok(!r.j.unread[A1], 'the member reads it: the count goes');
  let td = (await J('GET', '/admin/chat/thread?userId=' + uid, null, null, true)).j; const replyAt = td.messages.find(m => m.from === 'admin').at;
  ok(td.memberReadAt >= replyAt && td.memberSeenAt >= replyAt, 'the panel sees its reply as delivered and read (the two blue ticks)', { r: td.memberReadAt, s: td.memberSeenAt, at: replyAt });
  r = await asend('nobody-here', A1, 'hello'); ok(r.s === 404, 'a reply to a member with no chat is refused');
  // ---- live delivery: an open request is answered the instant something happens
  const getJ = async (p, tk, adm) => { const r2 = await fetch(base + p, { headers: { authorization: 'Bearer ' + (adm ? AK : tk) } }); return r2.json(); };
  let sm = await J('GET', '/chat/summary', null, tok); const seq0 = sm.j.seq;
  ok(Number.isFinite(seq0) && seq0 > 1e12, 'the member gets a position number to wait from');
  let w0 = Date.now(); const waitP = getJ('/chat/wait?seq=' + seq0, tok); await sleep(200);
  let t0 = Date.now(); r = await asend(uid, A1, 'Live reply one'); const live = await waitP;
  ok(live.events.length === 1 && live.events[0].kind === 'msg' && live.events[0].msg.from === 'admin' && live.events[0].msg.agentId === A1 && Date.now() - t0 < 400, 'a waiting phone is answered AT ONCE with the reply itself (no second request)', { ms: Date.now() - t0, ev: live.events.map(e => e.kind) });
  ok(live.events[0].msg.text === 'Live reply one', 'and the message arrives as plain text, ready to show');
  ok(r.j.delivered === true, 'the panel is told it was delivered the moment it was sent (the phone was waiting)');
  w0 = Date.now(); const none = await getJ('/chat/wait?seq=' + live.seq, tok);
  ok(none.events.length === 0 && Date.now() - w0 >= 1000 && Date.now() - w0 < 2500, 'with nothing to report the request is held, then ends quietly and is simply made again', Date.now() - w0);
  const reset = await getJ('/chat/wait?seq=5', tok); ok(reset.reset === true && reset.seq > seq0 - 1, 'a position older than the server remembers (a restart) is told to reload');
  const am = await getJ('/admin/chat/summary', null, true); const aWait = getJ('/admin/chat/wait?seq=' + am.seq, null, true); await sleep(150);
  t0 = Date.now(); r = await send(A1, 'Member live one');
  const aLive = await aWait; const ev = aLive.events.find(e => e.kind === 'msg');
  ok(ev && ev.uid === uid && ev.msg.from === 'member' && ev.who && ev.who.phone.endsWith(phone.slice(1)) && Date.now() - t0 < 400, 'the panel\'s open request is answered at once with the member\'s message and who sent it', { ms: Date.now() - t0 });
  ok(r.j.delivered === true, 'the member is told "delivered" at once because the panel is open');
  // the panel opening the chat wakes the member's waiting phone (the blue ticks)
  let seq1 = (await J('GET', '/chat/summary', null, tok)).j.seq; const rdWait = getJ('/chat/wait?seq=' + seq1, tok); await sleep(150);
  await J('POST', '/admin/chat/read', { userId: uid }, null, true); const rd = await rdWait;
  ok(rd.events.some(e => e.kind === 'adminRead' && e.at > 0), 'opening the chat in the panel reaches the member\'s phone at once (the blue ticks)');
  // a few tabs at most: the oldest open request is released
  const many = [0, 1, 2, 3, 4].map(() => getJ('/chat/wait?seq=' + rd.seq, tok)); await sleep(300);
  const released = await Promise.race([many[0], sleep(900).then(() => null)]);
  ok(released && released.events.length === 0, 'more than three open requests from one member: the oldest is released');
  await Promise.all(many);
  // long conversations: the NEWEST messages come back, not the oldest 300
  const bigUser = (await J('POST', '/auth/signup', { phone: '0779998888', password: 'secret12' })); await J('POST', '/register', { pin: '123456', referralCode: '' }, bigUser.j.token);
  const store = fm.__stores.chatMessages; for (let i = 0; i < 350; i++) store.set('big' + i, { threadId: bigUser.j.uid, agentId: A1, from: i % 2 ? 'admin' : 'member', iv: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(30), wraps: [], at: 1000000 + i });
  h = await J('GET', '/chat/history?agentId=' + A1, null, bigUser.j.token);
  ok(h.j.messages.length === 300 && h.j.messages[299].at === 1000349 && h.j.messages[0].at === 1000050, 'a long conversation returns the newest 300 messages (not the oldest)', { n: h.j.messages.length, last: h.j.messages[h.j.messages.length - 1] && h.j.messages[h.j.messages.length - 1].at });
  h = await J('GET', '/chat/history?agentId=' + A1 + '&after=1000349', null, bigUser.j.token); ok(h.j.messages.length === 1 && h.j.messages[0].at === 1000349, 'asking for what is newer includes the last message itself (nothing sent in the same millisecond is ever lost)');
  r = await asend(uid, 'gone-agent', 'hi'); ok(r.s === 400, 'a reply under a profile that no longer exists is refused with a clear message');
  // ---- "typing...": never stored, woken at once to the other side, ended by a message
  const mwait = (tk, seq) => getJ('/chat/wait?seq=' + seq, tk), awaitA = seq => getJ('/admin/chat/wait?seq=' + seq, null, true);
  let sq = (await J('GET', '/admin/chat/summary', null, null, true)).j.seq; let aw2 = awaitA(sq); await sleep(150);
  let tt = Date.now(); await J('POST', '/chat/typing', { agentId: A1, typing: true }, tok); let ty = await aw2;
  ok(Array.isArray(ty.typing) && ty.typing.some(x => x.userId === uid && x.agentId === A1) && Date.now() - tt < 400, 'a member typing is told to the panel at once (no message stored)', { ms: Date.now() - tt, typing: ty.typing });
  ok(!JSON.stringify([...fm.__stores.chatMessages.values()]).includes('typing'), 'and nothing about it is kept');
  sq = (await J('GET', '/chat/summary', null, tok)).j.seq; let mw2 = mwait(tok, sq); await sleep(150);
  tt = Date.now(); await J('POST', '/admin/chat/typing', { userId: uid, agentId: A1, typing: true }, null, true); ty = await mw2;
  ok(ty.typing && ty.typing.agentId === A1 && Date.now() - tt < 400, 'the panel typing reaches the member\'s waiting phone at once, naming the profile', { ms: Date.now() - tt, typing: ty.typing });
  r = await J('GET', '/chat/wait?seq=' + ty.seq, null, tok).catch(() => null);
  await asend(uid, A1, 'stops typing now');
  ty = await getJ('/chat/wait?seq=' + (ty.seq + 999999999), tok); ok(!ty.typing, 'sending a message ends "typing…"');
  // ---- pictures: locked bytes, owner or admin only
  const raw = crypto.getRandomValues(new Uint8Array(60000)); const sealedPic = { ct: raw };
  const up = async (path, bytes, tk, adm, ctype) => { const r2 = await fetch(base + path, { method: 'POST', headers: { 'content-type': ctype || 'application/octet-stream', authorization: 'Bearer ' + (adm ? AK : tk) }, body: bytes }); let j2 = null; try { j2 = await r2.json(); } catch (_) {} return { s: r2.status, j: j2 }; };
  let u1 = await up('/chat/blob', sealedPic.ct, tok); ok(u1.j.status === 'success' && /^[0-9a-f]{24}$/.test(u1.j.id) && u1.j.size === sealedPic.ct.length, 'the member uploads a picture (a plain file)', u1);
  const dl = await fetch(base + '/chat/blob/' + u1.j.id, { headers: { authorization: 'Bearer ' + tok } }); const dlb = new Uint8Array(await dl.arrayBuffer());
  ok(dl.status === 200 && /immutable/.test(dl.headers.get('cache-control') || '') && dlb.length === sealedPic.ct.length, 'it comes back byte for byte, told to be kept by the phone for good (never downloaded twice)');
  ok(Buffer.compare(Buffer.from(dlb), Buffer.from(raw)) === 0, 'and it is the very same picture, nothing to unlock');
  ok(Buffer.from(fm.__stores.chatBlobs.get(u1.j.id).data, 'base64').compare(Buffer.from(raw)) === 0 && fm.__stores.chatBlobs.get(u1.j.id).plain === true, 'the server keeps the file as it came (stamped plain)');
  const dlA = await fetch(base + '/admin/chat/blob/' + u1.j.id, { headers: { authorization: 'Bearer ' + AK } }); ok(dlA.status === 200, 'the admin panel can fetch it');
  const other3 = await J('POST', '/auth/signup', { phone: '0778881111', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, other3.j.token);
  const dlO = await fetch(base + '/chat/blob/' + u1.j.id, { headers: { authorization: 'Bearer ' + other3.j.token } }); ok(dlO.status === 404, 'another member cannot fetch it (404)');
  ok((await fetch(base + '/chat/blob/' + u1.j.id)).status === 401 && (await fetch(base + '/admin/chat/blob/' + u1.j.id)).status === 401, 'nobody without a sign-in can');
  ok((await fetch(base + '/chat/blob/../../etc', { headers: { authorization: 'Bearer ' + tok } })).status === 404 && (await fetch(base + '/chat/blob/zzzz', { headers: { authorization: 'Bearer ' + tok } })).status === 404, 'a made-up id is a plain 404');
  u1 = await up('/chat/blob', new Uint8Array(700 * 1024), tok); ok(u1.s === 400, 'a picture over 600 KB is refused (the app sends far smaller ones)');
  u1 = await up('/chat/blob', new Uint8Array(5), tok); ok(u1.s === 400, 'an empty or tiny upload is refused');
  u1 = await up('/chat/blob', sealedPic.ct, null); ok(u1.s === 401, 'an upload needs a signed-in member');
  u1 = await up('/admin/chat/blob?userId=' + uid, sealedPic.ct, null, true); ok(u1.j && u1.j.status === 'success', 'the admin uploads a picture for a member who has a chat');
  u1 = await up('/admin/chat/blob?userId=nobody', sealedPic.ct, null, true); ok(u1.s === 404, 'but not for a member with no chat');
  h = await J('GET', '/chat/history?agentId=' + A1, null, tok); ok(h.j.messages.length > 0 && h.j.messages.every(m => !('wraps' in m) && !('iv' in m) && !('ct' in m)), 'a message carries only what is shown: no locks, no key material');
  // ---- limits and safety
  const suE = await J('POST', '/auth/signup', { phone: '0776667777', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, suE.j.token); const tokE = suE.j.token;
  r = await J('POST', '/chat/send', { agentId: A1, text: 'x', evil: '<script>' }, tokE); const evilDoc = [...fm.__stores.chatMessages.values()].find(m => m.text === 'x'); ok(r.j.status === 'success' && evilDoc && !('evil' in evilDoc), 'anything the server does not know is dropped, never stored');
  r = await J('POST', '/chat/send', { agentId: A1, text: 'y'.repeat(2500) }, tokE); const longDoc = [...fm.__stores.chatMessages.values()].find(m => /^y+$/.test(m.text || '')); ok(r.j.status === 'success' && longDoc.text.length === 1000, 'a very long message is cut to 1000 characters');
  let last; for (let i = 0; i < 22; i++) { last = await send(A1, 'x' + i); if (last.s === 429) break; }
  ok(last.s === 429, 'sending more than 20 messages a minute is slowed down');
  const ban = await J('POST', '/auth/signup', { phone: '0772222222', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, ban.j.token);
  await J('POST', '/admin/user/ban', { userId: ban.j.uid, banned: true }, null, true).catch(() => {});
  // ---- a profile is deleted
  r = await J('POST', '/admin/chat/agent/delete', { id: A2 }, null, true); ok(r.j.agents.length === 1, 'the owner deletes a profile');
  r = await J('GET', '/public/chat-config'); ok(r.j.agents.length === 1 && r.j.agents[0].id === A1, 'members no longer see it');
  const su3 = await J('POST', '/auth/signup', { phone: '0775556666', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su3.j.token);
  r = await send(A2, 'hello', null, su3.j.token); ok(r.s === 404, 'and can no longer write to it');
  r = await J('GET', '/admin/chat/thread?userId=' + uid, null, null, true); ok(r.j.messages.some(m => m.agentId === A2), 'but what was said to it stays in the panel');
  // ---- restricting a member: they cannot send (message, picture, voice), still read, and it can be undone (a fresh member: the earlier ones used up their sending allowance)
  const suR = await J('POST', '/auth/signup', { phone: '0775550000', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, suR.j.token);
  const tokR = suR.j.token, uidR = suR.j.uid;
  const first = { agentId: A1, text: 'first' };
  r = await J('POST', '/chat/send', first, tokR); ok(r.j.status === 'success', 'a new member writes first (so there is a chat)', r.j);
  r = await J('POST', '/admin/chat/restrict', { userId: uidR, restricted: true }); ok(r.s === 401, 'restricting needs the admin key');
  r = await J('POST', '/admin/chat/restrict', { userId: 'nobody', restricted: true }, null, true); ok(r.s === 404, 'restricting a member that does not exist is refused');
  r = await J('POST', '/admin/chat/restrict', { userId: uidR, restricted: true }, null, true); ok(r.j.status === 'success' && r.j.restricted === true, 'the panel restricts the member', r.j);
  const renv = { agentId: A1, text: 'can I write?' };
  r = await J('POST', '/chat/send', renv, tokR); ok(r.s === 403 && r.j.code === 'CHAT_RESTRICTED' && /turned off sending messages/.test(r.j.message), 'a restricted member\'s message is refused with a clear reason', r.j);
  const nR = fm.__stores.chatMessages.size; r = await J('POST', '/chat/send', renv, tokR); ok(fm.__stores.chatMessages.size === nR, 'and nothing was stored');
  u1 = await up('/chat/blob', sealedPic.ct, tokR); ok(u1.s === 403 && u1.j.code === 'CHAT_RESTRICTED', 'a restricted member cannot upload a picture or voice note either');
  r = await J('GET', '/chat/history?agentId=' + A1, null, tokR); ok(r.j.status === 'success' && r.j.restricted === true && r.j.messages.length > 0, 'they can still read the conversation, and are told they are restricted');
  r = await J('GET', '/chat/summary', null, tokR); ok(r.j.restricted === true, 'the summary says so too');
  r = await J('GET', '/admin/chat/thread?userId=' + uidR, null, null, true); ok(r.j.restricted === true, 'the panel\'s conversation view says so');
  r = await J('GET', '/admin/chat/threads', null, null, true); ok(r.j.threads.find(x => x.userId === uidR).restricted === true, 'and so does the inbox row');
  r = await J('POST', '/admin/chat/restrict', { userId: uidR, restricted: false }, null, true); ok(r.j.restricted === false, 'the panel allows the member again');
  r = await J('POST', '/chat/send', renv, tokR); ok(r.j.status === 'success', 'and the message now goes through', r.j);
  r = await J('GET', '/admin/chat/threads', null, null, true); ok(r.j.threads.find(x => x.userId === uidR).restricted === false, 'the inbox row is back to normal');
  // ---- deleting the account removes the chat
  r = await J('POST', '/admin/user/delete', { userId: uid }, null, true);
  ok([...fm.__stores.chatMessages.values()].filter(m => m.threadId === uid).length === 0 && !fm.__stores.chatThreads.has(uid), 'deleting the member\'s account deletes their chat and their thread', r.j);

  // ===================== the real apps, in a browser =====================
  const { chromium } = require('playwright'); const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const front = staticServer(path.join(__dirname, 'user')), adm = staticServer(path.join(__dirname, 'admin'));
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r)); await new Promise(r => adm.listen(ADMINP, '127.0.0.1', r));
  // fresh chat state for the browser part
  for (const c of ['chatMessages', 'chatThreads', 'chatMembers', 'chatAgents']) fm.__stores[c].clear(); fm.__stores.meta.delete('chatKey');
  const phone2 = '0773334444', su2 = await J('POST', '/auth/signup', { phone: phone2, password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su2.j.token);
  const errs = [];
  // -- admin
  const actx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block', permissions: ['microphone'] });
  const ap = await actx.newPage(); ap.on('pageerror', e => errs.push('admin: ' + String(e.message).slice(0, 200))); ap.on('dialog', d => d.accept());
  await ap.goto('http://127.0.0.1:' + ADMINP + '/'); await sleep(500);
  await ap.fill('#keyInput', AK); await ap.click('#loginBtn'); await ap.waitForSelector('#shell:not(.hidden)', { timeout: 10000 });
  await ap.click('[data-tab="chat"]'); await ap.waitForSelector('details.ch-tools', { timeout: 8000 });
  ok(await ap.evaluate(() => !document.getElementById('chMake') && !document.getElementById('chRestore') && !document.getElementById('chBackup') && !/chat key|backup|restore/i.test(document.getElementById('content').innerText)), 'admin: the Chat tab opens straight to the inbox and the profiles: no key to create, back up or restore');
  await ap.evaluate(() => { document.querySelector('details.ch-tools').open = true; }); await ap.click('#chAgAdd');
  await ap.fill('#chAgName', 'Sarah');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EIwESMolGFdFQIAJ/HAhEWXz2GAAAAAElFTkSuQmCC', 'base64');
  await ap.setInputFiles('#chAgFile', { name: 'sarah.png', mimeType: 'image/png', buffer: png }); await sleep(500);
  await ap.click('#chAgSave'); await sleep(900);
  ok((await J('GET', '/public/chat-config')).j.agents.length === 1 && /^data:image\/jpeg;base64,/.test((await J('GET', '/public/chat-config')).j.agents[0].photo), 'admin: a profile is saved with its picture (cropped square, small JPEG)');
  // -- member
  const mctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block', permissions: ['microphone'] });
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
  ok(await mp.evaluate(() => document.getElementById('chatName').textContent === 'Sarah' && !/encrypt/i.test(document.getElementById('chatBody').textContent)), 'member: the chat page opens (and does not claim any encryption)');
  const tSend = Date.now(); await mp.fill('#chatInput', 'Hello Sarah, my withdrawal is pending'); await mp.click('#chatSend');
  ok(await until(mp, () => document.querySelectorAll('#chatList .cm.me').length === 1 && !document.querySelector('#chatList .cm-tk[viewBox] circle')), 'member: the message appears, then its clock turns into a tick');
  // -- the admin sees it, with a notice
  ok(await until(ap, () => { const b = document.getElementById('cBadge'); return b && !b.classList.contains('hidden') && b.textContent === '1'; }, null, 15000), 'admin: the Chat tab shows a red 1');
  const msAdmin = Date.now() - tSend; realLog('         member -> admin: the red 1 showed ' + msAdmin + ' ms after tapping Send');
  ok(msAdmin < 2500, 'admin: the notice came within 2.5 seconds of the member tapping Send (' + msAdmin + ' ms)');
  await until(ap, () => document.querySelectorAll('#chThreads .ch-row').length === 1, null, 12000);
  ok(await ap.evaluate(() => { const r = document.querySelector('#chThreads .ch-row'); return r.classList.contains('unr') && /Hello Sarah, my withdrawal is pending/.test(r.textContent) && /via Sarah/.test(r.textContent) && !!r.querySelector('.ch-n'); }), 'admin: the inbox row shows the member, the opened message, "via Sarah" and an unread count');
  const memberTicks = () => mp.evaluate(() => { const t = document.querySelector('#chatList .cm.me .cm-tk'); return t ? (t.classList.contains('rd') ? 'read' : (t.querySelectorAll('path').length && t.innerHTML.indexOf('M7.2') > 0 ? 'delivered' : 'sent')) : 'none'; });
  ok(await until(mp, () => { const t = document.querySelector('#chatList .cm.me .cm-tk'); return !!t && t.innerHTML.indexOf('M7.2') > 0 && !t.classList.contains('rd'); }, null, 5000), 'member: two grey ticks as soon as the admin panel has it (delivered), not blue yet', await memberTicks());
  await ap.click('#chThreads .ch-row'); await until(ap, () => document.querySelectorAll('#chMsgs .ch-m').length === 1);
  ok(await ap.evaluate(() => /Hello Sarah, my withdrawal is pending/.test(document.getElementById('chMsgs').textContent)), 'admin: opening the thread shows the message');
  ok(await until(mp, () => { const t = document.querySelector('#chatList .cm.me .cm-tk'); return !!t && t.classList.contains('rd'); }, null, 5000), 'member: the ticks turn blue when the admin opens the chat (read)', await memberTicks());
  const tRep = Date.now(); await ap.fill('#chInput', 'Hi, I am checking it for you now.'); await ap.click('#chSend');
  ok(await until(mp, () => document.querySelectorAll('#chatList .cm.ag').length === 1, null, 12000) && await mp.evaluate(() => /checking it for you now/.test(document.querySelector('#chatList .cm.ag').textContent)), 'member: the reply arrives within seconds, under Sarah');
  const msMember = Date.now() - tRep; realLog('         admin -> member: the reply showed ' + msMember + ' ms after the admin tapped Send'); ok(msMember < 2500, 'member: the reply arrived within 2.5 seconds (' + msMember + ' ms)');
  await sleep(500); ok(await ap.evaluate(() => document.querySelectorAll('#chMsgs .ch-m.me .ch-tk').length === 1), 'admin: its own reply carries ticks');
  // -- typing, pictures and the speed of opening a chat
  await mp.fill('#chatInput', 'typ'); await mp.type('#chatInput', 'ing'); 
  ok(await until(ap, () => /typing/.test(document.querySelector('.ch-head').innerText), null, 4000), 'admin: "typing…" shows in the conversation while the member types');
  ok(await until(ap, () => /typing/.test(document.querySelector('#chThreads .ch-row') ? document.querySelector('#chThreads .ch-row').innerText : ''), null, 4000), 'admin: and in the inbox row');
  await mp.fill('#chatInput', '');
  await ap.fill('#chInput', 'wr'); await ap.type('#chInput', 'iting');
  ok(await until(mp, () => /typing/.test(document.getElementById('chatState').textContent) && !!document.querySelector('#chatList .cm-typ'), null, 4000), 'member: "typing…" under the name and the three dots in the chat while the panel types');
  await ap.fill('#chInput', ''); await ap.fill('#chInput', 'Here is the picture you asked for'); await ap.click('#chSend');
  ok(await until(mp, () => !document.querySelector('#chatList .cm-typ') && document.getElementById('chatState').textContent !== 'typing…', null, 4000), 'member: the dots go the moment the message arrives');
  // a big photo from the member
  const photo = fs.readFileSync('/tmp/claude-0/test-photo.jpg'); const tPic = Date.now();
  await mp.setInputFiles('#chatFile', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
  ok(await until(mp, () => !!document.querySelector('#chatList .cm.me .cm-img'), null, 3000), 'member: the picture shows in the chat the moment it is chosen (spinner while it uploads)');
  ok(await until(ap, () => { const im = document.querySelector('#chMsgs .ch-img img'); return !!im && im.naturalWidth > 0; }, null, 8000), 'admin: the picture arrives and shows');
  realLog('         photo ' + Math.round(photo.length / 1024) + ' KB chosen -> shown in the admin panel ' + (Date.now() - tPic) + ' ms later');
  const blobs = [...fm.__stores.chatBlobs.values()].filter(b => b.by === 'member').slice(-1)[0];
  ok(blobs && blobs.size < 320 * 1024 && blobs.size < photo.length, 'the picture was made small before leaving the phone (' + (photo.length >> 10) + ' KB -> ' + (blobs.size >> 10) + ' KB)');
  const dims = await ap.evaluate(() => { const im = document.querySelector('#chMsgs .ch-img img'); return [im.naturalWidth, im.naturalHeight]; }); ok(Math.max(...dims) <= 1280 && Math.max(...dims) >= 1000 && Math.abs(dims[0] / dims[1] - 4 / 3) < 0.02, 'long side at most 1280 px, shape kept (' + dims.join(' x ') + ')');
  ok(await ap.evaluate(() => { const b = document.querySelector('#chMsgs .ch-img'); return /data:image\/jpeg/.test(b.style.backgroundImage); }), 'admin: the blurred preview sits behind it');
  // the admin answers with a picture
  const tBack = Date.now(); await ap.setInputFiles('#chFile', { name: 'reply.jpg', mimeType: 'image/jpeg', buffer: photo });
  ok(await until(mp, () => { const im = document.querySelector('#chatList .cm.ag .cm-img img'); return !!im && im.naturalWidth > 0; }, null, 8000), 'member: the admin\'s picture arrives and shows');
  realLog('         admin picture -> shown on the phone ' + (Date.now() - tBack) + ' ms later');
  // pictures must not blink or jump when the list refreshes: the very same <img> element has to survive (typing dots, ticks and polls all redraw the list)
  await mp.evaluate(() => { document.querySelectorAll('#chatList .cm-img img').forEach((im, n) => { im.__keep = 'm' + n; }); window.__sc = document.getElementById('chatBody').scrollTop; });
  await ap.evaluate(() => { document.querySelectorAll('#chMsgs .ch-img img').forEach((im, n) => { im.__keep = 'a' + n; }); });
  const nPicM = await mp.evaluate(() => document.querySelectorAll('#chatList .cm-img img').length), nPicA = await ap.evaluate(() => document.querySelectorAll('#chMsgs .ch-img img').length);
  ok(nPicM >= 2 && nPicA >= 2, 'both screens hold the two pictures before the refresh (member ' + nPicM + ', admin ' + nPicA + ')');
  await ap.fill('#chInput', 'xx'); await ap.type('#chInput', 'yy');
  ok(await until(mp, () => !!document.querySelector('#chatList .cm-typ'), null, 4000), 'member: the list was redrawn (typing dots came)');
  await mp.fill('#chatInput', 'zz'); await mp.type('#chatInput', 'ww');
  ok(await until(ap, () => /typing/.test(document.querySelector('.ch-head').innerText), null, 4000), 'admin: the conversation was redrawn (typing line came)');
  ok(await mp.evaluate(() => { const l = [...document.querySelectorAll('#chatList .cm-img img')]; return l.length > 0 && l.every((im, n) => im.__keep === 'm' + n); }), 'member: the same picture elements are still there after a redraw (no blink, no new fade)');
  ok(await ap.evaluate(() => { const l = [...document.querySelectorAll('#chMsgs .ch-img img')]; return l.length > 0 && l.every((im, n) => im.__keep === 'a' + n); }), 'admin: the same picture elements are still there after a redraw');
  ok(await mp.evaluate(() => Math.abs(document.getElementById('chatBody').scrollTop - window.__sc) < 200), 'member: and the list did not jump');
  await mp.fill('#chatInput', ''); await ap.fill('#chInput', '');
  await mp.evaluate(() => chatRender(false)); await mp.evaluate(() => chatRender(false));
  ok(await mp.evaluate(() => [...document.querySelectorAll('#chatList .cm-img img')].every((im, n) => im.__keep === 'm' + n)), 'member: redrawing again and again leaves the pictures alone');
  // tap to enlarge
  await mp.click('#chatList .cm.ag .cm-img'); ok(await mp.evaluate(() => document.getElementById('chatViewer').classList.contains('show') && !!document.querySelector('#chatViewer img')), 'member: tapping a picture opens it full screen');
  // the phone's Back button closes the picture only, not the chat behind it
  await mp.goBack(); await sleep(250);
  ok(await mp.evaluate(() => !document.getElementById('chatViewer').classList.contains('show') && document.getElementById('ovChat').classList.contains('show')), 'member: Back closes the picture and stays in the chat');
  await mp.click('#chatList .cm.ag .cm-img'); await sleep(150); await mp.click('#chatViewer'); await sleep(250);
  ok(await mp.evaluate(() => !document.getElementById('chatViewer').classList.contains('show') && document.getElementById('ovChat').classList.contains('show')), 'member: a tap closes the picture and stays in the chat');
  await mp.goBack(); await sleep(250);
  ok(await mp.evaluate(() => !document.getElementById('ovChat').classList.contains('show')), 'member: and then Back leaves the chat as before (no extra stuck step)');
  await mp.evaluate(() => chatOpen(_cc.cfg.agents[0].id)); await sleep(300);
  // admin: the same on the panel
  await ap.click('#chMsgs .ch-img.ready'); ok(await ap.evaluate(() => document.getElementById('chViewer').classList.contains('show')), 'admin: tapping a picture opens it full screen');
  await ap.goBack(); await sleep(250);
  ok(await ap.evaluate(() => !document.getElementById('chViewer').classList.contains('show') && !!document.getElementById('chMsgs')), 'admin: Back closes the picture and stays on the chat');
  await ap.click('#chMsgs .ch-img.ready'); await sleep(150); await ap.click('#chViewer'); await sleep(250);
  ok(await ap.evaluate(() => !document.getElementById('chViewer').classList.contains('show')), 'admin: a tap closes it too');
  // opening again is instant (this phone's own copy)
  await mp.evaluate(() => chatBack()); await sleep(300);
  const tOpen = await mp.evaluate(() => new Promise(res => { const t0 = performance.now(); chatOpen(_cc.cfg.agents[0].id); const iv = setInterval(() => { if (document.querySelectorAll('#chatList .cm').length >= 3) { clearInterval(iv); res(Math.round(performance.now() - t0)); } }, 5); setTimeout(() => { clearInterval(iv); res(-1); }, 3000); }));
  realLog('         reopening the chat: messages on screen after ' + tOpen + ' ms');
  ok(tOpen >= 0 && tOpen < 400, 'member: reopening a chat paints the conversation within 400 ms (from the phone\'s own copy, no waiting for the network): ' + tOpen + ' ms');
  ok(await mp.evaluate(() => !document.getElementById('navVeil').classList.contains('on')), 'member: and with no loading dots');
  // -- voice notes: recorded, sent, played on the other side (the browser's fake microphone supplies a beep)
  const blobsBefore = fm.__stores.chatBlobs.size;
  await mp.click('#chatMic'); ok(await until(mp, () => document.getElementById('chatBar').classList.contains('recording'), null, 3000), 'member: the mic button starts recording (the recording bar with the timer replaces the text box)');
  await sleep(1800);
  ok(await mp.evaluate(() => /^0:0[1-9]/.test(document.getElementById('chatRecT').textContent)), 'member: the timer counts');
  await mp.click('#chatRec .chat-send');
  ok(await until(mp, () => { const v = document.querySelector('#chatList .cm.me .cm-vn:not(.pend)'); return !!v && Number(v.getAttribute('data-d')) >= 1; }, null, 8000), 'member: the voice note shows in the chat with its length once sent');
  ok(!(await mp.evaluate(() => document.getElementById('chatBar').classList.contains('recording'))), 'member: the recording bar is gone again');
  ok(fm.__stores.chatBlobs.size === blobsBefore + 1, 'the server stored one file for it');
  const lastBlob = [...fm.__stores.chatBlobs.values()].pop(), vraw = Buffer.from(lastBlob.data, 'base64');
  ok(vraw.length > 500 && ((vraw[0] === 0x1a && vraw[1] === 0x45 && vraw[2] === 0xdf && vraw[3] === 0xa3) || vraw.indexOf(Buffer.from('OggS')) === 0 || vraw.indexOf(Buffer.from('ftyp')) === 4), 'and it is the plain recording (a real audio file, nothing to unlock)');
  ok(await until(ap, () => !!document.querySelector('#chMsgs .ch-m.ag .ch-vn:not(.pend)'), null, 8000), 'admin: the voice note arrives in the conversation');
  ok(await ap.evaluate(() => /Voice note/.test(document.querySelector('#chThreads .ch-row .ch-prev').innerText)), 'admin: the inbox row says "Voice note"');
  await ap.click('#chMsgs .ch-m.ag .ch-vp');
  ok(await until(ap, () => { const v = document.querySelector('#chMsgs .ch-m.ag .ch-vn'); return v.classList.contains('playing') || (v.querySelector('.ch-vb i').style.width !== '' && v.querySelector('.ch-vb i').style.width !== '0%') || false; }, null, 6000), 'admin: pressing play opens (unlocks) and plays it');
  await ap.click('#chMsgs .ch-m.ag .ch-vp'); await sleep(200);
  ok(await ap.evaluate(() => !document.querySelector('#chMsgs .ch-m.ag .ch-vn').classList.contains('playing')), 'admin: pressing again pauses it');
  // the admin answers by voice
  await ap.click('#chMic'); ok(await until(ap, () => document.querySelector('.ch-bar').classList.contains('recording'), null, 3000), 'admin: the mic button starts recording');
  await sleep(1500); await ap.click('#chRecOk');
  ok(await until(mp, () => !!document.querySelector('#chatList .cm.ag .cm-vn:not(.pend)'), null, 8000), 'member: the admin\'s voice note arrives');
  await mp.click('#chatList .cm.ag .cm-vp');
  ok(await until(mp, () => { const v = document.querySelector('#chatList .cm.ag .cm-vn'); return v.classList.contains('playing') || (v.querySelector('.cm-vb i').style.width !== '' && v.querySelector('.cm-vb i').style.width !== '0%'); }, null, 6000), 'member: pressing play plays it');
  await mp.click('#chatList .cm.ag .cm-vp'); await sleep(200);
  // cancelling sends nothing
  const nVn = await mp.evaluate(() => document.querySelectorAll('#chatList .cm-vn').length), blobsNow = fm.__stores.chatBlobs.size;
  await mp.click('#chatMic'); await sleep(1300); await mp.click('#chatRec .chat-attach'); await sleep(500);
  ok(await mp.evaluate(n => document.querySelectorAll('#chatList .cm-vn').length === n && !document.getElementById('chatBar').classList.contains('recording'), nVn) && fm.__stores.chatBlobs.size === blobsNow, 'member: cancelling a recording sends nothing');
  // typing text swaps the mic for the send button
  await mp.fill('#chatInput', 'hello'); ok(await mp.evaluate(() => getComputedStyle(document.getElementById('chatSend')).display !== 'none' && getComputedStyle(document.getElementById('chatMic')).display === 'none'), 'member: with text typed the send button shows instead of the mic');
  await mp.fill('#chatInput', ''); ok(await mp.evaluate(() => getComputedStyle(document.getElementById('chatMic')).display !== 'none' && getComputedStyle(document.getElementById('chatSend')).display === 'none'), 'member: with nothing typed the mic shows');
  // -- restricting from the panel, live on the phone; and the member's details open from the chat header
  await ap.click('#chWhoBtn'); ok(await until(ap, () => { const m = document.getElementById('modalRoot'); return !m.classList.contains('hidden') && /0773334444|773334444/.test(m.innerText); }, null, 6000), 'admin: tapping the member\'s profile opens their full details (the same as in the Users tab)');
  ok(await ap.evaluate(() => /Wallet|Balance|Invested|Team|Recharge/i.test(document.getElementById('modalRoot').innerText)), 'admin: with the account figures in it');
  await ap.evaluate(() => { const m = document.getElementById('modalRoot'); m.classList.add('hidden'); m.innerHTML = ''; });
  await ap.click('#chRestrict');
  ok(await until(mp, () => document.getElementById('chatBar').classList.contains('restricted') && getComputedStyle(document.getElementById('chatLock')).display !== 'none' && getComputedStyle(document.getElementById('chatInput')).display === 'none', null, 5000), 'member: the moment the panel restricts, the text box is replaced by the notice (live)');
  ok(await until(ap, () => /cannot send/.test(document.querySelector('.ch-head').innerText) && /Allow messages/.test(document.getElementById('chRestrict').textContent), null, 4000), 'admin: the conversation shows "cannot send" and the button becomes "Allow messages"');
  ok(await until(ap, () => /cannot send/.test(document.querySelector('#chThreads .ch-row').innerText), null, 4000), 'admin: the inbox row says "cannot send"');
  await ap.click('#chRestrict');
  ok(await until(mp, () => !document.getElementById('chatBar').classList.contains('restricted') && getComputedStyle(document.getElementById('chatInput')).display !== 'none', null, 5000), 'member: allowed again, the text box is back at once');
  // microphone switched off for the app: asking again shows nothing, so the app explains how to turn it on, and "try again" works once it is on
  await mp.evaluate(() => { window.__q = navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query = async () => ({ state: 'denied' }); });
  await mp.click('#chatMic');
  ok(await until(mp, () => document.getElementById('micSheetBg').classList.contains('show') && /Permissions/.test(document.getElementById('micSheetSteps').innerText) && !document.getElementById('chatBar').classList.contains('recording'), null, 3000), 'member: with the microphone switched off, a sheet says exactly how to turn it on (no silent failure)');
  await mp.evaluate(() => { navigator.permissions.query = window.__q; });
  await mp.click('#micTryBtn');
  ok(await until(mp, () => document.getElementById('chatBar').classList.contains('recording') && !document.getElementById('micSheetBg').classList.contains('show'), null, 3000), 'member: "I turned it on, try again" closes the sheet and starts recording');
  await mp.click('#chatRec .chat-attach'); await sleep(300);
  // the microphone must not be blocked by the page's own security headers (it was: "microphone=()" made the phone refuse without even asking)
  const hh = await fetch(base + '/health'); ok(/microphone=\(self\)/.test(hh.headers.get('permissions-policy') || ''), 'server header lets this app use the microphone (and only this app)', { h: hh.headers.get('permissions-policy') });
  const ng = require('child_process').execFileSync('node', [path.join(__dirname, 'deploy/make-nginx.js'), 'dev', 'ADMINPATH'], { encoding: 'utf8' });
  ok(/Permissions-Policy "[^"]*microphone=\(self\)/.test(ng) && !/microphone=\(\)/.test(ng), 'nginx header lets this app use the microphone too');
  // -- no keys: a second phone signed in to the SAME account shows the same chat and can write
  const m2ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await m2ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const m2 = await m2ctx.newPage(); m2.on('pageerror', e => errs.push('member2: ' + String(e.message).slice(0, 200)));
  await m2.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(m2, () => document.getElementById('authScreen').style.display === 'flex');
  await m2.fill('#fPhone', phone2.replace(/^0/, '')); await m2.fill('#fPass', 'secret12'); await m2.click('#authGo');
  ok(await until(m2, () => document.getElementById('app').style.display === 'block', null, 15000), 'second phone: signs in to the same account');
  await m2.evaluate(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} try { stopAccountPoll(); } catch (e) {} window._smartaiNavMs = 0; });
  await m2.evaluate(() => openOverlay('support')); await until(m2, () => document.querySelectorAll('#supAgents .sup-ag').length === 1);
  await m2.click('#supAgents .sup-ag');
  const nFirst = await mp.evaluate(() => document.querySelectorAll('#chatList .cm').length);
  ok(await until(m2, n => document.querySelectorAll('#chatList .cm').length === n, nFirst, 8000) && await m2.evaluate(() => /checking it for you now/.test(document.getElementById('chatList').textContent) && !/can no longer be shown/.test(document.getElementById('chatList').textContent)), 'second phone: opens the very same conversation, every message readable (' + nFirst + ' messages)');
  await m2.fill('#chatInput', 'written from my second phone'); await m2.click('#chatSend');
  ok(await until(mp, () => /written from my second phone/.test(document.getElementById('chatList').textContent), null, 8000), 'first phone: shows what was written on the second phone');
  ok(await until(ap, () => /written from my second phone/.test(document.getElementById('chMsgs').textContent), null, 8000), 'admin: gets it too');
  ok(await until(ap, () => !!document.querySelector('#chMsgs .ch-img img') && document.querySelector('#chMsgs .ch-img img').naturalWidth > 0, null, 5000) && await ap.evaluate(() => !document.getElementById('chBackup')), 'admin: pictures still show and there is no key backup button');
  // a locked message that somehow still exists is never shown at all (not even as a placeholder), on either side
  const legacyUid = [...fm.__stores.users.entries()].find(([k, u]) => u.phone && u.phone.endsWith(phone2.slice(1)))[0];
  fm.__stores.chatMessages.set('old-locked', { _id: 'old-locked', threadId: legacyUid, agentId: [...fm.__stores.chatAgents.keys()][0], from: 'admin', iv: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(40), wraps: [], at: 1000 });
  const shownBefore = await mp.evaluate(() => document.querySelectorAll('#chatList .cm').length);
  await mp.evaluate(() => { _cc.after = 0; _cc.msgs = []; _cc.sig = ''; }); await mp.evaluate(() => chatPoll()); await sleep(400);
  ok(await mp.evaluate(n => document.querySelectorAll('#chatList .cm').length === n && !/cannot be shown|no longer be shown/.test(document.getElementById('chatList').textContent), shownBefore), 'member: a locked message is not shown, nothing says "cannot be shown"');
  // used-ID silence is covered in test-manual-pay.js; errors:
  ok(errs.length === 0, 'no script error in either app' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'the server logged no error' + (serverErrors.length ? ': ' + serverErrors.slice(0, 3).join(' | ') : ''));
  await mp.screenshot({ path: path.join(require('os').tmpdir(), 'chat-member.png') }); await ap.screenshot({ path: path.join(require('os').tmpdir(), 'chat-admin.png') });
  await browser.close(); front.close(); adm.close();
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: customer-service chat end to end (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FAIL:', e.stack || e.message); process.exit(1); });
