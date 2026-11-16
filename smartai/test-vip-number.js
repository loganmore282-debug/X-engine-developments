'use strict';
// "Number VIP levels": one tap gives the products VIP 1, 2, 3 ... in the shown arrangement (position, then price), skips deleted ones, changes only what differs, and drops the VIP cache.
//   node test-vip-number.js
const fs = require('node:fs'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf("app.post('/admin/products/number-vips'"), b = src.indexOf("app.get('/admin/products', async", a);
ok(a > 0 && b > a, 'the endpoint is in server.js');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
ok(/id="numberVips"/.test(admin) && /\/admin\/products\/number-vips/.test(admin), 'the Products page has the Number VIP levels button');
(async () => {
  const handlers = {}; const app = { post: (p, h) => { handlers[p] = h; } };
  const rows = [
    { key: 'c', name: 'C', price: 300, order: 2, vip: 0 }, { key: 'a', name: 'A', price: 100, order: 0, vip: 7 }, { key: 'b', name: 'B', price: 200, order: 1, vip: 2 },
    { key: 'gone', deleted: true, order: 1, vip: 9 }, { key: 'd', name: 'D', price: 50, order: 3 },
  ];
  const writes = []; let cacheTs = 5, cleared = 0, owner = true, logged = null;
  const db = { collection: () => ({ doc: key => ({ set: async (v, o) => { writes.push([key, v, o]); const r = rows.find(x => x.key === key); Object.assign(r, v); } }) }) };
  const getProductsRaw = async () => { cacheTs = cacheTs; return rows.slice().sort((x, y) => (x.order || 0) - (y.order || 0) || (x.price || 0) - (y.price || 0)); };
  const mk = new Function('app', 'db', 'verifyOwner', 'getProductsRaw', '_vipCache', 'logAdminAction', 'setTs', src.slice(a, b).replace(/_productsCacheTs = 0/g, 'setTs()'));
  mk(app, db, () => owner, getProductsRaw, { clear: () => { cleared++; } }, (r, k, d) => { logged = [k, d]; }, () => { cacheTs = 0; });
  const call = async () => { const out = { code: 200, body: null }; await handlers['/admin/products/number-vips']({ body: {} }, { status(c) { out.code = c; return this; }, json(x) { out.body = x; return this; } }); return out; };
  owner = false; ok((await call()).code === 401, 'only the owner can do it'); owner = true;
  const r = await call();
  ok(r.code === 200 && r.body.total === 4 && r.body.order.map(x => x.key + ':' + x.vip).join() === 'a:1,b:2,c:3,d:4', 'the products are numbered VIP 1 to 4 in their arrangement: ' + JSON.stringify(r.body.order));
  ok(rows.find(x => x.key === 'gone').vip === 9, 'a deleted product is left alone');
  ok(r.body.changed === 3 && writes.length === 3 && !writes.some(w => w[0] === 'b'), 'only the products whose number differed were written (B was already VIP 2)');
  ok(writes.every(w => w[2] && w[2].merge === true && Object.keys(w[1]).join() === 'vip'), 'each write changes only the VIP number');
  ok(cleared === 1 && cacheTs === 0 && logged && logged[0] === 'products_vip_numbered', 'the member VIP cache is dropped and the action is logged');
  const again = await call(); ok(again.body.changed === 0 && writes.length === 3, 'a second tap changes nothing');
  rows.find(x => x.key === 'a').order = 9; const moved = await call();
  ok(moved.body.order.map(x => x.key).join() === 'b,c,d,a' && rows.find(x => x.key === 'a').vip === 4 && rows.find(x => x.key === 'b').vip === 1, 'after the products are rearranged the numbers follow the new arrangement');
  console.log('test-vip-number: ' + n + ' checks passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
