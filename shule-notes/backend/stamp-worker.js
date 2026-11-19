// Runs inside a worker thread (see stampInThread in stamp.js).
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { stampPdf } = require('./stamp');

stampPdf(Buffer.from(workerData.buffer), workerData.lines).then(
  (buffer) => parentPort.postMessage({ ok: true, buffer }),
  (error) => parentPort.postMessage({ ok: false, error: error.message }),
);
