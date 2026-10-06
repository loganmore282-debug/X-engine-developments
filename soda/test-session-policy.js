'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDLE_MS, ADMIN_IDLE_MS, MAX_MS, MEMBER_MAX_MS, createMemberSession, checkMemberSession, revokeMemberSession, revokeAllMemberSessions, tokenKey, validSession } = require('./session-policy');
assert.equal(IDLE_MS, 4 * 60 * 60 * 1000, 'member inactivity limit is exactly four hours');
assert.equal(ADMIN_IDLE_MS, 15 * 60 * 1000, 'admin inactivity remains fifteen minutes');
assert.equal(MAX_MS, 8 * 60 * 60 * 1000, 'admin absolute lifetime remains eight hours');
assert.equal(MEMBER_MAX_MS, 4 * 60 * 60 * 1000, 'member sessions end after four hours');
function fakeDb(){
  const rows = new Map();
  const mk = key => ({ id: key, data: () => rows.get(key), ref: { update: async v => { Object.assign(rows.get(key), v); } } });
  return { rows, collection: () => ({
    doc: key => ({
      get: async () => ({ exists: rows.has(key), data: () => rows.get(key) }),
      set: async value => { rows.set(key, value); },
      update: async v => { if (!rows.has(key)) throw new Error('NOT_FOUND'); Object.assign(rows.get(key), v); },
      updateIf: async (filter, value) => {
        const row = rows.get(key);
        if (!row || row.revoked || +row.expiresAt <= +filter.expiresAt.$gt || +row.lastActiveAt <= +filter.lastActiveAt.$gt) return false;
        Object.assign(row, value); return true;
      }
    }),
    where: (f, o, v) => ({ get: async () => ({ docs: [...rows].filter(([, r]) => r[f] === v).map(([k]) => mk(k)) }) }),
  }) };
}
async function serverChecks(){
  const now = 1800000000000;
  let db = fakeDb();
  const { token, authTime, expiresAt } = await createMemberSession(db, 'member-a', '0770000001', now);
  assert(token.length >= 40, 'tokens are long random strings');
  assert.equal(expiresAt, now + MEMBER_MAX_MS); assert.equal(authTime, now / 1000);
  assert(!db.rows.has(token) && db.rows.has(tokenKey(token)), 'only a hash of the token is stored, never the token');
  assert.equal(JSON.stringify([...db.rows.values()]).includes(token), false, 'the token appears nowhere in the stored record');
  const ok = await checkMemberSession(db, token, false, now);
  assert.deepEqual([ok.uid, ok.phone, ok.auth_time], ['member-a', '0770000001', now / 1000]);
  assert(await checkMemberSession(db, token, false, now + 16 * 60 * 1000), 'member remains signed in past the old 15-minute limit');
  assert(await checkMemberSession(db, token, false, now + IDLE_MS - 1));
  assert.equal(+db.rows.get(tokenKey(token)).lastActiveAt, now, 'polling cannot extend idle time');
  assert.equal(await checkMemberSession(db, token, true, now + IDLE_MS), null, 'expired session cannot be revived by a late heartbeat');
  assert.equal(await checkMemberSession(db, token, false, now + IDLE_MS), null);
  // activity renews the idle window, never the absolute lifetime
  db = fakeDb(); const a = await createMemberSession(db, 'active-member', '0770000002', now), touch = now + 45 * 60 * 1000;
  assert(await checkMemberSession(db, a.token, true, touch), 'interaction after 45 minutes renews a member session');
  assert(await checkMemberSession(db, a.token, false, now + MEMBER_MAX_MS - 1));
  assert.equal(await checkMemberSession(db, a.token, true, now + MEMBER_MAX_MS), null, 'late activity cannot revive an ended session');
  db = fakeDb(); const b = await createMemberSession(db, 'long', '0770000003', now);
  for (let t = now + 60000; t < now + MEMBER_MAX_MS; t += 60000) assert(await checkMemberSession(db, b.token, true, t));
  assert.equal(await checkMemberSession(db, b.token, true, now + MEMBER_MAX_MS), null, 'activity never extends the 4-hour maximum');
  // revocation
  db = fakeDb(); const r = await createMemberSession(db, 'member-b', '0770000004', now), r2 = await createMemberSession(db, 'member-b', '0770000004', now), other = await createMemberSession(db, 'member-c', '0770000005', now);
  await revokeMemberSession(db, r.token);
  assert.equal(await checkMemberSession(db, r.token, true, now + 1000), null, 'a logged-out token stops working at once');
  assert(await checkMemberSession(db, r2.token, false, now + 1000), 'only that session ended');
  await revokeAllMemberSessions(db, 'member-b', tokenKey(r2.token));
  assert(await checkMemberSession(db, r2.token, false, now + 2000), 'the session that made a password change is kept');
  await revokeAllMemberSessions(db, 'member-b');
  assert.equal(await checkMemberSession(db, r2.token, false, now + 3000), null, 'revoke-all ends every session of the member');
  assert(await checkMemberSession(db, other.token, false, now + 3000), 'another member is never affected');
  // junk
  for (const bad of ['', null, undefined, 'short', 'x'.repeat(300), {}, 42, 'a'.repeat(43)])
    assert.equal(await checkMemberSession(db, bad, false, now), null, 'unknown or malformed token is refused: ' + String(bad).slice(0, 10));
  assert.equal(validSession({expiresAt:new Date(now+MAX_MS)},now),false,'old admin sessions without activity metadata expire');
}
function clientChecks(panel, idleMs, maxMs){
  const built = process.argv.includes('--built');
  const html = fs.readFileSync(__dirname+(built?'/user/index.html':'/user-src/index.html'),'utf8');
  if (built) assert.equal(html,fs.readFileSync(__dirname+'/user/share.html','utf8'),'referral entry ships the same member policy');
  const user = html.match(/<script data-soda-idle>([\s\S]*?)<\/script>/)[1];
  const admin = fs.readFileSync(__dirname+'/admin-src/index.html','utf8').match(/<script data-soda-idle>([\s\S]*?)<\/script>/)[1];
  assert(user.includes('IDLE = 4 * 60 * 60 * 1000, MAX = 4 * 60 * 60 * 1000'));
  assert(admin.includes('IDLE = 15 * 60 * 1000'));
  let now=1800000000000, expired=0, pulses=0;
  const listeners={},store=new Map();
  const document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn};
  const window={addEventListener:(name,fn)=>listeners[name]=fn};
  const context={window,document,Date:{now:()=>now},Number,JSON,Promise,setInterval:()=>1,clearInterval:()=>{},sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
  vm.runInNewContext(panel === 'user' ? user : admin,context);
  const session=window.createSodaIdleSession('test',()=>expired++,()=>pulses++);
  assert(session.begin('alice',now,true));assert.equal(pulses,1);
  now+=idleMs-1;assert(session.check());assert.equal(pulses,1,'timer checks do not create activity');
  now++;listeners.pointerdown({isTrusted:true});assert.equal(expired,1,'first tap after sleeping cannot revive the session');
  assert.equal(session.check(),false);
  assert(session.begin('alice-new',now,true));
  now+=60000;document.hidden=true;listeners.keydown({isTrusted:true});document.hidden=false;
  const last=JSON.parse(store.get('test')).last;assert.equal(last,now-60000);
  listeners.keydown({isTrusted:false});assert.equal(JSON.parse(store.get('test')).last,last);
  listeners.keydown({isTrusted:true});assert.equal(JSON.parse(store.get('test')).last,now);
  // A reload keeps the previous last interaction, not the reload time.
  now+=60000;assert(session.begin('alice-new',now-120000,false));assert.equal(JSON.parse(store.get('test')).last,last+60000);
  now+=idleMs;listeners.visibilitychange();assert.equal(expired,2);
  const start=now;assert(session.begin('bob',start,true));
  for(let t=start+60000;t<start+maxMs;t+=60000){now=t;listeners.pointerdown({isTrusted:true});assert(session.check());}
  now=start+maxMs;assert.equal(session.check(),false);assert.equal(expired,3);
  if(panel === 'user') {
    assert(session.begin('skew',now+2000,false),'fresh Firebase login tolerates small clock skew');
    assert.equal(JSON.parse(store.get('test')).started,now,'skew never extends local maximum');
    session.clear();
    assert.equal(session.begin('large-skew',now+61000,false),false,'large clock errors still reject');
  }
  assert.equal(session.begin('legacy',0,false),false);
  store.set('test',JSON.stringify({identity:'corrupt',started:now}));assert.equal(session.begin('corrupt',now,false),false);
}
(async()=>{await serverChecks();clientChecks('user',4*60*60*1000,4*60*60*1000);clientChecks('admin',15*60*1000,8*60*60*1000);console.log('PASS: member 4-hour idle and maximum / admin 15-minute idle, 8-hour maximum, activity-only renewal, refresh/hidden tabs, revocation, migration and account isolation');})().catch(e=>{console.error(e);process.exitCode=1;});
