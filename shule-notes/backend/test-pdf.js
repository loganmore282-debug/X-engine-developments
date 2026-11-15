#!/usr/bin/env node
/**
 * extractPdfText() is a thin, trust-boundary wrapper around pdf-parse, so
 * this pins the two things that actually matter here: the real shape it
 * hands back to the upload route, and that a genuinely corrupt upload
 * REJECTS rather than silently returning garbage -- server.js's own upload
 * handler depends on that rejection to tell the admin "no text could be
 * read" instead of claiming success with an empty AI context.
 */
'use strict';

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

(async () => {
  console.log('— the real shape handed to the upload route —');
  {
    // Stub pdf-parse itself (not the PDF format) so this pins OUR wiring --
    // what field names we read off its result -- without depending on
    // hand-crafting a byte-perfect PDF, which is a format detail pdf-parse's
    // own test suite already covers.
    const pp = require.resolve('pdf-parse');
    require.cache[pp] = {
      id: pp, filename: pp, loaded: true,
      exports: async () => ({ text: '  Chapter 1: Cells  \n\n', numpages: 3 }),
    };
    delete require.cache[require.resolve('./pdf')];
    const { extractPdfText } = require('./pdf');
    const result = await extractPdfText(Buffer.from('fake-pdf-bytes'));
    ck(result.text === 'Chapter 1: Cells', 'the extracted text is trimmed of surrounding whitespace');
    ck(result.pageCount === 3, 'the page count is carried through');
  }

  console.log('\n— a genuinely unreadable file is rejected, not silently emptied —');
  {
    delete require.cache[require.resolve('pdf-parse')];
    delete require.cache[require.resolve('./pdf')];
    const { extractPdfText } = require('./pdf');
    let threw = false;
    try { await extractPdfText(Buffer.from('this is not a pdf at all, just text')); }
    catch (e) { threw = true; }
    ck(threw, 'a non-PDF buffer throws, which the upload route catches and reports as "no text could be read"');
  }

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall pdf.js checks pass');
  process.exit(bad ? 1 : 0);
})();
