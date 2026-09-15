#!/usr/bin/env python3
"""Dump the exact BLOCK KEYS the admin panel's translator will look up.

Why this exists rather than reading them out of the sweep's report: the sweep
renders in a target language, so by the time it reads a block the per-node
pass has already translated the single words inside it -- `<b>Settings</b>`
has become `<b>Mipangilio</b>` -- and the flattened text is a Swahili/English
hybrid that is NOT the key. Writing rows against those would produce rows that
can never match.

Rendered in ENGLISH, nothing is translated, so what a qualifying block
flattens to IS the key. The "does this block qualify" test is the ENGINE'S
OWN (window.__i18nBlockOk), for the same reason the sweeps use it: a copy of
that rule here would drift and quietly send you off writing rows for
sentences the engine never forms.

Run:  python3 dump-admin-blocks.py [out.json]
"""
import asyncio, functools, http.server, json, os, socketserver, sys, threading

from playwright.async_api import async_playwright
from find_admin_fixtures import R, API  # R is the route table, API the origin

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'admin')
PORT = 8907                      # its own port; see CLAUDE.md's running list
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'admin-block-keys.json')

DUMP = """() => {
  const ok = window.__i18nBlockOk;
  const maxLen = window.__i18nMaxLen ? window.__i18nMaxLen() : 160;
  if (!ok) return null;
  const out = [];
  const vis = el => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  for (const el of document.querySelectorAll('p,li,div,span,td,th,label,h1,h2,h3,h4,small')) {
    if (el.closest('[data-no-i18n]')) continue;
    if (!ok(el) || !vis(el)) continue;
    const t = String(el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t && t.length <= maxLen) out.push(t);
  }
  return out;
}"""


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    class Q(socketserver.TCPServer):
        allow_reuse_address = True
        def handle_error(self, *a): pass
    srv = Q(('127.0.0.1', PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


TABS = ['dashboard', 'analytics', 'users', 'deposits', 'withdrawals', 'transactions',
        'referrals', 'products', 'promocodes', 'messages', 'settings', 'regions',
        'admins', 'auditlog']


async def main():
    srv = serve()
    keys, notes = [], []
    async with async_playwright() as pw:
        # The container ships Chromium here; never run "playwright install".
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(service_workers='block')
        page = await ctx.new_page()

        async def api(r):
            path = '/' + r.request.url.split('://', 1)[-1].split('/', 1)[-1].split('?')[0]
            body = next((v for k, v in R.items() if path.endswith(k)), {'status': 'success'})
            await r.fulfill(status=200, content_type='application/json', body=json.dumps(body))
        await page.route(f'{API}/**', api)
        # English: nothing is translated, so a block flattens to its own key.
        await page.add_init_script(
            "try{localStorage.setItem('chipz_admin_lang','en');}catch(e){}")
        await page.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='load')
        await page.wait_for_timeout(900)
        try:
            await page.fill('#loginKey', 'k')
            await page.click('#loginBtn')
            await page.wait_for_timeout(1500)
        except Exception as e:
            notes.append(f'sign-in: {e}')
        for tab in TABS:
            try:
                await page.click(f'button[data-tab="{tab}"]')
                await page.wait_for_timeout(1100)
                got = await page.evaluate(DUMP)
                if got is None:
                    notes.append('window.__i18nBlockOk is missing -- is the panel built?')
                    break
                keys += got
            except Exception as e:
                notes.append(f'{tab}: {e}')
        await b.close()
    srv.shutdown()
    keys = list(dict.fromkeys(keys))
    json.dump({'keys': keys, 'notes': notes}, open(OUT, 'w', encoding='utf8'),
              indent=1, ensure_ascii=False)
    print(f'{len(keys)} block key(s) -> {OUT}')
    for n in notes:
        print('  note:', n)


asyncio.run(main())
