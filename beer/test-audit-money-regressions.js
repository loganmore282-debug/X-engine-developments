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
      op === 'in' ? v.some(x => x === row[k] || x === null && row[k] == null) : op === '<=' ? row[k] <= v : op === '>' ? row[k] > v : op === '!=' ? row[k] !== v :
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
    db, FieldValue:FV, crypto, Date, Math, Map, Set, Number, String, Boolean, process:{env:{}},
    console:{log(){},warn(){},error(){}}, AbortSignal,
    app:{post:(p,fn) => routes.set(p,fn)},
    _withdrawInFlight:new Set(), _lockTails:new Map(),
    getSettings:async() => ({}), fmtMoney:n => 'Br ' + n,
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
    userId:'u',status:'pending',amount:10000,net:8500,phone:'+251911000000',network:'Telebirr'
  }},transactions:{tx:{withdrawalId:'w',status:'pending',amount:-10000}}};
}
function loadProcess(c) {
  vm.runInContext(section('async function _processWithdrawalNow(', "app.post('/admin/withdraw/process'"),c);
}
async function manualPayouts() {
  // Every payout is made by hand: "Mark as paid" only records it, once, and never contacts a provider.
  const db = makeDb(paymentSeed());
  const {c} = context(db);
  loadProcess(c);
  const first = await c._processWithdrawalNow('w','test');
  assert.equal(first.code,200);
  assert.equal(db.rows.withdrawals.w.status,'processed');
  assert.equal(db.rows.withdrawals.w.payoutMethod,'manual');
  assert.equal(db.rows.users.u.totalWithdrawn,8500);
  assert.equal(db.rows.transactions.tx.status,'success');
  const again = await c._processWithdrawalNow('w','test');
  assert.equal(again.code,400);
  assert.equal(db.rows.users.u.totalWithdrawn,8500);
  console.log('PASS F1: mark-as-paid records a manual payout once and a repeat counts nothing.');
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
  vm.runInContext(section('async function _creditDepositNow(', '// WITHDRAWAL (requested by the member'),c);
  await c._creditDepositNow(await db.collection('pendingDeposits').doc('d').get());
  assert.equal(db.rows.users.u.walletBalance,25000);
  console.log('PASS F5: later confirmation credits exactly once.');
}
async function additionalControls() {
  const db=makeDb({}), {c}=context(db);
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
  assert.equal((await region.processWithdrawalCore('w','test')).code,200);
  assert.equal(ran,true);ran=false;
  assert.equal((await region.processWithdrawalCore('missing','test')).code,404);
  console.log('PASS controls: wallet ledger amounts and the withdrawal wrapper.');
}
(async()=>{
  await manualPayouts();
  await repairPendingDeposit(); await additionalControls();
  console.log('Payment audit regressions passed offline.');
})().catch(e=>{console.error(e);process.exitCode=1;});
