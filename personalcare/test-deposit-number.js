'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {JSDOM} = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'),'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js','utf8');
const dom = new JSDOM(html,{url:'http://161.97.98.107:8104/',runScripts:'outside-only',pretendToBeVisual:true});
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
// Deposit page: the deposit number is typed right on it, Pay starts the payment straight away (no separate payment page) and the polling screen
// waits for the provider's answer.
let n=0;const ok=(c,m)=>{n++;assert.ok(c,m)};
async function main(){
  await tick();
  w.eval('STATE.page="home"; STATE.account={walletBalance:5000,phone:"0772123456"}; STATE.settings={minDeposit:15000,minWithdraw:5000,depositAvailable:true}; STATE.investments=[];');
  w.eval('openDepositFormSheet()');
  const phone=()=>d.getElementById('depPhone'), nets=()=>[...d.querySelectorAll('#depNets button')];
  ok(phone()&&phone().value==='0772123456','the Deposit page has a number box, filled with the member\'s own number');
  ok(nets().length===2&&nets().find(b=>b.classList.contains('on')).dataset.n==='MTN Mobile Money','the provider is picked from the number (077 = MTN)');
  phone().value='0701234567';w.syncDepositNet();
  ok(nets().find(b=>b.classList.contains('on')).dataset.n==='Airtel Money','070 = Airtel');
  phone().value='0751234567';w.syncDepositNet();ok(nets().find(b=>b.classList.contains('on')).dataset.n==='Airtel Money','075 = Airtel');
  phone().value='0391234567';w.syncDepositNet();ok(nets().find(b=>b.classList.contains('on')).dataset.n==='MTN Mobile Money','039 = MTN');
  w.pickDepNet(nets()[1]);ok(nets()[1].classList.contains('on')&&!nets()[0].classList.contains('on'),'the member can pick the provider by hand');
  ok(!d.getElementById('pgPayBtn')&&!d.getElementById('pgPtr'),'no separate payment page: no second form, no pull-down refresh');
  // Pay: validations first, nothing is sent
  const sent=[];const notes=[];
  w.pgSealedPost=async(path,body)=>{sent.push([path,body]);return {status:'success',depositId:'dep1',reference:'REF-1'};};
  w.post=async(path)=>{sent.push(['POST '+path]);return {status:'success'};};
  w.notify=m=>{notes.push(String(m));};
  w.depositStatusHold=async()=>({status:'success',state:'pending'});
  w.refreshTransactionsCache=async()=>{};
  d.getElementById('depAmount').value='30000';
  phone().value='';await w.submitDeposit();ok(!sent.length&&/Deposit number/.test(notes.pop()),'an empty number is refused, nothing is sent');
  phone().value='12345';await w.submitDeposit();ok(!sent.length&&/valid/.test(notes.pop()),'a number that is not a mobile number is refused');
  phone().value='0772123456';d.getElementById('depAmount').value='1000';await w.submitDeposit();ok(!sent.length&&/Minimum/.test(notes.pop()),'below the minimum is refused');
  d.getElementById('depAmount').value='30000';
  nets().forEach(b=>b.classList.remove('on'));await w.submitDeposit();ok(!sent.length&&/MTN Mobile Money or Airtel/.test(notes.pop()),'no provider: asks for one');
  // Pay with everything filled in: one sealed request with the amount, the number and the provider, and the polling screen opens
  w.syncDepositNet();
  await w.submitDeposit();
  ok(sent.length===1&&sent[0][0]==='/deposit/marzpay','Pay calls /deposit/marzpay once, directly (no order is made first)');
  ok(sent[0][1].amount===30000&&sent[0][1].phone==='+256772123456'&&sent[0][1].network==='MTN Mobile Money'&&!('orderNo' in sent[0][1]),'with the amount, the full number and the provider');
  const scr=d.getElementById('payScreen');
  ok(scr.classList.contains('show')&&w.eval('_pg.view')==='initiated'&&w.eval('_pg.depositId')==='dep1','the polling screen is up');
  ok(/Payment Initiated/.test(d.getElementById('pgBody').textContent)&&/Awaiting mobile money approval/.test(d.getElementById('pgBody').textContent)&&/detected automatically/.test(d.getElementById('pgBody').textContent),'it says the prompt is on the phone and the payment is detected automatically');
  ok(!d.getElementById('sheetBg').classList.contains('show'),'the Deposit page is closed behind it');
  // the answer: failed -> the failed screen with Try again; matched -> success and home
  w.depositStatusHold=async()=>({status:'success',state:'failed',message:'Declined by the provider.'});
  const tok=w.eval('_pg.token');await w.eval('pgApply')({status:'success',state:'failed',message:'Declined by the provider.'},tok);
  ok(/Payment failed/.test(d.getElementById('pgBody').textContent)&&/Try again/.test(d.getElementById('pgBody').textContent),'a failed payment shows the failed screen with Try again');
  w.eval('closePaymentPage()');ok(!scr.classList.contains('show'),'Back / close leaves the polling screen');
  // success path
  sent.length=0;w.eval('openDepositFormSheet()');d.getElementById('depAmount').value='30000';d.getElementById('depPhone').value='0772123456';w.syncDepositNet();
  await w.submitDeposit();ok(scr.classList.contains('show'),'a second deposit opens the polling screen again');
  let accountReads=0;w.api=async(path)=>{if(path==='/account'){accountReads++;return {status:'success',account:{walletBalance:35000}};}return {status:'success',transactions:[]};};
  const tok2=w.eval('_pg.token');const done=await w.eval('pgApply')({status:'success',state:'matched'},tok2);
  ok(done===true&&w.eval('_pg.view')==='done','a matched payment ends the polling with success');
  w.pgHome();await new Promise(r=>setTimeout(r,60));
  ok(!scr.classList.contains('show')&&accountReads>=1&&w.eval('STATE.account.walletBalance')===35000,'Back to Home closes it and reads the new balance');
  // the old order page is gone from the code
  ok(!/\/deposit\/order\/create|openPaymentPage|pgFormHtml|ckOpenPendingPayment/.test(source),'the old payment page code is gone from the member app');
  console.log(`PASS: deposit number and polling screen (${n} checks)`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
