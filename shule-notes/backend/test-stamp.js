#!/usr/bin/env node
// The footer on every PDF page: it must be there on every page, at the bottom of the page AS DISPLAYED (also on
// pages stored sideways or upside down), must not disturb the original text, and must never break a download.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDb, stubDb } = require('./fake-mongo.testlib');
stubDb(makeDb());
const stamp = require('./stamp');
const settings = require('./settings');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

// A test PDF whose pages are sideways, upside down and cropped, like real scans.
async function samplePdf() {
  const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const make = (label, rotation, size, crop) => {
    const page = doc.addPage(size);
    page.drawText(label, { x: 60, y: size[1] - 80, size: 18, font });
    if (rotation) page.setRotation(degrees(rotation));
    if (crop) page.setCropBox(...crop);
  };
  make('Page one upright', 0, [595, 842]);
  make('Page two turned 90', 90, [595, 842]);
  make('Page three upside down', 180, [595, 842]);
  make('Page four turned 270', 270, [842, 595]);
  make('Page five cropped', 0, [700, 900], [40, 60, 500, 700]);
  make('Page six landscape', 0, [842, 595]);
  return Buffer.from(await doc.save());
}

// Reads back what a viewer would show: each page's text with its position on the DISPLAYED page.
async function pagesAsDisplayed(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.filter((t) => t.str.trim()).map((t) => {
      const [a, b, c, d, e, f] = pdfjs.Util.transform(vp.transform, t.transform);
      return { str: t.str, x: e, y: f, vertical: Math.abs(b) > Math.abs(a) };
    });
    out.push({ width: vp.width, height: vp.height, items });
  }
  return out;
}

// Where the logo picture lands on the DISPLAYED page: its four corners, read from the page's drawing commands.
async function logoPlacementOf(buffer, pageNo) { return logoPlacement(buffer, pageNo); }
async function logoPlacement(buffer, pageNo) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === pdfjs.OPS.transform) ctm = pdfjs.Util.transform(ctm, ops.argsArray[i]);
    else if (fn === pdfjs.OPS.paintImageXObject) {
      const m = pdfjs.Util.transform(vp.transform, ctm);
      return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => ({ x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] }));
    }
  }
  return null;
}

(async () => {
  console.log('— the footer\'s words —');
  const full = { supportPhone: '0700 123 456', supportWhatsapp: '+256 700 123 456', supportEmail: 'help@shule.ug', websiteUrl: 'https://shule.example.ug' };
  const lines = stamp.footerLines(full, 'https://api.example/download/');
  ck(lines[0] === 'Downloaded from Shule Notes  |  https://shule.example.ug', 'the first line says where it came from, with the owner\'s website');
  ck(lines[1] === 'Contact us: 0700 123 456  |  WhatsApp +256 700 123 456  |  help@shule.ug', 'the second line lists the contacts');
  ck(stamp.footerLines({}, 'https://api.example/download/').join('~') === 'Downloaded from Shule Notes  |  https://api.example/download/', 'with no website and no contacts: the download page, and no contact line');
  ck(stamp.plain('Café — “x” 😀').indexOf('😀') < 0 && !/[^\x20-\x7e -ÿ]/.test(stamp.plain('Café — “x” 😀')), 'characters a standard PDF font cannot draw become "?", never an error');

  console.log('\n— stamping —');
  const original = await samplePdf();
  const stamped = await stamp.stampPdf(original, lines);
  const before = await pagesAsDisplayed(original);
  const after = await pagesAsDisplayed(stamped);
  ck(after.length === before.length && after.length === 6, 'the page count is unchanged');
  for (let i = 0; i < after.length; i++) {
    const p = after[i];
    const text = p.items.map((t) => t.str).join(' ');
    ck(text.includes('Downloaded from Shule Notes') && text.includes('Contact us: 0700 123 456'), `page ${i + 1}: both lines are there`);
    const footer = p.items.filter((t) => /Downloaded|Contact us/.test(t.str));
    ck(footer.length === 2 && footer.every((t) => t.y > p.height - 40 && t.y < p.height - 4), `page ${i + 1}: the lines sit along the bottom of the page as displayed`);
    ck(footer.every((t) => t.x > 0 && t.x < p.width - 40) && footer.every((t) => !t.vertical), `page ${i + 1}: inside the page and reading the right way up`);
    ck(before[i].items.every((o) => p.items.some((t) => t.str === o.str)), `page ${i + 1}: the original text is untouched`);
    const img = await logoPlacement(stamped, i + 1);
    ck(img && img.every((c) => c.x > 0 && c.x < p.width && c.y > p.height - 45 && c.y < p.height), `page ${i + 1}: the logo sits inside the page, along the bottom`);
    ck(img && Math.abs(Math.hypot(img[1].x - img[0].x, img[1].y - img[0].y) - 22) < 0.5, `page ${i + 1}: the logo is 22 points wide, not stretched`);
  }
  ck(!(await logoPlacement(original, 1)), 'the original pages had no picture');
  ck(!(await logoPlacementOf(await stamp.stampPdf(original, lines, { logo: null }), 1)), 'with no logo file the footer is text only');
  const small = await (async () => { const { PDFDocument } = require('pdf-lib'); const d = await PDFDocument.create(); d.addPage([100, 60]); return Buffer.from(await d.save()); })();
  ck((await stamp.stampPdf(small, lines)).length > 0, 'a tiny page is left alone, not an error');
  let rejected = false;
  try { await stamp.stampPdf(Buffer.from('this is not a pdf'), lines); } catch (_) { rejected = true; }
  ck(rejected, 'a damaged file is refused by the stamper (the server then sends the original)');

  console.log('\n— sending —');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  fs.mkdirSync(path.join(dir, 'notes'));
  const name = '11111111-2222-3333-4444-555555555555.pdf';
  fs.writeFileSync(path.join(dir, 'notes', name), original);
  const first = await stamp.fileToSend({ uploadDir: dir, fileName: name, lines });
  ck(first.stamped && first.file.includes('stamped') && (await pagesAsDisplayed(fs.readFileSync(first.file)))[0].items.some((t) => /Downloaded/.test(t.str)), 'the file to send is a stamped copy');
  ck(fs.readFileSync(path.join(dir, 'notes', name)).equals(original), 'the original upload is never changed');
  let calls = 0;
  const counting = async (b, l) => { calls++; return stamp.stampPdf(b, l); };
  const second = await stamp.fileToSend({ uploadDir: dir, fileName: name, lines, stamp: counting });
  ck(second.file === first.file && calls === 0, 'asking again reuses the stamped copy (no second job)');
  const other = ['Downloaded from Shule Notes', 'Contact us: 0711 000 111'];
  const changed = await Promise.all([1, 2, 3, 4].map(() => stamp.fileToSend({ uploadDir: dir, fileName: name, lines: other, stamp: counting })));
  ck(calls === 1 && changed.every((c) => c.file === changed[0].file) && changed[0].file !== first.file, 'new contact details make one new copy, even when four students ask at once');
  ck(fs.readdirSync(path.join(dir, 'stamped')).length === 1, 'the copy made for the old contact details is removed');
  const off = await stamp.fileToSend({ uploadDir: dir, fileName: name, lines, enabled: false });
  ck(!off.stamped && off.file === path.join(dir, 'notes', name), 'switched off in the admin panel: the original is sent');
  const failing = async () => { throw new Error('boom'); };
  const fb = await stamp.fileToSend({ uploadDir: dir, fileName: name, lines: ['x'], stamp: failing });
  ck(!fb.stamped && fb.file === path.join(dir, 'notes', name), 'if stamping fails the student still gets the original');
  ck(!(await stamp.fileToSend({ uploadDir: dir, fileName: '../../etc/passwd', lines })).stamped, 'a file name with slashes is never stamped or read');
  const threaded = await stamp.stampInThread(original, lines);
  ck((await pagesAsDisplayed(threaded)).length === 6, 'the worker thread version gives the same result');
  stamp.removeStamped(dir, name);
  ck(fs.readdirSync(path.join(dir, 'stamped')).length === 0, 'deleting a note removes its stamped copies');

  console.log('\n— the settings —');
  ck((await settings.saveSettings({ websiteUrl: 'not a link' })).ok === false, 'a website that is not a link is refused');
  ck((await settings.saveSettings({ websiteUrl: 'javascript:alert(1)' })).ok === false, 'a javascript: link is refused');
  ck((await settings.saveSettings({ websiteUrl: 'https://shule.example.ug', pdfStamp: false })).ok, 'a real link and the on/off switch are saved');
  const s = await settings.getSettings();
  ck(s.websiteUrl === 'https://shule.example.ug' && s.pdfStamp === false, 'and read back');
  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall stamp checks pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
