#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const member = fs.readFileSync(path.join(__dirname, 'user-src/original_module.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8');

function source(name) {
  const start = server.indexOf(`async function ${name}(`) >= 0
    ? server.indexOf(`async function ${name}(`) : server.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  let depth = 0;
  for (let i = server.indexOf('{', start); i < server.length; i++) {
    if (server[i] === '{') depth++;
    if (server[i] === '}' && --depth === 0) return server.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

(async () => {
  const ug = { key: 'ug', currency: 'UGX', dialCode: '256' };
  const currentRegion = new Function('DEFAULT_REGION', `${source('currentRegion')}; return currentRegion;`)(ug);
  assert.deepEqual(currentRegion(), ug);
  assert.doesNotMatch(server, /app\.(?:post|get)\('\/admin\/regions(?:\/|')/);
  assert.doesNotMatch(server, /db\.collection\('regions'\)/);
  assert.doesNotMatch(panel, /id="regionSwitch"|\/admin\/regions/);
  assert.doesNotMatch(member, /\/public\/(?:entry|share-host)/);

  const products = [{ key: 'asset', price: 15000, regions: { ke: { price: 1 } } }];
  const getProducts = new Function('getProductsRaw', `${source('getProducts')}; return getProducts;`)(async () => products);
  assert.deepEqual(await getProducts(), [{ key: 'asset', price: 15000 }]);

  const getSettings = new Function('db', 'DEFAULT_SETTINGS', 'sanitizeAllowedOrigins', 'refreshHostPolicy', `
    let _settingsCache = null, _settingsCacheTs = 0, _mainAllowedHosts = [];
    ${source('getSettings')}
    return getSettings;
  `)({ collection: name => ({ doc: id => ({ get: async () => {
    assert.equal(name, 'settings'); assert.equal(id, 'main');
    return { exists: true, data: () => ({ minDeposit: 15000 }) };
  } }) }) }, { minDeposit: 30000 }, () => ({ hosts: [] }), () => {});
  assert.equal((await getSettings()).minDeposit, 15000);
  assert.doesNotMatch(server, /'254':\s*\{ code: 'KE'/);
  assert.doesNotMatch(server + member + panel, new RegExp('lipa' + 'pay', 'i'));
  console.log('Uganda-only settings, assets, payment surfaces and country editor: pass');
})().catch(e => { console.error(e); process.exitCode = 1; });
