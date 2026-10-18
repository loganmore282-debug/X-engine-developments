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

const mod=fs.readFileSync(__dirname+'/user-src/original_module.js','utf8'), html=fs.readFileSync(__dirname+'/user-src/index.html','utf8');
function setup(rows){
  const db=database(rows); db.rows.counters ||= {};
  const baseCollection=db.collection;
  db.collection=name=>name!=='counters'?baseCollection(name):{ doc:id=>({ get:async()=>({ exists:!!db.rows.counters[id], data:()=>structuredClone(db.rows.counters[id]||{}) }),
    set:async d=>{ const row=(db.rows.counters[id] ||= {}); for(const [k,v] of Object.entries(d)) row[k]=(row[k]||0)+v.n; } }) };
  const c=vm.createContext({ db, console, Date, FieldValue:{ increment:n=>({op:'inc',n}) } });
  vm.runInContext("const DEPOSIT_METHOD_KEYS=['C','L','H','K']; let _hotDepositMethod={key:'H',ts:0};\n"+fn('bumpDepositMethod')+'\n'+fn('getHotDepositMethod'),c);
  return {c,db};
}
(async()=>{
  // nothing counted yet: H carries the mark
  let {c,db}=setup({counters:{}});
  assert.equal(await c.getHotDepositMethod(),'H','H before anyone has used a method');
  // taps are counted (set with merge makes the counter document on the first tap)
  for(const k of ['K','K','L','C','K','bad','']) c.bumpDepositMethod(k);
  await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(db.rows.counters.depositMethodTaps,{tapsK:3,tapsL:1,tapsC:1},'only the four methods are counted');
  vm.runInContext("_hotDepositMethod={key:'H',ts:0}",c);
  assert.equal(await c.getHotDepositMethod(),'K','the most used method gets the mark');
  // it is remembered for a minute
  db.rows.counters.depositMethodTaps.tapsL=99; assert.equal(await c.getHotDepositMethod(),'K','remembered for a minute');
  vm.runInContext('_hotDepositMethod.ts=0',c); assert.equal(await c.getHotDepositMethod(),'L','and refreshed after it');
  // the app: the mark follows the setting, the loading state is the screenshot's
  assert.ok(/depositHotMethod: await getHotDepositMethod\(\)/.test(source) && /bumpDepositMethod\(req\.body\.method\)/.test(source),'the server publishes it and counts a started deposit');
  assert.ok(/data-m="\$\{k\}" class="\$\{i === 0 \? 'on' : ''\}\$\{k === hotKey \? ' hot' : ''\}"/.test(mod) && /\? STATE\.settings\.depositHotMethod : 'H'/.test(mod),'the HOT mark sits on the most used pill, not always the first');
  assert.ok(/ckPayLoading\(submitBtn, true\);\s*ckLoadBegin\(\);/.test(mod) && /post\('\/deposit\/marzpay', \{ amount, phone, method \}\)/.test(mod) && /ckLoadEnd\(\);[\s\S]{0,500}ckPayLoading\(submitBtn, false/.test(mod),'tapping Pay shows the grey Loading button and the loading box until the server answers');
  assert.ok(/\.ck-pay\.ck-pay-ld,\.ck-pay\.ck-pay-ld:disabled\{background:#a4a4a4;color:#8d8e93;opacity:1;/.test(html) && /\.ck-pay-sp\{[^}]*animation:ckSpoke \.9s steps\(12\) infinite/.test(html),'the grey of the screenshot and a 12-spoke spinner');
  assert.ok(/cancelAnimationFrame\(btn\._raf\)/.test(mod),'a count-up cannot write over the word Loading');
  console.log('PASS: deposit methods (HOT by usage) and the Loading Pay button');
})().catch(e=>{console.error(e);process.exit(1)});
