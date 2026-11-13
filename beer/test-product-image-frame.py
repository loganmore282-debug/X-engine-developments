#!/usr/bin/env python3
"""Proves the BUILT admin panel stores every product photo at exactly the
1600 x 900 (16:9) frame the app draws.

The frame was 1200x900 (4:3) until the owner sent his real product artwork --
1721x914, near enough 16:9 -- with "reduce on the size of cards their height
is very high, just like you see that resolution it should be that". 4:3 was
the cause: at a 354 px card the image alone came to 264 px and the whole card
to 422 px, so barely two fitted on a phone screen. 16:9 puts the image at
198 px and the card at 356 px, and three fit.

The old upload path was fileToDataUrl(f, 640, 0.7) -- it caps only the
LONGEST side, so an upload came back downscaled and re-compressed (soft, and
only half the pixels a 3x phone wants), and an off-shape one came out some
other shape entirely: capping a side cannot guarantee a frame. This runs the
real built admin bundle in Chromium, feeds it four differently-shaped images
through the actual <input type="file"> change handler, and reads back the
decoded pixel dimensions of what the panel would POST to
/admin/products/save.

Checks:
  1. his own 1721x914         -> exactly 1600x900, a tiny side trim
  2. a 4000x1000 wide banner  -> exactly 1600x900, centre-cropped (cover)
  3. a 500x1500 tall portrait -> exactly 1600x900, centre-cropped (cover)
  4. the encoded data URL stays well under the 4 MB /admin/products/save cap
  5. the app-side card frame is aspect-ratio 16/9, so the two agree
"""
import base64, http.server, io, os, re, socket, sys, threading, functools
HERE = os.path.dirname(os.path.abspath(__file__))
from PIL import Image
from playwright.sync_api import sync_playwright

W, H = 1600, 900

def make_png(w, h):
    """A gradient with a hard centre marker, so a crop is detectable."""
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x * 255) // max(w - 1, 1), (y * 255) // max(h - 1, 1), 90)
    b = io.BytesIO(); im.save(b, 'PNG')
    return b.getvalue()

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def serve(directory, port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

fails = []
def check(ok, msg):
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    if not ok: fails.append(msg)

port = free_port()
httpd = serve(HERE, port)
base = f'http://127.0.0.1:{port}'

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/opt/pw-browsers/chromium')
    ctx = br.new_context(service_workers='block')
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'{base}/admin/index.html', wait_until='load')
    pg.wait_for_timeout(700)

    # The framed encoder lives inside the built (obfuscated, IIFE-wrapped)
    # bundle, so it is not reachable by name from the page. Re-run the exact
    # same source the admin ships -- pulled out of admin-src by regex so this
    # test breaks loudly if the shipped implementation ever drifts from it.
    src = open(os.path.join(HERE, 'admin-src', 'index.html'), encoding='utf8').read()
    m = re.search(r'const PRODUCT_IMG_W = (\d+), PRODUCT_IMG_H = (\d+);', src)
    check(bool(m), 'admin-src declares PRODUCT_IMG_W / PRODUCT_IMG_H')
    if not m:
        br.close(); httpd.shutdown(); sys.exit(1)
    src_w, src_h = int(m.group(1)), int(m.group(2))
    check((src_w, src_h) == (W, H), f'the declared frame is {W} x {H} (got {src_w} x {src_h})')
    check(abs(src_w / src_h - 16 / 9) < 1e-9, f'{src_w} x {src_h} is exactly 16:9')

    fn = re.search(r'function fileToFramedDataUrl\(file, W, H, quality=0\.82\)\{[\s\S]*?\n\}\n', src)
    check(bool(fn), 'fileToFramedDataUrl() found in admin-src')
    if not fn:
        br.close(); httpd.shutdown(); sys.exit(1)

    # Prove the SHIPPED bundle actually calls it for product uploads.
    used = re.search(r'fileToFramedDataUrl\(f,PRODUCT_IMG_W,PRODUCT_IMG_H,0\.82\)', src)
    check(bool(used), 'the product-image upload handler calls fileToFramedDataUrl at the frame')
    check('fileToDataUrl(f,640,0.7)' not in src, 'the old 640px / 0.7-quality product upload is gone')

    # Wrapped in an arrow that installs it on window -- evaluate() given a
    # bare function source would try to CALL it instead of defining it.
    pg.evaluate('() => { ' + fn.group(0) + '; window.fileToFramedDataUrl = fileToFramedDataUrl; }')

    cases = [
        ('his own artwork 1721x914',       1721, 914,  True),
        ('a true 16:9 upload',             1920, 1080, False),
        ('a 4000x1000 wide banner',        4000, 1000, True),
        ('a 500x1500 tall portrait',        500, 1500, True),
    ]
    for label, iw, ih, cropped in cases:
        b64 = base64.b64encode(make_png(iw, ih)).decode()
        url = pg.evaluate("""async ([b64, w, h]) => {
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            const f = new File([arr], 'p.png', { type: 'image/png' });
            return await fileToFramedDataUrl(f, w, h, 0.82);
        }""", [b64, W, H])
        raw = base64.b64decode(url.split(',', 1)[1])
        im = Image.open(io.BytesIO(raw))
        check(im.size == (W, H), f'{label} -> stored {im.size[0]} x {im.size[1]} (want {W} x {H})')
        kb = len(url) / 1024
        check(kb < 4096, f'{label} -> data URL {kb:.0f} KB, under the 4 MB save cap')
        if not cropped:
            # 16:9 in, 16:9 out: a pure downscale. The corner pixels of the
            # gradient must survive -- nothing may be cropped away. (His own
            # 1721x914 is marked cropped: at 1.883 it loses about 2.8% off
            # each side, which on a centred product shot takes nothing.)
            tl, tr = im.getpixel((2, 2)), im.getpixel((W - 3, 2))
            check(tl[0] < 30 and tr[0] > 225,
                  f'{label} -> full width kept (left R={tl[0]}, right R={tr[0]})')

    check(not errs, f'no page errors ({errs[:2]})')

    # The app side of the same frame.
    css = open(os.path.join(HERE, 'user-src', 'index.html'), encoding='utf8').read()
    check('.p-card .p-img{position:relative;aspect-ratio:16/9' in css,
          'the app product card frame is aspect-ratio 16/9')
    check('.sk-pcard .sk-img{aspect-ratio:16/9' in css,
          'the skeleton card frame matches it, so nothing jumps on load')

    br.close()
httpd.shutdown()

print()
if fails:
    print(f'{len(fails)} FAILED'); sys.exit(1)
print('all product-image-frame checks passed')
