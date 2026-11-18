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
  r = await J('POST', '/chat/send', Object.assign({}, env, { ct: 'A'.repeat(10000) }), tok); ok(r.s === 400, 'an oversized message is refused');
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
  // ---- live delivery: an open request is answered the instant something happens
  const getJ = async (p, tk, adm) => { const r2 = await fetch(base + p, { headers: { authorization: 'Bearer ' + (adm ? AK : tk) } }); return r2.json(); };
  let sm = await J('GET', '/chat/summary', null, tok); const seq0 = sm.j.seq;
  ok(Number.isFinite(seq0) && seq0 > 1e12, 'the member gets a position number to wait from');
  let w0 = Date.now(); const waitP = getJ('/chat/wait?seq=' + seq0, tok); await sleep(200);
  env = await seal('Live reply one', uid + '|admin|' + A1, mkeys.map(k => ({ kid: k.kid, jwk: k.jwk })).concat([{ kid: adminPair.kid, jwk: adminPair.pub }])); env.userId = uid; env.agentId = A1;
  let t0 = Date.now(); r = await J('POST', '/admin/chat/send', env, null, true); const live = await waitP;
  ok(live.events.length === 1 && live.events[0].kind === 'msg' && live.events[0].msg.from === 'admin' && live.events[0].msg.agentId === A1 && Date.now() - t0 < 400, 'a waiting phone is answered AT ONCE with the reply itself (no second request)', { ms: Date.now() - t0, ev: live.events.map(e => e.kind) });
  ok(JSON.parse(await CHAT.open(live.events[0].msg, uid + '|admin|' + A1, mk.kid, mk.priv)).t === 'Live reply one', 'and that message opens with the phone\'s key');
  ok(r.j.delivered === true, 'the panel is told it was delivered the moment it was sent (the phone was waiting)');
  w0 = Date.now(); const none = await getJ('/chat/wait?seq=' + live.seq, tok);
  ok(none.events.length === 0 && Date.now() - w0 >= 1000 && Date.now() - w0 < 2500, 'with nothing to report the request is held, then ends quietly and is simply made again', Date.now() - w0);
  const reset = await getJ('/chat/wait?seq=5', tok); ok(reset.reset === true && reset.seq > seq0 - 1, 'a position older than the server remembers (a restart) is told to reload');
  const am = await getJ('/admin/chat/summary', null, true); const aWait = getJ('/admin/chat/wait?seq=' + am.seq, null, true); await sleep(150);
  env = await seal('Member live one', uid + '|member|' + A1, [{ kid: adminPair.kid, jwk: adminPair.pub }, { kid: mk.kid, jwk: mk.pub }]); env.agentId = A1; t0 = Date.now(); r = await J('POST', '/chat/send', env, tok);
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
  r = await J('POST', '/admin/chat/send', Object.assign({}, env, { userId: uid, agentId: 'gone-agent' }), null, true); ok(r.s === 400, 'a reply under a profile that no longer exists is refused with a clear message');
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
  env = await seal('stops typing now', uid + '|admin|' + A1, mkeys.map(k => ({ kid: k.kid, jwk: k.jwk })).concat([{ kid: adminPair.kid, jwk: adminPair.pub }])); env.userId = uid; env.agentId = A1; await J('POST', '/admin/chat/send', env, null, true);
  ty = await getJ('/chat/wait?seq=' + (ty.seq + 999999999), tok); ok(!ty.typing, 'sending a message ends "typing…"');
  // ---- pictures: locked bytes, owner or admin only
  const raw = crypto.getRandomValues(new Uint8Array(60000)); const sealedPic = await CHAT.sealBlob(raw);
  const up = async (path, bytes, tk, adm, ctype) => { const r2 = await fetch(base + path, { method: 'POST', headers: { 'content-type': ctype || 'application/octet-stream', authorization: 'Bearer ' + (adm ? AK : tk) }, body: bytes }); let j2 = null; try { j2 = await r2.json(); } catch (_) {} return { s: r2.status, j: j2 }; };
  let u1 = await up('/chat/blob', sealedPic.ct, tok); ok(u1.j.status === 'success' && /^[0-9a-f]{24}$/.test(u1.j.id) && u1.j.size === sealedPic.ct.length, 'the member uploads a picture (locked bytes only)', u1);
  const dl = await fetch(base + '/chat/blob/' + u1.j.id, { headers: { authorization: 'Bearer ' + tok } }); const dlb = new Uint8Array(await dl.arrayBuffer());
  ok(dl.status === 200 && /immutable/.test(dl.headers.get('cache-control') || '') && dlb.length === sealedPic.ct.length, 'it comes back byte for byte, told to be kept by the phone for good (never downloaded twice)');
  ok(Buffer.compare(Buffer.from(await CHAT.openBlob(dlb, sealedPic.key, sealedPic.iv)), Buffer.from(raw)) === 0, 'and opens, with the key that travels inside the message, to the very same picture');
  ok(Buffer.from([...fm.__stores.chatBlobs.values()][0].data, 'base64').compare(Buffer.from(sealedPic.ct)) === 0 && !Buffer.from([...fm.__stores.chatBlobs.values()][0].data, 'base64').includes(Buffer.from(raw.slice(100, 140))), 'the server holds only the locked bytes: the picture is not in its database');
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
  h = await J('GET', '/chat/history?agentId=' + A1 + '&kid=' + mk.kid, null, tok); ok(h.j.messages.length > 0 && h.j.messages.every(m => m.wraps.length === 1 && m.wraps[0].kid === mk.kid), 'asking with a key id sends only the lock for that key (half the bytes)');
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
  const { chromium } = require('playwright'); const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const front = staticServer(path.join(__dirname, 'user')), adm = staticServer(path.join(__dirname, 'admin'));
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r)); await new Promise(r => adm.listen(ADMINP, '127.0.0.1', r));
  // fresh chat state for the browser part
  for (const c of ['chatMessages', 'chatThreads', 'chatMembers', 'chatAgents']) fm.__stores[c].clear(); fm.__stores.meta.delete('chatKey');
  const phone2 = '0773334444', su2 = await J('POST', '/auth/signup', { phone: phone2, password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su2.j.token);
  const errs = [];
  // -- admin
  const actx = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block', permissions: ['microphone'] });
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
  ok(await mp.evaluate(() => document.getElementById('chatName').textContent === 'Sarah' && /end-to-end encrypted/.test(document.getElementById('chatBody').textContent)), 'member: the chat page opens, says it is end-to-end encrypted');
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
  ok(await ap.evaluate(() => /Hello Sarah, my withdrawal is pending/.test(document.getElementById('chMsgs').textContent)), 'admin: opening the thread decrypts the message (only here)');
  ok(await until(mp, () => { const t = document.querySelector('#chatList .cm.me .cm-tk'); return !!t && t.classList.contains('rd'); }, null, 5000), 'member: the ticks turn blue when the admin opens the chat (read)', await memberTicks());
  const tRep = Date.now(); await ap.fill('#chInput', 'Hi, I am checking it for you now.'); await ap.click('#chSend');
  ok(await until(mp, () => document.querySelectorAll('#chatList .cm.ag').length === 1, null, 12000) && await mp.evaluate(() => /checking it for you now/.test(document.querySelector('#chatList .cm.ag').textContent)), 'member: the reply arrives within seconds, under Sarah, decrypted on the phone');
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
  ok(await until(ap, () => { const im = document.querySelector('#chMsgs .ch-img img'); return !!im && im.naturalWidth > 0; }, null, 8000), 'admin: the picture arrives, is opened with the key inside the message and shows');
  realLog('         photo ' + Math.round(photo.length / 1024) + ' KB chosen -> shown in the admin panel ' + (Date.now() - tPic) + ' ms later');
  const blobs = [...fm.__stores.chatBlobs.values()].filter(b => b.by === 'member').slice(-1)[0];
  ok(blobs && blobs.size < 320 * 1024 && blobs.size < photo.length, 'the picture was made small before leaving the phone (' + (photo.length >> 10) + ' KB -> ' + (blobs.size >> 10) + ' KB)');
  const dims = await ap.evaluate(() => { const im = document.querySelector('#chMsgs .ch-img img'); return [im.naturalWidth, im.naturalHeight]; }); ok(Math.max(...dims) <= 1280 && Math.max(...dims) >= 1000 && Math.abs(dims[0] / dims[1] - 4 / 3) < 0.02, 'long side at most 1280 px, shape kept (' + dims.join(' x ') + ')');
  ok(await ap.evaluate(() => { const b = document.querySelector('#chMsgs .ch-img'); return /data:image\/jpeg/.test(b.style.backgroundImage); }), 'admin: the blurred preview sits behind it (inside the encrypted message)');
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
  // -- voice notes: recorded, locked, sent, played on the other side (the browser's fake microphone supplies a beep)
  const blobsBefore = fm.__stores.chatBlobs.size;
  await mp.click('#chatMic'); ok(await until(mp, () => document.getElementById('chatBar').classList.contains('recording'), null, 3000), 'member: the mic button starts recording (the recording bar with the timer replaces the text box)');
  await sleep(1800);
  ok(await mp.evaluate(() => /^0:0[1-9]/.test(document.getElementById('chatRecT').textContent)), 'member: the timer counts');
  await mp.click('#chatRec .chat-send');
  ok(await until(mp, () => { const v = document.querySelector('#chatList .cm.me .cm-vn:not(.pend)'); return !!v && Number(v.getAttribute('data-d')) >= 1; }, null, 8000), 'member: the voice note shows in the chat with its length once sent');
  ok(!(await mp.evaluate(() => document.getElementById('chatBar').classList.contains('recording'))), 'member: the recording bar is gone again');
  ok(fm.__stores.chatBlobs.size === blobsBefore + 1, 'the server stored one locked blob for it');
  const lastBlob = [...fm.__stores.chatBlobs.values()].pop(), vraw = Buffer.from(lastBlob.data, 'base64');
  ok(!(vraw[0] === 0x1a && vraw[1] === 0x45 && vraw[2] === 0xdf && vraw[3] === 0xa3) && vraw.indexOf(Buffer.from('OpusHead')) < 0 && vraw.indexOf(Buffer.from('OggS')) < 0, 'and the bytes are locked (no audio header can be seen in them)');
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
  // the microphone must not be blocked by the page's own security headers (it was: "microphone=()" made the phone refuse without even asking)
  const hh = await fetch(base + '/health'); ok(/microphone=\(self\)/.test(hh.headers.get('permissions-policy') || ''), 'server header lets this app use the microphone (and only this app)', { h: hh.headers.get('permissions-policy') });
  const ng = require('child_process').execFileSync('node', [path.join(__dirname, 'deploy/make-nginx.js'), 'dev', 'ADMINPATH'], { encoding: 'utf8' });
  ok(/Permissions-Policy "[^"]*microphone=\(self\)/.test(ng) && !/microphone=\(\)/.test(ng), 'nginx header lets this app use the microphone too');
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
