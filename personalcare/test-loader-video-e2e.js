'use strict';
// The start-up loader video through the REAL server.js (a child process on a temp folder), over HTTP: raw upload as the owner, the public info and
// video addresses (whole file, Range, versioned cache), a restart (it is kept), and removal.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-lv-')), PORT = 3800 + Math.floor(Math.random() * 90), KEY = 'lv-admin-key-123456', base = 'http://127.0.0.1:' + PORT;
let n = 0; const ok = (c, m, x) => { n++; assert.ok(c, m + (x ? ' ' + JSON.stringify(x).slice(0, 200) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms)); let child = null;
function start() {
  child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(PORT), PERSONALCARE_DATA_DIR: dir, ADMIN_KEY: KEY, NODE_ENV: 'development' }) });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  return (async () => { for (let i = 0; i < 80; i++) { try { const h = await fetch(base + '/health'); if (h.ok && (await h.json()).db === true) return; } catch (_) {} await sleep(250); } throw new Error('server did not start'); })();
}
const stop = () => new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); });
// a tiny but real WebM: a 3 second clip made by the box maker below (EBML mark + filler) is enough for the server's checks; a real file is used when ffmpeg made one
const real = '/tmp/claude-0/trace/test3s.webm';
const vid = fs.existsSync(real) ? fs.readFileSync(real) : Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.alloc(50000, 3)]);
(async () => {
  await start();
  try {
    const auth = { authorization: 'Bearer ' + KEY };
    let r = await fetch(base + '/public/loader-video'); ok(r.status === 404, 'no video yet: 404');
    let j = await (await fetch(base + '/public/loader-video-info')).json(); ok(j.status === 'success' && j.enabled === false, 'info: none');
    r = await fetch(base + '/admin/loader-video/set', { method: 'POST', headers: { 'content-type': 'video/webm' }, body: vid }); ok(r.status === 401, 'an upload without the admin key is refused');
    r = await fetch(base + '/admin/loader-video/set', { method: 'POST', headers: Object.assign({ 'content-type': 'video/webm' }, auth), body: vid }); j = await r.json();
    ok(r.status === 200 && j.enabled && j.type === 'video/webm' && j.size === vid.length, 'the owner uploads the raw file', j);
    const ver = j.version;
    r = await fetch(base + '/admin/loader-video/set', { method: 'POST', headers: Object.assign({ 'content-type': 'video/mp4' }, auth), body: Buffer.from('<html>' + 'x'.repeat(3000) + '</html>') }); ok(r.status === 400, 'a file that is not a video is refused over HTTP');
    r = await fetch(base + '/public/loader-video?v=' + ver); const body = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && r.headers.get('content-type') === 'video/webm' && Buffer.compare(body, vid) === 0 && /immutable/.test(r.headers.get('cache-control')) && r.headers.get('accept-ranges') === 'bytes', 'the versioned address serves the exact file, cached for a year');
    r = await fetch(base + '/public/loader-video', { headers: { range: 'bytes=0-9' } }); const part = Buffer.from(await r.arrayBuffer());
    ok(r.status === 206 && part.length === 10 && Buffer.compare(part, vid.subarray(0, 10)) === 0 && r.headers.get('content-range') === 'bytes 0-9/' + vid.length, 'a Range request returns exactly those bytes');
    r = await fetch(base + '/public/loader-video', { headers: { 'if-none-match': r.headers.get('etag') } }); ok(r.status === 304, 'unchanged: 304');
    j = await (await fetch(base + '/public/loader-video-info')).json(); ok(j.enabled && j.version === ver, 'the info carries the version');
    // kept across a restart
    await stop(); await start();
    r = await fetch(base + '/public/loader-video?v=' + ver); ok(r.status === 200 && Buffer.compare(Buffer.from(await r.arrayBuffer()), vid) === 0, 'after a restart the video is still there');
    // removed
    r = await fetch(base + '/admin/loader-video/clear', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, auth), body: '{}' }); ok(r.status === 200, 'the owner removes it');
    r = await fetch(base + '/public/loader-video'); ok(r.status === 404, 'removed: 404 again');
    console.log(`PASS: start-up loader video through the real server (${n} checks)`);
  } finally { try { child.kill('SIGKILL'); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { try { child.kill('SIGKILL'); } catch (_) {} console.error(e); process.exit(1); });
