'use strict';
// Offline regression tests for the September 17 audit. Executes actual source functions.
// Usage: node reproduce-chipz-audit.cjs /path/to/chipz
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {AsyncLocalStorage} = require('node:async_hooks');
const root = process.argv[2] || __dirname;
if (!root) throw new Error('Pass the chipz source directory');
const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
function section(start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'source anchors must exist: ' + start);
  return src.slice(a, b);
}
const FV = {
  increment: n => ({op:'inc', n}), serverTimestamp: () => new Date(),
  delete: () => ({op:'delete'}), arrayUnion: (...items) => ({op:'union',items})
};
function makeDb(seed) {
  const rows = structuredClone(seed);
  let serial = 0, failUserRead = false;
  function apply(row, patch) {
    for (const [k,v] of Object.entries(patch)) {
      if (v && v.op === 'inc') row[k] = (row[k] || 0) + v.n;
      else if (v && v.op === 'delete') delete row[k];
      else if (v && v.op === 'union') row[k] = [...new Set([...(row[k] || []), ...v.items])];
      else row[k] = structuredClone(v);
    }
  }
  function matches(row, filters) {
    return filters.every(([k,op,v]) => op === '==' ? row[k] === v :
      op === 'in' ? v.some(x => x === row[k] || x === null && row[k] == null) : op === '<=' ? row[k] <= v : op === '>' ? row[k] > v :
      (() => { throw new Error('Unsupported mock query operator ' + op); })());
  }
  function snap(col,id) {
    const frozen = rows[col]?.[id] ? structuredClone(rows[col][id]) : null;
    return {id, exists:!!frozen, data:() => structuredClone(frozen), ref:ref(col,id)};
  }
  function ref(col,id) {
    return {id,
      get:async() => {
        if (col === 'users' && failUserRead) { failUserRead = false; throw new Error('injected transient read failure'); }
        return snap(col,id);
      },
      set:async(data) => { rows[col] ||= {}; rows[col][id] = {}; apply(rows[col][id],data); },
      update:async(patch) => { assert(rows[col]?.[id], 'update must match existing doc'); apply(rows[col][id],patch); },
      updateIf:async(filter,patch) => {
        const row = rows[col]?.[id];
        if (!row || !Object.entries(filter).every(([k,v]) => v && '$ne' in Object(v)
          ? (Array.isArray(row[k]) ? !row[k].includes(v.$ne) : row[k] !== v.$ne)
          : row[k] === v)) return false;
        apply(row,patch); return true;
      },
      delete:async() => { delete rows[col][id]; }
    };
  }
  function query(col,filters=[],sort=null,lim=0) {
    return {
      where:(k,op,v) => query(col,[...filters,[k,op,v]],sort,lim),
      orderBy:(k,dir='asc') => query(col,filters,[k,dir],lim),
      limit:n => query(col,filters,sort,n),
      doc:(id) => ref(col,id || 'generated-' + (++serial)),
      add:async(data) => { const r = ref(col,'generated-' + (++serial)); await r.set(data); return r; },
      get:async() => {
        let entries = Object.entries(rows[col] || {}).filter(([,r]) => matches(r,filters));
        if (sort) entries.sort((a,b) => (a[1][sort[0]] > b[1][sort[0]] ? 1 : a[1][sort[0]] < b[1][sort[0]] ? -1 : 0) * (sort[1] === 'desc' ? -1 : 1));
        if (lim) entries = entries.slice(0,lim);
        const docs = entries.map(([id]) => snap(col,id));
        return {docs,empty:!docs.length,size:docs.length,forEach:fn=>docs.forEach(fn)};
      }
    };
  }
  return {rows, collection:col => query(col), failNextUserRead:() => {failUserRead=true;}};
}
function response() { return {code:200,status(n){this.code=n;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;}}; }
function context(db, extra={}) {
  const routes = new Map();
  const c = vm.createContext({
    db, FieldValue:FV, crypto, Date, Math, Map, Set, Number, String, Boolean,
    console:{log(){},warn(){},error(){}}, AbortSignal,
    app:{post:(p,fn) => routes.set(p,fn)},
    _withdrawInFlight:new Set(), _lockTails:new Map(),
    getSettings:async() => ({}), payoutIsManual:() => false,
    withdrawProvider:() => 'marzpay', fmtMoney:n => 'UGX ' + n,
    PUBLIC_URL:'https://invalid.example', MARZPAY_BASE:'https://invalid.example',
    MARZPAY_KEY:'test-only', MARZ_TIMEOUT:1000,
    // MarzPay is multi-market now, so its request body carries the region's
    // `country` and marzSendMoney refuses rather than guess when it cannot
    // tell which market a payout belongs to. In production that context comes
    // from processWithdrawalCore's withUserRegion(ownerId, ...) wrapper; these
    // fixtures are a Ugandan payout (+256 / MTN), so the sandbox says so.
    // Without this the outbound call is never made and the assertion that one
    // WAS made reads as a resend bug rather than a missing fixture.
    currentRegion:() => ({ key:'ug', name:'Uganda', dialCode:'256', currency:'UGX' }),
    MARZPAY_MARKETS:{ '256':{ code:'UG', currency:'UGX' }, '254':{ code:'KE', currency:'KES' } },
    // marzMarket() is declared far from the lifted section, so it is supplied
    // rather than sliced -- same rule the real one follows.
    marzMarket:(r) => ({ '256':{ code:'UG', currency:'UGX' }, '254':{ code:'KE', currency:'KES' } })[
      String((r && r.dialCode) || '256').replace(/\D/g,'')] || null,
    marzUserMsg:(d,f) => d.message || f, lipaUserMsg:(d,f) => d.Errors || f,
    lipaTraderId:p => p, lipaChannel:n => n,
    finalizeWithdrawalTransactionRecord:async(id,outcome) => {
      db.rows.transactions.tx.status = outcome === 'processed' ? 'success' : outcome;
    },
    ...extra
  });
  vm.runInContext(section('function withLock(key, fn)', 'const _userBeingDeleted'),c);
  return {c,routes};
}
function paymentSeed() {
  return {users:{u:{walletBalance:0,totalWithdrawn:0}}, withdrawals:{w:{
    userId:'u',status:'pending',amount:10000,net:8500,phone:'+256700000000',network:'MTN'
  }},transactions:{tx:{withdrawalId:'w',status:'pending',amount:-10000}}};
}
function loadProcess(c) {
  vm.runInContext(section('async function markWithdrawalProcessed(', 'async function processWithdrawalCore('),c);
  vm.runInContext(section('async function _processWithdrawalNow(', "app.post('/admin/withdraw/process'"),c);
}
async function ambiguousPayouts() {
  const db = makeDb(paymentSeed()), sent=[];
  const {c} = context(db,{fetch:async(_url,opts) => {
    sent.push(JSON.parse(opts.body)); // model gateway accepting the outbound payout
    return {ok:false,status:502,json:async() => {throw new SyntaxError('HTML gateway response');}};
  }});
  vm.runInContext(section('async function _marzParse(', '// Owner: "let us put on dashboard'),c);
  loadProcess(c);
  const first = await c._processWithdrawalNow('w','test');
  assert.equal(first.code,500);
  assert.equal(db.rows.withdrawals.w.status,'sending');
  assert.ok(db.rows.withdrawals.w.marzReference);
  await c._processWithdrawalNow('w','test');
  assert.equal(sent.length,1);
  console.log('PASS F1: ambiguous MarzPay response retains identifier and blocks resend.');

  const controlDb = makeDb(paymentSeed());
  const {c:control} = context(controlDb,{marzSendMoney:async() => {throw new Error('transport failure');}});
  loadProcess(control);
  await control._processWithdrawalNow('w','test');
  assert.equal(controlDb.rows.withdrawals.w.status,'sending');
  console.log('F1 CONTROL: thrown transport failure correctly retains sending.');

  const lipaDb = makeDb(paymentSeed());
  const {c:lipa} = context(lipaDb,{withdrawProvider:() => 'lipapay'});
  vm.runInContext(section('async function _lipaParse(', 'async function _lipaPost('),lipa);
  lipa.lipaDisburse = () => lipa._lipaParse({ok:false,status:502,json:async() => {throw new SyntaxError('HTML');}});
  loadProcess(lipa);
  await lipa._processWithdrawalNow('w','test');
  assert.equal(lipaDb.rows.withdrawals.w.status,'sending');
  assert.equal(lipaDb.rows.withdrawals.w.lipaOutTradeNo,'w');
  console.log('PASS F1: ambiguous LipaPay response retains identifier and blocks resend.');
}
async function earlyCallback() {
  const db = makeDb(paymentSeed());
  const {c,routes} = context(db,{
    withdrawProvider:() => 'lipapay',
    lipaOrderQuery:async() => ({Data:{PayStatus:1}})
  });
  vm.runInContext(section('const LIPA_PAY_STATUS', 'function lipaUserMsg('),c);
  loadProcess(c);
  vm.runInContext(section("app.post('/withdraw/lipapay/callback'", "app.post('/bank/save'"),c);
  c.lipaDisburse = async() => {
    await routes.get('/withdraw/lipapay/callback')({body:{OutTradeNo:'w'}},response());
    assert.equal(db.rows.withdrawals.w.status,'processed');
    assert.equal(db.rows.users.u.totalWithdrawn,8500);
    return {Succeeded:true,Data:{TransactionId:'provider-tx'}};
  };
  await c._processWithdrawalNow('w','test');
  assert.equal(db.rows.withdrawals.w.status,'processed');
  assert.equal(db.rows.users.u.totalWithdrawn,8500);
  assert.equal(db.rows.transactions.tx.status,'success');
  console.log('PASS F2: early verified callback stays completed and counted once.');
}
async function starvation() {
  for (const blockers of [49,50]) {
    const withdrawals={};
    for(let i=0;i<blockers;i++) withdrawals['old'+i]={status:'pending',regionKey:'ke',amount:10000,createdAt:new Date(1000+i)};
    withdrawals.eligible={status:'pending',regionKey:'ug',amount:10000,createdAt:new Date(2000)};
    const db=makeDb({withdrawals}), processed=[];
    const {c}=context(db,{
      getSettings:async() => ({autoApproveWithdrawalsEnabled:true,autoApproveIntervalSec:10,autoApproveMaxAmount:0}),
      DEFAULT_REGION_KEY:'ug',tsMillis:t => +t,
      processWithdrawalCore:async(id) => {processed.push(id);db.rows.withdrawals[id].status='processed';}
    });
    vm.runInContext(section('async function _autoApproveTickForRegion(', "app.get('/admin/payments/sync'"),c);
    for(let i=0;i<3;i++) await c._autoApproveTickForRegion('ug');
    assert.equal(processed.length,1);
    console.log(`PASS F3: eligible withdrawal progresses past ${blockers} other-region rows.`);
  }
}
async function regionReadFailure() {
  for(const fail of [false,true]) {
    const regionCtx=new AsyncLocalStorage();
    const ug={key:'ug',currency:'UGX'},ke={key:'ke',currency:'KES'};
    const db=makeDb({users:{u:{regionKey:'ke',walletBalance:50000,totalInvested:0,status:'active'}},investments:{},transactions:{}});
    let middleware;
    const {c,routes}=context(db,{
      _regionCtx:regionCtx,_userRegionCache:new Map(),USER_REGION_TTL:600000,DEFAULT_REGION_KEY:'ug',
      defaultRegion:()=>ug,regionByKey:k=>k==='ke'?ke:ug,regionForHost:()=>ug,
      getRegions:async()=>[ug,ke],requestHost:()=> 'ug.example',hostIsParked:()=>false,
      verifyAuth:async()=> 'u',currentRegionKey:()=>regionCtx.getStore().region.key,
      getProductByKey:async()=>({key:'p',name:'Fixture product',price:regionCtx.getStore().region.key==='ke'?40000:20000,cycle:10,active:true}),
      getSettings:async()=>({cycleDays:10}),productExpectedReturn:p=>p.price*2,productOpenState:()=>({open:true}),
      nowStr:()=>({date:'2026-09-17',time:'12:00'}),creditReferralCommission:async()=>{},grantTurntableSpins:()=>{}
    });
    c.app.use=fn=>{middleware=fn;};
    vm.runInContext(section('async function userRegionKey(', 'function forgetUserRegion('),c);
    vm.runInContext(section('app.use(async (req, res, next) => {\n  let region', '// ── THE ROOT DOMAIN'),c);
    vm.runInContext(section("app.post('/invest/create'", "app.get('/investments'"),c);
    if(fail) db.failNextUserRead();
    const req={headers:{authorization:'Bearer test'},body:{tierKey:'p'}},res=response();
    let requestDone;
    await middleware(req,res,()=>{requestDone=routes.get('/invest/create')(req,res);});
    await requestDone;
    assert.equal(res.body.status,fail?'error':'success');
    assert.equal(res.code,fail?503:200);
    assert.equal(db.rows.users.u.walletBalance,fail?50000:10000);
    const inv=Object.values(db.rows.investments)[0];
    assert.equal(inv?.amount,fail?undefined:40000);
    console.log(`PASS F4: region read failure=${fail}; correct price or no purchase.`);
  }
}
async function repairPendingDeposit() {
  const db=makeDb({
    users:{u:{walletBalance:5000,totalDeposited:5000}},
    pendingDeposits:{d:{userId:'u',amount:20000,ref:'deposit-ref',status:'pending'}},
    transactions:{
      paid:{userId:'u',type:'deposit',amount:5000,status:'success'},
      pending:{userId:'u',type:'deposit',amount:20000,displayAmount:20000,status:'pending',depositId:'d'}
    }
  });
  const {c,routes}=context(db,{
    verifyOwner:()=>true,finiteMoney:n=>Number(n)||0,logAdminAction:()=>{},
    _creditingDeposits:new Set(),sendAdminPush:async()=>{},
    nowStr:()=>({date:'2026-09-17',time:'12:00'})
  });
  vm.runInContext(section("function walletLedgerAmount(", "app.post('/admin/user/complete-registration'"),c);
  const res=response();
  await routes.get('/admin/user/repair-wallet')({body:{userId:'u'}},res);
  assert.equal(res.body.status,'success');
  assert.equal(db.rows.users.u.walletBalance,5000);
  console.log('PASS F5: wallet repair does not credit unpaid deposit.');
  vm.runInContext(section('function depositFullyCredited(', 'async function creditDeposit('),c);
  vm.runInContext(section('async function _creditDepositNow(', "app.post('/deposit/marzpay/status'"),c);
  await c._creditDepositNow(await db.collection('pendingDeposits').doc('d').get());
  assert.equal(db.rows.users.u.walletBalance,25000);
  console.log('PASS F5: later confirmation credits exactly once.');
}
async function additionalControls() {
  // Normal accepted and definitive refused requests remain usable; ambiguous
  // parsed HTTP failures and unrecognized envelopes never invite a resend.
  for (const provider of ['marzpay','lipapay']) {
    for (const kind of ['success','refusal','busy','unknown']) {
      const db=makeDb(paymentSeed());
      const {c}=context(db,{withdrawProvider:()=>provider});
      vm.runInContext(section('async function _marzParse(', 'async function marzCollect('),c);
      vm.runInContext(section('async function _lipaParse(', 'async function _lipaPost('),c);
      const status=kind==='busy'?503:kind==='refusal'?400:200;
      const body=kind==='unknown'?{}:provider==='marzpay'
        ? {status:kind==='success'?'success':'error',data:{transaction:{uuid:'tx'}}}
        : {Succeeded:kind==='success',Data:{TransactionId:'tx'}};
      const parsed=()=>c[provider==='marzpay'?'_marzParse':'_lipaParse']({ok:status===200,status,json:async()=>structuredClone(body)});
      c.marzSendMoney=parsed;c.lipaDisburse=parsed;
      loadProcess(c);
      await c._processWithdrawalNow('w','test');
      assert.equal(db.rows.withdrawals.w.status,kind==='success'?'processing':kind==='refusal'?'pending':'sending');
      assert.equal(db.rows.users.u.totalWithdrawn,kind==='success'?8500:0);
    }
  }
  // Same-country over-cap rows also cannot starve eligible legacy UG rows.
  const withdrawals={};
  for(let i=0;i<50;i++) withdrawals['large'+i]={status:'pending',regionKey:'ug',amount:50000,createdAt:new Date(1000+i)};
  withdrawals.legacy={status:'pending',amount:5000,createdAt:new Date(2000)};
  const db=makeDb({withdrawals}),processed=[];
  const {c}=context(db,{DEFAULT_REGION_KEY:'ug',tsMillis:t=>+t,
    getSettings:async()=>({autoApproveWithdrawalsEnabled:true,autoApproveMaxAmount:10000}),
    processWithdrawalCore:async id=>{processed.push(id);}});
  vm.runInContext(section('async function _autoApproveTickForRegion(', "app.get('/admin/payments/sync'"),c);
  await c._autoApproveTickForRegion('ug');
  assert.deepEqual(processed,['legacy']);
  vm.runInContext(section('function walletLedgerAmount(', "app.post('/admin/user/repair-wallet'"),c);
  c.finiteMoney=n=>Number(n)||0;
  assert.equal(c.walletLedgerAmount({type:'withdraw',status:'pending',amount:-5000}),-5000);
  assert.equal(c.walletLedgerAmount({type:'deposit',status:'pending',amount:20000}),0);
  assert.equal(c.walletLedgerAmount({type:'deposit',status:'failed',amount:20000}),0);
  assert.equal(c.walletLedgerAmount({type:'deposit',status:'success',amount:20000}),20000);
  assert.equal(c.walletLedgerAmount({type:'deposit_reversal',amount:-20000}),-20000);
  const regionDb=makeDb(paymentSeed());
  let ran=false;
  const {c:region}=context(regionDb,{
    withUserRegion:async(uid,fn)=>{assert.equal(uid,'u');return fn();},
    _processWithdrawalNow:async()=>{ran=true;return {code:200};}
  });
  vm.runInContext(section('async function processWithdrawalCore(', 'async function _processWithdrawalNow('),region);
  assert.equal((await region.processWithdrawalCore('w','test')).code,200);
  assert.equal(ran,true);ran=false;
  region.withUserRegion=async()=>{throw new Error('region unavailable');};
  assert.equal((await region.processWithdrawalCore('w','test')).code,503);
  assert.equal(ran,false);
  assert.equal((await region.processWithdrawalCore('missing','test')).code,404);
  console.log('PASS controls: normal payments, clean refusals, busy replies, legacy regions, caps, and reserved withdrawal debits.');
}
(async()=>{
  await ambiguousPayouts(); await earlyCallback(); await starvation(); await regionReadFailure();
  await repairPendingDeposit(); await additionalControls();
  console.log('All five audit regressions passed offline.');
})().catch(e=>{console.error(e);process.exitCode=1;});
