// The installed app's NAME comes from the backend.
//
// Owner: "let's not make chipz to be default name, let's make it to be backend
// such that the set name abides every functions except others like api,
// callback curls but system visuals should be backend."
//
// manifest.json's `name` is what Android prints under the installed icon and
// what Chrome's "Install app" sheet shows. It is a static file on a static
// host, so renaming the app in the admin panel changed every screen and left
// that one alone -- which is the screenshot he sent. The service worker now
// rewrites it from the live setting.
//
// This runs sw.js for real, in a vm with the browser objects it expects
// stubbed. Testing it through Playwright is not an option: every Playwright
// test in this repo runs with service_workers="block", precisely because an
// unblocked worker intercepts the stubbed API calls and every other test goes
// dark. So the worker is exercised directly instead, which also makes the
// failure modes (backend down, malformed JSON, cold cache) reachable, and
// those are the ones that matter -- a phone that cannot install the app is
// far worse than one that installs it under last week's name.
const fs = require('fs');
const vm = require('vm');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

const SW_SRC = fs.readFileSync(__dirname + '/user/sw.js', 'utf8');
const SHIPPED = JSON.parse(fs.readFileSync(__dirname + '/user/manifest.json', 'utf8'));

// ── a small slice of the browser ──
class FakeResponse {
  constructor(body, init) {
    this._body = typeof body === 'string' ? body : JSON.stringify(body);
    this.status = (init && init.status) || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Map(Object.entries((init && init.headers) || {}));
  }
  clone() { const r = new FakeResponse(this._body); r.status = this.status; r.ok = this.ok; r.headers = this.headers; return r; }
  async text() { return this._body; }
  async json() { return JSON.parse(this._body); }
}

function makeEnv({ settingsName, settingsFails, manifestBody, manifestFails, seeded }) {
  const store = new Map();          // cacheName -> Map(key -> Response)
  if (seeded) store.set('chipz-brand-v1', new Map([['/__brand-name', new FakeResponse(seeded)]]));
  const calls = { settings: 0, manifest: 0 };
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return {
        async match(k) { return m.get(k) || undefined; },
        async put(k, v) { m.set(k, v); },
        async addAll() {},
      };
    },
    async match(k) {
      for (const m of store.values()) if (m.has(k)) return m.get(k);
      return undefined;
    },
    async keys() { return [...store.keys()]; },
    async delete() { return true; },
  };
  const fetch = async (req) => {
    const url = typeof req === 'string' ? req : req.url;
    if (url.indexOf('/public/settings') !== -1) {
      calls.settings++;
      if (settingsFails) throw new Error('offline');
      return new FakeResponse({ status: 'success', settings: settingsName == null ? {} : { brandName: settingsName } });
    }
    calls.manifest++;
    if (manifestFails) throw new Error('offline');
    return new FakeResponse(manifestBody === undefined ? JSON.stringify(SHIPPED) : manifestBody);
  };
  const ctx = {
    self: { addEventListener() {}, location: { origin: 'https://chipz-app.onrender.com' }, skipWaiting() {}, clients: { claim() {} } },
    caches, fetch, Response: FakeResponse, URL,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SW_SRC, ctx);
  return { ctx, calls, store };
}

const REQ = { url: 'https://chipz-app.onrender.com/manifest.json' };

(async () => {
  console.log('— the shipped manifest is the starting point —');
  ck(typeof SHIPPED.name === 'string' && SHIPPED.name.length > 0,
     `user/manifest.json ships a name (${SHIPPED.name})`);
  ck(Array.isArray(SHIPPED.icons) && SHIPPED.icons.length >= 2,
     'and the icons that must survive being rewritten');

  console.log('\n— a renamed app installs under its new name —');
  {
    const { ctx, calls } = makeEnv({ settingsName: 'Voltrix' });
    const out = await ctx.brandedManifest(REQ);
    const json = JSON.parse(await out.text());
    ck(json.name === 'Voltrix', `name comes from the backend (${json.name})`);
    ck(json.short_name === 'Voltrix', `and so does short_name (${json.short_name})`);
    // Everything else must be byte-for-byte what shipped. This is the failure
    // that would be invisible until someone tried to install: a manifest with
    // the right name and no icons still installs, just blank.
    ck(JSON.stringify(json.icons) === JSON.stringify(SHIPPED.icons),
       'the icons are untouched');
    for (const k of ['start_url', 'scope', 'display', 'background_color', 'theme_color']) {
      ck(json[k] === SHIPPED[k], `${k} is untouched (${json[k]})`);
    }
    // The description carries the name inside a sentence.
    ck(json.description.indexOf('Voltrix') === 0 && json.description.indexOf(SHIPPED.name) === -1,
       `the description follows the name too (${json.description})`);
    ck(calls.settings === 1, 'the backend was asked exactly once');
    ck(String(out.headers.get('Content-Type')).indexOf('manifest') !== -1,
       'served as a manifest content type');
  }

  console.log('\n— the name is remembered, and served without waiting —');
  {
    // A manifest fetch happens while Chrome decides whether to offer an
    // install prompt. Blocking that on a cold Render backend is how the
    // prompt never appears at all, so a known name is served immediately and
    // the refresh happens behind it.
    const { ctx, calls } = makeEnv({ settingsName: 'Later', seeded: 'Voltrix' });
    const out = await ctx.brandedManifest(REQ);
    const json = JSON.parse(await out.text());
    ck(json.name === 'Voltrix', `the remembered name is used (${json.name})`);
    // ...and the fresher one is stored for next time rather than dropped.
    await new Promise(r => setTimeout(r, 10));
    const again = await ctx.brandedManifest(REQ);
    ck(JSON.parse(await again.text()).name === 'Later',
       'while the newer name lands on the next read');
    ck(calls.settings >= 1, 'the refresh really did run in the background');
  }

  console.log('\n— every failure falls back to the file as shipped —');
  {
    // Backend unreachable, nothing remembered.
    const { ctx } = makeEnv({ settingsFails: true });
    const json = JSON.parse(await (await ctx.brandedManifest(REQ)).text());
    ck(json.name === SHIPPED.name,
       `offline backend installs under the shipped name, not a blank (${json.name})`);
    ck(JSON.stringify(json.icons) === JSON.stringify(SHIPPED.icons), 'with its icons intact');
  }
  {
    // Backend up but the setting is missing entirely.
    const { ctx } = makeEnv({ settingsName: null });
    const json = JSON.parse(await (await ctx.brandedManifest(REQ)).text());
    ck(json.name === SHIPPED.name, 'an unset name changes nothing');
  }
  {
    // The manifest itself came back as something that is not JSON -- e.g. a
    // captive-portal HTML page, which is a real thing on hotel/campus wifi.
    const { ctx } = makeEnv({ settingsName: 'Voltrix', manifestBody: '<html>nope</html>' });
    const out = await ctx.brandedManifest(REQ);
    ck((await out.text()) === '<html>nope</html>',
       'a non-JSON manifest is passed through untouched rather than throwing');
  }
  {
    // Network gone for BOTH, with the shell precache holding the file.
    const env = makeEnv({ settingsFails: true, manifestFails: true });
    (await env.ctx.caches.open('chipz-shell-v50')).put('/manifest.json', new FakeResponse(JSON.stringify(SHIPPED)));
    const json = JSON.parse(await (await env.ctx.brandedManifest(REQ)).text());
    ck(json.name === SHIPPED.name, 'fully offline, it falls back to the precached copy');
  }

  console.log('\n— wired into the worker, in the right order —');
  // /manifest.json is in SHELL, so the cache-first branch would serve the
  // file as shipped and this whole feature would be dead code. Order is the
  // entire correctness argument here, and it is not visible from behaviour.
  const iManifest = SW_SRC.indexOf("reqUrl.pathname === '/manifest.json'");
  const iNavigate = SW_SRC.indexOf("e.request.mode === 'navigate'");
  const iCacheFirst = SW_SRC.lastIndexOf('caches.match(e.request).then(cached => cached ||');
  ck(iManifest > 0, 'the fetch handler intercepts /manifest.json');
  ck(iManifest < iNavigate && iManifest < iCacheFirst,
     'BEFORE the navigate and cache-first branches, or the shell copy would win');
  // The brand cache holds a live setting, not a build artefact, so the
  // activate sweep must spare it -- otherwise every deploy forgets the name
  // and the first manifest read after it blocks on the backend again.
  ck(/k !== BRAND_CACHE/.test(SW_SRC),
     'and activate() does not sweep the remembered name away on every deploy');

  console.log(bad ? `\n${bad} FAILED` : '\nbranded manifest: all cases pass');
  process.exit(bad ? 1 : 0);
})();
