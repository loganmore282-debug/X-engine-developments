'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {JSDOM} = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'),'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js','utf8');
const dom = new JSDOM(html,{url:'http://179.198.197.114:8090/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window, d=w.document;
w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
w.matchMedia=()=>({matches:true,addListener(){},removeListener(){}});
w.fetch=async()=>({json:async()=>({status:'success',settings:{},products:[],messages:[]})});
w.open=()=>null;
for(const s of d.scripts){
  if(s.type==='module'||s.type==='application/ld+json'||s.src)continue;
  if(s.hasAttribute('data-nx-core')){
    const code=built?zlib.inflateSync(Buffer.from(s.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1],'base64')).toString():source.replace('var _entryPromise = maybeRotateEntry();','var _entryPromise = Promise.resolve();').replace('var _bootPromise = boot();','var _bootPromise = Promise.resolve();');
    w.eval(code);
  }else if(s.textContent.trim())w.eval(s.textContent);
}
const tick=()=>new Promise(r=>setTimeout(r,5));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function setState(){w.eval('STATE.page="home"; STATE.account={walletBalance:50000,totalEarned:100,totalDeposited:20000,totalWithdrawn:5000}; STATE.settings={minDeposit:15000,minWithdraw:5000,withdrawFeePct:0}; STATE.investments=[]; STATE.bankAccounts=[{id:"wallet",network:"MTN Mobile Money",phone:"256771234567",holder:"Test Member"}];')}
async function main(){
  await tick();setState();
  const request=w.api, originalFetch=w.fetch;
  w.fetch=async()=>({json:async()=>[]});
  assert.equal((await request('/public/settings')).status,'error','malformed responses must release callers');
  const auth=deferred();let requests=0;
  w.fbAuth={currentUser:{getIdToken:()=>auth.promise}};
  w.fetch=async()=>{requests++;return {json:async()=>({status:'success'})}};
  const staleRequest=request('/withdraw/request',{method:'POST',body:'{}'});
  w.eval('STATE.authEpoch++');auth.resolve('test-token');
  assert.equal((await staleRequest).stale,true);
  assert.equal(requests,0,'a mutation must not be sent after its session changes during token refresh');
  w.fbAuth={currentUser:{getIdToken:()=>new Promise(()=>{})}};
  const cancel=new w.AbortController();
  const waiting=request('/account',{signal:cancel.signal});cancel.abort();
  assert.equal((await waiting).status,'error','stalled token refresh must be cancellable');
  assert.equal(requests,0);w.fbAuth=null;w.fetch=originalFetch;
  w.api=async(path)=>path==='/account'?{status:'success',account:{walletBalance:70000,totalEarned:700,totalDeposited:30000,totalWithdrawn:10000}}
    :path==='/investments'?{status:'success',investments:[{status:'active',tierLabel:'Test Asset',amount:15000,payoutsTotal:7,dailyPayout:1000}]}
    :{status:'success',messages:[]};
  await w.renderHome();
  assert.match(d.querySelector('#homeProducts').textContent,/Test Asset|No assets yet/,'Home lists the catalogue');
  w.eval('STATE.products=[{key:"a1",name:"Test Asset",price:15000,cycle:30,expectedReturn:45000,dailyPayout:1500,isOpen:true}]');w.paintHome();
  assert.match(d.querySelector('.v-card-h').textContent,/Test Asset/,'the product name sits in the bar above its card');
  assert.match(d.querySelector('.v-rows').textContent,/UGX15,000/,'prices read UGX15,000 with no space');
  assert.equal(d.querySelectorAll('.v-quick button').length,4,'Home has Deposit, Withdraw, Help Me and Gift Code');
  assert.equal(d.querySelectorAll('.bottom-nav .navitem').length,4,'four tabs: Home, Income, Team, My');
  assert.deepEqual([...d.querySelectorAll('.bottom-nav .lbl')].map(e=>e.textContent),['Home','Income','Team','My']);
  const originalBanner=d.querySelector('.home-banner');await w.liveRefreshVisible();
  assert.equal(d.querySelector('.home-banner'),originalBanner,'balance refresh must not rebuild Home');
  w.eval('STATE.page="assets"');w.eval('STATE.investments=[{status:"active",tierKey:"a1",tierLabel:"Test Asset",amount:15000,payoutsTotal:30,payoutsMade:3,dailyPayout:1500,expectedReturn:45000,paidOut:4500,createdAt:new Date().toISOString()},{status:"active",tierKey:"a1",tierLabel:"Gifted",amount:0,payoutsTotal:30,payoutsMade:1,dailyPayout:1500,expectedReturn:45000,paidOut:0,createdAt:new Date().toISOString(),granted:true}]');w.paintAssets();
  assert.match(d.querySelector('.v-total').textContent,/Total Earnings/);assert.match(d.querySelector('#incomeTotal').textContent,/UGX700\.00/);
  assert.equal(d.querySelectorAll('#ownedAssets .v-card').length,2,'Income lists every owned asset');
  assert(d.querySelector('#ownedAssets .v-gift .v-ribbon'),'a gifted asset carries the GIFT ribbon');
  assert.equal(d.querySelectorAll('#ownedAssets .v-dates').length,2,'each owned card shows Purchase and Expire');
  w.eval('STATE.page="account"');await w.renderAccount();
  assert.match(d.querySelector('.v-me-bal').textContent,/UGX70,000\.00/);assert.match(d.querySelector('.v-vip').textContent,/VIP 0/);
  assert.deepEqual([...d.querySelectorAll('.v-tile b')].map(e=>e.textContent),['Wallet','Messages','Details','APP','Login Password','Trade Password']);
  w.eval('STATE.page="home"');
  // The old full-screen "Congratulations!" win card (showChestWin()) was
  // removed -- a redeemed gift code is now just this toast (see
  // submitChestKey() in original_module.js).
  w.notify('Giftcode redeemed successfully ✓');
  assert.match(d.querySelector('#notifyMsg').textContent,/Giftcode redeemed successfully/);
  assert.equal(d.querySelector('#notifyBg').classList.contains('show'),true);
  w.closeNotify();
  setState();
  const bank=deferred();w.api=()=>bank.promise;
  const opened=w.openWithdrawSheet();
  const input=d.querySelector('#witAmount');input.value='15,000';input.focus();w.syncWithdrawReceiveAmt();
  assert(d.querySelector('#witSubmitBtn').classList.contains('fade')===false,'the button un-fades once an amount is typed');
  bank.resolve({status:'success',accounts:[{id:'wallet',network:'MTN Mobile Money',phone:'256771234567',holder:'Test Member'}]});await opened;
  assert.equal(d.querySelector('#witAmount'),input);assert.equal(input.value,'15,000');
  assert.equal(d.querySelectorAll('.v-info li').length,4,'four withdrawal instructions');assert.match(d.querySelector('.v-info').textContent,/Fee: 0%/);assert(d.querySelector('#witPin'),'the Trade Password is asked on the Withdraw screen');
  const stale=deferred();w.api=()=>stale.promise;const previous=w.openWithdrawSheet();
  w.api=async()=>({status:'success',accounts:[{id:'new',network:'Airtel Money',phone:'256751234567',holder:'Current Wallet'}]});
  await w.openWithdrawSheet();
  stale.resolve({status:'success',accounts:[{id:'old',phone:'256701111111'}]});await previous;
  assert.match(d.querySelector('#witWallet').textContent,/Current Wallet/i,'late request must not replace a new screen');
  const payment=deferred();let posts=0;
  w.post=()=>{posts++;return payment.promise};w.notify=()=>{};w.refreshAfterWithdraw=()=>{};
  d.querySelector('#witAmount').value='5000';
  d.querySelector('#witPin').value='12345';await w.submitWithdraw();assert.equal(posts,0,'a Trade Password that is not 6 digits must not reach the server');
  d.querySelector('#witPin').value='123456';
  const first=w.submitWithdraw();await w.submitWithdraw();assert.equal(posts,1,'duplicate tap must not issue a second withdrawal');
  w.openChangeLoginPasswordSheet();
  payment.resolve({status:'success',net:5000});await first;
  assert(d.querySelector('#lpOld'),'late withdrawal response must not close another form');
  w.openDepositSheet();assert.equal(d.querySelectorAll('.v-info li').length,4);
  assert.match(d.querySelector('.v-info').textContent,/Minimum deposit amount: UGX15000/);assert.equal(d.querySelectorAll('#depPays button').length,3,'PAY-A, PAY-B and PAY-C');
  d.querySelector('#depAmount').value='15000';d.querySelector('#depPhone').value='0771234567';
  const deposit=deferred();posts=0;w.post=()=>{posts++;return deposit.promise};
  const sending=w.submitDeposit();await w.submitDeposit();assert.equal(posts,1);
  w.openChangeLoginPasswordSheet();
  deposit.resolve({status:'error',message:'Test request rejected'});await sending;
  assert(d.querySelector('#lpOld'),'deposit cleanup must tolerate the original button being removed');
  assert.equal(d.querySelector('#depRedirect'),null,'removed redirect overlay stays absent after a rejected deposit');
  console.log('PASS '+(built?'guarded bundle':'source')+': Home refresh, reward dialog, wallet races, zero fees, repeat taps, navigation, and payment guidance');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>w.close());
