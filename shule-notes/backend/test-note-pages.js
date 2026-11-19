#!/usr/bin/env node
// The per-page text behind in-document search: produced once, kept, and shared by simultaneous askers.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDb, ObjectId } = require('./fake-mongo.testlib');
const { extractPdfText } = require('./pdf');
const { makePdf } = require('./pdf.testlib');
const { pageTextsFor } = require('./note-pages');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  fs.mkdirSync(path.join(dir, 'notes'));
  fs.writeFileSync(path.join(dir, 'notes', 'a.pdf'), makePdf(['Cells and tissues', 'Photosynthesis in leaves', 'Respiration']));
  const db = makeDb();
  const inserted = await db.collection('notes').insertOne({ title: 'Biology', fileName: 'a.pdf' });
  const note = { _id: inserted.insertedId, title: 'Biology', fileName: 'a.pdf' };

  let reads = 0;
  const extract = async (buffer) => { reads++; return extractPdfText(buffer); };

  console.log('— a note uploaded before page text was kept —');
  const [first, second] = await Promise.all([
    pageTextsFor({ db, note, uploadDir: dir, extract }),
    pageTextsFor({ db, note, uploadDir: dir, extract }),
  ]);
  ck(first.length === 3 && first[1].includes('Photosynthesis'), 'the pages are read from the file on first request');
  ck(reads === 1 && second === first || (reads === 1 && second.length === 3), 'two students asking at the same moment cause ONE read, not two');
  const stored = await db.collection('notes').findOne({ _id: note._id });
  ck(Array.isArray(stored.pageTexts) && stored.pageTexts.length === 3, 'the result is saved on the note');

  console.log('\n— afterwards —');
  const again = await pageTextsFor({ db, note: stored, uploadDir: dir, extract });
  ck(reads === 1 && again.length === 3, 'a later request is answered from what was saved, without reading the file again');

  console.log('\n— a missing file —');
  let failed = false;
  try { await pageTextsFor({ db, note: { _id: new ObjectId(), fileName: 'gone.pdf' }, uploadDir: dir, extract }); } catch (e) { failed = true; }
  ck(failed, 'a file that is gone rejects (the route turns that into an empty list, not a crash)');

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall note-pages checks pass');
  process.exit(bad ? 1 : 0);
})();
