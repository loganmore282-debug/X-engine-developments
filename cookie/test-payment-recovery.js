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
  return { users, investments:{}, pendingDeposits:{ d1:{ userId:'buyer', amount:15000, status:'pending' } }, transactions:{} };
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
    wholeTeamDeposits:async()=>250000
  });
  vm.runInContext('const _lockTails=new Map(); const _creditingDeposits=new Set();\n' + [
    'withLock','finiteMoney','depositFullyCredited','creditReferralCommission','_payReferralCommissionNow','creditDeposit','_creditDepositNow'
  ].map(fn).join('\n'), c);
  return {c, db, routes};
}
function response(){return {code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}}}
async function credit(c,db,id='d1'){return c.creditDeposit(await db.collection('pendingDeposits').doc(id).get())}
const firstBuy=(extra={})=>({userId:'buyer',amount:15000,isFirstInvestment:true,commissionBasis:'investment',commissionPending:true,commissionPaidLevels:[],...extra});
async function main(){
  {
    // A deposit credits the wallet once and pays NO referral reward, however many deposits there are.
    const {c,db}=setup();
    await Promise.all([credit(c,db),credit(c,db)]);
    assert.equal(db.rows.users.buyer.walletBalance,15000);
    assert.equal(db.rows.users.l1.walletBalance,0,'a deposit pays no referral reward');
    assert.equal(db.rows.users.l2.walletBalance,0);
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.depositId==='d1').length,1,'deposit status repair must only match the deposit ledger row');
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.type==='commission').length,0);
    db.rows.pendingDeposits.d2={userId:'buyer',amount:25000,status:'pending'};
    await credit(c,db,'d2');
    assert.equal(db.rows.users.buyer.walletBalance,40000);
    assert.equal(db.rows.users.l1.walletBalance,0,'a second deposit pays nothing either');
    assert.equal(db.rows.users.buyer.firstReferralDepositId,undefined,'no deposit is marked as the referral deposit any more');
  }
  {
    // The first purchase pays Level 1 / 2 / 3 once, even when the pay call arrives twice at once; a later purchase pays nothing.
    const {c,db}=setup();
    db.rows.investments.i1=firstBuy();
    const r=await Promise.all([c.creditReferralCommission('i1','buyer',15000),c.creditReferralCommission('i1','buyer',15000)]);
    assert.equal(r.filter(Boolean).length>=1,true);
    assert.equal(db.rows.users.l1.walletBalance,4500,'Level 1 is paid once on the first purchase');
    assert.equal(db.rows.users.l2.walletBalance,450);
    assert.equal(db.rows.users.l3.walletBalance,300);
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.type==='commission').length,3);
    assert.equal(db.rows.investments.i1.commissionPending,false);
    db.rows.investments.i2=firstBuy({isFirstInvestment:false,amount:90000,commissionPending:false});
    assert.equal(await c.creditReferralCommission('i2','buyer',90000),false);
    assert.equal(db.rows.users.l1.walletBalance,4500,'a second purchase pays nothing');
  }
  {
    const {c,db}=setup();
    vm.runInContext(fn('wholeTeamStats')+'\n'+fn('wholeTeamDeposits'),c);
    await credit(c,db);
    assert.equal(await c.wholeTeamDeposits('l1'),15000);
  }
  {
    const {c,db}=setup();
    db.faults.push((col,id,patch)=>col==='pendingDeposits' && id==='d1' && patch.walletCredited===true);
    await assert.rejects(credit(c,db));
    assert.equal(db.rows.pendingDeposits.d1.needsManualCredit,true);
    assert.equal(db.rows.users.buyer.walletBalance,15000);
    await credit(c,db);
    assert.equal(db.rows.users.buyer.walletBalance,15000,'retry after marker failure must not re-credit deposit');
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
    // The ledger row failing after the wallet landed is repaired without paying twice.
    const {c,db}=setup();
    db.rows.investments.i1=firstBuy();
    db.faults.push((col,id)=>col==='transactions'&&id.startsWith('commission:i1:0'));
    await assert.rejects(c.creditReferralCommission('i1','buyer',15000));
    assert.equal(db.rows.users.l1.walletBalance,4500);
    db.faults.length=0;
    await c.creditReferralCommission('i1','buyer',15000);
    assert.equal(db.rows.users.l1.walletBalance,4500,'ledger repair must not repeat commission');
    assert.equal(Object.values(db.rows.transactions).filter(t=>t.type==='commission').length,3);
  }
  {
    // A banned referrer waits (still pending) and is paid on unban without repeating the other levels.
    const {c,db}=setup();db.rows.users.l1.status='banned';
    db.rows.investments.i1=firstBuy();
    await c.creditReferralCommission('i1','buyer',15000);assert.equal(db.rows.users.l1.walletBalance,0);
    assert.equal(db.rows.investments.i1.commissionPending,true);
    db.rows.users.l1.status='active';await c.creditReferralCommission('i1','buyer',15000);
    assert.equal(db.rows.users.l1.walletBalance,4500);
    assert.equal(db.rows.users.l2.walletBalance,450,'unblocked retry must not repeat other levels');
  }
  {
    // A product the admin activated is not a purchase: it pays no reward.
    const {c,db}=setup();
    db.rows.investments.g1=firstBuy({isFirstInvestment:false,granted:true,commissionPending:false});
    assert.equal(await c.creditReferralCommission('g1','buyer',15000),false);
    assert.equal(db.rows.users.l1.walletBalance,0);
  }
  console.log('PASS: deposits pay nothing, the first purchase pays Level 1/2/3 once, failed writes, repeated calls, bans, admin-activated products');
}
main().catch(e=>{console.error(e);process.exitCode=1});
