// Creates the two MongoDB users, or checks that the app user can log in.
//   node create-users.js create <port> <rootPass> <appPass>
//   node create-users.js check  <uri>
// Uses the same `mongodb` driver the app uses, so no mongosh is needed.
const { MongoClient } = require('mongodb');
const [mode, a, b, c] = process.argv.slice(2);
const DB = 'shulenotesdb';

(async () => {
  if (mode === 'create') {
    const client = new MongoClient(`mongodb://127.0.0.1:${a}/?directConnection=true`);
    await client.connect();
    await client.db('admin').command({ createUser: 'shule_root', pwd: b, roles: [{ role: 'root', db: 'admin' }] });
    await client.db(DB).command({ createUser: 'shule_app', pwd: c, roles: [{ role: 'readWrite', db: DB }] });
    await client.close();
    console.log('users created');
  } else if (mode === 'check') {
    const client = new MongoClient(a, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    await client.db().collection('login_check').insertOne({ at: new Date() });
    await client.db().collection('login_check').drop();
    await client.close();
    console.log('login ok');
  } else {
    throw new Error('usage: create-users.js create <port> <rootPass> <appPass> | check <uri>');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
