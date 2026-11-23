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

const rates={commL1:20,commL2:5,commL3:1,cycleDays:8};
const products={ p30:{key:'p30',name:'Volt Go',price:30000,cycle:8,category:'income',active:true}, p90:{key:'p90',name:'Home Cell',price:90000,cycle:8,category:'income',active:true},
  silver:{key:'silver',name:'Silver',price:0,cycle:360,category:'wage',active:true} };
function seed(){
  return { users:{ buyer:{referredBy:'l1',walletBalance:500000,totalInvested:0,registrationDone:true,status:'active'},
    l1:{referredBy:'l2',walletBalance:0}, l2:{referredBy:'l3',walletBalance:0}, l3:{walletBalance:0},
    loner:{walletBalance:500000,totalInvested:0,registrationDone:true,status:'active'} }, investments:{}, transactions:{} };
}
function setup(input=seed()){
  const db=database(input); let serial=0;
  const c=vm.createContext({ db, console:{log(){},warn(){},error(){}},
    FieldValue:{ increment:n=>({op:'inc',n}), arrayUnion:(...items)=>({op:'union',items}), delete:()=>({op:'delete'}), serverTimestamp:()=>new Date() },
    getSettings:async()=>rates, getProductByKey:async k=>products[k]?{...products[k]}:null,
    productOpenState:()=>({open:true}), productExpectedReturn:(t)=>t.price*3, settled:[], settleInvestmentIfDue:async d=>{ c.settled.push(d.id); },
    round2:n=>Math.round(n*100)/100, fmtMoney:n=>'UGX '+n, nowStr:()=>({date:'2026-10-18',time:'10:00'}),
    newStatementId:()=>'s-'+ ++serial, verifyAuth:async req=>req.uid, grantTurntableSpins(){}, _vipCache:new Map(),
    app:{post:(p,h)=>{ctxRoutes[p]=h}}
  });
  const ctxRoutes={}; c.ctxRoutes=ctxRoutes;
  vm.runInContext('const _lockTails=new Map();\n'+['withLock','finiteMoney','creditReferralCommission','_payReferralCommissionNow','reconcilePurchaseIntents'].map(fn).join('\n')+'\n'+route('/invest/create'),c);
  return {c,db,buy:(uid,tierKey)=>{const res=response();return ctxRoutes['/invest/create']({uid,body:{tierKey}},res).then(()=>res)}};
}
function response(){return {code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}}}
const commissions=db=>Object.values(db.rows.transactions).filter(t=>t.type==='commission');
async function main(){
  {
    const {c,db,buy}=setup();
    const r=await buy('buyer','p30');
    assert.equal(r.body.status,'success',JSON.stringify(r.body));
    assert.equal(db.rows.users.buyer.walletBalance,470000);
    assert.equal(db.rows.users.l1.walletBalance,6000,'Level 1 gets 20% of the first product');
    assert.equal(db.rows.users.l2.walletBalance,1500,'Level 2 gets 5%');
    assert.equal(db.rows.users.l3.walletBalance,300,'Level 3 gets 1%');
    assert.deepEqual(commissions(db).map(t=>[t.userId,t.commissionLevel,t.description]).sort(),[['l1',0,'Level 1 reward'],['l2',1,'Level 2 reward'],['l3',2,'Level 3 reward']]);
    const inv=Object.values(db.rows.investments)[0];
    assert.equal(inv.isFirstInvestment,true);assert.equal(inv.commissionPending,false,'paid, so nothing left pending');
    // CASHBACK: the first purchase's first cashback is due at the moment of purchase (and is paid at once); every later purchase pays its first one 24 hours later
    assert.ok(Math.abs(+new Date(inv.payoutFirstAt)-Date.now())<5000,'first purchase: first cashback due now');
    assert.equal(+new Date(inv.nextPayoutAt),+new Date(inv.payoutFirstAt));
    assert.deepEqual(c.settled,[r.body.investmentId],'the first cashback is settled before the answer goes back');
    const r2=await buy('buyer','p90');
    assert.equal(r2.body.status,'success');
    const inv2=db.rows.investments[r2.body.investmentId];
    assert.ok(Math.abs(+new Date(inv2.payoutFirstAt)-(Date.now()+86400000))<5000,'a later purchase: first cashback 24 hours after the purchase');
    assert.equal(c.settled.length,1,'a later purchase is not paid at once');
    assert.equal(db.rows.users.l1.walletBalance,6000,'the second purchase pays the referrers nothing');
    assert.equal(commissions(db).length,3);
  }
  {
    // The admin switch "First purchase pays its first cashback at once": off = the first purchase waits 24 hours like any other, and is not settled at once
    const {c,db,buy}=setup(); rates.firstPurchaseCashbackNow=false;
    const r=await buy('buyer','p30'); assert.equal(r.body.status,'success');
    const inv=db.rows.investments[r.body.investmentId];
    assert.ok(Math.abs(+new Date(inv.payoutFirstAt)-(Date.now()+86400000))<5000,'switch off: first cashback 24 hours later');
    assert.equal(c.settled.length,0,'switch off: nothing paid at once');
    assert.equal(inv.isFirstInvestment,true,'it is still the first purchase for the referral reward');
    assert.equal(db.rows.users.l1.walletBalance,6000,'the referral reward does not depend on the switch');
    delete rates.firstPurchaseCashbackNow;
  }
  {
    // two first purchases at the same instant: one reward only
    const {db,buy}=setup();
    const [a,b]=await Promise.all([buy('buyer','p30'),buy('buyer','p90')]);
    assert.equal(a.body.status,'success');assert.equal(b.body.status,'success');
    assert.equal(commissions(db).length,3,'the reward is paid once');
    const firsts=Object.values(db.rows.investments).filter(i=>i.isFirstInvestment);
    assert.equal(firsts.length,1,'exactly one purchase is the first');
    assert.equal(db.rows.users.l1.walletBalance,firsts[0].amount*0.2);
  }
  {
    // CRASH SAFETY: the server dies after the wallet was debited and before the investment exists (here: the investment write fails AND the instant
    // compensating refund fails too). The note left behind lets the sweep give the money back, exactly once; a completed purchase leaves no note.
    const {c,db,buy}=setup();
    const ok1=await buy('buyer','p30'); assert.equal(ok1.body.status,'success');
    assert.equal(Object.keys(db.rows.purchaseIntents||{}).length,0,'a completed purchase leaves no note behind');
    assert.ok(db.rows.users.buyer.debitedInvestmentIds.length===1,'the debit carries a token');
    db.faults.push((col)=>col==='investments');
    db.faults.push((col,id,patch)=>col==='users'&&id==='buyer'&&patch.refundedInvestmentIds);
    const before=db.rows.users.buyer.walletBalance;
    const bad=await buy('buyer','p90'); assert.equal(bad.code,400,'the purchase is reported as failed');
    assert.equal(db.rows.users.buyer.walletBalance,before-90000,'(the instant refund failed too, so the wallet is short)');
    const left=Object.entries(db.rows.purchaseIntents); assert.equal(left.length,1,'the note is still there'); const [invId,note]=left[0];
    assert.equal(db.rows.investments[invId],undefined,'and there is no investment');
    await c.reconcilePurchaseIntents(); assert.equal(db.rows.users.buyer.walletBalance,before-90000,'a purchase still in progress (note under 2 minutes old) is left alone');
    note.createdMs=Date.now()-3*60000;
    await c.reconcilePurchaseIntents();
    assert.equal(db.rows.users.buyer.walletBalance,before,'the sweep gave the 90,000 back');
    assert.equal(db.rows.users.buyer.totalInvested,30000,'totalInvested is back too');
    assert.equal(Object.keys(db.rows.purchaseIntents).length,0,'and the note is gone');
    await c.reconcilePurchaseIntents(); assert.equal(db.rows.users.buyer.walletBalance,before,'a second sweep refunds nothing more');
    // a note whose purchase DID complete (the delete after it failed) is only cleaned up, nobody is refunded
    db.rows.purchaseIntents={ [Object.keys(db.rows.investments)[0]]:{userId:'buyer',price:30000,status:'debiting',createdMs:Date.now()-5*60000} };
    await c.reconcilePurchaseIntents(); assert.equal(db.rows.users.buyer.walletBalance,before,'a completed purchase is never refunded'); assert.equal(Object.keys(db.rows.purchaseIntents).length,0);
    // the server died AFTER the investment was written but before its ledger row: the sweep writes the row (once) and clears the note
    db.rows.investments.invX={userId:'buyer',tierLabel:'Volt Go',amount:30000,date:'2026-10-18',time:'10:00',status:'active'};
    db.rows.purchaseIntents={ invX:{userId:'buyer',price:30000,status:'debiting',createdMs:Date.now()-5*60000} };
    await c.reconcilePurchaseIntents();
    assert.equal(db.rows.users.buyer.walletBalance,before,'nobody is refunded for a purchase that completed');
    const row=db.rows.transactions['purchase:invX']; assert.ok(row&&row.amount===-30000&&row.investmentId==='invX'&&row.type==='investment','the missing ledger row is written');
    db.rows.purchaseIntents={ invX:{userId:'buyer',price:30000,status:'debiting',createdMs:Date.now()-5*60000} }; await c.reconcilePurchaseIntents();
    assert.equal(Object.keys(db.rows.transactions).filter(k=>k==='purchase:invX').length,1,'and never twice');
    // a note written but the debit never happened (the crash was before it): cleaned up, nothing refunded
    db.rows.purchaseIntents={ 'ghost':{userId:'buyer',price:50000,status:'debiting',createdMs:Date.now()-5*60000} };
    await c.reconcilePurchaseIntents(); assert.equal(db.rows.users.buyer.walletBalance,before,'no debit, no refund'); assert.equal(Object.keys(db.rows.purchaseIntents).length,0);
  }
  {
    // a product the admin activated first is not the first purchase
    const input=seed();input.investments['grant-x']={userId:'buyer',granted:true,amount:30000,isFirstInvestment:false,tierKey:'p30'};
    input.users.buyer.totalInvested=30000;input.users.buyer.firstInvestmentDone=true;
    const {db,buy}=setup(input);
    const r=await buy('buyer','p90');assert.equal(r.body.status,'success');
    assert.equal(db.rows.users.l1.walletBalance,18000,'the first real purchase still pays');
  }
  {
    // no referrer: nothing to pay, nothing breaks
    const {db,buy}=setup();
    const r=await buy('loner','p30');assert.equal(r.body.status,'success');assert.equal(commissions(db).length,0);
    const inv=Object.values(db.rows.investments)[0];assert.equal(inv.commissionPending,false);
  }
  {
    // the reward failing never fails the purchase; the reconciler pays it afterwards
    const {c,db,buy}=setup();
    db.faults.push((col,id)=>col==='users'&&id==='l1');
    const r=await buy('buyer','p30');
    assert.equal(r.body.status,'success','the member keeps the purchase');
    assert.equal(db.rows.users.buyer.walletBalance,470000);
    const [id,inv]=Object.entries(db.rows.investments)[0];
    assert.equal(inv.commissionPending,true,'still pending, so the 30 second reconciler retries it');
    await c.creditReferralCommission(id,'buyer',inv.amount);
    assert.equal(db.rows.users.l1.walletBalance,6000);assert.equal(commissions(db).length,3);
    await c.creditReferralCommission(id,'buyer',inv.amount);
    assert.equal(commissions(db).length,3,'and never twice');
  }
  {
    // a task product is never bought
    const {db,buy}=setup();
    const r=await buy('buyer','silver');assert.equal(r.code,400);assert.equal(r.body.code,'SOLD_OUT');assert.equal(db.rows.users.buyer.walletBalance,500000);
  }
  {
    // not enough money: no reward, no investment
    const input=seed();input.users.buyer.walletBalance=1000;
    const {db,buy}=setup(input);
    const r=await buy('buyer','p30');assert.equal(r.code,400);assert.equal(commissions(db).length,0);assert.equal(Object.keys(db.rows.investments).length,0);
  }
  console.log('PASS: first purchase reward (real /invest/create route: 20/5/1 percent once, concurrent, admin-activated first, no referrer, failure safe)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
