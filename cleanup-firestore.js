/**
 * X-Engine Firestore Cleanup Script
 * Deletes all test data before going to production.
 *
 * KEEPS:  admins, settings, products, ads
 * DELETES: users, deposits, pendingPayments, withdrawals, transactions,
 *          notifications, investments, bankAccounts, adminRequests, referrals,
 *          broadcasts
 *
 * HOW TO RUN:
 *   1. npm install firebase-admin   (one-time)
 *   2. Set env var:  export FIREBASE_SERVICE_ACCOUNT='{ ...your service account JSON... }'
 *      OR place your serviceAccount.json file in this folder and pass it:
 *      node cleanup-firestore.js ./serviceAccount.json
 *   3. node cleanup-firestore.js
 */

const admin = require('firebase-admin');

// ── Load credentials ──────────────────────────────────────────────────────────
let serviceAccount;
const jsonFile = process.argv[2];
if (jsonFile) {
  serviceAccount = require(require('path').resolve(jsonFile));
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  console.error('❌  Provide credentials:\n   node cleanup-firestore.js ./serviceAccount.json\n   OR set FIREBASE_SERVICE_ACCOUNT env var');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Collections to wipe completely ────────────────────────────────────────────
const WIPE = [
  'users',
  'deposits',
  'pendingPayments',
  'withdrawals',
  'transactions',
  'notifications',
  'investments',
  'bankAccounts',
  'adminRequests',
  'referrals',
  'broadcasts',
];

// ── Collections to keep ───────────────────────────────────────────────────────
const KEEP = ['admins', 'settings', 'products', 'ads'];

async function deleteCollection(collectionName) {
  const ref = db.collection(collectionName);
  let total = 0;
  while (true) {
    const snap = await ref.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    process.stdout.write(`\r  🗑  ${collectionName}: ${total} deleted...`);
  }
  console.log(`\r  ✅  ${collectionName}: ${total} document(s) deleted         `);
}

async function main() {
  console.log('\n🚀  X-Engine Firestore Cleanup');
  console.log('━'.repeat(45));
  console.log(`🔒  KEEPING: ${KEEP.join(', ')}`);
  console.log(`🗑   WIPING:  ${WIPE.join(', ')}`);
  console.log('━'.repeat(45));

  // Safety prompt
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('\n⚠️   Type  YES  to confirm permanent deletion: ', answer => {
      rl.close();
      if (answer.trim() !== 'YES') {
        console.log('❌  Aborted.');
        process.exit(0);
      }
      resolve();
    });
  });

  console.log('\nDeleting...\n');
  for (const col of WIPE) {
    await deleteCollection(col);
  }

  console.log('\n━'.repeat(45));
  console.log('✅  All test data cleared. Firestore is clean for production.');
  console.log(`🔒  Preserved: ${KEEP.join(', ')}`);
  console.log('\nNext steps:');
  console.log('  1. Open admin panel → Settings → save your fee/bonus/referral rates');
  console.log('  2. Add your investment products under Products');
  console.log('  3. You are live! 🚀\n');
  process.exit(0);
}

main().catch(e => { console.error('❌  Error:', e.message); process.exit(1); });
