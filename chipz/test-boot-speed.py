#!/usr/bin/env python3
"""What actually makes the app slow to open, measured rather than guessed.

Owner: "l also need faster loading and faster changing of the subdomain
rations" (rotations).

Four questions, each measured with the tool that can actually see it -- which
took two false starts to get right (see the note at the end):

1. WHAT THE LOADING SCREEN WAITS FOR -- against the real built app with
   page.route, counting every request made before #app appears and the bytes
   each answer carries. The heavy ones are the admin-uploaded images: they
   travel as base64 data: URLs inside JSON, and /public/chipz-images alone
   carries SEVEN slots.

2. THE INVITE ADDRESS -- it must change between opens of the Referral screen
   and, after the first, cost no request at all.

3. WHETHER A PLAIN READ COSTS TWO ROUND TRIPS -- `Content-Type:
   application/json` is not a CORS-safelisted header, so sending it on a GET
   turns a simple request into a preflighted one: an OPTIONS before every
   call. Preflights are INVISIBLE to page.route and to Playwright's request
   events (the browser issues them below that layer), so this is measured
   against a REAL local HTTP server on its own origin, counting methods
   server-side.

4. WHETHER A SECOND OPEN RE-DOWNLOADS THE ARTWORK -- an ETag turns ~1 MB of
   JSON into a 304. page.route cannot show this either: a fulfilled route
   never enters the browser's HTTP cache. Same real server.

Questions 3 and 4 use a MINIMAL page that reproduces api()'s own request
shape rather than the 300 KB obfuscated bundle. Two earlier versions tried to
point the real app at the local server by rewriting its fetch: the page's own
CSP blocked the stub origin (fixable), and then every response write died
with a broken pipe while the app itself reported no error and sat on its
loading screen. The bundle is not what those two questions are about, and a
harness that cannot explain its own failure is measuring nothing -- so the
request SHAPE is asserted against the source in test-regions.js, and the
browser behaviour it produces is measured here on a page small enough to be
certain about.

Ports 8893 (static app) and 8895 (stub API) -- see CLAUDE.md's port list.
"""
import asyncio
import functools
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from playwright.async_api import async_playwright  # noqa: E402

APP_PORT = 8893
API_PORT = 8895
APP_ORIGIN = f'http://127.0.0.1:{APP_PORT}'
API_ORIGIN = f'http://localhost:{API_PORT}'
API = 'https://chipz-server.onrender.com'

failed = 0


def ck(cond, label):
    global failed
    print(('PASS  ' if cond else 'FAIL  ') + label)
    if not cond:
        failed += 1


def data_url(kb):
    """A stand-in for one admin-uploaded image, at a realistic size."""
    return 'data:image/jpeg;base64,' + ('A' * (kb * 1024))


# Roughly what the real slots hold once the owner has uploaded his artwork.
IMAGE_SLOTS = {
    'referral': 120, 'logo': 40, 'spin': 120, 'profilegif': 90,
    'downloadbg': 260, 'authhero': 150, 'authcard': 120,
}

REGION = {'key': 'ug', 'name': 'Uganda', 'currency': 'UGX', 'dialCode': '256',
          'localLength': 9, 'prefixes': ['7'], 'utcOffsetMin': 180, 'usesBareLocal': True}

# Held back in the boot run to see what the loader really waits for.
HEAVY = {'/public/chipz-images', '/public/manual-pay-images', '/public/announcement-image'}
HEAVY_DELAY = 3.0

HOSTS = ['g26e.example.test', 'b5dh.example.test', 't3gs.example.test', 'x7k2.example.test']


def payloads():
    return {
        '/public/settings': {'status': 'success', 'settings': {'brandName': 'Chipz'},
                             'regionCount': 1, 'region': REGION, 'referralRequired': True},
        '/public/products': {'status': 'success', 'products': []},
        '/public/activity-feed': {'status': 'success', 'feed': []},
        '/public/banner': {'status': 'success', 'image': data_url(150)},
        '/public/announcement-image': {'status': 'success', 'image': data_url(90)},
        '/public/manual-pay-images': {'status': 'success', 'selector': data_url(70),
                                      'hero': data_url(70)},
        '/public/chipz-images': dict({'status': 'success'},
                                     **{k: data_url(v) for k, v in IMAGE_SLOTS.items()}),
        '/public/entry': {'status': 'success', 'rotate': False, 'mode': 'off', 'host': ''},
        # `hosts` is the pool this round adds; `host` stays for a bundle that
        # has not been rebuilt yet.
        '/public/share-host': {'status': 'success', 'host': HOSTS[0], 'count': len(HOSTS),
                               'hosts': HOSTS},
        '/account': {'status': 'success', 'region': REGION,
                     'account': {'walletBalance': 1000, 'publicId': '00001',
                                 'phone': '0712345678', 'referralCode': 'RC1',
                                 'status': 'active'}},
        '/investments': {'status': 'success', 'investments': []},
        '/team/stats': {'status': 'success', 'referralCode': 'RC1',
                        'teamL1Count': 0, 'teamL2Count': 0, 'teamL3Count': 0},
        '/bank/list': {'status': 'success', 'accounts': []},
        '/transactions': {'status': 'success', 'transactions': []},
        '/messages': {'status': 'success', 'messages': []},
        '/turntable/status': {'status': 'success', 'spins': 0, 'enabled': False},
    }


# ── the real HTTP server, for the two questions a stubbed route cannot answer ──
class ApiHandler(http.server.BaseHTTPRequestHandler):
    # HTTP/1.1, and that is load-bearing: BaseHTTPRequestHandler defaults to
    # HTTP/1.0, and Chromium will not revalidate an HTTP/1.0 response at all.
    # The first version of this harness reported "no 304" against a perfectly
    # good ETag for exactly that reason -- a stub that speaks 1.0 cannot test
    # HTTP caching.
    protocol_version = 'HTTP/1.1'
    log = None          # [(method, path)]
    bytes_out = None    # {path: bytes actually sent}

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin') or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Max-Age', '86400')

    def do_OPTIONS(self):
        ApiHandler.log.append(('OPTIONS', self.path.split('?')[0]))
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        ApiHandler.log.append((self.command, path))
        raw = json.dumps(payloads().get(path, {'status': 'success'})).encode()
        etag = '"stub-' + str(abs(hash(path)) % 10 ** 8) + '"'
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self._cors()
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('ETag', etag)
        # "ask every time, but a 304 is enough" -- the bytes go away without
        # an upload ever going unnoticed, which a max-age would risk.
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except Exception:
            return
        ApiHandler.bytes_out[path] = ApiHandler.bytes_out.get(path, 0) + len(raw)

    def log_message(self, *a):
        pass


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class QuietStatic(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve_static(directory, port):
    handler = functools.partial(QuietStatic, directory=directory)
    httpd = Threaded(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def serve_api(port):
    ApiHandler.log, ApiHandler.bytes_out = [], {}
    httpd = Threaded(('127.0.0.1', port), ApiHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """
 const user={uid:'u1',email:'712345678@chipz-platform.com',getIdToken:async()=>'tok'};
 export const getAuth=()=>({currentUser:user});
 export const createUserWithEmailAndPassword=async()=>({user});
 export const signInWithEmailAndPassword=async()=>({user});
 export const signOut=async()=>{};export const updatePassword=async()=>{};
 export const reauthenticateWithCredential=async()=>{};
 export const EmailAuthProvider={credential:()=>({})};
 export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};
 export const setPersistence=async()=>{};export const browserLocalPersistence={};
 export const sendPasswordResetEmail=async()=>{};export const getAnalytics=()=>({});
"""


async def boot_and_rotation(pw):
    """The real built app: what the loader waits for, and the invite address."""
    table = payloads()
    seen = []                 # (path, bytes) in order, while the loader is up
    hits = {}                 # path -> total request count, for the whole run
    done = {'at': None}

    b = await pw.chromium.launch(executable_path='/opt/pw-browsers/chromium')
    ctx = await b.new_context(service_workers='block', viewport={'width': 390, 'height': 844})
    page = await ctx.new_page()

    async def api(route):
        path = route.request.url[len(API):].split('?')[0]
        raw = json.dumps(table.get(path, {'status': 'success'}))
        hits[path] = hits.get(path, 0) + 1
        # THE HEAVY REPLIES ARE HELD BACK ON PURPOSE.
        #
        # An earlier version of this harness counted every request made
        # before #app appeared and failed on the big ones -- but they are
        # FIRED at the same instant as everything else deliberately (delaying
        # the fetch would only move the wait later). What matters is whether
        # the loading screen BLOCKS on them, and the only way to see that is
        # to make them slow and watch whether the app still opens.
        if path in HEAVY:
            await asyncio.sleep(HEAVY_DELAY)
        # Counted on ARRIVAL, not on request: a reply that lands after the app
        # is already up cost the member nothing, and counting it at request
        # time was how an earlier version of this reported 1.3 MB of "wait"
        # for payloads the loader demonstrably did not wait for.
        if done['at'] is None:
            seen.append((path, len(raw)))
        await route.fulfill(status=200, content_type='application/json', body=raw)

    await page.route(f'{API}/**', lambda r: asyncio.ensure_future(api(r)))
    await page.route('https://fonts.googleapis.com/**',
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='text/css', body='')))
    await page.route('https://www.gstatic.com/firebasejs/**/firebase-app.js',
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='text/javascript', body=FB_APP)))
    await page.route('https://www.gstatic.com/firebasejs/**/firebase-auth.js',
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='text/javascript', body=FB_AUTH)))

    print('— what the loading screen waits for —')
    t0 = time.time()
    await page.goto(f'{APP_ORIGIN}/index.html', wait_until='commit')
    try:
        await page.wait_for_function(
            "() => { const a = document.getElementById('app');"
            " return a && getComputedStyle(a).display !== 'none'; }", timeout=40000)
        done['at'] = (time.time() - t0) * 1000
    except Exception:
        pass

    ck(done['at'] is not None, 'the app reaches its first screen')
    paths = [p for p, _ in seen]
    total = sum(n for _, n in seen)
    print(f'    first screen in {(done["at"] or -1):.0f} ms after {len(seen)} requests, '
          f'{total/1024:.0f} KB of JSON')
    for p, n in sorted(seen, key=lambda x: -x[1])[:4]:
        print(f'      {n/1024:8.0f} KB  {p}')

    # THE ASSERTION THAT MATTERS: with the artwork held back HEAVY_DELAY
    # seconds, the app must still open straight away. That is the difference
    # between "fired early" (good, and unchanged) and "waited for".
    ck(done['at'] is not None and done['at'] < HEAVY_DELAY * 1000 * 0.6,
       f'the first screen does not wait for the artwork '
       f'({(done["at"] or -1):.0f} ms against a {HEAVY_DELAY*1000:.0f} ms stall)')
    # The uploaded slots are not on the critical path at all...
    ck('/public/chipz-images' not in paths or done['at'] < HEAVY_DELAY * 1000 * 0.6,
       'the seven-slot image bundle does not gate the app opening')
    ck(total < 400 * 1024,
       f'and what it DOES wait for is under 400 KB of JSON ({total/1024:.0f} KB)')
    # ...but they must still arrive, and Home must repaint when they do, or
    # the spin banner and the profile GIF simply never appear. This is the
    # half a "just stop awaiting it" change silently breaks.
    await page.wait_for_timeout(int(HEAVY_DELAY * 1000) + 1500)
    ck(hits.get('/public/chipz-images', 0) >= 1,
       'the artwork is still fetched, just not in front of the member')
    painted = await page.evaluate(
        "() => ({ gif: !!document.querySelector('.home-gif img'),"
        " spin: !!document.querySelector('.spin-banner img, .spin-b img'),"
        " state: typeof STATE !== 'undefined' && !!STATE.profileGif })")
    ck(painted['state'], 'and it reaches STATE')
    ck(painted['gif'] or painted['spin'],
       f'and Home repaints to show it once it lands ({painted})')

    print('\n— the invite address changes without a round trip —')
    links, calls = [], []
    for i in range(3):
        n0 = hits.get('/public/share-host', 0)
        await page.evaluate("() => showPage('home')")
        await page.evaluate("() => showPage('referral')")
        await page.wait_for_timeout(700)
        link = await page.evaluate(
            "() => { const el = document.querySelector('.url-row span, #refUrl, [data-copy^=\"http\"]');"
            " return el ? (el.getAttribute('data-copy') || el.textContent || '').trim() : ''; }")
        n1 = hits.get('/public/share-host', 0)
        links.append(link)
        calls.append(n1 - n0)
        print(f'    open {i+1}: {link or "(blank)"}  [{n1-n0} request(s)]')

    hosts = [re.sub(r'^https?://([^/]+).*$', r'\1', lk) for lk in links if lk]
    ck(all(links), 'every open shows an invite link')
    ck(len(set(hosts)) > 1, f'the address rotates between opens ({len(set(hosts))} distinct)')
    ck(sum(calls[1:]) == 0, 'and after the first open it costs no request at all')

    await ctx.close()
    await b.close()


async def preflight_and_cache(pw):
    """The two things only a real server on a real origin can show."""
    api = serve_api(API_PORT)
    try:
        b = await pw.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        ctx = await b.new_context()
        page = await ctx.new_page()
        await page.goto(f'{APP_ORIGIN}/probe.html')

        async def one(path, headers):
            ApiHandler.log.clear()
            out = await page.evaluate(
                """async ([url, headers]) => {
                     const r = await fetch(url, { headers });
                     const j = await r.json();
                     return { ok: r.ok, keys: Object.keys(j).length };
                   }""", [API_ORIGIN + path, headers])
            return out, [m for m, _ in ApiHandler.log]

        print('\n— a plain read should be ONE round trip, not two —')
        with_ct, m_ct = await one('/public/settings', {'Content-Type': 'application/json'})
        ck(with_ct['ok'] and with_ct['keys'] > 1, 'the probe can read the stub at all')
        print(f'    with Content-Type: {m_ct}')
        ck('OPTIONS' in m_ct,
           'Content-Type: application/json on a GET really does force a preflight')

        plain, m_plain = await one('/public/products', {})
        print(f'    without it:        {m_plain}')
        ck('OPTIONS' not in m_plain and plain['ok'],
           'and dropping it removes the preflight -- one round trip, same answer')

        print('\n— a second open must not re-download the artwork —')
        ApiHandler.bytes_out.clear()
        await page.evaluate("async (u) => { const r = await fetch(u); await r.json(); }",
                            API_ORIGIN + '/public/chipz-images')
        first = ApiHandler.bytes_out.get('/public/chipz-images', 0)
        ApiHandler.bytes_out.clear()
        await page.evaluate("async (u) => { const r = await fetch(u); await r.json(); }",
                            API_ORIGIN + '/public/chipz-images')
        second = ApiHandler.bytes_out.get('/public/chipz-images', 0)
        print(f'    first fetch {first/1024:.0f} KB, second {second/1024:.0f} KB')
        ck(first > 500 * 1024, 'the fixture really is a heavy payload')
        ck(second == 0,
           'an ETag + revalidate turns the repeat into a 304 with no body at all')

        await ctx.close()
        await b.close()
    finally:
        api.shutdown()


async def main():
    static = serve_static(os.path.join(HERE, 'user'), APP_PORT)
    probe = os.path.join(HERE, 'user', 'probe.html')
    open(probe, 'w').write('<!doctype html><title>probe</title><h1>probe</h1>')
    try:
        async with async_playwright() as pw:
            await boot_and_rotation(pw)
            await preflight_and_cache(pw)
    finally:
        static.shutdown()
        try:
            os.remove(probe)
        except OSError:
            pass

    print()
    if failed:
        print(f'{failed} FAILED')
        return 1
    print('boot speed: all cases pass')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
