// Slows down someone guessing a student's password. The per-address limit on the sign-in route stops one
// computer; this one counts wrong passwords PER PHONE NUMBER across all addresses, so guessing from many
// places is stopped too. After 10 wrong passwords in 15 minutes that number cannot sign in until the
// 15 minutes are over (a right password never gets through during the lock, so guessing cannot win).
'use strict';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_TRACKED = 20000; // keeps memory bounded if someone sprays many numbers

const failures = new Map(); // phone -> { count, since }

function prune(now) {
  for (const [phone, f] of failures) if (now - f.since >= WINDOW_MS) failures.delete(phone);
  // Still too many (an attack): forget the oldest, never grow without limit.
  if (failures.size > MAX_TRACKED) {
    const oldest = [...failures.entries()].sort((a, b) => a[1].since - b[1].since).slice(0, failures.size - MAX_TRACKED);
    for (const [phone] of oldest) failures.delete(phone);
  }
}

function isLocked(phone, now = Date.now()) {
  const f = failures.get(phone);
  if (!f) return false;
  if (now - f.since >= WINDOW_MS) { failures.delete(phone); return false; }
  return f.count >= MAX_FAILURES;
}

function recordFailure(phone, now = Date.now()) {
  const f = failures.get(phone);
  if (!f || now - f.since >= WINDOW_MS) failures.set(phone, { count: 1, since: now });
  else f.count += 1;
  if (failures.size > MAX_TRACKED) prune(now);
}

function clear(phone) { failures.delete(phone); }

// Seconds until a locked number can try again (for the message).
function minutesLeft(phone, now = Date.now()) {
  const f = failures.get(phone);
  return f ? Math.max(1, Math.ceil((WINDOW_MS - (now - f.since)) / 60000)) : 0;
}

module.exports = { isLocked, recordFailure, clear, minutesLeft, WINDOW_MS, MAX_FAILURES, _failures: failures };
