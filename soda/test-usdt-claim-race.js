'use strict';
const assert = require('node:assert/strict');
const acorn = require('acorn');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(src, {ecmaVersion:'latest'});
const routeNode = tree.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
  && n.expression.callee.object?.name === 'app' && n.expression.arguments[0]?.value === '/deposit/usdt/submit');
assert(routeNode, 'USDT submit route exists');
const helper = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'usdtDepositDocId');
assert(helper, 'deterministic USDT claim id helper exists');
let submit;
const deposits = new Map(), ledger = new Map(), intents = new Map();
const mkIntent=(id,userId,base)=>intents.set(id,{userId,baseUsdt:base,amountUgx:base*4000,rate:4000,walletAddress:'wallet',exactMicros:Number(id),createdMs:1,status:'open'});
[['10000001','u1',10],['10000002','u2',10],['10000003','u1',12],['10000004','old-user',11],['10000005','attacker',11],['10000006','new-user',11]].forEach(a=>mkIntent(...a)); let queryArrivals = 0, releaseQueries;
const queryGate = new Promise(r => { releaseQueries = r; });
function snap(id) { const row=deposits.get(id); return {id,exists:!!row,data:()=>structuredClone(row)}; }
function depRef(id) { return {id,
  async get(){ return snap(id); },
  async createIfAbsent(data){ if(deposits.has(id))return false;deposits.set(id,structuredClone(data));return true; },
  async updateIf(filter,data){const row=deposits.get(id);if(!row||row.status!==filter.status)return false;deposits.set(id,{...row,...structuredClone(data)});return true;}
}; }
const db={collection(name){
  if(name==='users')return {doc:id=>({get:async()=>({exists:true,data:()=>({status:'active',registrationDone:true})})})};
  if(name==='pendingDeposits')return {
    where(field,op,value){const query={limit(n){this.limitValue=n;return this;},async get(){queryArrivals++;if(queryArrivals===2)releaseQueries();await queryGate;let docs=[...deposits].filter(([,row])=>field==='txid'&&op==='=='&&row.txid===value).map(([id,row])=>({id,data:()=>structuredClone(row),ref:depRef(id)}));if(this.limitValue)docs=docs.slice(0,this.limitValue);return {docs,empty:!docs.length};}};return query;},
    doc:id=>depRef(id)
  };
  if(name==='usdtIntents')return {doc:id=>({async get(){const r=intents.get(id);return {id,exists:!!r,data:()=>structuredClone(r)};},async update(d){intents.set(id,{...intents.get(id),...d});}})};
  if(name==='transactions')return {
    where(field,op,value){return {limit(){return this;},async get(){const docs=[...ledger].filter(([,row])=>row[field]===value).map(([id,row])=>({id,data:()=>structuredClone(row),ref:{update:async data=>ledger.set(id,structuredClone(data))}}));return {docs,empty:!docs.length};}};},
    async add(data){ledger.set('tx-'+(ledger.size+1),structuredClone(data));}
  };
  throw new Error(name);
}};
const app={post(path,fn){if(path==='/deposit/usdt/submit')submit=fn;}};
const ctx={app,db,Map,Number,String,Math,Date,isFinite,setTimeout,structuredClone,
  verifyAuth:async req=>req.userId,
  getSettings:async()=>({usdtEnabled:true,usdtRate:4000,minDeposit:1000,usdtWalletAddress:'wallet'}),
  MAX_MONEY_AMOUNT:1e12,fmtMoney:n=>'UGX '+n,uniqueRef:async()=>Math.random().toString(36),newStatementId:()=> 'stmt',
  nowStr:()=>({date:'2026-09-28',time:'23:59'}),currentRegionKey:()=> 'ug',
  FieldValue:{serverTimestamp:()=>new Date(),delete:()=>undefined},
  resolveUsdtDeposit:async()=>({outcome:'matched'}),console
};
vm.createContext(ctx);
vm.runInContext(src.slice(helper.start,helper.end)+'\nconst _usdtSubmitDebounce=new Map();\n'+src.slice(routeNode.start,routeNode.end),ctx);
function res(){return {code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
(async()=>{
  const txid='a'.repeat(64), a=res(), b=res();
  await Promise.all([
    submit({userId:'u1',body:{intentId:'10000001',txid}},a),
    submit({userId:'u2',body:{intentId:'10000002',txid}},b)
  ]);
  assert.equal(deposits.size,1,'one on-chain transfer creates one claim');
  assert.equal(ledger.size,1,'only the winning claim creates a ledger row');
  assert.deepEqual([a.code,b.code].sort((x,y)=>x-y),[200,409]);
  assert([...deposits.keys()][0].startsWith('usdt:'),'TXID determines the claim document id');
  vm.runInContext('_usdtSubmitDebounce.clear()',ctx); // isolate retry semantics from the 7-second tap limiter
  // A failed claim can be corrected, but it must reuse both the claim and its
  // zeroed ledger row or later success would be counted twice.
  const id=[...deposits.keys()][0];deposits.get(id).status='failed';
  ledger.get('tx-1').status='failed';ledger.get('tx-1').amount=0;
  const retry=res();await submit({userId:'u1',body:{intentId:'10000003',txid}},retry);
  assert.equal(retry.code,200);assert.equal(deposits.size,1);assert.equal(ledger.size,1);
  assert.equal(ledger.get('tx-1').amount,48000);assert.equal(ledger.get('tx-1').status,'pending');

  // A failed claim from before deterministic IDs were introduced must also
  // be revived in place, preserving its existing statement row and identity.
  const legacyTxid='b'.repeat(64), legacyId='legacy-random-claim-id';
  deposits.set(legacyId,{userId:'old-user',method:'usdt',txid:legacyTxid,status:'failed',amount:0});
  ledger.set('legacy-tx',{userId:'old-user',statementId:'stable-statement',type:'deposit',depositId:legacyId,status:'failed',amount:0});
  const legacyRetry=res();await submit({userId:'old-user',body:{intentId:'10000004',txid:legacyTxid}},legacyRetry);
  assert.equal(legacyRetry.code,200);
  assert.equal(deposits.size,2,'legacy retry reuses the random-ID claim instead of creating a deterministic duplicate');
  assert.equal(deposits.get(legacyId).status,'awaiting_verification');
  assert.equal(ledger.size,2,'legacy retry reuses its existing ledger row');
  assert.equal(ledger.get('legacy-tx').depositId,legacyId);
  assert.equal(ledger.get('legacy-tx').amount,44000);
  assert.equal(ledger.get('legacy-tx').statementId,'stable-statement','retry preserves the existing statement identity');

  const denied=res();await submit({userId:'attacker',body:{intentId:'10000005',txid:legacyTxid}},denied);
  assert.equal(denied.code,409,'a different account cannot take over a failed legacy TXID');
  assert.equal(deposits.get(legacyId).userId,'old-user');

  const manyTxid='c'.repeat(64);
  for(let i=0;i<21;i++)deposits.set('legacy-failed-'+i,{userId:'prior',method:'usdt',txid:manyTxid,status:'failed',amount:0});
  deposits.set('legacy-open-last',{userId:'prior',method:'usdt',txid:manyTxid,status:'awaiting_verification',amount:44000});
  const beyondOldLimit=res();await submit({userId:'new-user',body:{intentId:'10000006',txid:manyTxid}},beyondOldLimit);
  assert.equal(beyondOldLimit.code,409,'an open legacy claim beyond the old 20-row cap still blocks reuse');

  // ── payment requests (the TXID-hijack fix) ──
  vm.runInContext('_usdtSubmitDebounce.clear()',ctx);
  let x=res();await submit({userId:'u1',body:{amountUsdt:10,txid:'d'.repeat(64)}},x);
  assert.equal(x.code,400,'the old amount-and-hash claim is no longer accepted');
  x=res();await submit({userId:'attacker',body:{intentId:'10000001',txid:'d'.repeat(64)}},x);
  assert.equal(x.code,404,'someone else\'s payment request cannot be used');
  // An attacker submits a hash that is not theirs; it is declined on-chain
  // (amount mismatch), which must NOT lock the real owner out of that hash.
  const stolen='e'.repeat(64);
  deposits.set('usdt:'+stolen,{userId:'attacker',method:'usdt',txid:stolen,status:'failed',amount:0,exactMicros:10000005,intentId:'10000005'});
  ledger.set('atk-tx',{userId:'attacker',statementId:'atk',type:'deposit',depositId:'usdt:'+stolen,status:'failed',amount:0});
  mkIntent('10000007','victim',10);
  vm.runInContext('_usdtSubmitDebounce.clear()',ctx);
  x=res();await submit({userId:'victim',body:{intentId:'10000007',txid:stolen}},x);
  assert.equal(x.code,200,'a failed attempt by someone else does not block the real owner');
  assert.equal(deposits.get('usdt:'+stolen).userId,'victim','the claim now belongs to the owner of the matching request');
  assert.equal(ledger.get('atk-tx').userId,'victim','its single ledger row moves with it (no duplicate rows to double count)');
  assert.equal(intents.get('10000007').status,'used','the request is marked used');
  // One request, one transaction.
  vm.runInContext('_usdtSubmitDebounce.clear()',ctx);
  x=res();await submit({userId:'victim',body:{intentId:'10000007',txid:'f'.repeat(64)}},x);
  assert.equal(x.code,409,'a second hash for the same request is refused while the first is live');
  console.log('PASS: USDT payment requests: hijack attempts, ownership, one hash per request');
  console.log('PASS: USDT TXID races and retries preserve one claim and ledger row, including legacy random-ID claims');
})().catch(e=>{console.error(e);process.exit(1)});
