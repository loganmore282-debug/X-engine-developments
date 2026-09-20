#!/usr/bin/env node
/**
 * Two owner asks: "why can't l delete a country?" and "make sure that l can
 * enable link preview or no".
 *
 * WHAT IS PINNED, and why each one is a real failure mode:
 *
 *  1. THE DELETE REFUSALS ARE TELLABLE APART. There are four, and the first
 *     used to answer a bare "Unauthorized" -- which names no cause, so "it
 *     just will not delete" sends you to look at the button. Owner-only,
 *     the founding region, no such region, and members-are-signed-up each
 *     say which it is now, and the members one says HOW MANY.
 *
 *  2. THE LINK PREVIEW CAN BE TURNED OFF, and the mechanism is the only one
 *     available: the og:/twitter: tags live in the STATIC page head, so they
 *     cannot be removed per request -- a crawler reads the file and runs no
 *     script. Answering 404 for the image is therefore how "off" is
 *     expressed. Gated to that ONE slot, because the same helper serves the
 *     installed-app icons and switching those off by accident is far worse.
 *
 *  3. A BACKEND-WIDE SETTING CAN ACTUALLY BE SAVED. The panel stripped every
 *     GLOBAL_ONLY field from its own save UNCONDITIONALLY, so maintenance
 *     mode, the maintenance message, allowed origins, the base domain,
 *     block-root, parked hosts, strict hosts, the opening countdown and the
 *     app name could not be changed from the panel AT ALL -- silently, with a
 *     "Rates saved" toast on top. The server only refuses those for a region
 *     OVERLAY, so stripping them on the founding country threw away a save it
 *     would have accepted.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const admin = fs.readFileSync(path.join(HERE, 'admin-src', 'index.html'), 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// ── 1. the four delete refusals ───────────────────────────────────────────
console.log('— deleting a country says WHY it was refused —');
{
  const at = src.indexOf("app.post('/admin/regions/delete'");
  const end = src.indexOf('\napp.', at + 10);
  ck(at > -1 && end > at, 'the delete route was located');
  const body = src.slice(at, end);

  // Each refusal carries its own code, which is what makes them tellable
  // apart from the outside as well as in the wording.
  for (const code of ['OWNER_ONLY', 'FOUNDING_REGION', 'NO_SUCH_REGION', 'REGION_HAS_MEMBERS']) {
    ck(body.includes(code), `the ${code} refusal has its own code`);
  }
  ck(new Set(['OWNER_ONLY', 'FOUNDING_REGION', 'NO_SUCH_REGION', 'REGION_HAS_MEMBERS']).size === 4,
     'and the four are distinct');

  // The owner check is SEPARATE from the admin check, or the message cannot
  // say which of the two failed. This is the one that reported nothing.
  // Asserted as ORDER, not as a character distance: a comment between the two
  // pushed them past a {0,200} window and failed a correct route.
  const adminAt = body.indexOf('verifyAdmin(req)');
  const ownerAt = body.indexOf('verifyOwner(req)');
  ck(adminAt > -1 && ownerAt > adminAt,
     'the admin check and the owner check are separate steps, admin first');
  ck(/OWNER_ONLY[\s\S]{0,300}?owner account can delete/.test(body),
     '  and the owner refusal says owner rights are what is missing');
  ck(!/verifyOwner\(req\)\) return res\.status\(401\)\.json\(\{ status: 'error', message: 'Unauthorized' \}\)/.test(body),
     '  the bare "Unauthorized" for an owner-only action is gone');
  ck(/403/.test(body.slice(body.indexOf('OWNER_ONLY') - 200, body.indexOf('OWNER_ONLY'))),
     '  and it is a 403, not a 401 -- the session is fine, the role is not');

  // The COUNT, not just the fact. "There are members here" on a country you
  // believe is empty reads as a bug; "1 member" sends you to that account.
  ck(/limit\(51\)/.test(body), 'the member check reads a bounded page, not the whole collection');
  // Matched on the MESSAGE, not on the count being computed somewhere above
  // it: the first version matched the `howMany` definition, which a mutation
  // that dropped the count from the sentence left perfectly intact.
  const msgAt = body.indexOf('REGION_HAS_MEMBERS');
  const msg = body.slice(msgAt, body.indexOf('});', msgAt));
  ck(/\$\{howMany\}/.test(msg), 'and the sentence itself reports how many');
  ck(/members: n/.test(msg), '  with the number in the reply too, not only in prose');
  ck(/member\$\{n === 1 \? '' : 's'\}/.test(body), '  singular or plural');
  ck(/more than 50 members/.test(body),
     '  capped honestly rather than claiming an exact number it did not count');
  ck(/[Ss]witch the country OFF instead/.test(body),
     'and it names the alternative, which keeps those accounts on their own money');

  // A country that is already gone must not read as one of the other three.
  ck(body.indexOf('NO_SUCH_REGION') < body.indexOf('REGION_HAS_MEMBERS'),
     'an unknown country is answered before the member query runs');
  ck(/404/.test(body.slice(body.indexOf('NO_SUCH_REGION') - 120, body.indexOf('NO_SUCH_REGION'))),
     '  as a 404');
}

// ── 2. the link-preview switch ────────────────────────────────────────────
console.log('\n— the link preview can be switched off —');
{
  ck(/linkPreviewEnabled: true,/.test(src), 'the setting exists and defaults ON (what shipped)');
  ck(/const SETTINGS_BOOLEAN_FIELDS = \['linkPreviewEnabled'/.test(src),
     'and is validated as a boolean like every other switch');

  // Backend-wide by necessity: the og: tags are in one static file served to
  // every country and every host, so a per-country share card cannot exist.
  const g = /const GLOBAL_ONLY_SETTINGS = \[([^\]]*)\]/.exec(src)[1];
  ck(/linkPreviewEnabled/.test(g), 'it is backend-wide, not per country');

  // RUN the real handler. Whether a 404 comes back for one slot and not
  // another is not a question a text match can answer.
  const fnAt = src.indexOf('function serveBrandAsset(slot)');
  const fnEnd = src.indexOf('\n}', src.indexOf('} catch (e) { res.status(500).end(); }', fnAt));
  ck(fnAt > -1 && fnEnd > fnAt, 'serveBrandAsset was located');
  const serve = src.slice(fnAt, fnEnd + 2);

  const make = new Function('SETT', 'ASSET', `
    async function getSettings() { return SETT; }
    async function getBrandAsset() { return ASSET; }
    ${serve}
    return serveBrandAsset;
  `);
  const res = () => {
    const o = { code: 200, headers: {}, ended: false,
      status(n) { this.code = n; return this; },
      set(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
      end(b) { this.ended = true; this.body = b; return this; } };
    return o;
  };
  const req = { headers: {}, method: 'GET' };
  const ASSET = { buf: Buffer.from('jpegbytes'), mime: 'image/jpeg', version: 7 };

  return (async () => {})(), (async () => {
    // ON: the card is served.
    let r = res();
    await make({ linkPreviewEnabled: true }, ASSET)('link-preview')(req, r);
    ck(r.code === 200 && r.headers['content-type'] === 'image/jpeg',
       'with the switch ON a crawler gets the picture');

    // OFF: 404, which is what makes a shared link show no picture.
    r = res();
    await make({ linkPreviewEnabled: false }, ASSET)('link-preview')(req, r);
    ck(r.code === 404, 'with the switch OFF it is a 404, so the link shares no picture');
    ck(r.headers['cache-control'] === 'no-store',
       '  and the refusal is not cached, so switching it back on takes effect at once');

    // THE important negative: the app icons share this helper and must be
    // untouched. Switching off a share card must never take the installed
    // home-screen icon with it.
    for (const slot of ['app-icon-512', 'app-icon-192']) {
      r = res();
      await make({ linkPreviewEnabled: false }, ASSET)(slot)(req, r);
      ck(r.code === 200, `${slot} is still served with the preview switched off`);
    }

    // An unset setting must behave as ON -- every deployed database predates
    // this field, and a share card vanishing on deploy would be a surprise.
    r = res();
    await make({}, ASSET)('link-preview')(req, r);
    ck(r.code === 200, 'a settings document with no such field still shares the picture');

    // ── 3. a backend-wide setting can be saved at all ───────────────────
    console.log('\n— a backend-wide setting reaches the server —');
    const ag = /const ADMIN_GLOBAL_ONLY = \[([^\]]*)\]/.exec(admin)[1];
    const norm = t => t.split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean).sort().join('|');
    ck(norm(ag) === norm(g),
       "the panel's list is exactly the server's, so nothing is stripped that should save");

    // The strip must be conditional on the target country. Unconditional, it
    // deleted every global field from its own save.
    ck(/const target = \(body && body\.region\) \|\| one;/.test(admin),
       'the panel works out which country the save is actually for');
    ck(/if \(target !== 'ug' && REGION_SCOPED_WRITES\.includes\(path\)/.test(admin),
       'and strips backend-wide fields ONLY for a region overlay, not on every save');

    // The switch names the founding region explicitly, or it would be
    // stripped whenever another country is picked -- and still toast success.
    ck(/api\('\/admin\/settings\/update', \{ region: 'ug', settings: \{ linkPreviewEnabled: on \} \}\)/.test(admin),
       'the switch saves against the founding region, so it works from any country');
    ck(/linkPrevOn\.checked = !on;/.test(admin),
       'a refused save puts the switch back rather than lying about it');
    ck(/id="linkPrevOn"[^>]*\$\{s\.linkPreviewEnabled !== false \? 'checked' : ''\}/.test(admin),
       'and it renders from the stored value, treating unset as on');

    console.log(bad ? `\n${bad} FAILED` : '\nlink preview + country delete: all cases pass');
    process.exit(bad ? 1 : 0);
  })();
}
