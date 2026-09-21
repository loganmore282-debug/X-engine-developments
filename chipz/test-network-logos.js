#!/usr/bin/env node
/**
 * Network logos, per network NAME, shared by every country that has it --
 * and both deposit paths (PAY A and PAY B) now pick a network before
 * submitting.
 *
 * Owner: "make when one can select network, l know marz can detect
 * automatically but just put it so after payment channel you put network so
 * l will upload network Logos from admin panel, the good thing you know
 * network of each country so put names of l will just put Logos... let one
 * select amount, then no putting number, so it will redirect to the other
 * manual page where l will put network logos, so there, after putting
 * number he will hit that polling back there... so l want automatic
 * payment to pass through that procedure however after confirmation, it
 * will come back to auto poll not on the final manual pay screen."
 *
 * Then, on which logo goes with which network: "orange cannot be that of
 * airtel or airtel cannot be that of mtn, so per network, logos change" --
 * confirming ONE logo per network NAME (not per country), shared wherever
 * that exact name appears in a country's own network list.
 *
 * This runs the real server functions (networkLogoKey, getAllNetworkLogos,
 * getAllNetworkLogoRows) against a stub database, checks the real route
 * bodies for the properties that matter, and runs the real client helpers
 * (networkLogoKeyClient, networkLogoHtml) against a stub STATE -- per this
 * project's own repeatedly-learned rule: run the functions, don't read them.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(HERE, 'user-src', 'original_module.js'), 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

function fnSource(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  const bodyAt = text.indexOf('{', text.indexOf(')', start));
  let depth = 0;
  for (let k = bodyAt; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
// manualPayConfirm/resumeManualPayFlow are `window.NAME = async function(...)`
// assignments, not `function NAME(...)` declarations -- fnSource() cannot
// find those by name at all.
function windowFnSource(text, name) {
  const anchor = `window.${name} = `;
  const start = text.indexOf(anchor);
  if (start === -1) throw new Error(`no such window assignment: ${name}`);
  const bodyAt = text.indexOf('{', text.indexOf('function', start));
  let depth = 0;
  for (let k = bodyAt; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
function asyncFnSource(text, name) {
  const start = text.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`no such async function: ${name}`);
  const bodyAt = text.indexOf('{', text.indexOf(')', start));
  let depth = 0;
  for (let k = bodyAt; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
function routeBody(method, urlPath) {
  const anchor = `app.${method}('${urlPath}'`;
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error(`no such route: ${method} ${urlPath}`);
  const bodyAt = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let k = bodyAt; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in route ${method} ${urlPath}`);
}

// ── networkLogoKey() -- the normalizer both /admin/network-logo/set and
// /admin/network-logo/clear key their document id from ──
console.log('— networkLogoKey() —');
{
  const fn = new Function('return ' + fnSource(src, 'networkLogoKey'))();
  ck(fn('MTN Mobile Money') === 'mtn mobile money', 'lowercased');
  ck(fn('  MTN   Mobile    Money  ') === 'mtn mobile money', 'trimmed and internal whitespace collapsed');
  ck(fn('Orange Money') !== fn('Airtel Money'), 'two different networks never collide');
  ck(fn('MTN Mobile Money') === fn('mtn mobile money'), 'case is not significant');
  ck(fn('') === '', 'an empty/garbage name normalizes to an empty key rather than throwing');
}

// ── getAllNetworkLogos() / getAllNetworkLogoRows() against a stub db ──
console.log('\n— getAllNetworkLogos() / getAllNetworkLogoRows() —');
{
  function makeDb(docs) {
    return {
      collection(name) {
        if (name !== 'networkLogos') throw new Error('unexpected collection: ' + name);
        return {
          async get() {
            return { docs: docs.map(d => ({ id: d.id, data: () => d.data })) };
          },
        };
      },
    };
  }
  const fixture = [
    { id: 'mtn mobile money', data: { name: 'MTN Mobile Money', image: 'data:image/png;base64,AAAA' } },
    { id: 'orange money', data: { name: 'Orange Money', image: 'data:image/png;base64,BBBB' } },
  ];
  const sandbox = new Function('db', `
    let _networkLogoCache = null, _networkLogoCacheTs = 0;
    ${asyncFnSource(src, 'getAllNetworkLogos')}
    ${asyncFnSource(src, 'getAllNetworkLogoRows')}
    return { getAllNetworkLogos, getAllNetworkLogoRows };
  `)(makeDb(fixture));

  sandbox.getAllNetworkLogos().then(map => {
    ck(map['mtn mobile money'] === 'data:image/png;base64,AAAA', 'the public map is keyed on the NORMALIZED name');
    ck(map['orange money'] === 'data:image/png;base64,BBBB', 'and holds every uploaded logo');
    ck(!('name' in map), 'the public map carries only image data, no display names');
  }).then(() => sandbox.getAllNetworkLogoRows()).then(rows => {
    ck(rows.length === 2, 'the admin list has one row per upload');
    const mtn = rows.find(r => r.key === 'mtn mobile money');
    ck(!!mtn && mtn.name === 'MTN Mobile Money', 'the admin row keeps the ORIGINAL casing/spacing as typed, for display');
  }).then(() => makeDb([]).collection('networkLogos').get()).then(async () => {
    // A broken/empty db must not throw the settings page down -- confirmed
    // by feeding a fresh sandbox no rows at all.
    const emptySandbox = new Function('db', `
      let _networkLogoCache = null, _networkLogoCacheTs = 0;
      ${asyncFnSource(src, 'getAllNetworkLogos')}
      return { getAllNetworkLogos };
    `)(makeDb([]));
    const empty = await emptySandbox.getAllNetworkLogos();
    ck(empty && typeof empty === 'object' && Object.keys(empty).length === 0, 'zero uploads is an empty object, not null/undefined/a throw');
  }).then(runRouteChecks).catch(e => { console.log('FAIL  network-logo storage checks threw: ' + (e && e.message)); process.exit(1); });
}

function runRouteChecks() {
  // ── The routes themselves: owner-only writes, admin-only reads, image
  // validated the same way every other admin-uploaded image is ──
  console.log('\n— routes —');
  {
    const setBody = routeBody('post', '/admin/network-logo/set');
    ck(/verifyOwner\(req\)/.test(setBody), '/admin/network-logo/set requires the owner key, same as the other manual-pay logo slots');
    ck(/NETWORK_LOGO_MAX/.test(setBody), 'the name length is checked against the shared cap');
    ck(/data:image\\\/\(png\|jpe\?g\|webp\|gif\)/.test(setBody), 'the image is validated against the same data: URL shape every other admin image upload uses');
    // Checked on the actual .doc(...) call, not merely that the word
    // "networkLogoKey" appears somewhere in the route -- a mutation that
    // stops USING the normalized key in .doc() while leaving an unrelated
    // `const key = networkLogoKey(name)` line sitting above it would still
    // match a loose "does this text appear anywhere" check.
    ck(/\.doc\(key\)\.set\(/.test(setBody), 'it stores under the NORMALIZED key (the .doc() call itself uses it), not the raw typed name');
    ck(/_networkLogoCacheTs = 0/.test(setBody), 'the cache is invalidated on save, so a fresh upload is visible immediately');

    const clearBody = routeBody('post', '/admin/network-logo/clear');
    ck(/verifyOwner\(req\)/.test(clearBody), '/admin/network-logo/clear requires the owner key too');
    ck(/\.doc\(networkLogoKey\(name\)\)\.delete\(/.test(clearBody), 'clear resolves the SAME normalized key set used, in the .doc() call itself');

    const listBody = routeBody('get', '/admin/network-logos');
    ck(/verifyAdmin\(req\)/.test(listBody), '/admin/network-logos (the admin list) requires an admin session');

    const publicBody = routeBody('get', '/public/network-logos');
    ck(!/verifyAdmin|verifyOwner/.test(publicBody), '/public/network-logos needs no admin session -- every member reads it at boot');
    ck(/publicJson\(/.test(publicBody), 'served through the same cached publicJson() helper as the rest of the manual-pay artwork');
  }

  // /admin/network-logo/set must be in IMAGE_BODY_ROUTES, or an upload would
  // be refused by the body-size limiter meant for JSON, not base64 images.
  {
    const setLine = src.split('\n').find(l => l.includes('const IMAGE_BODY_ROUTES'));
    ck(!!setLine && setLine.includes("/admin/network-logo/set"), "/admin/network-logo/set is registered in IMAGE_BODY_ROUTES");
  }

  runClientChecks();
}

function runClientChecks() {
  console.log('\n— client: networkLogoKeyClient() / networkLogoHtml() —');
  {
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    const STATE = { networkLogos: { 'mtn mobile money': 'data:image/png;base64,AAAA' } };
    const sandbox = new Function('STATE', 'esc', `
      ${fnSource(client, 'networkLogoFallbackHtml')}
      ${fnSource(client, 'networkLogoKeyClient')}
      ${fnSource(client, 'networkLogoHtml')}
      return { networkLogoKeyClient, networkLogoHtml, networkLogoFallbackHtml };
    `)(STATE, esc);

    ck(sandbox.networkLogoKeyClient('MTN Mobile Money') === 'mtn mobile money', 'the client key matches the server key for the same name');
    ck(sandbox.networkLogoHtml('MTN Mobile Money').includes('data:image/png;base64,AAAA'), 'a network WITH an uploaded logo renders that image');
    ck(!sandbox.networkLogoHtml('Orange Money').includes('<img'), 'a network with NO uploaded logo falls back to the letter tile, not a broken <img>');
    ck(sandbox.networkLogoFallbackHtml('Orange Money').includes('>O<'), 'the fallback names the network by its first letter');
    ck(sandbox.networkLogoFallbackHtml('').includes('>?<'), 'an empty/garbage name falls back to a plain placeholder rather than throwing');
  }

  console.log('\n— the deposit tiles are built from regionNetworks(), not a fixed MTN/Airtel pair —');
  {
    ck(!/MTN_LOGO_DATA_URI|AIRTEL_LOGO_DATA_URI/.test(client), 'the two hardcoded base64 logos are gone from the client entirely');
    ck(!/data-method="MTN"/.test(client) && !/data-method="Airtel"/.test(client), 'no tile is hardcoded to a fixed MTN/Airtel value any more');
    const flowFn = fnSource(client, 'openManualPayFlow');
    ck(/regionNetworks\(\)\.map/.test(flowFn), 'openManualPayFlow() builds its tiles by mapping over regionNetworks()');
    ck(/networkLogoHtml\(n\)/.test(flowFn), 'and paints each tile with networkLogoHtml(), not a fixed asset');
  }

  console.log('\n— PAY A now reaches the same network screen, and lands back on the poll screen, never the manual code screen —');
  {
    const confirmFn = windowFnSource(client, 'manualPayConfirm');
    ck(/_depPayChoice === 'A'/.test(confirmFn), "manualPayConfirm() branches on which method was chosen");
    // Inside the PAY-A branch specifically -- not merely present somewhere
    // in the function, which every other assertion in this project has
    // learned the hard way is not the same thing. Sliced to the matching
    // closing brace of the `if` block, not a guessed character count, so it
    // can never spill into PAY B's branch right below it.
    const aBranchStart = confirmFn.indexOf("_depPayChoice === 'A'");
    const ifBodyAt = confirmFn.indexOf('{', aBranchStart);
    let ifDepth = 0, ifEnd = -1;
    for (let k = ifBodyAt; k < confirmFn.length; k++) {
      if (confirmFn[k] === '{') ifDepth++;
      else if (confirmFn[k] === '}') { ifDepth--; if (ifDepth === 0) { ifEnd = k; break; } }
    }
    const aBranch = confirmFn.slice(aBranchStart, ifEnd + 1);
    ck(/\/deposit\/marzpay/.test(aBranch), "PAY A's branch calls /deposit/marzpay, the same automatic-gateway route it always used");
    ck(/closeManualPayOverlay/.test(aBranch), 'and closes the shared network-selector overlay on the way out');
    ck(/openDepositStatusModal/.test(aBranch) && /pollDepositStatus/.test(aBranch), 'landing on the ordinary "Redirecting to payment" poll screen -- never the manual COPY & PAY screen');
    ck(!/deposit\/manual\/init/.test(aBranch), "PAY A's own branch never calls the manual /deposit/manual/init route");

    const phoneCheck = confirmFn.slice(0, aBranchStart);
    ck(/cleanPhone\(raw\)/.test(phoneCheck), 'the phone is validated with the same region-aware cleanPhone() used everywhere else, not a hardcoded Uganda check');
    ck(!/isValidUgandaMobileNumber/.test(client), 'the old Uganda-only sanity check is gone from the file entirely');
  }

  console.log('\n— renderManualPayReminder() shows no reminder for a network it has no template for —');
  {
    function makeEl() {
      const classes = new Set();
      return {
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        style: {},
        innerHTML: '',
      };
    }
    function run(network, settings) {
      const els = { manPayReminderRow: makeEl(), manPayYourAccountLine: makeEl(), manPayReminderBox: makeEl() };
      const STATE = { settings };
      const $ = id => els[id];
      const esc = s => String(s);
      const toLocalPhoneDisplay = s => s;
      const fn = new Function('STATE', '$', 'esc', 'toLocalPhoneDisplay',
        fnSource(client, 'renderManualPayReminder') + '\nreturn renderManualPayReminder;')(STATE, $, esc, toLocalPhoneDisplay);
      fn({ network, assignedNumber: '0700000000', amount: 5000 });
      return els;
    }
    const both = { manualPayReminderMtn: 'MTN steps: {{number}} / {{amount}}', manualPayReminderAirtel: 'Airtel steps: {{number}}' };

    let els = run('MTN Mobile Money', both);
    ck(!els.manPayReminderRow.classList.contains('mp-hidden'), 'MTN Mobile Money shows its own template');
    ck(els.manPayReminderBox.innerHTML.includes('MTN steps'), 'and the MTN text specifically');

    els = run('Airtel Money', both);
    ck(!els.manPayReminderRow.classList.contains('mp-hidden'), 'Airtel Money shows its own template');
    ck(els.manPayReminderBox.innerHTML.includes('Airtel steps'), 'and the Airtel text specifically, never MTN\'s');

    els = run('Orange Money', both);
    ck(els.manPayReminderRow.classList.contains('mp-hidden'), "Orange Money -- a network with NO template of its own -- shows NOTHING, not MTN's reminder");
    ck(els.manPayReminderBox.innerHTML === '', 'the reminder box is left empty for it');
  }

  console.log('\n— a resumed pending manual order keeps its own real network name —');
  {
    const resumeFn = fnSource(client, 'resumeManualPayFlow');
    ck(/_manDepChosenMethod = p\.network;/.test(resumeFn), "resumeManualPayFlow() no longer remaps a saved network through an MTN/Airtel ternary");
  }

  console.log();
  console.log(bad ? `${bad} FAILED` : 'network logos: all cases pass');
  process.exit(bad ? 1 : 0);
}
