// Live updates: one open connection per screen (Server-Sent Events), so things happen the moment they happen instead of
// on the next reload or poll.
//   Students (GET /live):        "revision" (the owner changed notes/subjects/announcements/settings), "signed_out" (this
//                                 device was replaced by a sign-in elsewhere), "notice" (a new sign-in alert), "access" (a pass
//                                 was added or removed), "payment" (one of their payments changed).
//   Admin panel (GET /admin/live): "signup", "payment", "feedback", "signin" -- shown at once in the panel.
// Single process on purpose (see CLAUDE.md), so the list of open connections lives in memory.
'use strict';

const HEARTBEAT_MS = 25000; // below nginx's 60 s read timeout, and keeps phone networks from dropping an idle line
const MAX_PER_KEY = 8;      // one student with many tabs open: the oldest is closed first

const channels = new Map(); // key -> Set<client>

// How many students have the app or website open right now; the admin panel shows it live.
let presenceTimer = null;
function onlineStudents() { let n = 0; for (const k of channels.keys()) if (k.startsWith('user:')) n += 1; return n; }
function presenceChanged(key) {
  if (!key.startsWith('user:') || presenceTimer) return;
  presenceTimer = setTimeout(() => { presenceTimer = null; publish('admin', 'presence', { online: onlineStudents() }); }, 800);
  if (presenceTimer.unref) presenceTimer.unref();
}

function add(key, client) {
  let set = channels.get(key);
  if (!set) { set = new Set(); channels.set(key, set); }
  if (set.size >= MAX_PER_KEY) { const oldest = set.values().next().value; oldest.close(); }
  set.add(client);
  presenceChanged(key);
}
function remove(key, client) {
  const set = channels.get(key);
  if (!set) return;
  set.delete(client);
  if (!set.size) { channels.delete(key); presenceChanged(key); }
}

// Opens the stream on `res` and registers it under every key in `keys`.
function subscribe(req, res, keys, hello = {}) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tells nginx to pass each event on at once instead of buffering
  });
  res.flushHeaders();
  if (req.socket) { req.socket.setTimeout(0); req.socket.setNoDelay(true); req.socket.setKeepAlive(true); }
  let open = true;
  const client = {
    send(event, data) {
      if (!open) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    },
    close() { if (open) { open = false; cleanup(); res.end(); } },
  };
  const beat = setInterval(() => { if (open) res.write(': ping\n\n'); }, HEARTBEAT_MS);
  const cleanup = () => { clearInterval(beat); for (const k of keys) remove(k, client); };
  req.on('close', () => { if (open) { open = false; cleanup(); } });
  for (const k of keys) add(k, client);
  // retry: how long the browser waits before reconnecting by itself
  res.write('retry: 2000\n\n');
  client.send('hello', hello);
  return client;
}

function publish(key, event, data) {
  const set = channels.get(key);
  if (!set) return 0;
  for (const c of [...set]) c.send(event, data);
  return set.size;
}
// Every student screen (an owner change).
function broadcastStudents(event, data) {
  let n = 0;
  for (const [key, set] of channels) if (key.startsWith('user:')) for (const c of set) { c.send(event, data); n += 1; }
  return n;
}
// Sends then closes (a device that was signed out has nothing more to hear).
function publishAndClose(key, event, data) {
  const set = channels.get(key);
  if (!set) return 0;
  for (const c of [...set]) { c.send(event, data); c.close(); }
  return 1;
}

function closeAll() { for (const set of [...channels.values()]) for (const c of [...set]) c.close(); }

const stats = () => ({ keys: channels.size, connections: [...channels.values()].reduce((a, s) => a + s.size, 0) });

module.exports = { subscribe, publish, broadcastStudents, publishAndClose, closeAll, stats, onlineStudents, HEARTBEAT_MS };
