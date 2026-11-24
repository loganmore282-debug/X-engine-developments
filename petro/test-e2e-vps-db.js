'use strict';
// END-TO-END on the VPS database: the REAL server.js is started on a fresh local database folder (no MongoDB) and driven over HTTP as the admin
// (members here sign in through Firebase, which a test cannot do, so this covers what the admin side writes): settings, assets, treasure codes
// (a unique index) -- 60 codes made at the same moment must all be different -- then the process is KILLED (kill -9) and started again and
// every change must still be there, then a clean stop (SIGTERM) and one more start.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petro-e2e-')), PORT = 3900 + Math.floor(Math.random() * 90), KEY = 'e2e-admin-key-123456';
const base = 'http://127.0.0.1:' + PORT;
let checks = 0; const ok = (c, m, x) => { checks++; assert.ok(c, m + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SA = (() => { const { privateKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }); return JSON.stringify({ type: 'service_account', project_id: 'fixture-project', private_key_id: 'abc', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'fixture@fixture-project.iam.gserviceaccount.com', client_id: '1' }); })();
let child = null, out = '';
function start() {
  out = '';
  child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(PORT), PETRO_DATA_DIR: dir, DB_ENGINE: 'local', PETRO_DB_FRESH: '1', MONGODB_URI: '', ADMIN_KEY: KEY, FIREBASE_SERVICE_ACCOUNT: SA, NODE_ENV: 'development' }) });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return (async () => { for (let i = 0; i < 120; i++) { try { const h = await fetch(base + '/health'); if (h.ok && (await h.json()).db === true) return; } catch (_) {} await sleep(250); } throw new Error('server did not start: ' + out.slice(-600)); })();
}
const stopped = () => new Promise(r => child.once('exit', (code, sig) => r({ code, sig })));
const J = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, { authorization: 'Bearer ' + KEY }), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
(async () => {
  try {
    await start(); ok(/Database: the VPS/.test(out), 'the server says it uses the VPS database');
    const bef = (await J('GET', '/public/settings')).j; ok(bef && bef.status === 'success', 'public settings answer');
    let r = await J('POST', '/admin/settings/update', { settings: { minDeposit: 12345 } }); ok(r.s === 200, 'an admin setting is saved', r);
    r = await J('GET', '/public/settings'); ok(Number(r.j.settings.minDeposit) === 12345, 'and read back', r.j.settings && r.j.settings.minDeposit);
    const gen = await Promise.all(Array.from({ length: 60 }, () => J('POST', '/admin/promocodes/generate', { minReward: 1000, maxReward: 2000 })));
    const codes = gen.filter(x => x.j && x.j.status === 'success').map(x => x.j.code); ok(codes.length === 60 && new Set(codes).size === 60, '60 treasure codes made at the same moment are all different', { made: codes.length, distinct: new Set(codes).size });
    const prods0 = (await J('GET', '/public/products')).j.products || [];
    // kill -9, no goodbye
    const gone = stopped(); child.kill('SIGKILL'); await gone; await start();
    r = await J('GET', '/public/settings'); ok(Number(r.j.settings.minDeposit) === 12345, 'after kill -9 the setting is still 12,345');
    const prods1 = (await J('GET', '/public/products')).j.products || []; ok(prods1.length === prods0.length, 'and the assets are all there (' + prods1.length + ')');
    const again = await Promise.all(Array.from({ length: 5 }, () => J('POST', '/admin/promocodes/generate', { minReward: 1000, maxReward: 2000 })));
    ok(again.every(x => x.j && x.j.status === 'success' && !codes.includes(x.j.code)), 'a new code after the restart is never one that already exists (the unique index was rebuilt)');
    const done = stopped(); child.kill('SIGTERM'); const res = await done; ok(res.code === 0, 'SIGTERM is a clean stop (exit 0)', res);
    await start(); r = await J('GET', '/public/settings'); ok(Number(r.j.settings.minDeposit) === 12345, 'and after the clean stop and start it is still there');
    ok(!/UNIQUENESS NOT ENFORCED/.test(out), 'every unique index is built');
    console.log(`PASS: Petro on the VPS database, end to end (${checks} checks)`);
  } finally { try { child && child.kill('SIGKILL'); } catch (_) {} await sleep(200); fs.rmSync(dir, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); console.error(out.slice(-1500)); try { child.kill('SIGKILL'); } catch (_) {} process.exit(1); });
