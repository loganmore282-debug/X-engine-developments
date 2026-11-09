'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function load(panel){
  const built=process.argv.includes('--built');
  const html=fs.readFileSync(__dirname+'/'+panel+(built?'':'-src')+'/index.html','utf8');
  const dom=new JSDOM(html,{url:'https://example.test/'+panel+'/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.scrollTo=()=>{};w.open=()=>null;
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  w.fetch=async()=>({status:200,json:async()=>({status:'success',settings:{},products:[],messages:[],stats:{}})});
  w.Notification={permission:'denied'};
  for(const tag of w.document.scripts){
    if(tag.src||tag.type==='module'||tag.type==='application/ld+json')continue;
    let code=tag.textContent;
    if(tag.hasAttribute('data-nx-core'))code=(built
      ? require('node:zlib').inflateSync(Buffer.from(tag.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1],'base64')).toString()
      : fs.readFileSync(__dirname+'/user-src/original_module.js','utf8'))
      .replace('var _entryPromise = maybeRotateEntry();','var _entryPromise = Promise.resolve();')
      .replace('var _bootPromise = boot();','var _bootPromise = Promise.resolve();');
    if(code.trim())w.eval(code);
  }
  return dom;
}

(async()=>{
 for(const mode of ['normal','clock-skew','401','token-error']){
  const dom=load('user'),w=dom.window;await tick();
  const now=Math.floor(Date.now()/1000)*1000;w.Date.now=()=>now;
  let out=0;const notes=[];
  const account={uid:'fixture',getIdToken:async()=> 'fixture-token',getIdTokenResult:async()=>{
    if(mode==='token-error')throw Error('offline');
    return {claims:{auth_time:(now+(mode==='clock-skew'?2000:0))/1000}};
  }};
  w.notify=m=>notes.push(m);w.fbAuth={currentUser:null};
  w.fetch=async url=>({status:mode==='401'&&String(url).endsWith('/auth/session/activity')?401:200,json:async()=>({status:'success',settings:{}})});
  w.fbSignOut=async()=>{out++;w.fbAuth.currentUser=null;w.dispatchEvent(new w.CustomEvent('snow-auth',{detail:null}));};
  w.enterApp=async()=>{await tick();if(w.fbAuth.currentUser){w.eval('STATE.account={phone:"fixture"}');w.document.getElementById('app').style.display='';}};
  w.fbSignIn=async()=>{w.fbAuth.currentUser=account;w.dispatchEvent(new w.CustomEvent('snow-auth',{detail:account}));return {user:account}};
  const phone=w.document.getElementById('loginPhone'),pass=w.document.getElementById('loginPassword'),btn=w.document.getElementById('loginBtn');
  phone.value='770000000';pass.value='fixture-password';
  await w.doLogin();await tick();
  assert.equal(phone.value,'770000000',mode+' retains phone');assert.equal(btn.disabled,false);
  if(mode==='normal'||mode==='clock-skew'){assert.equal(out,0);assert.equal(w.document.getElementById('app').style.display,'');}
  else {assert(out>0);assert.equal(pass.value,'');assert(notes.length>0);assert.equal(w.document.getElementById('authScreen').style.display,'');}
  dom.window.close();
 }
 const dom=load('user'),w=dom.window;await tick();
 let attempts=0,boots=0;const notes=[];
 w.notify=m=>notes.push(m);w.maybeShowOpeningGate=async()=>false;
 const user={uid:'retry',getIdToken:async()=> 'fixture',getIdTokenResult:async()=>({claims:{auth_time:Math.floor(Date.now()/1000)}})};
 w.fbAuth={currentUser:null};
 w.fbSignIn=async()=>{attempts++;w.fbAuth.currentUser=user;w.dispatchEvent(new w.CustomEvent('snow-auth',{detail:user}));return {user}};
 w.enterApp=async()=>{boots++;if(boots===1){w.document.getElementById('authScreen').style.display='';return;}w.eval('STATE.account={phone:"fixture"}');w.document.getElementById('app').style.display='';};
 const phone=w.document.getElementById('loginPhone'),pass=w.document.getElementById('loginPassword');
 phone.value='77000000';pass.value='fixture-password';
 const autofill=()=>{const e=new w.Event('animationstart',{bubbles:true});e.animationName='onAutoFillStart';phone.dispatchEvent(e);};
 autofill();await new Promise(r=>setTimeout(r,190));assert.equal(attempts,0);assert.equal(notes.length,0,'partial autofill does not show invalid-number error');
 phone.value='770000000';autofill();await new Promise(r=>setTimeout(r,190));assert.equal(attempts,1);assert.equal(boots,1);
 await w.doLogin();assert.equal(attempts,2);assert.equal(boots,2,'same-user retry reopens account after failed boot');
 assert.equal(w.document.getElementById('loginBtn').disabled,false);
 // Delayed browser sign-out cleanup cannot erase a newly selected number/password.
 let release;w.PasswordCredential=function(){};
 Object.defineProperty(w.navigator,'credentials',{value:{get(){},store(){},preventSilentAccess:()=>new Promise(r=>{release=r})},configurable:true});
 w.fbSignOut=async()=>{w.fbAuth.currentUser=null;w.dispatchEvent(new w.CustomEvent('snow-auth',{detail:null}));};
 const leaving=w.doLogout({auto:true});await tick();phone.value='780000000';pass.value='new-fixture-password';release();await leaving;
 assert.equal(phone.value,'780000000');assert.equal(pass.value,'new-fixture-password');
 await tick();dom.window.close();
 console.log('PASS: login clock skew, rejected sessions, token failures, retained phone, retry button, delayed autofill, same-user retry and delayed logout cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
