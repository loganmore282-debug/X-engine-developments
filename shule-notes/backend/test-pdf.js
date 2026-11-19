#!/usr/bin/env node
/**
 * Runs the real extractPdfText() on a real (generated) PDF, repeatedly: the
 * previous extractor failed at random on valid files, which left notes
 * permanently without an AI context. Also pins that an unreadable upload
 * REJECTS, since server.js's upload handler relies on that to tell the admin
 * "no text could be read" instead of claiming success.
 */
'use strict';
const { extractPdfText, extractInThread } = require('./pdf');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

const { makePdf } = require('./pdf.testlib');

(async () => {
  console.log('— a real PDF, read repeatedly —');
  {
    const pdf = makePdf(['Chapter 1: Cells', 'Chapter 2: Tissues']);
    let allSame = true;
    let first = null;
    for (let i = 0; i < 12; i++) {
      const r = await extractPdfText(pdf);
      if (!first) first = r;
      if (r.text !== first.text || r.pageCount !== first.pageCount) allSame = false;
    }
    ck(first.pageCount === 2, 'the page count is read from the document');
    ck(Array.isArray(first.pages) && first.pages.length === 2 && first.pages[0].includes('Cells') && first.pages[1].includes('Tissues') && !first.pages[0].includes('Tissues'), 'the text of each page is kept separately, in page order');
    ck(first.text.includes('Chapter 1: Cells') && first.text.includes('Chapter 2: Tissues'), 'text from every page is extracted');
    ck(first.text === first.text.trim(), 'the extracted text is trimmed of surrounding whitespace');
    ck(allSame, 'twelve reads of the same file give the same result every time');
  }

  console.log('\n— the same, on a worker thread (so uploads never freeze the server) —');
  {
    const pdf = makePdf(['Photosynthesis notes', 'Respiration notes']);
    const direct = await extractPdfText(pdf);
    const threaded = await extractInThread(pdf);
    ck(threaded.text === direct.text && threaded.pageCount === 2, 'the worker thread reads exactly what the direct reader reads');
    // While a big read is running, the main thread must stay free to answer requests.
    let worstGap = 0, last = Date.now();
    const timer = setInterval(() => { const now = Date.now(); worstGap = Math.max(worstGap, now - last); last = now; }, 5);
    const many = makePdf(Array.from({ length: 60 }, (_, i) => 'Page ' + i + ' ' + 'lorem ipsum '.repeat(40)));
    await Promise.all([extractInThread(many), extractInThread(many), extractInThread(many)]);
    clearInterval(timer);
    ck(worstGap < 150, `the main thread stayed responsive during heavy reading (longest pause ${worstGap} ms)`);
    let rejected = false;
    try { await extractInThread(Buffer.from('not a pdf')); } catch (e) { rejected = true; }
    ck(rejected, 'an unreadable file rejects on the worker thread too');
    let timedOut = false;
    try { await extractInThread(many, 1); } catch (e) { timedOut = /too long/.test(e.message); }
    ck(timedOut, 'a read that takes too long is stopped, not left hanging');
  }

  console.log('\n— a genuinely unreadable file is rejected, not silently emptied —');
  {
    let threw = false;
    try { await extractPdfText(Buffer.from('this is not a pdf at all, just text')); }
    catch (e) { threw = true; }
    ck(threw, 'a non-PDF buffer throws, which the upload route catches and reports as "no text could be read"');
  }

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall pdf.js checks pass');
  process.exit(bad ? 1 : 0);
})();
