#!/usr/bin/env node
/**
 * Manual deposits are human-verified, and the member's message reaches the
 * admin intact.
 *
 * Owner: "the manual payments, ie deposits, this time no use of forwarder sms
 * app, only the sent message from after refresh on manual payment page should
 * appear to admin panel in its full details so as admin verifies manually or
 * rejects."
 *
 * The important assertion here is that an UNPARSEABLE message is still
 * delivered in full. That route used to answer 400 and store nothing, so a
 * real payment whose SMS wording the parser does not recognise disappeared
 * with no way for the member to be paid. It is checked by RUNNING the real
 * handler against a stub database and reading what it wrote -- grepping for
 * the absence of a `return res.status(400)` would prove nothing about what
 * actually lands in the document.
 *
 * Also pinned: the route still never credits, the forwarder cannot credit
 * while manualSmsAutoCredit is off, and the referral link is the bare
 * /refCode= form with a host rewrite to match.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const mod = fs.readFileSync(path.join(HERE, 'user-src', 'original_module.js'), 'utf8');
const render = fs.readFileSync(path.join(HERE, 'render.yaml'), 'utf8');
const admin = fs.readFileSync(path.join(HERE, 'admin-src', 'index.html'), 'utf8');

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const grab = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i === -1 || j === -1 || j <= i) throw new Error(`bad slice anchors: ${a} .. ${b}`);
  return src.slice(i, j);
};
// Pull one named function out by matching its braces, rather than slicing
// between two comment anchors. An anchor that has drifted returns -1 and the
// slice then silently swallows the rest of the file -- which is exactly how
// the first version of this test ended up redeclaring verifyAuth.
function fnSource(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
// Comments stripped before any "does the code do X" check. The paste-sms
// route's own comment explains that it never calls creditDeposit(), and a
// plain scan cannot tell that sentence from a call -- the same self-matching
// trap test-security-hardening.js documents.
// Line comments FIRST -- see the long note on the same helper in
// test-no-snow-branding.js. A line comment containing the characters "/*"
// (a USSD code written as *165#/*185#, say) otherwise opens a block that runs
// to the next real "*/", blanking every line between and taking the checks
// built on this helper blind with it.
const stripComments = s => s
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// ── the real paste-sms handler, on a stub database ──
console.log('— the member\'s message reaches review, whatever it says —');

const handlerBody = grab("app.post('/deposit/manual/paste-sms'", '// 1-minute sweep for manual orders');
check(handlerBody.length > 500, 'found the paste-sms route to run');

// Never credits. This is the invariant the whole flow rests on: the member
// supplies this text, so it can never be allowed to move a balance by itself.
check(!/creditDeposit\s*\(/.test(stripComments(handlerBody)),
  'the route never calls creditDeposit -- a member-supplied message cannot pay anyone');

const ORDER = { userId: 'u1', method: 'manual', status: 'pending', amount: 20000,
                assignedNumber: '0770000001' };
let written = null, replied = null, code = 200;

function run(text, order = ORDER) {
  written = null; replied = null; code = 200;
  const sandbox = {
    verifyAuth: async () => 'u1',
    cleanPhone: null, fmtUGX: null, parseMoMoSms: null, parseSentMoMoSms: null,
    FieldValue: { serverTimestamp: () => '<ts>' },
    console,
    db: { collection: () => ({ doc: () => ({
      get: async () => ({
        exists: !!order,
        data: () => order,
        ref: { update: async p => { written = p; } },
      }),
    }) }) },
  };
  const fn = new Function('sandbox', `
    const { verifyAuth, FieldValue, db, console } = sandbox;
    ${grab('function _smsAmount', 'function parseMoMoSms')}
    ${fnSource('fmtUGX')}
    ${fnSource('cleanPhone')}
    ${fnSource('parseMoMoSms')}
    ${fnSource('parseSentMoMoSms')}
    let handler;
    const app = { post: (_p, h) => { handler = h; } };
    ${handlerBody}
    return handler;
  `)(sandbox);

  const res = {
    status(c) { code = c; return res; },
    json(j) { replied = j; return res; },
  };
  return fn({ body: { depositId: 'dep1', text }, headers: {} }, res)
    .then(() => ({ written, replied, code }));
}

(async () => {
  // 1. A message the parser understands.
  const real = 'You have sent UGX 20,000 to JOHN DOE, 256770000001 on 2026-09-09 10:12:03, '
             + 'fee: 0. Reason: Deposit. New balance: 4,500. ID :302556677001.';
  const a = await run(real);
  check(a.code === 200 && a.written && a.written.status === 'review',
    'a readable payment message queues the order for review');
  check(!!a.written && a.written.pastedSms === real,
    'and stores the message itself, not a summary of it');
  check(!!a.written && a.written.pastedSmsParsed === true, 'flagged as machine-readable');
  check(!!a.written && a.written.pastedSmsAmountMatches === true,
    'with the amount cross-checked against the order');

  // 1b. A REAL operator SMS, which arrives on several lines.
  //
  // Every case here used to be one line, which is why this went unnoticed for
  // a round: the route stored `info.raw`, the parser's working copy with
  // /\s+/g collapsed to single spaces so its patterns can match across breaks.
  // On one-line input the collapsed copy IS the original and every assertion
  // passed, while a real message -- transaction id, balance and fee each on
  // their own line -- reached the admin as one run-on string, with the panel's
  // <pre style="white-space:pre-wrap"> left with nothing to preserve.
  //
  // Owner: "make sure that messages are sent correctly in full to admin panel
  // to approve or reject."
  const multi = 'You have sent UGX 20,000 to KYARIMPA MADRINE, 256791399585.\n'
              + 'Fee: UGX 0\n'
              + 'New balance: UGX 4,500\n'
              + 'Financial Transaction ID: 302556677001.';
  const m = await run(multi);
  check(m.code === 200 && !!m.written, 'a real multi-line operator SMS is accepted');
  check(!!m.written && m.written.pastedSms === multi,
    'and reaches the admin byte for byte, line breaks and all');
  check(!!m.written && (m.written.pastedSms.match(/\n/g) || []).length === 3,
    `its 3 line breaks survive (found ${m.written ? (m.written.pastedSms.match(/\n/g) || []).length : 0})`);
  check(!!m.written && m.written.pastedSmsParsed === true,
    'while still being parsed -- the parser reads across the breaks as before');
  check(!!m.written && m.written.pastedSmsAmount === 20000,
    `and pulls the amount out of it (got ${m.written && m.written.pastedSmsAmount})`);

  // 2. THE ROUND'S POINT: something the parser cannot read at all.
  const junk = 'i have sent the 20000 already from my MTN please check and confirm asap';
  const b = await run(junk);
  check(b.code === 200, `an unreadable message is accepted, not refused (got ${b.code})`);
  check(!!b.written && b.written.status === 'review',
    'it still reaches the admin as Needs Review');
  check(!!b.written && b.written.pastedSms === junk,
    'stored verbatim, exactly as the member typed it');
  check(!!b.written && b.written.pastedSmsParsed === false,
    'and marked as NOT machine-read, so the admin knows to read it themselves');
  check(!!b.written && /could not read/i.test(b.written.reviewReason || ''),
    'the review note says so in words');

  // 3. Empty is still refused -- accepting everything is not the same as
  //    accepting nothing.
  const c = await run('   ');
  check(c.code === 400, `an empty submission is still refused (got ${c.code})`);
  check(c.written === null, 'and writes nothing');

  // 4. A long message is not truncated below what an operator SMS needs.
  const long = 'x'.repeat(1500) + ' ID :302999';
  const d = await run(long);
  check(!!d.written && d.written.pastedSms.length >= 1500,
    `a long message survives (kept ${d.written ? d.written.pastedSms.length : 0} chars)`);

  // ── the forwarder cannot credit on its own ──
  console.log('\n— no use of the forwarder app —');
  check(/manualSmsAutoCredit:\s*false/.test(src),
    'automatic crediting from forwarded SMS defaults to OFF');
  // Comments stripped: the gate's own comment names the setting, so an
  // unstripped scan finds the SENTENCE and reports the gate present even
  // after the code has been removed. Verified by deleting the gate -- this
  // check went green until the strip was added.
  const fwd = stripComments(grab("app.post('/deposit/manual/sms-forwarder'", "app.post('/deposit/manual/paste-sms'"));
  const gateAt = fwd.indexOf('manualSmsAutoCredit');
  const creditAt = fwd.indexOf('await creditDeposit(match)');
  check(gateAt !== -1, 'the forwarder route checks that setting');
  check(gateAt !== -1 && creditAt !== -1 && gateAt < creditAt,
    'and checks it BEFORE crediting, not after');
  check(/status:\s*'review'/.test(fwd.slice(gateAt, creditAt)),
    'a held match is queued for review rather than dropped');
  check(/pastedSms:/.test(fwd.slice(gateAt, creditAt)),
    'with the forwarded message attached, so the admin sees the same evidence');
  // ...and attached UNCOLLAPSED. `info.raw` is the parser's working copy with
  // /\s+/g flattened to single spaces, so storing it costs the admin every
  // line break in the message. The member-paste route is checked by running
  // it (case 1b above); this branch needs a container full of stubs to reach,
  // so it is pinned at the source instead -- comments already stripped, and
  // scoped to the held-for-review branch rather than the whole file.
  const fwdWrite = fwd.slice(gateAt, creditAt);
  const fwdPasted = (fwdWrite.match(/pastedSms:\s*([^\n]*)/) || [])[1] || '';
  check(!/\binfo\.raw\b/.test(fwdPasted.replace(/\|\|[\s\S]*$/, '')),
    `the forwarded message is stored as it arrived, not the parser's flattened copy  --  ${fwdPasted.trim()}`);
  check(/slice\(0,\s*2000\)/.test(fwdPasted),
    'and capped, like the paste route -- this one arrives from an app, not a form');

  // ── the admin panel actually shows it ──
  console.log('\n— the admin panel shows the message in full —');
  check(/pastedSms/.test(admin), 'the deposits table renders the pasted message');
  check(/white-space:pre-wrap/.test(admin),
    'as pre-wrapped text, so line breaks in an SMS survive');
  check(!/pastedSms[^\n]*slice\(/.test(admin),
    'and is not truncated -- the transaction id sits at the END of an operator SMS');
  check(/esc\(d\.pastedSms\)/.test(admin),
    'escaped: it is member-supplied text going into innerHTML');
  check(/data-mreject/.test(admin) && /data-force/.test(admin),
    'with both Approve and Reject available on a review row');

  // ── the referral link ──
  console.log('\n— the invite link is /refCode= and nothing else —');
  const linkLine = (mod.match(/const link = code \?[^\n]*/) || [''])[0];
  check(/\/refCode=\$\{encodeURIComponent\(code\)\}/.test(linkLine),
    `the link is <origin>/refCode=<code>  --  ${linkLine.trim()}`);
  check(!/#pages\/register/.test(linkLine) && !/\?ref=/.test(linkLine),
    'with none of the older wording left in it');
  check(/\/refCode=\(\[\^\/\?#\]\+\)/.test(mod),
    'and the app reads that code back off the path');
  // Links already sent to real people must keep working.
  check(/search\.get\('ref'\)/.test(mod), 'the old ?ref= form still works');
  check(/location\.hash/.test(mod), 'and the old #...?ref= form still works');

  check(/type:\s*rewrite/.test(render) && /source:\s*\/refCode=\*/.test(render),
    'the host rewrites /refCode=* to index.html, or every invite would 404');
  check(!/source:\s*\/\*\s*$/m.test(render),
    'and it is scoped to that path, not a blanket /* rewrite');

  console.log(failed ? `\n${failed} FAILED` : '\nmanual review + refCode: all cases pass');
  process.exit(failed ? 1 : 0);
})();
