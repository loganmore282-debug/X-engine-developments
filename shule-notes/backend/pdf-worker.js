// Runs inside a worker thread (see extractInThread in pdf.js): reads the text of
// one PDF so the thread that answers requests is never busy doing it.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { extractPdfText } = require('./pdf');

extractPdfText(Buffer.from(workerData)).then(
  (result) => parentPort.postMessage({ ok: true, ...result }),
  (error) => parentPort.postMessage({ ok: false, error: error.message }),
);
