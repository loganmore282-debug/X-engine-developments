// A number that changes whenever the owner changes something in the admin panel (a note, a subject,
// an announcement, a setting). Phones ask for it every few seconds while the app is open, and reload
// their library the moment it differs, so an upload shows up on students' screens almost at once.
// It lives in memory: after a restart it is simply a new number, which costs each phone one reload.
'use strict';

let value = Date.now();

const current = () => value;
function bump() {
  value = Math.max(value + 1, Date.now()); // always different from the last one, even within a millisecond
  return value;
}

// Admin requests that only READ must not move it.
const READ_ONLY = /\/(list|get|stats|check-key)$/;
function adminChangeTracker(req, res, next) {
  res.on('finish', () => {
    if (req.method === 'POST' && res.statusCode < 400 && !READ_ONLY.test(req.path)) bump();
  });
  next();
}

module.exports = { current, bump, adminChangeTracker };
