'use strict';
// The sign-up captcha (captcha.js) and how the app and the server use it.
const fs = require('node:fs'), assert = require('node:assert/strict');
const captcha = require('./captcha');
const R = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
// the picture: four digits, an svg, a data url, answer not leaked in the id
{
  const c = captcha.issue();
  ok(/^\d{4}$/.test(c.code) && /^[0-9a-f]{32}$/.test(c.id), 'four digits and a random id');
  const svg = Buffer.from(c.image.split(',')[1], 'base64').toString();
  ok(c.image.startsWith('data:image/svg+xml;base64,') && svg.startsWith('<svg') && svg.endsWith('</svg>'), 'a data: svg picture');
  ok(!/<text/i.test(svg) && !svg.includes(c.code) && (svg.match(/<path /g) || []).length === 4, 'the digits are outlined shapes (no readable text), four of them');
  ok(!Object.values(require('./captcha')._live.get(c.id)).includes(c.code) && !JSON.stringify([...require('./captcha')._live.values()]).includes('"code"'), 'the server keeps a keyed hash, not the plain code');
  ok(!svg.includes(c.id), 'the id is not in the picture');
  for (const col of ['#0b6a3b', '#10a95a', '#e1212c', '#f7c41a']) { let seen = false; for (let i = 0; i < 40 && !seen; i++) seen = Buffer.from(captcha.issue().image.split(',')[1], 'base64').toString().includes('fill="' + col + '"'); ok(seen, 'digit colour ' + col + ' is used'); }
  for (let i = 0; i < 30; i++) { const x = Buffer.from(captcha.issue().image.split(',')[1], 'base64').toString(); const cols = new Set([...x.matchAll(/<path [^>]*fill="(#[0-9a-f]{6})"/g)].map(m => m[1])); ok(cols.size >= 3, 'at least three colours in one picture'); }
}
// answers: right once, never again; wrong uses the picture up; expired never; unknown never
{
  const a = captcha.issue(); ok(captcha.verify(a.id, a.code) === true, 'the right code passes');
  ok(captcha.verify(a.id, a.code) === false, 'and cannot be used a second time');
  const b = captcha.issue(); ok(captcha.verify(b.id, '0000' === b.code ? '1111' : '0000') === false, 'a wrong code fails');
  ok(captcha.verify(b.id, b.code) === false, 'and the picture is used up by the wrong answer');
  const c = captcha.issue(5000); ok(captcha.verify(c.id, c.code, 5000 + captcha.TTL_MS + 1) === false, 'an old picture fails');
  const d = captcha.issue(); ok(captcha.verify(d.id, ' ' + d.code + ' ') === true, 'spaces around the code are ignored');
  ok(captcha.verify('nope', '1234') === false && captcha.verify(undefined, undefined) === false && captcha.verify('', '') === false, 'unknown ids never pass');
  ok(captcha.verify({ $ne: 1 }, { $ne: 1 }) === false, 'objects never pass');
}
// the live pictures stay bounded
{ const before = captcha._live.size; for (let i = 0; i < 300; i++) captcha.issue(); ok(captcha._live.size >= before && captcha._live.size < 20001, 'bounded store'); }
// wiring: the server route and sign-up check, the app, and the markup
{
  const server = R('server.js'), mod = R('user-src/original_module.js'), html = R('user-src/index.html');
  ok(/app\.get\('\/auth\/captcha', memberCaptchaLimiter/.test(server) && /Cache-Control', 'no-store'/.test(server), 'GET /auth/captcha, never cached');
  ok(/captcha\.verify\(textOf\(req\.body\.captchaId\), textOf\(req\.body\.captchaCode\)\)/.test(server) && /code: 'BAD_CAPTCHA'/.test(server) && /code: 'CAPTCHA_REQUIRED'/.test(server), 'sign-up checks the captcha first');
  ok(server.indexOf('captcha.verify(') < server.indexOf("cleanPhone(textOf(req.body.phone))", server.indexOf("app.post('/auth/signup'")), 'the captcha is checked before anything else in sign-up');
  ok(/const MEMBER_PASSWORD_MIN = 6,/.test(server) && !/weakPasswordReason/.test(server) && !fs.existsSync(__dirname + '/weak-passwords.js'), 'passwords: at least 6, no weak-password list');
  ok(/window\.fbCreateUser = async \(email, pass\) =>/.test(html) && !/captchaId/.test(html) && !/loadAuthCaptcha|capError/.test(mod), 'the app no longer sends or asks for a captcha (the owner\'s Create Account has none)');
  ok(/pass\.length < 6\) return regError\('Password must be at least 6 characters'\)/.test(mod), 'the app asks for 6 characters');
  for (const id of ['authLogo', 'authLogoImg', 'authHeroBg', 'loginPhone', 'loginPassword', 'rememberMe', 'loginBtn', 'regPhone', 'regPassword', 'regPassword2', 'regTradePin', 'regReferral', 'regBtn']) ok(html.includes('id="' + id + '"'), 'markup has ' + id);
  ok(/placeholder="Enter password"/.test(html) && /placeholder="Re-enter password"/.test(html) && /placeholder="6-digit trade password"/.test(html) && /placeholder="Enter Username Number"/.test(html), 'the words are the screenshot\'s');
  ok(/id="loginDial">\+234</.test(html) && /id="regDial">\+234</.test(html), '+234 on both forms');
  ok(/POTATO_IMAGE_SLOTS = \['logo', 'authhero', 'authlogo',/.test(server) && /id="authLogoFile"/.test(R('admin-src/index.html')) && /applyAuthLogo/.test(mod), 'the circle logo is an admin-uploaded slot');
}
console.log(`PASS: captcha and Potato sign-up wiring (${n} checks)`);
