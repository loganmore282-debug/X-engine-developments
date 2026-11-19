// Puts a small footer on every page of a note's PDF as it is sent to a student: where it came from and how
// to reach the owner. The original upload is never changed; the stamped copy is made once and kept (it is
// made again only when the contact details in the admin panel change). If stamping ever fails the student
// still gets the original, never an error.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Standard PDF fonts only know Western characters: anything else becomes "?" so a stray symbol cannot
// make stamping fail.
const plain = (s) => String(s || '').replace(/[^\x20-\x7e -ÿ]/g, '?').replace(/\s+/g, ' ').trim();

// The footer's lines, from the owner's settings. `website` is the owner's own link, or the app's download page.
function footerLines(settings, website) {
  const lines = [];
  const site = plain(settings.websiteUrl) || plain(website);
  lines.push('Downloaded from Shule Notes' + (site ? '  |  ' + site : ''));
  const contacts = [];
  if (settings.supportPhone) contacts.push(plain(settings.supportPhone));
  if (settings.supportWhatsapp) contacts.push('WhatsApp ' + plain(settings.supportWhatsapp));
  if (settings.supportEmail) contacts.push(plain(settings.supportEmail));
  if (contacts.length) lines.push('Contact us: ' + contacts.join('  |  '));
  return lines;
}

// Draws the lines centred along the bottom of the page AS IT IS DISPLAYED. Pages stored sideways (/Rotate)
// need the text turned the same way, so the position is worked out on the displayed page and mapped back.
// The owner's logo in grey tones, shown small beside the words. Read once.
let logoFile;
function logoBytes() {
  if (logoFile === undefined) {
    try { logoFile = fs.readFileSync(path.join(__dirname, 'assets', 'logo-gray.png')); } catch (_) { logoFile = null; }
  }
  return logoFile;
}

async function stampPdf(buffer, lines, { logo = logoBytes() } = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const logoImage = logo ? await doc.embedPng(logo) : null; // embedded once, shared by every page
  const colour = rgb(0.36, 0.38, 0.40);
  for (const page of doc.getPages()) {
    const box = page.getCropBox(); // the part of the page that is shown
    const w = box.width; const h = box.height;
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const visW = angle === 90 || angle === 270 ? h : w;
    const visH = angle === 90 || angle === 270 ? w : h;
    if (visW < 160 || visH < 90) continue; // too small to carry a footer
    const toUser = (vx, vy) => (angle === 90 ? [w - vy, vx] : angle === 180 ? [w - vx, h - vy] : angle === 270 ? [vy, h - vx] : [vx, vy]);
    // The logo (a square, 22 points) with the lines to its right, the whole group centred along the bottom.
    const logoSize = logoImage && visW >= 200 ? 22 : 0;
    const gap = logoSize ? 7 : 0;
    const room = visW - 24 - logoSize - gap;
    const fitted = lines.map((line) => {
      let size = 7.5;
      while (size > 5 && font.widthOfTextAtSize(line, size) > room) size -= 0.5;
      let text = line;
      while (text.length > 4 && font.widthOfTextAtSize(text, size) > room) text = text.slice(0, -2);
      if (text !== line) text = text.slice(0, -1) + '..';
      return { text, size, width: font.widthOfTextAtSize(text, size) };
    });
    const textWidth = Math.max(...fitted.map((f) => f.width));
    const startX = (visW - (logoSize + gap + textWidth)) / 2;
    if (logoSize) {
      const [lx, ly] = toUser(startX, 7);
      page.drawImage(logoImage, { x: box.x + lx, y: box.y + ly, width: logoSize, height: logoSize, rotate: degrees(angle) });
    }
    fitted.forEach((f, i) => {
      const vy = 9 + (lines.length - 1 - i) * 9.5; // the first line sits above the last
      const [ux, uy] = toUser(startX + logoSize + gap, vy);
      page.drawText(f.text, { x: box.x + ux, y: box.y + uy, size: f.size, font, color: colour, rotate: degrees(angle) });
    });
  }
  return Buffer.from(await doc.save());
}

// The same, on a worker thread: stamping a big PDF takes seconds of CPU and must not stop other requests.
function stampInThread(buffer, lines, timeoutMs = 90000) {
  const { Worker } = require('worker_threads');
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'stamp-worker.js'), {
      workerData: { buffer, lines },
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('stamping took too long')); }, timeoutMs);
    worker.once('message', (m) => { clearTimeout(timer); worker.terminate(); m.ok ? resolve(Buffer.from(m.buffer)) : reject(new Error(m.error)); });
    worker.once('error', (e) => { clearTimeout(timer); reject(e); });
    worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error('the stamping thread stopped (code ' + code + ')')); });
  });
}

const stampDir = (uploadDir) => path.join(uploadDir, 'stamped');
const stampName = (fileName, lines) => path.basename(fileName, '.pdf') + '.' + crypto.createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 10) + '.pdf';

const inFlight = new Map(); // one stamping job per file, however many students ask at once
const failed = new Set();   // files that could not be stamped: not retried until the server restarts

// The path of the file to send: the stamped copy (made now if needed), or the original if stamping is off or fails.
async function fileToSend({ uploadDir, fileName, lines, enabled = true, stamp = stampInThread }) {
  const original = path.join(uploadDir, 'notes', fileName);
  if (!enabled || !lines.length || !/^[\w-]+\.pdf$/.test(fileName)) return { file: original, stamped: false };
  const name = stampName(fileName, lines);
  const target = path.join(stampDir(uploadDir), name);
  if (fs.existsSync(target)) return { file: target, stamped: true };
  if (failed.has(name)) return { file: original, stamped: false };
  if (!inFlight.has(name)) {
    inFlight.set(name, (async () => {
      const stamped = await stamp(await fs.promises.readFile(original), lines);
      await fs.promises.mkdir(stampDir(uploadDir), { recursive: true });
      const tmp = target + '.tmp';
      await fs.promises.writeFile(tmp, stamped);
      await fs.promises.rename(tmp, target);
      removeStamped(uploadDir, fileName, name); // older stamps of this note (the contacts changed) are no longer needed
    })().finally(() => inFlight.delete(name)));
  }
  try {
    await inFlight.get(name);
    return { file: target, stamped: true };
  } catch (e) {
    failed.add(name);
    console.error('could not stamp', fileName, ':', e.message);
    return { file: original, stamped: false };
  }
}

// Deletes the stamped copies of a note (all of them, or all but `keep`).
function removeStamped(uploadDir, fileName, keep) {
  const prefix = path.basename(fileName, '.pdf') + '.';
  try {
    for (const f of fs.readdirSync(stampDir(uploadDir))) if (f.startsWith(prefix) && f !== keep) fs.rmSync(path.join(stampDir(uploadDir), f), { force: true });
  } catch (_) { /* no stamped folder yet */ }
}

module.exports = { footerLines, stampPdf, stampInThread, fileToSend, removeStamped, plain, _failed: failed };
