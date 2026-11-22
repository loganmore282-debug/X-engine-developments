// Runs the REAL Shule Notes server (all its routes and rules) against an in-memory database, seeded with a few notes,
// so the website can be driven end to end without MongoDB.
const path = require('path'); const fs = require('fs'); const os = require('os');
const B = require('path').resolve(__dirname, '../../backend');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'web-up-'));
process.env.ALLOWED_ORIGINS = 'http://localhost:4173,http://localhost:5173';
process.env.ADMIN_KEY = 'test-admin-key-123456';
const { makeDb, stubDb } = require(B + '/fake-mongo.testlib.js');
const db = makeDb(); stubDb(db);
const { PDFDocument, StandardFonts } = require(B + '/node_modules/pdf-lib');
const { ObjectId } = require(B + '/node_modules/mongodb');
const { app, marz } = require(B + '/server.js');
const { saveSettings } = require(B + '/settings.js');
(async () => {
  const subjects = ['Biology', 'Chemistry', 'Physics', 'Mathematics'];
  const subjectIds = {};
  for (const [i, name] of subjects.entries()) { const r = await db.collection('subjects').insertOne({ name, order: i }); subjectIds[name] = r.insertedId; }
  fs.mkdirSync(path.join(process.env.UPLOAD_DIR, 'notes'), { recursive: true });
  const mk = async (title, subject, cls, kind, pages) => {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    const texts = [];
    for (let p = 1; p <= pages; p++) {
      const pg = doc.addPage([595, 842]); const body = `${title}. Page ${p}. Photosynthesis is how plants make food from light, water and carbon dioxide.`;
      pg.drawText(title, { x: 50, y: 780, size: 22, font }); pg.drawText(`Page ${p} of ${pages}`, { x: 50, y: 750, size: 12, font });
      pg.drawText('Photosynthesis is how plants make food from light,', { x: 50, y: 700, size: 14, font }); pg.drawText('water and carbon dioxide.', { x: 50, y: 680, size: 14, font });
      texts.push(body);
    }
    const fileName = require('crypto').randomUUID() + '.pdf';
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'notes', fileName), Buffer.from(await doc.save()));
    await db.collection('notes').insertOne({ title, description: `${title}: a short summary for revision`, subjectId: subjectIds[subject], classLevel: cls, kind, fileName, fileSize: 40000, pageCount: pages, uploadedAt: new Date(), active: true, views: Math.floor(Math.random() * 50), textStatus: 'ready', extractedText: texts.join('\n'), pageTexts: texts });
  };
  await mk('Photosynthesis', 'Biology', 'Senior 2', 'notes', 5);
  await mk('Cell Structure', 'Biology', 'Senior 2', 'notes', 4);
  await mk('The Periodic Table', 'Chemistry', 'Senior 2', 'notes', 6);
  await mk('Newton\'s Laws of Motion', 'Physics', 'Senior 2', 'notes', 3);
  await mk('Algebra Past Paper 2024', 'Mathematics', 'Senior 2', 'past-paper', 4);
  await mk('Genetics', 'Biology', 'Senior 4', 'notes', 5);
  await db.collection('announcements').insertOne({ title: 'Mock exams start Monday', message: 'Revise the past papers in the Notes tab. Good luck!', active: true, createdAt: new Date() });
  // Payments on, with a pretend MarzPay that says "paid" a few seconds after the prompt (the real payment code runs).
  await saveSettings({ paymentsEnabled: true, marzpayKey: 'dGVzdC1tYXJ6cGF5LWtleS0xMjM0NQ==' });
  const started = {}; let counter = 0;
  Object.assign(marz, {
    configured: async () => true,
    collect: async ({ reference }) => { const uuid = 'mock-' + (++counter); started[uuid] = Date.now(); return { ok: true, uuid, message: '' }; },
    status: async (uuid) => (Date.now() - (started[uuid] || 0) > 4000 ? 'paid' : 'pending'),
  });
  await db.collection('notes').updateOne({ title: 'Cell Structure' }, { $set: { free: true } });
  app.listen(4010, () => console.log('mock server up on 4010'));
})();
