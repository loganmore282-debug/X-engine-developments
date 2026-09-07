#!/usr/bin/env python3
"""The banner video must survive being loaded from a DIFFERENT SITE.

This is the bug the owner hit: he uploaded a video and Home showed nothing.

server.js sets `Cross-Origin-Resource-Policy: same-site` globally (helmet), and
`chipz-app.onrender.com` / `chipz-server.onrender.com` LOOK same-site but are
not: onrender.com is on the Public Suffix List, so every *.onrender.com is its
own registrable domain. A <video src> is a no-cors subresource load, so CORP
gates it -- and the browser dropped the response with
ERR_BLOCKED_BY_RESPONSE.NotSameSite, silently. The <video> fired `error`, the
app's own fallback swapped in the striped hero, and nothing anywhere said why.

API calls never showed the problem because CORP does not gate CORS-mode
fetches. The banner video is the app's only cross-origin subresource, so it
was the first and only thing to break.

The test loads a page from `localhost` pointing at a video on `127.0.0.1` --
different sites, exactly like the two Render subdomains -- serving it with the
headers PARSED OUT OF server.js's real route, so if that route ever loses the
CORP header again this fails. It also asserts the same-site header genuinely
blocks playback, so the passing case cannot be vacuous.
"""
import asyncio, base64, http.server, os, re, socketserver, sys, threading

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
VID_PORT, PAGE_PORT = 8871, 8872

fails = []
def ck(ok, l):
    print(("PASS  " if ok else "FAIL  ") + l)
    if not ok: fails.append(l)

# ── the headers the real route sets ──────────────────────────────────────
src = open(os.path.join(HERE, 'server.js'), encoding='utf8').read()
route = src[src.index("app.get('/public/banner-video'"):src.index("app.get('/public/help-banner'")]
ROUTE_HEADERS = dict(re.findall(r"res\.set\('([A-Za-z-]+)', '([^']+)'\)", route))
print('headers server.js sets on /public/banner-video:')
for k, v in ROUTE_HEADERS.items(): print('   %-32s %s' % (k, v))

corp = ROUTE_HEADERS.get('Cross-Origin-Resource-Policy')
ck(corp == 'cross-origin',
   'the route sets Cross-Origin-Resource-Policy: cross-origin (got %r)' % corp)
# And confirm the global default it is opting out of is still the strict one --
# if that ever loosens, this route's override stops being load-bearing and the
# comment on it would be misleading.
ck("crossOriginResourcePolicy: { policy: 'same-site' }" in src,
   'the global helmet policy is still the strict same-site (this route is the exception)')

STATE = {}

class VidHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = STATE['bytes']
        self.send_response(200)
        for k, v in STATE['headers'].items():
            if k in ('Content-Length', 'Content-Range'): continue
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

PAGE = """<!doctype html><meta charset=utf-8><body style="margin:0;background:#111">
<video id=v src="http://127.0.0.1:__PORT__/public/banner-video?v=__CASE__" autoplay muted loop playsinline
       preload="auto" style="width:320px;height:180px;object-fit:cover"></video>
<script>
  window.__err = null; window.__ok = false;
  var v = document.getElementById('v');
  v.addEventListener('error', function(){ window.__err = v.error && v.error.message; });
  v.addEventListener('playing', function(){ window.__ok = true; });
</script></body>"""

class PageHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        case = self.path.split('case=')[-1] if 'case=' in self.path else '0'
        b = PAGE.replace('__PORT__', str(VID_PORT)).replace('__CASE__', case).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

def start(handler, port):
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(('127.0.0.1', port), handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

MAKE_VIDEO = """async () => {
  const c = document.createElement('canvas'); c.width=320; c.height=180;
  const g = c.getContext('2d'); let i=0;
  const draw=()=>{g.fillStyle=['#e21b2a','#ff8a1f','#111'][i++%3];g.fillRect(0,0,320,180);};
  draw();
  const chunks=[]; const rec=new MediaRecorder(c.captureStream(25),{mimeType:'video/webm'});
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.start(); const t=setInterval(draw,40);
  await new Promise(r=>setTimeout(r,1200)); clearInterval(t);
  await new Promise(r=>{rec.onstop=r;rec.stop();});
  const buf=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());
  let s=''; for(const b of buf) s+=String.fromCharCode(b);
  return btoa(s);
}"""

# Each case gets its OWN browser context and its own ?v= value. Without that
# the first (allowed) load populates the HTTP cache -- and the route sends
# `immutable` for a year -- so the next case replays from cache and never
# revalidates CORP at all. The first version of this test did exactly that
# and reported the blocked case as passing.
_case = [0]
async def try_load(browser, headers):
    STATE['headers'] = headers
    _case[0] += 1
    ctx = await browser.new_context()
    pg = await ctx.new_page()
    blocked = []
    pg.on('console', lambda m: blocked.append(m.text))
    # localhost -> 127.0.0.1 is cross-SITE, the same relationship as
    # chipz-app.onrender.com -> chipz-server.onrender.com.
    await pg.goto('http://localhost:%d/?case=%d' % (PAGE_PORT, _case[0]), wait_until='load')
    await pg.wait_for_timeout(2500)
    r = await pg.evaluate("""() => { const v = document.getElementById('v');
        return { ok: window.__ok, err: window.__err, readyState: v.readyState,
                 t: v.currentTime, paused: v.paused }; }""")
    r['console'] = [m for m in blocked if 'BLOCKED' in m or 'Failed to load' in m]
    await pg.close(); await ctx.close()
    return r

async def main():
    start(VidHandler, VID_PORT)
    start(PageHandler, PAGE_PORT)
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        maker_ctx = await b.new_context()
        maker = await maker_ctx.new_page(); await maker.goto('about:blank')
        STATE['bytes'] = base64.b64decode(await maker.evaluate(MAKE_VIDEO))
        await maker.close(); await maker_ctx.close()
        ck(len(STATE['bytes']) > 1000, 'recorded a real webm (%d bytes)' % len(STATE['bytes']))

        print('\n— with the headers server.js actually sets —')
        good = await try_load(b, ROUTE_HEADERS)
        print('  ', good)
        ck(good['ok'] and not good['paused'], 'the video plays across sites')
        ck(good['readyState'] >= 3, 'it decoded (readyState %s)' % good['readyState'])
        ck(not good['err'], 'no media error (%s)' % good['err'])
        ck(not good['console'], 'nothing was blocked (%s)' % good['console'])

        # The passing case above means nothing unless the strict header really
        # does break it -- this is what the owner was actually seeing.
        print('\n— and the old same-site header really is what broke it —')
        strict = dict(ROUTE_HEADERS, **{'Cross-Origin-Resource-Policy': 'same-site'})
        bad = await try_load(b, strict)
        print('  ', bad)
        ck(not bad['ok'] and bad['paused'], 'same-site blocks it, silently')
        ck(any('NotSameSite' in m for m in bad['console']),
           'and the browser reason is NotSameSite (%s)' % bad['console'])

        # An ABSENT CORP header is not enforced at all -- which is exactly why
        # this bug was helmet's doing rather than the route's: the route never
        # set one, so it inherited the global same-site. Pinned here so the
        # reason stays on record: the fix had to be an explicit override, not
        # "just don't set a header".
        print('\n— an absent header is unenforced (helmet is what set one) —')
        none_hdr = {k: v for k, v in ROUTE_HEADERS.items() if k != 'Cross-Origin-Resource-Policy'}
        gone = await try_load(b, none_hdr)
        print('  ', gone)
        ck(gone['ok'], 'no CORP header is unrestricted -- so the global helmet one was the cause')

        await b.close()

    print()
    if fails:
        print('%d FAILED' % len(fails)); sys.exit(1)
    print('banner video cross-site: all cases pass')

asyncio.run(main())
