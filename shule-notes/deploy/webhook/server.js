// Receives GitHub's "push" webhook and starts a deploy. No dependencies.
//
// - Listens on 127.0.0.1 only; nginx exposes it at /_hooks/github.
// - Every request must carry a valid X-Hub-Signature-256 (HMAC-SHA256 of the
//   raw body with the shared secret), or it is refused with 401.
// - Only a push to the configured branch starts a deploy; everything else is ignored.
// - Never passes anything from the request to a command: the command is fixed.
// - One deploy at a time; pushes that arrive meanwhile are merged into ONE more run.
'use strict';
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.HOOK_PORT || 4100);
const SECRET = process.env.WEBHOOK_SECRET || '';
const BRANCH = process.env.BRANCH || '';
const CMD = process.env.DEPLOY_CMD || '';
const MAX_BODY = 1024 * 1024;

if (SECRET.length < 20 || !BRANCH || !CMD) {
  console.error('WEBHOOK_SECRET (20+ characters), BRANCH and DEPLOY_CMD must be set.');
  process.exit(1);
}

let running = false;
let pending = false;
function runDeploy() {
  if (running) { pending = true; return; }
  running = true;
  const child = spawn(CMD, [], { stdio: 'inherit' });
  const done = (note) => {
    console.log('deploy finished:', note);
    running = false;
    if (pending) { pending = false; runDeploy(); }
  };
  child.on('error', (e) => done('could not start: ' + e.message));
  child.on('exit', (code) => done('exit code ' + code));
}

function validSignature(raw, header) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(raw).digest();
  let given;
  try { given = Buffer.from(header.slice(7), 'hex'); } catch (_) { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const server = http.createServer((req, res) => {
  const reply = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(text + '\n'); };
  if (req.method === 'GET') return reply(200, 'Shule Notes deploy hook is running');
  if (req.method !== 'POST' || req.url !== '/github') return reply(404, 'not found');

  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { tooBig = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', () => {});
  req.on('close', () => { if (tooBig && !res.writableEnded) { res.statusCode = 413; res.end(); } });
  req.on('end', () => {
    if (tooBig) return;
    const raw = Buffer.concat(chunks);
    if (!validSignature(raw, req.headers['x-hub-signature-256'])) return reply(401, 'bad signature');
    const event = req.headers['x-github-event'];
    if (event === 'ping') return reply(200, 'pong');
    if (event !== 'push') return reply(200, 'ignored: ' + event);
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (_) { return reply(400, 'bad json'); }
    if (payload.deleted || payload.ref !== 'refs/heads/' + BRANCH) return reply(200, 'ignored: not ' + BRANCH);
    console.log('push to', BRANCH, 'received; starting deploy');
    runDeploy();
    reply(202, 'deploy started');
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`deploy hook on 127.0.0.1:${PORT}, branch ${BRANCH}`));
