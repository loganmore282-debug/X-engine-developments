#!/usr/bin/env node
'use strict';
// Reads `pm2 jlist` from stdin and prints one line per app:  name|status|port|restarts|pid     (pm2's own modules, such as the log rotator, are left out)
let s = ''; process.stdin.on('data', d => s += d).on('end', () => {
  let a = null;   // pm2 may print "[PM2] ..." notices before the JSON: take the first line that really is the JSON list
  for (const line of s.split('\n')) { if (line[0] !== '[') continue; try { const j = JSON.parse(line); if (Array.isArray(j)) { a = j; break; } } catch (e) {} }
  if (!a) { try { a = JSON.parse(s); } catch (e) { process.exit(0); } }
  for (const p of a) { const e = p.pm2_env || {}, v = e.env || {}; if (e.pmx_module) continue;
    console.log([p.name, e.status, e.PORT || v.PORT || '', e.restart_time || 0, p.pid || 0].join('|')); }
});
