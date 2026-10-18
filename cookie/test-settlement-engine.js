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

const HOUR=3600000, DAY=86400000, eat=s=>Date.parse(s+'+03:00');
let NOW=0;
class FakeDate extends Date{ constructor(...a){ if(a.length) super(...a); else super(NOW); } static now(){ return NOW; } static [Symbol.hasInstance](x){ return Object.prototype.toString.call(x)==='[object Date]'; } }
function setup(rows){
  const db=database(rows); let serial=0;
  const c=vm.createContext({ db, Date:FakeDate, console:{log(){},warn(){},error(){}}, tzOffMs:()=>10800000, 
    _creditingPayouts:new Set(), nowStr:()=>({date:'d',time:'t'}), newStatementId:()=>'s-'+ ++serial,
    FieldValue:{ increment:n=>({op:'inc',n}), arrayUnion:(...items)=>({op:'union',items}), delete:()=>({op:'delete'}), serverTimestamp:()=>new FakeDate() } });
  vm.runInContext('const _lockTails=new Map();\n'+['withLock','tsMillis','eatNextMidnight','payoutDueAtMs','payoutsDueCount','settleInvestmentIfDue','_settleDueInvestmentNow'].map(fn).join('\n'),c);
  const settle=async id=>c.settleInvestmentIfDue(await db.collection('investments').doc(id).get());
  return {c,db,settle};
}
const member=(extra={})=>({walletBalance:0,totalEarned:0,status:'active',...extra});
const plan=(o={})=>({userId:'m',status:'active',tierLabel:'Volt Go',amount:30000,payoutsTotal:8,payoutsMade:0,paidOut:0,expectedReturn:90000,createdAt:new FakeDate(eat('2026-10-14T15:00:00')),...o});   // a Wednesday afternoon
const cashRows=db=>Object.values(db.rows.transactions||{}).filter(t=>t.type==='cashback');
async function runDays(h,inv,id,from,days,parallel=1){
  const paidAt=[];
  for(let t=from;t<from+days*DAY;t+=HOUR){ NOW=t; const before=cashRows(h.db).length;
    await Promise.all(Array.from({length:parallel},()=>h.settle(id)));
    if(cashRows(h.db).length>before) paidAt.push(new Date(t+10800000).toISOString().slice(0,16).replace('T',' ')); }
  return paidAt;
}
async function main(){
  {
    // A daily income product bought Wednesday 15:00 pays exactly 8 times, at every midnight (no weekend rest), and exactly its total in all.
    const h=setup({users:{m:member()},investments:{i1:plan()},transactions:{}});
    const days=await runDays(h,null,'i1',eat('2026-10-14T15:00:00'),20);
    assert.deepEqual(days,['2026-10-15 00:00','2026-10-16 00:00','2026-10-17 00:00','2026-10-18 00:00','2026-10-19 00:00','2026-10-20 00:00','2026-10-21 00:00','2026-10-22 00:00'],'pays at 00:00 every night, Saturday, Sunday and Monday included');
    assert.equal(h.db.rows.users.m.walletBalance,90000,'the wallet got exactly the total payout');
    assert.equal(h.db.rows.users.m.totalEarned,90000);
    assert.equal(h.db.rows.investments.i1.status,'matured');assert.equal(h.db.rows.investments.i1.payoutsMade,8);assert.equal(h.db.rows.investments.i1.paidOut,90000);
    assert.equal(cashRows(h.db).length,8,'one ledger row per payout');
    await h.settle('i1');assert.equal(h.db.rows.users.m.walletBalance,90000,'a matured product never pays again');
  }
  {
    // Five settle calls at the same instant, every hour: still exactly one payment per midnight.
    const h=setup({users:{m:member()},investments:{i1:plan()},transactions:{}});
    await runDays(h,null,'i1',eat('2026-10-14T15:00:00'),20,5);
    assert.equal(h.db.rows.users.m.walletBalance,90000,'concurrent settling never doubles a payout');
    assert.equal(cashRows(h.db).length,8);
  }
  {
    // Down for 20 days (a deploy, a restart): one catch-up pays every missed day once.
    const h=setup({users:{m:member()},investments:{i1:plan()},transactions:{}});
    NOW=eat('2026-11-10T09:00:00');await Promise.all([h.settle('i1'),h.settle('i1'),h.settle('i1')]);
    assert.equal(h.db.rows.users.m.walletBalance,90000);assert.equal(h.db.rows.investments.i1.status,'matured');assert.equal(cashRows(h.db).length,8);
  }
  {
    // The process stops after the wallet credit but before the product is marked paid: the retry does not pay that day twice.
    const h=setup({users:{m:member()},investments:{i1:plan()},transactions:{}});
    NOW=eat('2026-10-15T00:05:00');
    h.db.faults.push((col,id,patch)=>col==='investments'&&id==='i1'&&patch.payoutsMade===1);
    await assert.rejects(h.settle('i1'));
    assert.equal(h.db.rows.users.m.walletBalance,11250,'the wallet was credited once');
    NOW=eat('2026-10-15T00:10:00');await h.settle('i1');
    assert.equal(h.db.rows.users.m.walletBalance,11250,'the retry only advances the product, no second credit');
    assert.equal(h.db.rows.investments.i1.payoutsMade,1);assert.equal(cashRows(h.db).length,1);
    NOW=eat('2026-12-01T00:00:00');await h.settle('i1');
    assert.equal(h.db.rows.users.m.walletBalance,90000,'and the rest still adds up to exactly the total');
  }
  {
    // A banned member earns nothing while banned; unbanned, the missed days are paid once.
    const h=setup({users:{m:member({status:'banned'})},investments:{i1:plan()},transactions:{}});
    NOW=eat('2026-10-24T09:00:00');await h.settle('i1');assert.equal(h.db.rows.users.m.walletBalance,0);assert.equal(h.db.rows.investments.i1.payoutsMade,0);
    h.db.rows.users.m.status='active';NOW=eat('2026-10-24T09:30:00');await h.settle('i1');await h.settle('i1');
    assert.equal(h.db.rows.users.m.walletBalance,90000,'caught up once, nothing doubled');assert.equal(cashRows(h.db).length,8);
  }
  {
    // A removed product pays nothing.
    const h=setup({users:{m:member()},investments:{i1:plan({status:'removed'})},transactions:{}});
    NOW=eat('2026-12-01T00:00:00');await h.settle('i1');assert.equal(h.db.rows.users.m.walletBalance,0);
  }
  {
    // A daily wage product (activated by the admin, price 0) pays its daily figure from the same engine and stops at its total.
    const h=setup({users:{m:member()},investments:{w1:plan({tierLabel:'Silver',amount:0,payoutsTotal:360,expectedReturn:360000,granted:true,createdAt:new FakeDate(eat('2026-10-14T15:00:00'))})},transactions:{}});
    NOW=eat('2026-10-25T01:00:00');await Promise.all([h.settle('w1'),h.settle('w1')]);
    assert.equal(h.db.rows.investments.w1.payoutsMade,11,'eleven midnights so far (Thursday 00:00 to Sunday 00:00)');
    assert.equal(h.db.rows.users.m.walletBalance,11000,'1,000 a day, once each');
    assert.equal(h.db.rows.investments.w1.status,'active');
    NOW=eat('2028-06-01T00:00:00');await h.settle('w1');
    assert.equal(h.db.rows.users.m.walletBalance,360000,'the full wage in the end, exactly');assert.equal(h.db.rows.investments.w1.status,'matured');
    await h.settle('w1');assert.equal(h.db.rows.users.m.walletBalance,360000);
  }
  {
    // Amounts that do not divide evenly still end on the exact total.
    const h=setup({users:{m:member()},investments:{i1:plan({payoutsTotal:7,expectedReturn:100000})},transactions:{}});
    NOW=eat('2027-01-01T00:00:00');await h.settle('i1');assert.equal(h.db.rows.users.m.walletBalance,100000);assert.equal(h.db.rows.investments.i1.paidOut,100000);
  }
  console.log('PASS: settlement engine (exact totals, no double pay: concurrent, crash retry, catch-up, ban, removed; every midnight; wage products)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
