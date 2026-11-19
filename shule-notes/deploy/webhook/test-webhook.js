// Runs the real hook server and checks who it lets in. Run: node test-webhook.js
'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SECRET = 'test-secret-0123456789-abcdefghij';
const BRANCH = 'claude/space8-rename-frontend-rebuild-juurd7';
const PORT = 4300 + Math.floor(Math.random() * 500);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));
const log = path.join(dir, 'runs.log');
const cmd = path.join(dir, 'fake-deploy.sh');
// A fake deploy that records each run and takes a moment, so overlapping pushes can be seen.
fs.writeFileSync(cmd, `#!/bin/sh\necho start >> ${log}\nsleep 1\necho end >> ${log}\n`, { mode: 0o755 });

let bad = 0;
const ck = (ok, name) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name); if (!ok) bad++; };
const sign = (body) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const runs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l === 'start').length : 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function post(body, headers = {}, rawBody) {
  return new Promise((resolve) => {
    const data = rawBody !== undefined ? rawBody : Buffer.from(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/github', method: 'POST', headers: { 'Content-Length': data.length, ...headers } }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    req.on('error', () => resolve({ status: 0, text: 'connection closed' }));
    req.end(data);
  });
}
const push = (ref, extra = {}) => { const b = JSON.stringify({ ref, ...extra }); return post(b, { 'x-github-event': 'push', 'x-hub-signature-256': sign(b) }); };

const server = spawn('node', [path.join(__dirname, 'server.js')], {
  env: { ...process.env, WEBHOOK_SECRET: SECRET, BRANCH, DEPLOY_CMD: cmd, HOOK_PORT: String(PORT) }, stdio: 'ignore',
});

(async () => {
  await wait(800);
  let r = await post('{}', { 'x-github-event': 'push' });
  ck(r.status === 401, 'no signature: refused');
  const b = JSON.stringify({ ref: 'refs/heads/' + BRANCH });
  r = await post(b, { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=' + 'ab'.repeat(32) });
  ck(r.status === 401, 'wrong signature: refused');
  r = await post(b, { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=zz' });
  ck(r.status === 401, 'garbage signature: refused');
  r = await post(b, { 'x-github-event': 'push', 'x-hub-signature-256': sign(b + ' ') });
  ck(r.status === 401, 'signature for a different body: refused');
  await wait(300);
  ck(runs() === 0, 'nothing was deployed by any of those');

  const ping = JSON.stringify({ zen: 'hi' });
  r = await post(ping, { 'x-github-event': 'ping', 'x-hub-signature-256': sign(ping) });
  ck(r.status === 200 && /pong/.test(r.text), 'GitHub\'s ping is answered');

  r = await push('refs/heads/some-other-branch');
  ck(r.status === 200 && /ignored/.test(r.text), 'a push to another branch is ignored');
  r = await push('refs/heads/' + BRANCH, { deleted: true });
  ck(r.status === 200 && /ignored/.test(r.text), 'deleting the branch is ignored');
  const iss = JSON.stringify({ action: 'opened' });
  r = await post(iss, { 'x-github-event': 'issues', 'x-hub-signature-256': sign(iss) });
  ck(r.status === 200 && /ignored/.test(r.text), 'other event types are ignored');
  await wait(300);
  ck(runs() === 0, 'still nothing deployed');

  r = await push('refs/heads/' + BRANCH);
  ck(r.status === 202, 'a signed push to the right branch is accepted');
  await wait(400);
  ck(runs() === 1, 'and starts exactly one deploy');
  await push('refs/heads/' + BRANCH); await push('refs/heads/' + BRANCH); await push('refs/heads/' + BRANCH);
  await wait(3500);
  ck(runs() === 2, 'three pushes during a deploy are merged into ONE more run, not three');

  r = await post('x', {}, Buffer.alloc(2 * 1024 * 1024, 'a'));
  ck(r.status === 413 || r.status === 0, 'an oversized body is cut off');
  r = await new Promise((res) => http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (x) => { let t = ''; x.on('data', (c) => (t += c)); x.on('end', () => res({ status: x.statusCode, text: t })); }));
  ck(r.status === 200 && /running/.test(r.text), 'opening the address in a browser says the hook is running');

  const noSecret = spawn('node', [path.join(__dirname, 'server.js')], { env: { ...process.env, WEBHOOK_SECRET: 'short', BRANCH, DEPLOY_CMD: cmd }, stdio: 'ignore' });
  const code = await new Promise((res) => noSecret.on('exit', res));
  ck(code === 1, 'it refuses to start with a weak or missing secret');

  server.kill();
  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall webhook checks pass');
  process.exit(bad ? 1 : 0);
})();
