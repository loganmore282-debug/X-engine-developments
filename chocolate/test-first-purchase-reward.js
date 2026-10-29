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

const rates={commL1:20,commL2:5,commL3:1,referralBonus:500,cycleDays:8};
const products={ p30:{key:'p30',name:'Volt Go',price:30000,cycle:8,active:true}, p90:{key:'p90',name:'Home Cell',price:90000,cycle:8,active:true} };
function seed(){
  return { users:{ buyer:{referredBy:'l1',walletBalance:500000,totalInvested:0,registrationDone:true,status:'active'},
    l1:{referredBy:'l2',walletBalance:0}, l2:{referredBy:'l3',walletBalance:0}, l3:{walletBalance:0} }, investments:{}, transactions:{} };
}
function setup(input=seed()){
  const db=database(input); let serial=0;
  const c=vm.createContext({ db, console:{log(){},warn(){},error(){}},
    FieldValue:{ increment:n=>({op:'inc',n}), arrayUnion:(...items)=>({op:'union',items}), delete:()=>({op:'delete'}), serverTimestamp:()=>new Date() },
    getSettings:async()=>rates, getProductByKey:async k=>products[k]?{...products[k]}:null,
    productOpenState:()=>({open:true}), productExpectedReturn:(t)=>t.price*3, payoutDueAtMs:(m,k)=>m+k*86400000,
    round2:n=>Math.round(n*100)/100, fmtMoney:n=>'UGX '+n, nowStr:()=>({date:'2026-10-21',time:'10:00'}),
    newStatementId:()=>'s-'+ ++serial, verifyAuth:async req=>req.uid, grantTurntableSpins(){}, _vipCache:new Map(),
    app:{post:(p,h)=>{ctxRoutes[p]=h}}
  });
  const ctxRoutes={}; c.ctxRoutes=ctxRoutes;
  vm.runInContext('const _lockTails=new Map();\n'+['withLock','finiteMoney','creditReferralCommission','_payReferralCommissionNow'].map(fn).join('\n')+'\n'+route('/invest/create'),c);
  return {c,db,buy:(uid,tierKey)=>{const res=response();return ctxRoutes['/invest/create']({uid,body:{tierKey}},res).then(()=>res)}};
}
function response(){return {code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}}}
const commissions=db=>Object.values(db.rows.transactions).filter(t=>t.type==='commission');
async function main(){
  {
    const {db,buy}=setup();
    const r=await buy('buyer','p30');
    assert.equal(r.body.status,'success',JSON.stringify(r.body));
    assert.equal(db.rows.users.buyer.walletBalance,470000);
    assert.equal(db.rows.users.l1.walletBalance,6500,'Level 1 gets 20% of the first product PLUS the fixed referral reward (500)');
    assert.equal(db.rows.users.l2.walletBalance,1500,'Level 2 gets 5%');
    assert.equal(db.rows.users.l3.walletBalance,300,'Level 3 gets 1%');
    assert.deepEqual(commissions(db).map(t=>[t.userId,t.commissionLevel,t.description]).sort(),[['l1',0,'Level 1 reward'],['l2',1,'Level 2 reward'],['l3',2,'Level 3 reward']]);
    const inv=Object.values(db.rows.investments)[0];
    assert.equal(inv.isFirstInvestment,true);assert.equal(inv.commissionBasis,'investment');assert.equal(inv.commissionPending,false,'paid, so nothing left pending');
    const r2=await buy('buyer','p90');
    assert.equal(r2.body.status,'success');
    assert.equal(db.rows.users.l1.walletBalance,6500,'the second purchase pays the referrers nothing');
    assert.equal(commissions(db).length,3);
  }
  {
    // The fixed referral reward is set in the admin; 0 means percentages only, and only Level 1 ever gets it.
    rates.referralBonus=0;
    const {db,buy}=setup();
    await buy('buyer','p30');
    assert.equal(db.rows.users.l1.walletBalance,6000,'with the reward set to 0, Level 1 gets the percentage only');
    rates.referralBonus=750;
    const o=setup();
    await o.buy('buyer','p30');
    assert.equal(o.db.rows.users.l1.walletBalance,6750,'a reward of 750 is added to Level 1');
    assert.equal(o.db.rows.users.l2.walletBalance,1500,'Level 2 gets the percentage only');
    assert.equal(o.db.rows.users.l3.walletBalance,300,'Level 3 gets the percentage only');
    rates.referralBonus=500;
  }
  {
    // a product the admin gave is not a purchase: the first REAL purchase still pays
    const input=seed(); input.investments.g1={userId:'buyer',tierKey:'p30',amount:30000,granted:true,status:'active'};
    const {db,buy}=setup(input);
    const r=await buy('buyer','p90'); assert.equal(r.body.status,'success');
    assert.equal(db.rows.users.l1.walletBalance,18500,'20% of 90,000 (+500 reward) after a gifted product');
  }
  {
    // a member who bought before this rule (a real purchase already on record) earns the referrers nothing new
    const input=seed(); input.investments.old={userId:'buyer',tierKey:'p30',amount:30000,status:'active',isFirstInvestment:true,commissionBasis:'deposit',commissionPending:false};
    const {db,buy}=setup(input);
    const r=await buy('buyer','p90'); assert.equal(r.body.status,'success');
    assert.equal(commissions(db).length,0); assert.equal(db.rows.users.l1.walletBalance,0);
  }
  {
    // a member whose older first-deposit reward was already issued does not earn a second one
    const input=seed(); input.users.buyer.firstReferralDepositId='dep1';
    const {db,buy}=setup(input);
    const r=await buy('buyer','p30'); assert.equal(r.body.status,'success');
    assert.equal(commissions(db).length,0); assert.equal(db.rows.users.l1.walletBalance,0);
  }
  {
    // a member with no referrer: nothing to pay, nothing left pending
    const input=seed(); delete input.users.buyer.referredBy;
    const {db,buy}=setup(input);
    const r=await buy('buyer','p30'); assert.equal(r.body.status,'success');
    assert.equal(commissions(db).length,0);
  }
  {
    // two first purchases at the same instant: one reward only
    const {db,buy}=setup();
    const [a,b]=await Promise.all([buy('buyer','p30'),buy('buyer','p90')]);
    assert.equal(a.body.status,'success');assert.equal(b.body.status,'success');
    assert.equal(commissions(db).length,3,'the reward is paid once');
    const firsts=Object.values(db.rows.investments).filter(i=>i.isFirstInvestment);
    assert.equal(firsts.length,1,'exactly one purchase is the first');
    assert.equal(db.rows.users.l1.walletBalance,firsts[0].amount*0.2+500);
  }
  // A deposit no longer creates any commission entitlement.
  const dep=route('/deposit/marzpay');
  assert(!/commissionBasis:\s*'deposit'/.test(dep) && !/commissionPending/.test(dep), 'a new deposit carries no commission fields');
  console.log('PASS: referral reward on the first purchase (first purchase only, gifted products and older rewards excluded, one reward under a race, deposits pay nothing)');
}
main().catch(e=>{console.error(e);process.exit(1)});
