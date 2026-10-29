'use strict';
// Failure counters with a sliding window and a temporary lock, kept in memory (the server is ONE process, like its money locks).
// Used to slow down password guessing: after `max` failures inside `windowMs` a key (an IP address, a phone number...) is locked
// for `lockMs`. The table is capped so that a flood of different keys cannot fill the memory.
function createFailGuard({ max, windowMs, lockMs, maxKeys = 50000 }) {
  const table = new Map(); // key -> { times: number[], lockedUntil: number }
  function prune(now) {
    for (const [k, e] of table) {
      e.times = e.times.filter(t => now - t < windowMs);
      if (e.lockedUntil <= now && !e.times.length) table.delete(k);
    }
    // Still too many (a flood of different keys inside the window): forget the oldest entries that are not locked.
    for (const [k, e] of table) { if (table.size <= maxKeys) break; if (e.lockedUntil <= now) table.delete(k); }
  }
  // Milliseconds left on the lock (0 = not locked).
  function locked(key, now = Date.now()) {
    const e = table.get(key);
    return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
  }
  // Record one failure; returns the lock time left if this one tripped the lock.
  function fail(key, now = Date.now()) {
    const e = table.get(key) || { times: [], lockedUntil: 0 };
    e.times = e.times.filter(t => now - t < windowMs);
    e.times.push(now);
    if (e.times.length >= max) { e.lockedUntil = now + lockMs; e.times = []; }
    table.set(key, e);
    if (table.size > maxKeys) prune(now);
    return locked(key, now);
  }
  return { locked, fail, clear: key => table.delete(key), size: () => table.size, prune };
}
module.exports = { createFailGuard };
