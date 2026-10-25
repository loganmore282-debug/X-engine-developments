#!/usr/bin/env node
// The Settings and Banners tabs must wire every button: one missing element in the wiring code used to stop everything after it
// (the Daily Salary table stayed on "Loading…" and "Save app name" did nothing).
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const errors = [], calls = [];
const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
const settings = { brandName: 'Potato', allowedOrigins: [], referencePrefix: 'potato', annTitle: 'Hi', annBody: 'x', annEnabled: true };
const dom = new JSDOM(html, {
  url: 'https://potato-platform.com/admin/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = async (url, opts) => {
      const p = String(url).replace(/^.*\/k7x2/, ''); let body = {}; try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
      calls.push([p, body]);
      let out = { status: 'success', settings, users: [], products: [], tiers: [{ id: 't1', target: 500000, reward: 2000 }], token: 't', username: 'owner', role: 'owner' };
      if (p === '/admin/settings/update') Object.assign(settings, body.settings || {});
      return { status: 200, ok: true, json: async () => out };
    };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.Notification = { permission: 'denied' };
  },
});
const w = dom.window, $ = id => w.document.getElementById(id), sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(200);
  $('keyInput').value = 'k'; $('loginBtn').click(); await sleep(300);
  w.document.querySelector('[data-tab="settings"]').click(); await sleep(400);
  assert.ok(calls.some(c => c[0] === '/admin/salary'), 'the Reward tiers table is requested');
  assert.ok(!/Loading/.test($('taskEditor').textContent), 'and replaces "Loading…"');
  $('brandNameInput').value = 'Potato Gum'; $('saveBrandName').click(); await sleep(150);
  assert.equal(settings.brandName, 'Potato Gum', '"Save app name" saves a new name');
  for (const gone of ['sWeekendCash', 'sWeekendWit', 'sReqReferral']) assert.equal($(gone), null, gone + ' (a removed setting) is not on the page');
  assert.ok(!/Saturday|weekend|referral code to sign up/i.test($('content').textContent.replace(/Right now it is \w+day \d\d:\d\d/g, '')), 'no weekend or require-referral wording on the Settings page');
  // the Banners tab buttons are wired too
  w.document.querySelector('[data-tab="banners"]').click(); await sleep(400);
  $('lpTitle').value = 'Potato Gum'; $('lpText').value = 'Earn daily'; $('saveLinkPreview').click(); await sleep(150);
  assert.equal(settings.linkPreviewTitle, 'Potato Gum'); assert.equal(settings.linkPreviewText, 'Earn daily');
  assert.deepEqual(errors, [], 'no script errors: ' + errors.join(' | '));
  console.log('PASS: admin Settings and Banners wiring (reward tiers load, app name, link preview save)');
  w.close();
})().catch(e => { console.error(e); process.exit(1); });
