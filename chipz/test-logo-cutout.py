#!/usr/bin/env python3
"""Uploading a logo that has a black background, through the real admin panel.

Owner: "there are logos l would like to upload to admin panel to replace chipz
logo on manual payment pages on copy and on network, but they have black
background so l wanted the system to refine it such that it remains as it is
with no background so as it shows up on transparent sitting with no black
background."

Driven through the UI, not by calling the cutter: the built panel is
obfuscated, so its functions have no names left to call -- but more to the
point, what matters is what LEAVES the browser. This sets the real file input,
lets the real change handler run, and intercepts the real
/admin/manual-pay-image/set to read the exact bytes that would be stored.

"Remains as it is" is the assertion that earns its place. The fixture is a
bright shape with BLACK BARS INSIDE IT, so a cutter that keys every dark pixel
instead of flood-filling from the border hands back a logo full of holes and
fails here.
"""
import asyncio, base64, json, os, sys, io, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/logo-cutout'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'admin')
FIX = os.path.join(HERE, 'test-fixtures')
PORT = 8812
API = 'https://chipz-server.onrender.com'

fails = []


def ck(ok, label):
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        fails.append(label)


R = {
    "/admin/check-key": {"status": "success", "token": "t", "username": "owner", "role": "owner"},
    "/admin/settings": {"status": "success", "settings": {}},
    "/admin/banner": {"status": "success", "image": None, "video": None, "videoVersion": None},
    "/admin/help-banner": {"status": "success", "image": None},
    "/admin/announcement-image": {"status": "success", "image": None},
    "/admin/about-content": {"status": "success", "blocks": []},
    "/admin/push/list": {"status": "success", "count": 0},
    "/admin/manual-numbers/list": {"status": "success", "numbers": []},
    "/admin/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/admin/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                            "profilegif": None, "downloadbg": None, "authhero": None, "authcard": None},
    "/admin/brand-assets": {"status": "success", "appIcon": None, "appIconCustom": False,
                            "linkPreview": None, "linkPreviewCustom": False,
                            "sizes": {"appIcon": "512 × 512", "linkPreview": "1200 × 630"}},
}


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def decode(data_url):
    head, _, b64 = data_url.partition(',')
    return head, Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA')


async def upload(page, sent, slot_input, strip_box, fixture, strip):
    """Set the real file input and let the panel's own handler run."""
    sent.clear()
    await page.evaluate(f"""() => {{
        const b = document.getElementById('{strip_box}');
        if (b) b.checked = {'true' if strip else 'false'};
    }}""")
    await page.set_input_files('#' + slot_input, os.path.join(FIX, fixture))
    for _ in range(60):
        await page.wait_for_timeout(200)
        if sent:
            break
    return sent[0] if sent else None


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 900, "height": 1200},
                                  service_workers="block")
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        sent = []

        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            if path.endswith('/admin/manual-pay-image/set'):
                try:
                    sent.append(json.loads(r.request.post_data or '{}'))
                except Exception:
                    sent.append({})
                await r.fulfill(status=200, content_type="application/json",
                                body=json.dumps({"status": "success"}))
                return
            body = next((v for k, v in R.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        await page.route(f"{API}/**", api)
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.fill('#keyInput', 'x')
        await page.click('#loginBtn')
        await page.wait_for_timeout(1200)
        await page.click('button[data-tab="settings"]')
        await page.wait_for_timeout(1600)

        body = await page.inner_text('#content')
        ck('Cut the dark background off this logo' in body,
           "both slots offer to cut the dark background off")
        ck(await page.evaluate("!!document.getElementById('mpSelectorStrip') && "
                               "document.getElementById('mpSelectorStrip').checked"),
           "and it is on by default, so he does not have to know to ask")

        print("\n— a flat black background, on the network screen —")
        got = await upload(page, sent, 'mpSelectorImgFile', 'mpSelectorStrip',
                           'mtn-on-black.png', True)
        ck(bool(got), "the upload reached the server")
        ck(bool(got) and got.get('slot') == 'selector', f"for the selector slot ({got and got.get('slot')})")
        head, im = decode(got['image'])
        im.save(os.path.join(OUT, 'selector-cut.png'))
        ck('image/png' in head, f"stored as PNG, which is the only format that can hold the transparency ({head})")
        w, h = im.size
        corners = [im.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
        ck(all(c[3] == 0 for c in corners), f"every corner is fully transparent {corners}")

        # "Remains as it is": the three black bars are INSIDE the bright shape,
        # enclosed on all sides, so a border flood-fill can never reach them.
        # A cutter that keyed dark pixels globally would have punched them out.
        bars = []
        for i in range(3):
            x = int(w * (0.13 + i * 0.285)) + int(w * 0.06)
            bars.append(im.getpixel((x, h // 2)))
        opaque_dark = [p for p in bars if p[3] > 240 and max(p[:3]) < 60]
        ck(len(opaque_dark) == 3,
           f"the black bars inside the logo are all still solid black {bars}")

        # The bright body survives untouched.
        mid = im.getpixel((int(w * 0.5), int(h * 0.18)))
        ck(mid[3] > 240 and mid[0] > 200 and mid[1] > 150 and mid[2] < 90,
           f"and the yellow body is still opaque yellow {mid}")

        # Trimmed: the fixture has a wide black margin, and these slots draw at
        # 56px, so an untrimmed logo would arrive on screen far too small.
        ck(w / h < 2.4 and w / h > 1.9,
           f"trimmed tight to the artwork, keeping its shape ({w}x{h}, ratio {w/h:.2f})")

        print("\n— the same logo antialiased, so it has a real soft edge —")
        got = await upload(page, sent, 'mpHeroImgFile', 'mpHeroStrip',
                           'soft-on-black.png', True)
        ck(bool(got) and got.get('slot') == 'hero', f"reached the hero slot ({got and got.get('slot')})")
        _, im2 = decode(got['image'])
        im2.save(os.path.join(OUT, 'hero-cut.png'))
        w2, h2 = im2.size
        # Scanned over the WHOLE image, not along one row. A first version
        # walked in from the left edge at mid-height and found nothing, and
        # read that as a hard cut -- but that row crosses the rounded shape at
        # its widest point, where the edge is vertical and the trim has already
        # cropped to it, so the first retained pixel is legitimately solid. The
        # antialiasing lives on the CORNERS, where the edge runs diagonally.
        px2 = [im2.getpixel((x, y)) for y in range(h2) for x in range(w2)]
        partial = [p for p in px2 if 12 < p[3] < 243]
        ck(len(partial) >= 20,
           f"the edge really is soft, not a hard cut ({len(partial)} partly-transparent pixels)")
        # The point of recovering colour out of the rim: a partly-transparent
        # pixel left at its composited value is dark, and a ring of those is
        # the black halo that gives away a badly cut-out logo.
        muddy = [p for p in partial if max(p[:3]) < 110]
        ck(not muddy,
           f"and none of them is dark, so there is no black fringe ({len(muddy)} dark, e.g. {muddy[:2]})")

        print("\n— a logo that has no dark background is left alone —")
        got = await upload(page, sent, 'mpSelectorImgFile', 'mpSelectorStrip',
                           'on-white.png', True)
        ck(bool(got), "it is still uploaded rather than refused")
        _, im3 = decode(got['image'])
        im3.save(os.path.join(OUT, 'white-untouched.png'))
        c3 = im3.getpixel((0, 0))
        ck(c3[3] > 240 and min(c3[:3]) > 230,
           f"its white background is untouched {c3}")
        toast = await page.evaluate("(document.getElementById('adToast')||{}).textContent || ''")
        ck('no dark background' in toast.lower(),
           f"and the panel SAYS nothing was cut, rather than claiming success ({toast!r})")

        print("\n— unticking the box uploads it exactly as it is —")
        got = await upload(page, sent, 'mpSelectorImgFile', 'mpSelectorStrip',
                           'mtn-on-black.png', False)
        ck(bool(got), "the upload still happens")
        _, im4 = decode(got['image'])
        c4 = im4.getpixel((0, 0))
        ck(c4[3] > 240 and max(c4[:3]) < 40,
           f"and the black background is still there, as asked {c4}")

        ck(not errs, f"no page errors anywhere in the panel ({errs[:1]})")
        await b.close()

    print(f"\n{len(fails)} FAILED" if fails else "\nlogo cutout: all cases pass")
    return 1 if fails else 0


if __name__ == "__main__":
    s = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        s.shutdown()
