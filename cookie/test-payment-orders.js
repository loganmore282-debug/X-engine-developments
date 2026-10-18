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

const crypto=require('node:crypto'); const PAY_SEAL=require('./pay-seal').createPaySeal();
function setup(extra={}){
  const rows={ users:{ u1:{registrationDone:true,status:'active',phone:'256771234567'}, u2:{registrationDone:true,status:'active',phone:'256772222222'} }, paymentOrders:{}, pendingDeposits:{}, transactions:{} };
  const db=database(rows); let serial=0, collects=[];
  const routes={}, locks=new Map(), debounce=new Map();
  const c=vm.createContext({ db, crypto, console:{log(){},warn(){},error(){}}, Date, setTimeout,
    FieldValue:{ increment:n=>({op:'inc',n}), serverTimestamp:()=>new Date() },
    verifyAuth:async req=>req.uid||null, getSettings:async()=>({minDeposit:30000}), paymentAmount:v=>Number(String(v).replace(/[^\d.]/g,'')),
    MAX_MONEY_AMOUNT:50000000, fmtMoney:n=>'UGX '+n, finiteMoney:n=>Number(n)||0, _userBeingDeleted:new Set(), depositAutomaticProvider:()=>'marzpay',
    gatewayServesRegion:()=>true, currentRegion:()=>({name:'Uganda'}), currentRegionKey:()=>'ug', textOf:v=>String(v==null?'':v), withLock:(k,fn)=>{ const prev=locks.get(k)||Promise.resolve(); const run=prev.then(fn,fn); locks.set(k,run.catch(()=>{})); return run; },
    depositSenderPhone:(body)=>({phone:'+256'+String(body.phone).replace(/\D/g,'').slice(-9)}), _depCreateDebounce:debounce, recordDepositAttempt:()=>1, depositSucceededRecently:()=>false,
    logSecurityEvent(){}, uniqueRef:async()=>'S26'+(++serial), mobileMoneyRefPrefix:async()=>'S', nowStr:()=>({date:'d',time:'t'}), newStatementId:()=>'st'+ ++serial,
    NETWORK_NAMES:new Set(['MTN Mobile Money','Airtel Money']), PUBLIC_URL:'', PROVIDER_BUSY_MSG:'busy', markDepositFailed:async()=>{},
    marzCollect:async a=>{ collects.push(a); return extra.marz||{status:'success',data:{transaction:{uuid:'tx1'}}}; }, marzUserMsg:()=>'x', pesajetCollect:async()=>({ok:true}), watchPesajetDeposit(){},
    PAY_SEAL, PAYMENT_ORDER_TTL_MS:10*60*1000, DEPOSIT_METHOD_KEYS:['C','L','H','K'], bumpDepositMethod(){},
    app:{ post:(p,h)=>{routes['POST '+p]=h}, get:(p,h)=>{routes['GET '+p]=h} } });
  vm.runInContext([fn('loadPaymentOrder')].join('\n')+'\nconst orderView = o => ({ orderNo: o.orderNo, amount: o.amount, state: o.status, depositId: o.depositId, reference: o.reference, expiresAt: o.expiresAt });\n'+route('/deposit/order/create')+'\n'+route('/deposit/order/:no')+'\n'+route('/deposit/marzpay'),c);
  const call=async(key,uid,body={},params={})=>{ let code=200,out; const res={headersSent:false,status(n){code=n;return res},json(b){out=b;res.headersSent=true;return res}}; await routes[key]({uid,body,params,headers:{}},res); await new Promise(r=>setTimeout(r,20)); return {code,out}; };
  return {db,call,collects,debounce};
}
(async()=>{
  const {db,call,collects,debounce}=setup();
  // an order: 11 random digits, the amount fixed on the server, 30 minutes
  let r=await call('POST /deposit/order/create','u1',{amount:30000,method:'H'});
  assert.equal(r.code,200); const no=r.out.orderNo; assert.match(no,/^\d{11}$/,'11 digits'); assert.equal(r.out.amount,30000);
  assert.ok(r.out.expiresAt>Date.now()+9*60000 && r.out.expiresAt<=Date.now()+10*60000+1000,'10 minutes');
  assert.equal(db.rows.paymentOrders[no].userId,'u1');
  assert.equal((await call('POST /deposit/order/create','u1',{amount:1000})).code,400,'below the minimum is refused');
  assert.equal((await call('POST /deposit/order/create',null,{amount:30000})).code,401,'not signed in is refused');
  // only the owner can see it; anyone else gets exactly what a missing number gets
  r=await call('GET /deposit/order/:no','u1',{},{no}); assert.equal(r.out.order.state,'created'); assert.equal(r.out.order.amount,30000);
  const other=await call('GET /deposit/order/:no','u2',{},{no}), missing=await call('GET /deposit/order/:no','u2',{},{no:'12345678901'});
  assert.deepEqual([other.code,other.out],[missing.code,missing.out],'someone else\'s order looks exactly like one that does not exist');
  assert.equal((await call('GET /deposit/order/:no','u1',{},{no:'12ab'})).code,404,'a malformed number is not found');
  // paying someone else's order, or a made-up one, starts nothing
  assert.equal((await call('POST /deposit/marzpay','u2',{orderNo:no,phone:'0771234567'})).code,404); assert.equal(collects.length,0);
  // the amount is the ORDER's: whatever the request says is ignored
  r=await call('POST /deposit/marzpay','u1',{orderNo:no,amount:999999999,phone:'0771234567',network:'Airtel Money'});
  assert.equal(r.code,200); assert.equal(collects.length,1); assert.equal(collects[0].amount,30000,'charged exactly the order amount');
  const dep=db.rows.pendingDeposits[r.out.depositId]; assert.equal(dep.amount,30000); assert.equal(dep.orderNo,no); assert.equal(dep.userId,'u1'); assert.equal(dep.network,'Airtel Money');
  assert.equal(db.rows.paymentOrders[no].status,'paying'); assert.equal(db.rows.paymentOrders[no].depositId,r.out.depositId);
  // a second tap, or a refresh, answers with the SAME payment and starts no second one
  const again=await call('POST /deposit/marzpay','u1',{orderNo:no,phone:'0771234567'});
  assert.equal(again.code,200); assert.equal(again.out.depositId,r.out.depositId); assert.equal(collects.length,1,'one payment per order');
  assert.equal(Object.keys(db.rows.pendingDeposits).length,1);
  // an expired order cannot be paid
  r=await call('POST /deposit/order/create','u1',{amount:40000}); const no2=r.out.orderNo; db.rows.paymentOrders[no2].expiresAt=Date.now()-1000;
  const exp=await call('POST /deposit/marzpay','u1',{orderNo:no2,phone:'0771234567'}); assert.equal(exp.code,410); assert.equal(exp.out.code,'ORDER_EXPIRED'); assert.equal(collects.length,1);
  assert.equal((await call('GET /deposit/order/:no','u1',{},{no:no2})).out.order.state,'expired');
  // a newer order closes the older unused one
  r=await call('POST /deposit/order/create','u1',{amount:50000}); const no3=r.out.orderNo;
  r=await call('POST /deposit/order/create','u1',{amount:60000}); const no4=r.out.orderNo;
  assert.equal(db.rows.paymentOrders[no3].status,'replaced','only the newest order can be paid');
  assert.equal((await call('POST /deposit/marzpay','u1',{orderNo:no3,phone:'0771234567'})).code,410);
  // two taps at the same instant: one payment
  debounce.clear();
  const both=await Promise.all([call('POST /deposit/marzpay','u1',{orderNo:no4,phone:'0771234567'}),call('POST /deposit/marzpay','u1',{orderNo:no4,phone:'0771234567'})]);
  assert.equal(collects.filter(x=>x.amount===60000).length,1,'two taps at once start one payment');
  assert.equal(both.filter(x=>x.code===200).length>=1,true);
  assert.equal(Object.values(db.rows.pendingDeposits).filter(d=>d.orderNo===no4).length,1,'one pending deposit for the order');
  // a storage failure after the order is claimed puts it back to 'created'
  const f=setup(); r=await f.call('POST /deposit/order/create','u1',{amount:30000}); const no6=r.out.orderNo;
  f.db.faults.push((col)=>col==='pendingDeposits');
  const bad2=await f.call('POST /deposit/marzpay','u1',{orderNo:no6,phone:'0771234567'});
  assert.notEqual(bad2.code,200); assert.equal(f.db.rows.paymentOrders[no6].status,'created','a failed start frees the order');
  // a sealed request is opened and the answer is sealed
  {
    const h=setup(); const o=(await h.call('POST /deposit/order/create','u1',{amount:70000})).out.orderNo;
    const ecdh=crypto.createECDH('prime256v1'); ecdh.generateKeys(); const pk=PAY_SEAL.publicKey();
    const peer=crypto.createPublicKey({key:pk.jwk,format:'jwk'}); const raw=ecdh.getPublicKey(); 
    const priv=crypto.createPrivateKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url'),d:ecdh.getPrivateKey().toString('base64url')},format:'jwk'});
    const key=crypto.createHash('sha256').update(crypto.diffieHellman({privateKey:priv,publicKey:peer})).digest();
    const epk=raw.toString('base64url'), iv=crypto.randomBytes(12), ci=crypto.createCipheriv('aes-256-gcm',key,iv); ci.setAAD(Buffer.from(pk.kid+'.'+epk));
    const ct=Buffer.concat([ci.update(JSON.stringify({ts:Date.now(),nonce:'n'.repeat(20),orderNo:o,phone:'0771234567',network:'MTN Mobile Money'})),ci.final(),ci.getAuthTag()]);
    const rr=await h.call('POST /deposit/marzpay','u1',{sealed:{kid:pk.kid,epk,iv:iv.toString('base64url'),ct:ct.toString('base64url')}});
    assert.equal(rr.code,200); assert.equal(rr.out.status,'success'); assert.ok(rr.out.sealed&&!rr.out.depositId,'the answer is sealed');
    const buf=Buffer.from(rr.out.sealed.ct,'base64url'), de=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(rr.out.sealed.iv,'base64url')); de.setAAD(Buffer.from(pk.kid+'.res')); de.setAuthTag(buf.subarray(-16));
    const ans=JSON.parse(Buffer.concat([de.update(buf.subarray(0,-16)),de.final()]).toString()); assert.ok(ans.depositId); assert.equal(h.collects[0].amount,70000);
    const bad=await h.call('POST /deposit/marzpay','u1',{sealed:{kid:pk.kid,epk,iv:iv.toString('base64url'),ct:ct.toString('base64url')}}); assert.equal(bad.code,400,'the same sealed request twice is refused');
  }
  // the link survives a reload: the service worker answers /payment/<number> with the app, and the page counts the 10 minutes
  { const sw=fs.readFileSync(__dirname+'/user/sw.js','utf8'), mod=fs.readFileSync(__dirname+'/user-src/original_module.js','utf8'), qu=fs.readFileSync(__dirname+'/deploy/quick-update.sh','utf8');
    assert.ok(/mode === 'navigate' && \/\^\\\/payment\\\/\\d\{8,14\}/.test(sw) && /fetch\('\/index\.html'/.test(sw),'the worker opens the app for a payment link');
    assert.ok(/PAYMENT_ORDER_TTL_MS = 10 \* 60 \* 1000/.test(fs.readFileSync(__dirname+'/server.js','utf8')),'orders last 10 minutes');
    assert.ok(/function pgStartTimer/.test(mod) && /id="pgTimer"/.test(mod) && /pgShowGone\('This payment has expired/.test(mod),'a countdown on the form that closes the order at 00:00');
    assert.ok(/preview\.sh" on/.test(qu),'the update script refreshes the preview nginx file'); }
  console.log('PASS: payment orders (11 digits, owner only, fixed amount, one payment, expiry, newest only)');
})().catch(e=>{console.error(e);process.exit(1)});
