// The text of each page of a note, for searching inside a document in the app.
// New uploads store it when their text is read; notes uploaded before this feature
// have none, so it is produced the first time someone asks, then kept.
'use strict';
const fs = require('fs');
const path = require('path');

const inFlight = new Map(); // note id -> the extraction already running, so two students asking at once read the file once

async function pageTextsFor({ db, note, uploadDir, extract }) {
  if (Array.isArray(note.pageTexts)) return note.pageTexts;
  const key = String(note._id);
  if (!inFlight.has(key)) {
    inFlight.set(key, (async () => {
      const file = path.join(uploadDir, 'notes', note.fileName);
      const buffer = await fs.promises.readFile(file);
      const { pages } = await extract(buffer);
      await db.collection('notes').updateOne({ _id: note._id }, { $set: { pageTexts: pages } });
      return pages;
    })().finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

module.exports = { pageTextsFor };
