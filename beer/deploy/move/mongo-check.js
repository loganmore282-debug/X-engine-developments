#!/usr/bin/env node
'use strict';
// node mongo-check.js <secrets file> <app folder>  -> does this server reach the app's MongoDB (Atlas must allow this server's address)? Never prints the connection string.
// exit 0 = connected, 1 = could not connect, 3 = could not test (no MONGODB_URI / driver)
const [file, dir] = process.argv.slice(2);
let s = {}; try { s = require(file); } catch (e) { console.log('secrets file cannot be read'); process.exit(3); }
const uri = String(s.MONGODB_URI || ''); if (!uri) { console.log('no MONGODB_URI in it'); process.exit(3); }
let MC; try { MC = require(require.resolve('mongodb', { paths: [dir || '.'] })).MongoClient; } catch (e) { console.log('mongodb driver not found in ' + dir); process.exit(3); }
const c = new MC(uri, { serverSelectionTimeoutMS: 20000 });
c.connect().then(() => c.db().command({ ping: 1 })).then(() => { console.log('connected'); process.exit(0); })
  .catch(e => { console.log('could not connect: ' + String(e && e.message || e).split('\n')[0].replace(/\/\/[^@\s]*@/g, '//***@')); process.exit(1); });
