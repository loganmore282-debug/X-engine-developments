'use strict';
// The payment request is sealed: the REAL client functions (user-src) against the REAL server module (pay-seal.js).
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const acorn = require('acorn');
const { createPaySeal } = require('./pay-seal');
const src = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
const fnSrc = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, 'missing ' + name); return src.slice(n.start, n.end); };

(async () => {
  const seal = createPaySeal();
  const wire = [];   // everything that went over the network
  const client = (opts = {}) => {
    const w = { crypto: globalThis.crypto, isSecureContext: true };
    const c = vm.createContext({ window: w, TextEncoder, TextDecoder, btoa, atob, Uint8Array, JSON, Object, Date, Math, ckNow: () => Date.now() + (opts.skew || 0),
      api: async path => { assert.equal(path, '/pay/key'); return Object.assign({ status: 'success' }, seal.publicKey()); },
      post: async (path, body) => { wire.push(JSON.stringify(body)); return opts.post(path, body); } });
    vm.runInContext(['pgB64u', 'pgUnB64u', 'pgSealedPost'].map(fnSrc).join('\n'), c);
    return c;
  };
  // the server side of the route: open, answer sealed
  let lastBody;
  const serverPost = (replyFor) => async (path, body) => {
    const o = seal.open(body.sealed);
    if (o.error) return { status: 'error', code: o.error };
    lastBody = o.body;
    return { status: 'success', sealed: seal.seal(o.key, replyFor(o.body)) };
  };
  let c = client({ post: serverPost(b => ({ status: 'success', depositId: 'dep1', reference: 'R1', echo: b.orderNo })) });
  const r = await c.pgSealedPost('/deposit/marzpay', { orderNo: '12345678901', phone: '+256771234567', network: 'Airtel Money' });
  assert.equal(r.status, 'success'); assert.equal(r.depositId, 'dep1'); assert.equal(r.echo, '12345678901', 'the answer is opened by the app');
  assert.equal(lastBody.phone, '+256771234567'); assert.equal(lastBody.network, 'Airtel Money'); assert.equal(lastBody.orderNo, '12345678901');
  // nothing readable on the wire
  assert.ok(!/256771234567|Airtel|12345678901/.test(wire[0]), 'phone, provider and order number are not in the request as sent');
  assert.deepEqual(Object.keys(JSON.parse(wire[0])), ['sealed']);
  // a copy of the request is refused (replay), a changed byte is refused, an old one is refused
  const env = JSON.parse(wire[0]).sealed;
  assert.equal(seal.open(env).error, 'SEAL_REPLAY', 'a captured request cannot be sent again');
  const w2 = []; c = client({ post: async (p, b) => { w2.push(b); return { status: 'error', code: 'X' }; } }); await c.pgSealedPost('/x', { a: 1 });
  const e2 = JSON.parse(JSON.stringify(w2[0].sealed)); const ct = Buffer.from(e2.ct, 'base64url'); ct[0] ^= 1; e2.ct = ct.toString('base64url');
  assert.equal(seal.open(e2).error, 'SEAL_BAD', 'a changed byte is refused');
  const e3 = JSON.parse(JSON.stringify(w2[0].sealed)); e3.epk = e3.epk.slice(0, -2) + 'AA'; assert.ok(seal.open(e3).error, 'a swapped app key is refused');
  const e4 = JSON.parse(JSON.stringify(w2[0].sealed)); e4.kid = 'ffffffffffff'; assert.equal(seal.open(e4).error, 'SEAL_KEY');
  const old = []; c = client({ skew: -10 * 60 * 1000, post: async (p, b) => { old.push(b); return { status: 'error' }; } }); await c.pgSealedPost('/x', { a: 1 });
  assert.equal(seal.open(old[0].sealed).error, 'SEAL_OLD', 'a request ten minutes old is refused');
  // a server restart (new key) makes the app fetch the new key and send again, once
  let n = 0; c = client({ post: async (p, b) => ++n === 1 ? { status: 'error', code: 'SEAL_KEY' } : serverPost(() => ({ status: 'success', depositId: 'd2' }))(p, b) });
  assert.equal((await c.pgSealedPost('/x', { a: 1 })).depositId, 'd2'); assert.equal(n, 2);
  // plain HTTP (no secure context): goes the ordinary way
  let plain; c = client({ post: async (p, b) => { plain = b; return { status: 'success' }; } }); c.window.isSecureContext = false;
  await c.pgSealedPost('/x', { phone: '1' }); assert.deepEqual(plain, { phone: '1' });
  // the route: sealed in, sealed out; over HTTPS a plain request is refused; the form asks for number and provider by hand
  assert.ok(/req\.body && req\.body\.sealed/.test(server) && /else if \(req\.secure\)/.test(server) && /SEAL_REQUIRED/.test(server), 'plain requests are refused over HTTPS');
  assert.ok(/pgSealedPost\('\/deposit\/marzpay'/.test(src), 'the app pays through the sealed call');
  assert.ok(/id="pgPhone"[^>]*value=""[^>]*required/.test(src) && /reportValidity/.test(src) && !/Select provider/.test(src), 'number typed by hand (empty gets the browser\'s "Please fill out this field."), provider picked from the list');
  console.log('PASS: sealed payment request (encrypted, replay-proof, answer sealed, HTTPS needs it)');
})().catch(e => { console.error(e); process.exit(1); });
