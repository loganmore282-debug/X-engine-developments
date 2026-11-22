// Speed. Most of what students ask for is the SAME for everyone (the library, the subjects, the settings), so it is
// built once, kept in memory, and sent with an ETag: a phone that already has the current copy gets a 304 with no body
// and the database is not touched. The copy is rebuilt the moment the owner changes anything (revision.js) and at
// least every minute (so the "most read" order stays fresh).
'use strict';
const crypto = require('crypto');
const revision = require('./revision');

const store = new Map();
const inflight = new Map();
const MAX_KEYS = 200;

async function shared(key, ttlMs, build) {
  const rev = revision.current();
  const hit = store.get(key);
  if (hit && hit.rev === rev && Date.now() - hit.at < ttlMs) return hit;
  // Many students asking at the same instant share ONE database read.
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const body = JSON.stringify(await build());
    const entry = { rev, at: Date.now(), body, etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"' };
    if (store.size >= MAX_KEYS) store.delete(store.keys().next().value);
    store.set(key, entry);
    return entry;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Sends a built answer: 304 if the caller already has it, otherwise the JSON.
function sendShared(req, res, entry, cacheControl = 'private, no-cache') {
  res.set('ETag', entry.etag);
  res.set('Cache-Control', cacheControl);
  if (req.headers['if-none-match'] === entry.etag) return res.status(304).end();
  res.type('application/json').send(entry.body);
}

function clear() { store.clear(); inflight.clear(); }

// Anything slower than this is written to the log, so a slow route shows itself.
function slowLog(limitMs = 1500) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (ms > limitMs) console.warn(`slow request: ${req.method} ${req.path} took ${Math.round(ms)} ms (status ${res.statusCode})`);
    });
    next();
  };
}

module.exports = { shared, sendShared, clear, slowLog };
