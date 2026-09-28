'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDLE_MS, MAX_MS, checkMember, memberKey, validSession } = require('./session-policy');
function fakeDb(){
  const rows = new Map();
  return { rows, collection: () => ({ doc: key => ({
    get: async () => ({ exists: rows.has(key), data: () => rows.get(key) }),
    createIfAbsent: async value => { if (!rows.has(key)) rows.set(key, value); },
    updateIf: async (filter, value) => {
      const row = rows.get(key);
      if (!row || row.revoked || +row.expiresAt <= +filter.expiresAt.$gt || +row.lastActiveAt <= +filter.lastActiveAt.$gt) return false;
      Object.assign(row, value); return true;
    }
  }) }) };
}
async function serverChecks(){
  const db = fakeDb(), now = 1800000000000, token = {uid:'member-a',auth_time:now/1000};
  assert(await checkMember(db, token, false, now));
  assert(await checkMember(db, token, false, now + IDLE_MS - 1));
  assert.equal(+db.rows.get(memberKey(token)).lastActiveAt, now, 'polling cannot extend idle time');
  assert.equal(await checkMember(db, token, true, now + IDLE_MS), false, 'expired session cannot be revived by a late heartbeat');
  assert.equal(await checkMember(db, token, false, now + IDLE_MS), false);
  const fresh = {...token,auth_time:(now+IDLE_MS+1000)/1000}, login = fresh.auth_time*1000;
  assert(await checkMember(db, fresh, true, login));
  for(let t=login+60000;t<login+MAX_MS;t+=60000) assert(await checkMember(db,fresh,true,t));
  assert.equal(await checkMember(db,fresh,true,login+MAX_MS),false,'activity never extends absolute lifetime');
  const revoked={uid:'member-b',auth_time:now/1000};assert(await checkMember(db,revoked,false,now));
  db.rows.get(memberKey(revoked)).revoked=true;
  assert.equal(await checkMember(db,revoked,true,now+1000),false);
  assert.equal(await checkMember(db,{uid:'unknown',auth_time:(now-IDLE_MS)/1000},false,now),false,'legacy old token cannot manufacture a fresh session');
  assert.equal(await checkMember(db,{uid:'bad'},false,now),false);
  assert.equal(validSession({expiresAt:new Date(now+MAX_MS)},now),false,'old admin sessions without activity metadata expire');
  assert.equal(memberKey(token)===memberKey({...token,uid:'other'}),false);
}
function clientChecks(){
  const user = fs.readFileSync(__dirname+'/user-src/index.html','utf8').match(/<script data-petro-idle>([\s\S]*?)<\/script>/)[1];
  const admin = fs.readFileSync(__dirname+'/admin-src/index.html','utf8').match(/<script data-petro-idle>([\s\S]*?)<\/script>/)[1];
  assert.equal(user,admin,'both panels use the same policy');
  let now=1800000000000, expired=0, pulses=0;
  const listeners={},store=new Map();
  const document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn};
  const window={addEventListener:(name,fn)=>listeners[name]=fn};
  const context={window,document,Date:{now:()=>now},Number,JSON,Promise,setInterval:()=>1,clearInterval:()=>{},sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
  vm.runInNewContext(user,context);
  const session=window.createPetroIdleSession('test',()=>expired++,()=>pulses++);
  assert(session.begin('alice',now,true));assert.equal(pulses,1);
  now+=IDLE_MS-1;assert(session.check());assert.equal(pulses,1,'timer checks do not create activity');
  now++;listeners.pointerdown({isTrusted:true});assert.equal(expired,1,'first tap after sleeping cannot revive the session');
  assert.equal(session.check(),false);
  assert(session.begin('alice-new',now,true));
  now+=60000;document.hidden=true;listeners.keydown({isTrusted:true});document.hidden=false;
  const last=JSON.parse(store.get('test')).last;assert.equal(last,now-60000);
  listeners.keydown({isTrusted:false});assert.equal(JSON.parse(store.get('test')).last,last);
  listeners.keydown({isTrusted:true});assert.equal(JSON.parse(store.get('test')).last,now);
  // A reload keeps the previous last interaction, not the reload time.
  now+=60000;assert(session.begin('alice-new',now-120000,false));assert.equal(JSON.parse(store.get('test')).last,last+60000);
  now+=IDLE_MS;listeners.visibilitychange();assert.equal(expired,2);
  const start=now;assert(session.begin('bob',start,true));
  for(let t=start+60000;t<start+MAX_MS;t+=60000){now=t;listeners.pointerdown({isTrusted:true});assert(session.check());}
  now=start+MAX_MS;assert.equal(session.check(),false);assert.equal(expired,3);
  assert.equal(session.begin('legacy',0,false),false);
  store.set('test',JSON.stringify({identity:'corrupt',started:now}));assert.equal(session.begin('corrupt',now,false),false);
}
(async()=>{await serverChecks();clientChecks();console.log('PASS: idle/absolute expiry, activity-only renewal, refresh/hidden tabs, revocation, migration and account isolation');})().catch(e=>{console.error(e);process.exitCode=1;});
