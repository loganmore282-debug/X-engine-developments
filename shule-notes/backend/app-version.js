// The newest app build, so students are told when there is one without the owner
// having to remember to type a number. The download page's refresh job
// (deploy/fetch-apk.sh) writes version.json next to the APK it serves.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.DOWNLOAD_DIR || '/var/www/shule-download';
let cached = { at: 0, value: 0 };

function publishedVersion(now = Date.now()) {
  if (now - cached.at < 60 * 1000) return cached.value;
  let value = 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DIR, 'version.json'), 'utf8'));
    const n = Number(parsed.versionCode);
    if (Number.isInteger(n) && n > 0) value = n;
  } catch (_) { /* no download page here: nothing to announce */ }
  cached = { at: now, value };
  return value;
}

function clearVersionCache() { cached = { at: 0, value: 0 }; }

module.exports = { publishedVersion, clearVersionCache };
