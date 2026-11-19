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

// Uploaded oldest first; the app lists the newest first.
const NOTES = [
  ['How to Revise for Exams', '', '', 'revision-tips.pdf', 'Planning, active revision and exam technique. For every class.'],
  ['Fractions and Decimals', 'Mathematics', 'Primary 7', 'fractions.pdf', 'Adding fractions and changing them to decimals, with practice questions.'],
  ['Plants and Animals', 'Science', 'Primary 7', 'plants-animals.pdf', 'Living things and how plants make food.'],
  ['Our District and Our Region', 'Social Studies', 'Primary 7', 'our-districts.pdf', 'Districts, regions and how to read a map.'],
  ['Reading Comprehension', 'English', 'Primary 7', 'comprehension.pdf', 'A short passage with questions.'],
  ['Demand and Supply', 'Economics', 'Senior 5', 'demand-supply.pdf', 'The law of demand, supply and market equilibrium.'],
  ['Planning a General Paper Essay', 'General Paper', 'Senior 5', 'gp-essay.pdf', 'Reading the question and structuring an essay.'],
  ['Cell Structure – Practice Questions', 'Biology', 'Senior 1', 'cells.pdf', 'Short-answer practice questions on plant and animal cells.'],
  ['Essay Writing', 'English', 'Senior 2', 'essay-writing.pdf', 'Planning and structuring an essay.'],
  ['Linear Equations – Worked Examples', 'Mathematics', 'Senior 2', 'linear-equations.pdf', 'Solving equations step by step.'],
  ['Map Reading', 'Geography', 'Senior 2', 'map-reading.pdf', 'Scale, key and grid references.'],
  ['Uganda Before Colonial Rule', 'History & Political Education', 'Senior 2', 'uganda-history.pdf', 'Early kingdoms and trade.'],
  ['Work, Energy and Power', 'Physics', 'Senior 2', 'energy.pdf', 'Definitions, formulas and worked examples.'],
  ["Newton's Laws of Motion – Revision", 'Physics', 'Senior 3', 'newton.pdf', 'The three laws, with a worked force calculation.'],
  ['Quadratic Equations – Worked Examples', 'Mathematics', 'Senior 3', 'quadratics.pdf', 'Factorising and the quadratic formula, with practice questions.'],
  ['Acids, Bases and Salts', 'Chemistry', 'Senior 2', 'acids.pdf', 'Acids, alkalis, neutralisation and the pH scale.'],
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
  // The one-click button adds every standard Ugandan subject (and asks first).
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#sSeed');
  await page.waitForSelector('#subjectsRows td:text-is("Subsidiary ICT")', { timeout: 60000 });
  await toastGone();
  await shot('admin-02-subjects');

  await page.click('.tab[data-tab="notes"]');
  for (const [i, [title, subject, level, file, desc]] of NOTES.entries()) {
    await page.fill('#nTitle', title);
    // The class first: the subject menu then shows only that class's subjects.
    await page.selectOption('#nClass', level ? { label: level } : { value: '' });
    await page.selectOption('#nSubject', subject ? { label: subject } : { value: '' });
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
