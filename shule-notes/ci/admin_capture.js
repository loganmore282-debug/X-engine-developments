// Drives the real admin panel against the real backend: signs in, creates
// subjects and uploads the sample PDFs (which is also what fills the app with
// content for capture.py), photographing each page along the way.
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }
const path = require('path');

const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:8080/';
const API_URL = process.env.API_URL || 'http://localhost:4000';
const ADMIN_KEY = process.env.ADMIN_KEY;
const PDF_DIR = process.argv[2];
const OUT = process.argv[3];

const SUBJECTS = [['Biology', 1], ['Mathematics', 2], ['Physics', 3], ['Chemistry', 4]];
// Uploaded oldest first; the app lists the newest first.
const NOTES = [
  ['How to Revise for Exams', '', '', 'revision-tips.pdf', 'Planning, active revision and exam technique. For every class.'],
  ['Fractions and Decimals', 'Mathematics', 'Primary 7', 'fractions.pdf', 'Adding fractions and changing them to decimals, with practice questions.'],
  ['Work, Energy and Power', 'Physics', 'Senior 2', 'energy.pdf', 'Definitions, formulas and worked examples.'],
  ['Cell Structure – Practice Questions', 'Biology', 'Senior 1', 'cells.pdf', 'Short-answer practice questions on plant and animal cells.'],
  ['Acids, Bases and Salts', 'Chemistry', 'Senior 2', 'acids.pdf', 'Acids, alkalis, neutralisation and the pH scale.'],
  ["Newton's Laws of Motion – Revision", 'Physics', 'Senior 3', 'newton.pdf', 'The three laws, with a worked force calculation.'],
  ['Quadratic Equations – Worked Examples', 'Mathematics', 'Senior 3', 'quadratics.pdf', 'Factorising and the quadratic formula, with practice questions.'],
  ['Photosynthesis', 'Biology', 'Senior 2', 'photosynthesis.pdf', 'How plants make food: the equation, leaf adaptations, limiting factors and the starch test.'],
];

(async () => {
  const browser = await pw.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const context = await browser.newContext({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 2 });
  await context.addInitScript((api) => localStorage.setItem('shule_api_base', api), API_URL);
  const page = await context.newPage();
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  // The extra wait covers the toast's own fade-out transition.
  const toastGone = async () => {
    await page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'));
    await page.waitForTimeout(400);
  };

  await page.goto(ADMIN_URL);
  await page.fill('#loginKey', ADMIN_KEY);
  await shot('admin-01-sign-in');
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not(.hidden)');

  await page.click('.tab[data-tab="subjects"]');
  for (const [name, order] of SUBJECTS) {
    await page.fill('#sName', name);
    await page.fill('#sOrder', String(order));
    await page.click('#sSave');
    await page.waitForSelector(`#subjectsRows td:text-is("${name}")`);
  }
  await toastGone();
  await shot('admin-02-subjects');

  await page.click('.tab[data-tab="notes"]');
  for (const [i, [title, subject, level, file, desc]] of NOTES.entries()) {
    await page.fill('#nTitle', title);
    await page.selectOption('#nSubject', subject ? { label: subject } : { value: '' });
    await page.selectOption('#nClass', level ? { label: level } : { value: '' });
    await page.setInputFiles('#nFile', path.join(PDF_DIR, file));
    await page.fill('#nDesc', desc);
    if (i === NOTES.length - 1) { await toastGone(); await shot('admin-03-uploading-a-note'); }
    await page.click('#nUpload');
    await page.waitForFunction((t) => [...document.querySelectorAll('#notesRows td')].some((td) => td.textContent.includes(t)), title);
  }
  await toastGone();
  await shot('admin-04-notes-list');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
