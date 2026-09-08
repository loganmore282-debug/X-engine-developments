// No Snow branding may reach a member.
//
// Owner: "it could be better if you remove old images of previews of Snow,
// remove them." Chipz is a fork of Snow, so inherited wording is not a
// hypothetical -- the referral share text still read "Join Snow and start
// earning", which meant every referral any member had ever sent invited
// people to a different product, and the About sheet was titled "About Snow".
//
// The fork is also why this needs to be a standing check rather than a
// one-off cleanup: every screen carried over from Snow arrives with Snow's
// words in it, and the ones that matter are exactly the ones nobody reads
// twice -- a share message, a sheet title, a toast.
//
// What this does NOT flag, deliberately:
//   * comments -- they document what Chipz changed and why, and CLAUDE.md
//     depends on them;
//   * the --snow-* CSS design tokens, which are a documented value-only
//     swap: the whole app reskins by changing what they hold, and renaming
//     ~250 of them would be churn with no visible effect;
//   * the snow_* storage keys and the snow-auth event name -- internal
//     identifiers no member ever sees. Renaming a cache key would silently
//     orphan every phone's cached state for nothing.
// So this is scoped to what a person can actually READ on a screen.
const fs = require('fs');

const FILES = ['user-src/original_module.js', 'user-src/index.html', 'admin-src/index.html', 'server.js'];

// Internal identifiers, allowed to keep the inherited name.
const ALLOWED = [
  /--snow-[a-z-]+/g,          // CSS design tokens
  /var\(--snow[a-z-]*\)/g,
  /snow_[a-z_]+/g,            // localStorage keys
  /'snow-auth'/g, /"snow-auth"/g,
];

// Strip block comments, then line comments -- but only a `//` that starts a
// line or follows whitespace, so a "https://..." inside a string survives
// and is still searched.
//
// A block comment is BLANKED rather than deleted, keeping its newlines, so
// the line numbers this reports still match the real file. Deleting them
// outright shifted every later line and pointed the first run of this test
// at an innocent CSS rule 400 lines away from the actual hit.
function stripComments(src) {
  const blank = m => m.replace(/[^\n]/g, ' ');
  return src.replace(/<!--[\s\S]*?-->/g, blank)   // two of the four files are HTML
            .replace(/\/\*[\s\S]*?\*\//g, blank)
            .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

console.log('— no reader-visible "Snow" left in the sources —');
let hits = 0;
for (const f of FILES) {
  const src = fs.readFileSync(__dirname + '/' + f, 'utf8');
  const lines = stripComments(src).split('\n');
  lines.forEach((line, i) => {
    let code = line;
    for (const re of ALLOWED) code = code.replace(re, '');
    if (/snow/i.test(code)) {
      hits++;
      console.log(`      ${f}:${i + 1}  ${code.trim().slice(0, 130)}`);
    }
  });
}
ck(hits === 0, `${FILES.length} source files carry no leftover Snow wording (${hits} hit${hits === 1 ? '' : 's'})`);

// The two that were actually wrong, pinned by name so a revert is loud.
console.log('\n— the two that were live —');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
// The referral invite SENTENCE is gone with shareReferral() -- the owner
// asked for copy, not share, so the button now copies the bare link and no
// product name travels into WhatsApp at all. That removes the worst place
// this could regress rather than fixing it.
ck(!/shareReferral/.test(stripComments(mod)),
   'shareReferral, which carried the "Join Snow" sentence, no longer exists');
ck(!/Join Snow/.test(stripComments(mod)), 'and no "Join Snow" anywhere');
// The About sheet's title used to be the literal 'About Chipz'. It is now
// built from the admin-set app name, which is the stronger property: it
// cannot go stale when the owner renames the platform, and the fallback
// inside brandName() means it still reads "About Chipz" out of the box. So
// what is checked here is that it is BUILT from the name, and -- separately
// -- that nothing in the file spells a platform name out by hand any more.
ck(/openSheet\('About ' \+ brandName\(\)/.test(mod),
   'the About sheet title is built from the admin-set app name');
ck(/function brandName\(\)/.test(mod) && /return n \|\| 'Chipz'/.test(mod),
   "and brandName() still falls back to 'Chipz' when nothing is set");
// No hardcoded name left anywhere in the module's actual CODE. Comments are
// stripped first: this file's own explanations say "Chipz" constantly, and
// an assertion that matched them would fail for a reason that has nothing to
// do with the shipped app. The two allowed hits are brandName()'s fallback
// and the same fallback inside brandTextMark()'s caller chain.
{
  const code = stripComments(mod);
  const hits = (code.match(/'Chipz'|"Chipz"|Chipz /g) || []);
  ck(hits.length <= 1,
     `the module hardcodes the app name at most once -- brandName()'s own fallback (${hits.length} hit${hits.length === 1 ? '' : 's'}: ${hits.join(', ') || 'none'})`);
  ck(!/CHIPZ/.test(code.replace(/chipz-grad|chipzMarkHtml|chipz-images|chipz-image/g, '')),
     'and no CHIPZ wordmark literal survives -- the mark is rendered from the name');
}
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
ck(!/snowflake mark/.test(stripComments(admin)),
   'the admin no longer offers to revert to "the snowflake mark"');
ck((admin.match(/Reverted to the CHIPZ wordmark/g) || []).length === 2,
   'both manual-pay slots say they revert to the CHIPZ wordmark');

// The allowlist is a deliberate carve-out, so it should still be TRUE that
// those names exist -- if they were all renamed, this file's exceptions are
// dead weight and someone should delete them rather than leave them looking
// like they still protect something.
console.log('\n— the carve-outs are still real —');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
ck(/--snow-canvas/.test(html), 'the --snow-* design tokens are still the token names in use');
ck(/snow_state_cache/.test(mod), 'and snow_state_cache is still the storage key');

// The checks above read the SOURCE. What ships is user/index.html, with the
// logic obfuscated, deflated and base64'd inside <script data-nx-core>.
//
// This can confirm the payload is a real, inflatable build -- but NOT what
// wording it contains: the obfuscator replaces every string literal with a
// lookup into an encoded string array, so "Join Chipz" is simply not present
// as text at any layer. A first attempt asserted it was, and the assertion
// that mattered ("no Join Snow left") passed vacuously against an empty
// string while its neighbours failed.
//
// The shipped WORDING is therefore checked where the built app actually
// runs -- see the Snow-branding block at the end of test-nav-sheets.py,
// which reads the rendered text of four real screens out of the built
// bundle. That also catches the failure this section was reaching for:
// a source fixed but never rebuilt.
console.log('\n— the deployed build is a real, inflatable payload —');
const zlib = require('zlib');
const built = fs.readFileSync(__dirname + '/user/index.html', 'utf8');
const m = /<script data-nx-core>([\s\S]*?)<\/script>/.exec(built);
ck(!!m, 'user/index.html carries a data-nx-core payload');
let core = '';
if (m) {
  // The loader holds the payload as the argument to atob("...").
  const b64 = (m[1].match(/atob\("([A-Za-z0-9+/=]+)"\)/) || [])[1];
  ck(!!b64, 'with a base64 blob inside it');
  if (b64) {
    try { core = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8'); }
    catch (e) { ck(false, 'the payload inflates: ' + e.message); }
  }
}
ck(core.length > 100000, `the built payload inflates to real code (${core.length} chars)`);
// Proof that the string literals really are unreadable here, so nobody
// later adds a grep against this payload and gets a hollow pass from it.
ck(!/Join Chipz/.test(core) && !/About Chipz/.test(core),
   'and its string literals are encoded — wording cannot be grepped from it, ' +
   'which is why the shipped wording is checked in test-nav-sheets.py instead');

console.log(bad ? `\n${bad} FAILED` : '\nno snow branding: all cases pass');
process.exit(bad ? 1 : 0);
