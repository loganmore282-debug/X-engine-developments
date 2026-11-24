'use strict';
// Which database this server talks to, decided in ONE place.
//
//   'mongo'  (the default, and what every server did before the move): the MongoDB cluster named by MONGODB_URI.
//   'local'  the database that lives on this VPS (localstore.js): in memory, made durable by a journal on the VPS disk, with nightly backups.
//
// The switch is a small file in the data folder, ENGINE.json, written ONLY by deploy/migrate-to-vps-db.sh after every record has been copied
// and checked. Until that file exists a server keeps using MongoDB, so shipping this code changes nothing by itself, and a new empty folder can
// never be mistaken for the real database. To go back: deploy/back-to-mongo.sh (renames the file). Environment overrides, for tests and new
// installs only:  DB_ENGINE=mongo forces MongoDB even if the file exists;  <APP>_DB_FRESH=1 with DB_ENGINE=local starts a brand-new empty local database.
const fs = require('fs'), path = require('path');
function resolve(app) {
  const key = String(app).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const dir = process.env[key + '_DATA_DIR'] || '/srv/' + app + '-data';
  const backupDir = process.env[key + '_BACKUP_DIR'] || '/srv/' + app + '-backups';
  const marker = path.join(dir, 'ENGINE.json');
  const out = { engine: 'mongo', dir, backupDir, marker, reason: 'no ENGINE.json yet: still on MongoDB' };
  if (process.env.DB_ENGINE === 'mongo') { out.reason = 'DB_ENGINE=mongo'; return out; }
  let info = null;
  try { info = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch (_) {}
  if (info && info.engine === 'local') { out.engine = 'local'; out.info = info; out.reason = 'ENGINE.json says local (migrated ' + (info.migratedAt || '?') + ')'; return out; }
  if (process.env.DB_ENGINE === 'local' && process.env[key + '_DB_FRESH'] === '1') { out.engine = 'local'; out.fresh = true; out.reason = key + '_DB_FRESH=1: a brand-new local database'; return out; }
  return out;
}
function writeMarker(app, info) {
  const e = resolve(app); fs.mkdirSync(e.dir, { recursive: true });
  const tmp = e.marker + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(Object.assign({ engine: 'local' }, info), null, 2) + '\n', { mode: 0o600 });
  const fd = fs.openSync(tmp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, e.marker); return e.marker;
}
function disableMarker(app) { const e = resolve(app); if (!fs.existsSync(e.marker)) return null; const to = e.marker + '.disabled-' + new Date().toISOString().replace(/[:.]/g, '-'); fs.renameSync(e.marker, to); return to; }
module.exports = { resolve, writeMarker, disableMarker };
