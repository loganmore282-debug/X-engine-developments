'use strict';
// PICTURES AS FILES: the real server on a fresh local database; an admin uploads big pictures (as the admin panel does, base64 data URLs); the public
// JSON must then carry short picture addresses instead of the base64, each address must serve exactly the uploaded bytes with a one-year
// immutable cache and answer 304 on a repeat, the JSON must be a fraction of its old size, and the pictures must still be served after a restart.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), assert = require('node:assert/strict');
const APP = 'potato', UP = 'POTATO';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-')), PORT = 3900 + Math.floor(Math.random() * 90), KEY = 'img-admin-key-123456', base = 'http://127.0.0.1:' + PORT;
const PREFIX = '/k7x2/public/img/';
const toUrl = u => (u.startsWith('http') ? u : base + u.replace(/^\/k7x2/, ''));
let checks = 0; const ok = (c, m, x) => { checks++; assert.ok(c, m + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SA = (() => { const { privateKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }); return JSON.stringify({ type: 'service_account', project_id: 'x', private_key_id: 'a', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'x@x.iam.gserviceaccount.com', client_id: '1' }); })();
let child = null, out = '';
function start() { out = ''; child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(PORT), [UP + '_DATA_DIR']: dir + '/db', [UP + '_IMG_DIR']: dir + '/img', DB_ENGINE: 'local', [UP + '_DB_FRESH']: '1', MONGODB_URI: '', ADMIN_KEY: KEY, FIREBASE_SERVICE_ACCOUNT: SA, NODE_ENV: 'development' }) }); child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return (async () => { for (let i = 0; i < 120; i++) { try { const h = await fetch(base + '/health'); if (h.ok && (await h.json()).db === true) return; } catch (_) {} await sleep(250); } throw new Error('server did not start: ' + out.slice(-500)); })(); }
const J = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j, h: r.headers }; };
const pic = n => { const b = crypto.randomBytes(180000); b[0] = 0xff; b[1] = 0xd8; return { buf: b, url: 'data:image/jpeg;base64,' + b.toString('base64') }; };   // 180 KB "jpeg"
(async () => {
  try {
    await start();
    const p0 = (await J('GET', '/public/products')).j.products; ok(p0.length >= 3, 'the starter assets exist', p0.length);
    const pics = [pic(1), pic(2), pic(3)];
    const edit = p0.slice(0, 3).map((p, i) => Object.assign({}, p, { image: pics[i].url }));
    const rest = p0.slice(3).map(p => p);
    const sv = await J('POST', '/admin/products/save', Object.assign({ products: edit.concat(rest) }, { region: undefined })); ok(sv.s === 200, 'the admin saves three products with a 180 KB picture each', sv.j);
    const r = await fetch(base + '/public/products', { headers: { 'accept-encoding': 'identity' } }); const raw = await r.text(); const j = JSON.parse(raw);
    ok(!/data:image/.test(raw) && raw.length < 60000, 'the public product list carries no base64 and is small (' + raw.length + ' bytes instead of about ' + 3 * 240000 + ')', raw.length);
    const urls = j.products.map(p => p.image).filter(u => u && u.startsWith(PREFIX)); ok(urls.length === 3 && urls.every(u => u.startsWith(PREFIX) && /\.jpg$/.test(u)), 'each picture is a short address', urls);
    const first = await fetch(toUrl(urls[0])); const bytes = Buffer.from(await first.arrayBuffer());
    ok(first.status === 200 && Buffer.compare(bytes, pics[0].buf) === 0, 'the address serves exactly the uploaded bytes');
    ok(/immutable/.test(first.headers.get('cache-control')) && /max-age=31536000/.test(first.headers.get('cache-control')) && first.headers.get('content-type') === 'image/jpeg' && first.headers.get('etag'), 'with a one-year immutable cache, the right type and an ETag');
    const again = await fetch(toUrl(urls[0]), { headers: { 'if-none-match': first.headers.get('etag') } }); ok(again.status === 304, 'a repeat with the ETag is a 304 with no body');
    ok((await fetch(base + '/public/img/' + '0'.repeat(24) + '.jpg')).status === 404 && (await fetch(base + '/public/img/..%2F..%2Fetc%2Fpasswd')).status === 404 && (await fetch(base + '/public/img/x.jpg')).status === 404, 'an unknown or malformed address is a 404 (no path tricks)');
    // the pictures are kept on disk: after kill -9 and a restart the same addresses still work
    const gone = new Promise(r => child.once('exit', r)); child.kill('SIGKILL'); await gone; await sleep(300);
    ok(fs.readdirSync(dir + '/img').filter(f => /\.jpg$/.test(f)).length >= 3, 'the pictures were written to the picture folder');
    await start(); const after = await fetch(toUrl(urls[1])); ok(after.status === 200 && Buffer.compare(Buffer.from(await after.arrayBuffer()), pics[1].buf) === 0, 'after a kill -9 and a restart the address still serves the picture (even before the list is asked for)');
    const j2 = await (await fetch(base + '/public/products')).json(); ok(JSON.stringify(j2.products.map(p => p.image)) === JSON.stringify(j.products.map(p => p.image)), 'and the addresses in the list are unchanged by the restart (so phones keep their cached pictures)');
    console.log('PASS: pictures as their own cacheable files (' + checks + ' checks)');
  } finally { try { child && child.kill('SIGKILL'); } catch (_) {} await sleep(200); fs.rmSync(dir, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); console.error(out.slice(-800)); try { child.kill('SIGKILL'); } catch (_) {} process.exit(1); });
