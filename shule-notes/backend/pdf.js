// Extracted ONCE, at upload time, and cached on the note document -- not
// re-parsed on every "Ask AI" question. A scanned/image-only PDF yields
// little or no text; that's surfaced to the admin at upload time rather than
// failing silently and leaving the AI feature quietly useless for that note.
'use strict';

// pdf.js itself, not the pdf-parse wrapper: pdf-parse bundles a 2018 build
// of pdf.js that randomly failed ("bad XRef entry") on valid PDFs.
// It ships as an ES module only, hence the dynamic import.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function extractPdfText(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, verbosity: 0,
  }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : '');
      pages.push(text);
    }
    // `pages` keeps the text of each page separately, so the app can search inside a document
    // and jump to the page a match is on. (Each page is capped so one odd file cannot bloat the database.)
    return { text: pages.join('\n\n').trim(), pageCount: doc.numPages, pages: pages.map((t) => t.trim().slice(0, 20000)) };
  } finally {
    await doc.destroy();
  }
}

// The same, on a worker thread. Reading a big PDF takes seconds of CPU; done on the
// main thread it would stop every other request for that long. Rejects after
// `timeoutMs` (default 2 minutes) so a damaged file cannot hang a thread forever.
function extractInThread(buffer, timeoutMs = 120000) {
  const { Worker } = require('worker_threads');
  const path = require('path');
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'pdf-worker.js'), {
      workerData: buffer,
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('reading the PDF took too long')); }, timeoutMs);
    worker.once('message', (m) => { clearTimeout(timer); worker.terminate(); m.ok ? resolve({ text: m.text, pageCount: m.pageCount, pages: m.pages }) : reject(new Error(m.error)); });
    worker.once('error', (e) => { clearTimeout(timer); reject(e); });
    worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error('the PDF reader stopped (code ' + code + ')')); });
  });
}

module.exports = { extractPdfText, extractInThread };
