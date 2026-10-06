'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function load(panel){
  const html=fs.readFileSync(__dirname+'/'+panel+'-src/index.html','utf8');
  const dom=new JSDOM(html,{url:'https://example.test/'+panel+'/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.scrollTo=()=>{};w.open=()=>null;
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  w.fetch=async()=>({status:200,json:async()=>({status:'success',settings:{},products:[],messages:[],stats:{}})});
  w.Notification={permission:'denied'};
  for(const tag of w.document.scripts){
    if(tag.src||tag.type==='module'||tag.type==='application/ld+json')continue;
    let code=tag.textContent;
    if(tag.hasAttribute('data-nx-core'))code=fs.readFileSync(__dirname+'/user-src/original_module.js','utf8')
      .replace('var _entryPromise = maybeRotateEntry();','var _entryPromise = Promise.resolve();')
      .replace('var _bootPromise = boot();','var _bootPromise = Promise.resolve();');
    if(code.trim())w.eval(code);
  }
  return dom;
}
(async()=>{
  const user=load('user'), w=user.window;await tick();
  let signedOut=0, entered=0, now=Math.floor(Date.now()/1000)*1000;w.Date.now=()=>now;
  const account={uid:'test-user',getIdToken:async()=> 'token',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(now/1000)}})};
  w.fbAuth={currentUser:account};w.fbSignOut=async()=>{signedOut++;w.fbAuth.currentUser=null;w.dispatchEvent(new w.CustomEvent('snow-auth',{detail:null}));};
  w.enterApp=async()=>entered++;
  w.dispatchEvent(new w.CustomEvent('snow-auth',{detail:account}));await tick();
  assert.equal(entered,1);assert(w.sessionStorage.getItem('soda_member_session'));
  const request=w.api,wait=deferred();let calls=0;
  w.fetch=async()=>{calls++;return wait.promise;};
  const one=request('/account'),two=request('/account');assert.equal(one,two);
  await tick();assert.equal(calls,1,'concurrent member reads share one request');
  wait.resolve({status:200,json:async()=>({status:'success'})});await one;
  w.fetch=async()=>({status:200,json:async()=>({status:'success',settings:{}})});
  w.eval('STATE.page="assets"');let navigations=0;w.showPage=()=>navigations++;
  w.navigatePage('assets');assert.equal(navigations,0);
  w.navigatePage('network');assert.equal(navigations,1);
  now+=16*60*1000;w.dispatchEvent(new w.Event('pageshow'));await tick();
  assert.equal(signedOut,0,'member remains signed in past the old 15-minute limit');
  assert(w.sessionStorage.getItem('soda_member_session'));
  now+=(4*60-16)*60*1000-1;w.dispatchEvent(new w.Event('pageshow'));await tick();
  assert.equal(signedOut,0,'member remains signed in immediately before four hours');
  now++;w.dispatchEvent(new w.Event('pageshow'));await tick();
  assert.equal(signedOut,1);assert.equal(w.sessionStorage.getItem('soda_member_session'),null);
  assert.equal(w._suppressAutofillLogin,false,'idle expiry preserves existing picker-assisted login');
  assert.equal(w.sessionStorage.getItem('soda_relogin_required'),null);
  assert.equal(w._triedAutoSignIn,true,'silent stored-password login stays disabled');
  assert.equal(w.document.querySelector('#app').style.display,'none');
  assert.equal(w.document.querySelector('#authScreen').style.display,'');
  await w.doLogout();
  assert.equal(w._suppressAutofillLogin,true,'deliberate logout still suppresses autofill auto-submit');
  assert.equal(w.sessionStorage.getItem('soda_relogin_required'),'1');
  await tick(); // Let the existing auth-settings refresh settle before closing the DOM.
  user.window.close();
  const admin=load('admin'), a=admin.window;await tick();
  let clock=Date.now();a.Date.now=()=>clock;
  a.eval('storeSession("admin-token","owner","owner")');await tick();
  const hold=deferred();calls=0;a.fetch=async()=>{calls++;return hold.promise;};
  const ar=a.api('/admin/stats'),br=a.api('/admin/stats');assert.equal(ar,br);assert.equal(calls,1);
  hold.resolve({status:200,json:async()=>({status:'success'})});await ar;
  a.document.querySelector('#content').innerHTML='<p id="retained">Visible dashboard</p>';
  a.document.querySelector('.tab[data-tab="dashboard"]').click();assert(a.document.querySelector('#retained'),'repeated active tab tap keeps DOM');
  a.fetch=async()=>({status:200,json:async()=>({status:'success'})});
  clock+=16*60*1000;a.dispatchEvent(new a.Event('pageshow'));await tick();
  assert.equal(a.sessionStorage.getItem('snow_admin_token'),null);
  assert(a.document.querySelector('#shell').classList.contains('hidden'));
  assert(!a.document.querySelector('#loginView').classList.contains('hidden'));
  assert.match(a.document.querySelector('#loginErr').textContent,/expired/);
  admin.window.close();
  console.log('PASS: member/admin login state, expired return-to-login, no silent relogin, concurrent-read deduplication, repeated-tab stability');
})().catch(e=>{console.error(e);process.exit(1)});
