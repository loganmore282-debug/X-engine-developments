#!/usr/bin/env python3
"""The admin panel's app-icon resizer, run in a real browser.

Owner: "make when l can upload app icon which will be appearing when
downloaded". Whatever he picks off his phone has to come out as the two
exact PNGs Android asks for -- and the server refuses anything that is not
precisely 512x512 / 192x192, so if this function is wrong the upload is
simply rejected and the icon never changes.

Three things have to hold, and none of them can be read off the source:
  * EXACT output size, whatever shape went in;
  * CONTAIN, not cover -- an icon that gets centre-cropped loses the edges
    of the logo, which for a wordmark means losing letters;
  * transparency SURVIVES -- a logo meant to sit on the launcher's own
    background must not come back on an opaque white tile.

So this lifts the real fileToSquarePng() out of the admin source, runs it in
Chromium against generated artwork, and decodes what comes back.
"""
import asyncio, base64, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/app-icon-resize'
os.makedirs(OUT, exist_ok=True)
ADMIN_SRC = '/home/user/X-engine-developments/chipz/admin-src/index.html'

fails = []
def ck(ok, l):
    print(("PASS  " if ok else "FAIL  ") + l)
    if not ok: fails.append(l)

def wordmark(w, h):
    """A wide, transparent-background mark with markers at the far edges.

    The edge markers are the point: a cover-fit would crop a 3:1 logo down to
    a square and throw both of them away, which is exactly the failure that
    would otherwise only show up as "my logo lost its ends" on a phone.
    """
    from PIL import ImageDraw
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 24, h - 1], fill=(226, 27, 42, 255))          # far LEFT
    d.rectangle([w - 25, 0, w - 1, h - 1], fill=(255, 138, 31, 255)) # far RIGHT
    d.ellipse([w // 2 - h // 4, h // 4, w // 2 + h // 4, h * 3 // 4], fill=(20, 20, 20, 255))
    return im

def as_data_url(im, fmt='PNG'):
    b = io.BytesIO(); im.save(b, fmt)
    mime = 'image/png' if fmt == 'PNG' else 'image/jpeg'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(b.getvalue()).decode())

def decode(data_url):
    head, b64 = data_url.split(',', 1)
    return head, Image.open(io.BytesIO(base64.b64decode(b64)))

async def main():
    src = open(ADMIN_SRC).read()
    a = src.index('function fileToSquarePng')
    b = src.index('// Reads the file EXACTLY')
    fn = src[a:b]
    # guessMimeFromName is referenced by the type check inside it.
    ga = src.index('const NAME_MIME'); gb = src.index('// Mirrors server.js')
    helpers = src[ga:gb]

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        page = await browser.new_page()
        page.on("pageerror", lambda e: ck(False, "page error: %s" % e))
        await page.set_content('<input type="file" id="f">')
        await page.add_script_tag(content=helpers + '\n' + fn)

        async def run(im, size, fmt='PNG', name='logo.png'):
            """Hand the function a real File, exactly as the file picker would."""
            await page.set_input_files('#f', files=[{
                "name": name,
                "mimeType": 'image/png' if fmt == 'PNG' else 'image/jpeg',
                "buffer": base64.b64decode(as_data_url(im, fmt).split(',', 1)[1]),
            }])
            return await page.evaluate(
                "size => fileToSquarePng(document.getElementById('f').files[0], size)", size)

        print("— a wide 900 × 300 wordmark, the awkward case —")
        wide = wordmark(900, 300)
        for size in (512, 192):
            head, im = decode(await run(wide, size))
            print("    %d → %s %s %s" % (size, head, im.size, im.mode))
            ck(head == 'data:image/png;base64', "%d comes back as a PNG (%s)" % (size, head))
            ck(im.size == (size, size), "exactly %d × %d, which is what the server demands" % (size, size))
            ck(im.mode == 'RGBA', "in RGBA, so it can carry transparency (%s)" % im.mode)

            px = im.load()
            # Contained, so a 3:1 mark occupies a 3:1 band across the middle
            # and the space above and below it stays empty.
            ck(px[size // 2, 2][3] == 0, "%d: the top edge is transparent padding, not filled" % size)
            ck(px[size // 2, size - 3][3] == 0, "%d: and so is the bottom" % size)
            ck(px[2, 2][3] == 0, "%d: the corners are transparent (a logo keeps its own background)" % size)

            # Both far edges of the artwork survived, i.e. nothing was cropped.
            mid = size // 2
            left = next((px[x, mid] for x in range(size) if px[x, mid][3] > 200), None)
            right = next((px[x, mid] for x in range(size - 1, -1, -1) if px[x, mid][3] > 200), None)
            ck(left is not None and left[0] > 180 and left[1] < 90,
               "%d: the far-LEFT red edge of the logo survived (%s)" % (size, left))
            ck(right is not None and right[0] > 200 and 90 < right[1] < 190,
               "%d: the far-RIGHT orange edge survived — nothing was cropped (%s)" % (size, right))

        print("\n— a tall 300 × 900 mark: padded on the sides instead —")
        head, im = decode(await run(wordmark(300, 900).rotate(90, expand=True), 512))
        px = im.load()
        ck(im.size == (512, 512), "still exactly 512 × 512")
        ck(px[2, 256][3] == 0 and px[509, 256][3] == 0,
           "with the transparent padding on the left and right this time")

        print("\n— an already-square 1024 × 1024 upload —")
        sq = Image.new('RGBA', (1024, 1024), (226, 27, 42, 255))
        head, im = decode(await run(sq, 512))
        px = im.load()
        ck(im.size == (512, 512), "downscales to 512 × 512")
        ck(px[2, 2][3] == 255 and px[509, 509][3] == 255,
           "and fills the frame edge to edge — no padding added to a square")

        print("\n— a JPEG photo (no alpha) still works —")
        head, im = decode(await run(Image.new('RGB', (800, 800), (10, 90, 200)), 512, 'JPEG', 'photo.jpg'))
        ck(im.size == (512, 512), "a JPEG upload comes back 512 × 512 PNG")
        # Tolerance, not equality: JPEG is lossy, so the pixel that went in as
        # (10, 90, 200) does not come back byte-identical. Anything tighter
        # than this is testing the JPEG encoder, not the resizer.
        mid = im.load()[256, 256][:3]
        ck(all(abs(a - b) <= 6 for a, b in zip(mid, (10, 90, 200))),
           "with its colour intact %s" % (mid,))

        print("\n— the size the server will actually accept —")
        # The whole point: what this produces has to pass server.js's header
        # check, which is exact and unforgiving.
        head, im = decode(await run(wide, 512))
        im.save(os.path.join(OUT, 'icon-512.png'))
        raw = open(os.path.join(OUT, 'icon-512.png'), 'rb').read()
        ck(raw[:8] == b'\x89PNG\r\n\x1a\n', "the bytes really are a PNG file")
        w = int.from_bytes(raw[16:20], 'big'); h = int.from_bytes(raw[20:24], 'big')
        ck((w, h) == (512, 512),
           "and its PNG header reads %d × %d — the exact thing server.js checks" % (w, h))

        await browser.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\napp icon resize: all cases pass")
    sys.exit(1 if fails else 0)

asyncio.run(main())
