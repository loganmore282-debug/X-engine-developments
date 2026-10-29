'use strict';
// Home has two product lists, Products and New Products, that never mix; the admin picks one per product.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest' });
const fn = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, name); return source.slice(n.start, n.end); };
const ctx = vm.createContext({ MAX_MONEY_AMOUNT: 1e9, MAX_SPINS_PER_PURCHASE: 100 });
vm.runInContext(fn('hhmmToMin') + fn('sanitizeProductInput'), ctx);
const base = { key: 'product11', name: 'Product-11', price: 50000, cycle: 8, multiplier: 3 };
const save = extra => vm.runInContext('sanitizeProductInput(' + JSON.stringify({ ...base, ...extra }) + ', 0)', ctx);
assert.equal(save({ category: 'new' }).category, 'new', 'a product saved as New Products stays there');
assert.equal(save({ category: 'main' }).category, 'main');
assert.equal(save({}).category, 'main', 'no category = the Products list');
assert.equal(save({ category: 'whatever' }).category, 'main', 'an unknown category falls back to Products');

// the member app: each tab lists only its own products
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const grab = name => { const a = mod.indexOf('function ' + name + '('); assert(a >= 0, name); const b = mod.indexOf('\n}\n', a); return mod.slice(a, b + 2); };
const app = { STATE: { products: [
  { key: 'a', name: 'Product-1' }, { key: 'b', name: 'Product-2', category: 'main' },
  { key: 'c', name: 'Product-11', category: 'new' }, { key: 'd', name: 'Product-12', category: 'new', active: false } ] } };
vm.createContext(app);
vm.runInContext(grab('homeTabNow') + grab('mgIsNew') + grab('homeTabProducts'), app);
const names = () => vm.runInContext('homeTabProducts().map(p => p.name).join()', app);
assert.equal(names(), 'Product-1,Product-2,Product-11', 'the owner\'s Home is one list: every active product, whichever category the admin saved it in');
assert.doesNotMatch(mod, /onclick="setHomeTab\('new'\)">New Products</, 'Home has no Products / New Products buttons any more');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
assert.match(admin, /id="pCat"/);
assert.match(admin, /category:\$\('pCat'\)\.value/, 'the admin still sends the category');
console.log('PASS: Home products (one list; category still saved)');
