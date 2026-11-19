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
  ['Linear Equations – Worked Examples', 'Mathematics', 'Senior 2', 'linear-equations.pdf', 'Solving equations step by step.', 'past-paper'],
  ['Map Reading', 'Geography', 'Senior 2', 'map-reading.pdf', 'Scale, key and grid references.'],
  ['Uganda Before Colonial Rule', 'History & Political Education', 'Senior 2', 'uganda-history.pdf', 'Early kingdoms and trade.'],
  ['Work, Energy and Power', 'Physics', 'Senior 2', 'energy.pdf', 'Definitions, formulas and worked examples.', 'past-paper'],
  ["Newton's Laws of Motion – Revision", 'Physics', 'Senior 3', 'newton.pdf', 'The three laws, with a worked force calculation.'],
  ['Quadratic Equations – Worked Examples', 'Mathematics', 'Senior 3', 'quadratics.pdf', 'Factorising and the quadratic formula, with practice questions.'],
  ['Acids, Bases and Salts', 'Chemistry', 'Senior 2', 'acids.pdf', 'Acids, alkalis, neutralisation and the pH scale.'],
  ['Photosynthesis', 'Biology', 'Senior 2', 'photosynthesis.pdf', 'How plants make food: the equation, leaf adaptations, limiting factors and the starch test.'],
];

const STUDENTS = [
  ['Amina Nakato', '0701000001', 'Primary 7'], ['Brian Okello', '0701000002', 'Senior 2'],
  ['Cissy Namubiru', '0701000003', 'Senior 5'], ['David Mugisha', '0701000004', 'Senior 2'],
  ['Esther Achieng', '0701000005', 'Primary 6'], ['Farouk Ssemakula', '0701000006', 'Senior 4'],
  ['Grace Atim', '0701000007', ''],
];
async function seedStudents() {
  for (const [name, phone, level] of STUDENTS) {
    const r = await (await fetch(API_URL + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone, password: 'secret123' }) })).json();
    if (r.status !== 'success') throw new Error('seeding ' + name + ': ' + r.message);
    if (level) await fetch(API_URL + '/auth/class-level', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r.token }, body: JSON.stringify({ classLevel: level }) });
  }
}

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

  // Dashboard first, with a few students already in so it has something to show.
  await seedStudents();
  await page.click('.nav[data-tab="dashboard"]');
  await page.waitForSelector('#dashStats .stat');

  await page.click('.nav[data-tab="subjects"]');
  // The one-click button adds every standard Ugandan subject, after a confirm dialog.
  await page.click('#sSeed');
  await page.waitForSelector('#modalOk');
  await shot('admin-02a-confirm-dialog');
  await page.click('#modalOk');
  await page.waitForSelector('#subjectsRows td:text-is("Subsidiary ICT")', { timeout: 60000 });
  await toastGone();
  await shot('admin-02-subjects');

  await page.click('.nav[data-tab="notes"]');
  for (const [i, [title, subject, level, file, desc, kind]] of NOTES.entries()) {
    await page.fill('#nTitle', title);
    // The class first: the subject menu then shows only that class's subjects.
    await page.selectOption('#nClass', level ? { label: level } : { value: '' });
    await page.selectOption('#nSubject', subject ? { label: subject } : { value: '' });
    await page.setInputFiles('#nFile', path.join(PDF_DIR, file));
    await page.selectOption('#nKind', kind || 'notes');
    await page.fill('#nDesc', desc);
    if (i === NOTES.length - 1) { await toastGone(); await shot('admin-03-uploading-a-note'); }
    await page.click('#nUpload');
    await page.waitForFunction((t) => [...document.querySelectorAll('#notesRows td')].some((td) => td.textContent.includes(t)), title);
  }
  await toastGone();
  await shot('admin-04-notes-list');

  // Edit dialog.
  await page.click('#notesRows button[data-act="edit"]');
  await page.waitForSelector('#eTitle');
  await shot('admin-05-edit-note');
  await page.click('#modalCancel');

  // Students: some browsing, then reset a password.
  await page.click('.nav[data-tab="students"]');
  await page.waitForSelector('#studentRows tr td .who');
  await shot('admin-06-students');
  await page.fill('#stSearch', 'amina');
  await page.waitForFunction(() => document.querySelectorAll('#studentRows tr').length === 1);
  await shot('admin-07-students-search');
  await page.fill('#stSearch', '');
  await page.waitForFunction(() => document.querySelectorAll('#studentRows tr').length > 1);
  await page.click('#studentRows button[data-act="ban"]');
  await page.waitForSelector('#modalOk');
  await page.click('#modalOk');
  await page.waitForSelector('#studentRows .pill.bad');
  await toastGone();
  await page.click('#studentRows button[data-act="reset"]');
  await page.waitForSelector('#resetPw');
  await shot('admin-08-reset-password');
  await page.click('#modalOk');
  await page.waitForSelector('.secret');
  await shot('admin-09-new-password');
  await page.click('#modalOk');

  // Announcements.
  await page.click('.nav[data-tab="announcements"]');
  await page.fill('#aTitle', 'Mock exams start on Monday');
  await page.fill('#aMessage', 'Revise the Senior 4 past papers in the Notes tab. Good luck!');
  await page.click('#aSave');
  await page.waitForSelector('#aList li');
  await toastGone();
  await shot('admin-10-announcements');

  // Settings.
  await page.click('.nav[data-tab="settings"]');
  await page.waitForSelector('#setPhone');
  await page.fill('#setAiLimit', '15');
  await page.fill('#setPhone', '+256 700 123 456');
  await page.fill('#setWhatsapp', '+256 700 123 456');
  await page.fill('#setEmail', 'help@shulenotes.example');
  await page.fill('#setHours', 'Monday to Friday, 8am to 5pm');
  await page.click('#setSave');
  await page.waitForSelector('#toast.ok');
  await toastGone();
  await shot('admin-11-settings');

  await page.click('.nav[data-tab="dashboard"]');
  await page.waitForSelector('#dashStats .stat');
  await shot('admin-12-dashboard');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
