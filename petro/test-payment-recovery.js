'use strict';
// Offline fault-injection tests execute the production payment functions.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest' });
function fn(name) {
  const node = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert(node, 'Missing production function ' + name);
  return source.slice(node.start, node.end);
}
function route(path) {
  const node = tree.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.callee.object?.name === 'app' && n.expression.arguments[0]?.value === path);
  assert(node, 'Missing route ' + path);
  return source.slice(node.start, node.end);
}
function database(seed) {
  const rows = structuredClone(seed), faults = [];
  let serial = 0;
  const fail = (col, id, patch) => {
    const at = faults.findIndex(f => f(col, id, patch));
    if (at >= 0) { faults.splice(at, 1); throw new Error('Injected storage failure'); }
  };
  function apply(row, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value?.op === 'inc') row[key] = (row[key] || 0) + value.n;
      else if (value?.op === 'union') row[key] = [...new Set([...(row[key] || []), ...value.items])];
      else if (value?.op === 'delete') delete row[key];
      else row[key] = structuredClone(value);
    }
  }
  function snapshot(col, id) {
    const value = rows[col]?.[id] && structuredClone(rows[col][id]);
    return { id, exists: !!value, data: () => structuredClone(value), ref: ref(col, id) };
  }
  function ref(col, id) {
    return { id, get: async () => snapshot(col, id),
      update: async patch => { fail(col, id, patch); assert(rows[col]?.[id]); apply(rows[col][id], patch); },
      updateIf: async (filter, patch) => {
        fail(col, id, patch);
        const row = rows[col]?.[id];
        if (!row || !Object.entries(filter).every(([k,v]) => v && '$ne' in Object(v)
          ? (Array.isArray(row[k]) ? !row[k].includes(v.$ne) : row[k] !== v.$ne) : row[k] === v)) return false;
        apply(row, patch); return true;
      },
      createIfAbsent: async data => { fail(col, id, data); rows[col] ||= {}; if (rows[col][id]) return false; rows[col][id] = {}; apply(rows[col][id], data); return true; },
      set: async data => { fail(col, id, data); rows[col] ||= {}; rows[col][id] = {}; apply(rows[col][id], data); },
      delete: async () => { delete rows[col]?.[id]; }
    };
  }
  function query(col, filters = [], limit = Infinity) {
    return { where: (key, op, value) => query(col, [...filters, [key, op, value]], limit),
      limit: n => query(col, filters, n), orderBy: () => query(col, filters, limit),
      doc: id => ref(col, id || 'generated-' + ++serial),
      add: async data => { const r = ref(col, 'generated-' + ++serial); await r.set(data); return r; },
      get: async () => {
        const docs = Object.entries(rows[col] || {}).filter(([,r]) => filters.every(([k,op,v]) => {
          if (op === '==') return r[k] === v;
          if (op === '!=') return r[k] !== v;
          if (op === 'in') return v.includes(r[k]);
          throw new Error('Unknown mock operator ' + op);
        })).slice(0, limit).map(([id]) => snapshot(col,id));
        return { docs, empty: !docs.length, size: docs.length, forEach: cb => docs.forEach(cb) };
      }
    };
  }
  return { rows, faults, collection: col => query(col) };
}
function seed() {
  const users = { buyer: { referredBy:'l1', walletBalance:0, totalDeposited:0 },
    l1:{referredBy:'l2',walletBalance:0}, l2:{referredBy:'l3',walletBalance:0}, l3:{walletBalance:0} };
  return { users, investments:{}, pendingDeposits:{ d1:{ userId:'buyer', amount:15000, status:'pending', commissionBasis:'deposit', commissionPending:true, commissionPaidLevels:[] } }, transactions:{} };
}
function setup(input = seed()) {
  const db = database(input), routes = {};
  let serial = 0;
  const c = vm.createContext({ db, console:{log(){},warn(){},error(){}},
    FieldValue:{ increment:n=>({op:'inc',n}), arrayUnion:(...items)=>({op:'union',items}), delete:()=>({op:'delete'}), serverTimestamp:()=>new Date() },
    getSettings:async()=>({commL1:30,commL2:3,commL3:2}),
    withUserRegion:async(_id,work)=>work(), nowStr:()=>({date:'2026-09-24',time:'00:00'}),
    newStatementId:()=> 'test-' + ++serial, fmtMoney:n=>'UGX '+n,
    verifyAuth:async()=> 'l1', markDepositAttemptSucceeded(){}, sendAdminPush:async()=>{},
    app:{post:(path,handler)=>{routes[path]=handler}},
    TEAM_MILESTONES:[{target:5,reward:5000}], TEAM_DEPOSIT_MILESTONES:[{target:250000,reward:5000}],
    activeL1Count:async()=>5, wholeTeamDeposits:async()=>250000
  });
  vm.runInContext('const _lockTails=new Map(); const _creditingDeposits=new Set();\n' + [
    'withLock','finiteMoney','depositFullyCredited','creditReferralCommission','creditDepositReferralCommission','_payReferralCommissionNow','creditDeposit','_creditDepositNow'
  ].map(fn).join('\n') + '\n' + route('/team/milestone/claim'), c);
  return {c, db, routes};
}
function response(){return {code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}}}
async function credit(c,db,id='d1'){return c.creditDeposit(await db.collection('pendingDeposits').doc(id).get())}
async function main(){
  {
    const {c,db}=setup();
    await Promise.all([credit(c,db),credit(c,db)]);
    assert.equal(db.rows.users.buyer.walletBalance,15000);
    assert.equal(db.rows.users.l1.walletBalance,4500);
    assert.equal(db.rows.users.l2.walletBalance,450);
    assert.equal(db.rows.users.l3.walletBalance,300);
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.depositId==='d1').length,1,'deposit status repair must only match the deposit ledger row');
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.referralDepositId==='d1').length,3);
    db.rows.pendingDeposits.d2={...seed().pendingDeposits.d1,amount:25000};
    await credit(c,db,'d2');
    assert.equal(db.rows.users.buyer.walletBalance,40000);
    assert.equal(db.rows.users.l1.walletBalance,4500,'second deposit must not repay a one-time commission');
    db.rows.investments.i1={userId:'buyer',isFirstInvestment:true,commissionBasis:'deposit',amount:15000};
    assert.equal(await c.creditReferralCommission('i1','buyer',15000),false);
    assert.equal(db.rows.users.l1.walletBalance,4500,'new purchases must not trigger commission');
  }
  {
    const {c,db}=setup();
    db.rows.pendingDeposits.d2={...seed().pendingDeposits.d1,amount:25000};
    await Promise.all([credit(c,db),credit(c,db,'d2')]);
    const first=db.rows.users.buyer.firstReferralDepositId;
    assert(['d1','d2'].includes(first));
    assert.equal(db.rows.users.buyer.walletBalance,40000);
    assert.equal(db.rows.users.l1.walletBalance,db.rows.pendingDeposits[first].amount*0.3,'concurrent deposits have one first-deposit entitlement');
  }
  {
    const {c,db}=setup();
    vm.runInContext(fn('activeL1Count')+'\n'+fn('wholeTeamDeposits'),c);
    assert.equal(await c.activeL1Count('l1'),0,'registration and an uncredited deposit do not activate a referral');
    await credit(c,db);
    assert.equal(await c.activeL1Count('l1'),1,'confirmed deposit activates the referral without an investment');
    assert.equal(await c.wholeTeamDeposits('l1'),15000);
  }
  {
    const {c,db}=setup();
    await c.creditDepositReferralCommission('d1','buyer');
    assert.equal(db.rows.users.l1.walletBalance,0,'uncredited deposit cannot pay');
    db.faults.push((col,id,patch)=>col==='pendingDeposits' && id==='d1' && patch.walletCredited===true);
    await assert.rejects(credit(c,db));
    assert.equal(db.rows.pendingDeposits.d1.needsManualCredit,true);
    assert.equal(db.rows.users.buyer.walletBalance,15000);
    await credit(c,db);
    assert.equal(db.rows.users.buyer.walletBalance,15000,'retry after marker failure must not re-credit deposit');
    assert.equal(db.rows.users.l1.walletBalance,4500);
  }
  {
    const {c,db}=setup();
    db.faults.push((col,id,patch)=>col==='users' && id==='buyer' && !!patch.creditedDepositIds);
    await assert.rejects(credit(c,db));
    assert.equal(c.depositFullyCredited(db.rows.pendingDeposits.d1),false,'interrupted claim remains recoverable');
    await credit(c,db);
    assert.equal(db.rows.users.buyer.walletBalance,15000);
  }
  {
    const {c,db}=setup();
    db.faults.push((col,id)=>col==='transactions'&&id.startsWith('commission:deposit:d1:0'));
    await credit(c,db);
    assert.equal(db.rows.users.l1.walletBalance,4500);
    await c.creditDepositReferralCommission('d1','buyer');
    assert.equal(db.rows.users.l1.walletBalance,4500,'ledger repair must not repeat commission');
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.type==='commission').length,3);
  }
  {
    const {c,db}=setup();db.rows.users.l1.status='banned';
    await credit(c,db);assert.equal(db.rows.users.l1.walletBalance,0);
    assert.equal(db.rows.pendingDeposits.d1.commissionPending,true);
    db.rows.users.l1.status='active';await c.creditDepositReferralCommission('d1','buyer');
    assert.equal(db.rows.users.l1.walletBalance,4500);
    assert.equal(db.rows.users.l2.walletBalance,450,'unblocked retry must not repeat other levels');
  }
  {
    const input=seed();input.investments.old={userId:'buyer',isFirstInvestment:true,commissionPaidLevels:[0],commissionPending:false};
    const {c,db}=setup(input);await credit(c,db);
    assert.equal(db.rows.users.l1.walletBalance,0,'existing first-investment credit must not be paid again on deposit');
  }
  {
    const {c,db,routes}=setup(),claim=routes['/team/milestone/claim'];
    db.faults.push((col,id)=>col==='transactions'&&id.startsWith('team-reward:'));
    const first=response();await claim({body:{type:'count',target:5}},first);
    assert.equal(first.code,500);assert.equal(db.rows.users.l1.walletBalance,5000);
    c.activeL1Count=async()=>0; // Even changed progress must allow history repair.
    const repaired=response();await claim({body:{type:'count',target:5}},repaired);
    assert.equal(repaired.code,200);assert.equal(repaired.body.alreadyClaimed,true);
    assert.equal(db.rows.users.l1.walletBalance,5000);
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.type==='team_reward').length,1);
    const bad=response();await claim({body:{type:'unknown',target:5}},bad);assert.equal(bad.code,400);
    const deposit=response();await claim({body:{type:'deposit',target:250000}},deposit);
    assert.equal(deposit.code,200);assert.equal(db.rows.users.l1.walletBalance,10000);
    const repeat=response();await claim({body:{type:'deposit',target:250000}},repeat);
    assert.equal(repeat.body.alreadyClaimed,true);assert.equal(db.rows.users.l1.walletBalance,10000);
    db.rows.users.l1.status='banned';
    const banned=response();await claim({body:{type:'count',target:5}},banned);assert.equal(banned.code,403);
  }
  console.log('PASS: deposits, one-time referral commissions, failed writes, repeated callbacks, bans, legacy credits, and task claim recovery');
}
main().catch(e=>{console.error(e);process.exitCode=1});
