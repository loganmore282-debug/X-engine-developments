#!/usr/bin/env python3
"""The wallet card's glow sweep actually moves.

Owner: "on wallet that wallet card having number, it has a glow sweep
animation too."

.sheen was a STATIC diagonal highlight painted across the whole card -- the
look of a sweep frozen mid-pass, which is why it read as almost-right.

A computed-style check would be the obvious test and a poor one: a declared
`animation` on an element that is clipped away, sized to nothing, or animating
a property that does not move reads as present and shows as nothing. So this
SAMPLES THE CARD over time and requires the bright band to be in a different
place in different frames.
"""
import asyncio, io, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
from PIL import Image, ImageChops

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/wallet-sheen'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8814
from chipz_test_api import API

ACCOUNT = {"userId": "u1", "phone": "0742730382", "publicId": "00001",
           "referralCode": "TCL80", "walletBalance": 45000, "registrationDone": True}

FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """
 const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};
 export const getAuth=()=>({currentUser:user});
 export const createUserWithEmailAndPassword=async()=>({user});
 export const signInWithEmailAndPassword=async()=>({user});
 export const signOut=async()=>{};export const updatePassword=async()=>{};
 export const reauthenticateWithCredential=async()=>{};
 export const EmailAuthProvider={credential:()=>({})};
 export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};
"""

ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "brandName": "Chipz", "annEnabled": False, "minDeposit": 3000,
        "depositPayAEnabled": True, "commL1": 28, "commL2": 1, "commL3": 1}},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": []},
    "/messages": {"status": "success", "messages": []},
    "/public/products": {"status": "success", "products": [
        {"key": "p1", "name": "Product-1", "price": 30000, "cycle": 150,
         "expectedReturn": 90000}]},
    "/public/banner": {"status": "success", "image": None, "video": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None,
                             "spin": None, "profilegif": None},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/bank/list": {"status": "success", "accounts": []},
}

failed = []


def ck(ok, label):
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        failed.append(label)


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def moved_column(a, b):
    """Where two frames differ most, as a fraction 0..1, and by how much.

    FRAME DIFFERENCING, not "find the brightest column" -- which is what the
    first version did and it never moved. The card's own gradient ends in
    #ff8a1f, and that orange is brighter in greyscale than a white band laid
    over the dark end of the card, so the brightest column was always the
    right edge: the base gradient, never the sheen. What actually identifies
    a moving highlight is the part of the card that CHANGED.
    """
    d = ImageChops.difference(a.convert('L'), b.convert('L'))
    w, h = d.size
    px = d.load()
    cols = [sum(px[x, y] for y in range(0, h, 3)) for x in range(w)]
    peak = max(cols)
    return cols.index(peak) / max(1, w - 1), peak


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 900},
                                  service_workers="block")
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))

        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            body = next((v for k, v in ROUTES.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        await page.route(f"{API}/**", api)
        await page.route("https://fonts.googleapis.com/**",
                         lambda r: asyncio.ensure_future(
                             r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                         lambda r: asyncio.ensure_future(
                             r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                         lambda r: asyncio.ensure_future(
                             r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(2400)
        await page.evaluate("window.closeAnnounce && closeAnnounce()")
        # openWalletSheet(), not showPage('wallet'): the wallet card lives in a
        # sheet opened from the Account list, and there is no 'wallet' page.
        # showPage('wallet') resolved to nothing and every assertion below
        # failed against a perfectly good card.
        await page.evaluate("openWalletSheet()")
        await page.wait_for_timeout(1500)

        card = await page.query_selector('.wallet-card')
        ck(card is not None, "the wallet card is on screen")
        sheen = await page.evaluate("""() => {
            const s = document.querySelector('.wallet-card .sheen');
            if (!s) return null;
            const cs = getComputedStyle(s), r = s.getBoundingClientRect();
            const cr = document.querySelector('.wallet-card').getBoundingClientRect();
            return { name: cs.animationName, dur: cs.animationDuration,
                     iter: cs.animationIterationCount,
                     w: s.offsetWidth, h: r.height, cardW: cr.width,
                     clipped: getComputedStyle(document.querySelector('.wallet-card')).overflow }; }""")
        ck(bool(sheen), "it has a sheen layer")
        ck(bool(sheen) and sheen['name'] not in ('none', ''),
           f"with an animation on it ({sheen and sheen['name']})")
        ck(bool(sheen) and sheen['iter'] == 'infinite',
           f"that repeats for as long as the card is up ({sheen and sheen['iter']})")
        ck(bool(sheen) and sheen['clipped'] == 'hidden',
           f"and the card clips it, so the band never escapes ({sheen and sheen['clipped']})")
        # A band NARROWER than the card is what makes a sweep a sweep -- a
        # full-width gradient can only fade, never travel.
        # offsetWidth, NOT getBoundingClientRect().width: the band is skewed,
        # and a bounding box includes the transform, so the rect read 309px of
        # a 350px card for a band that is laid out at 193px.
        ck(bool(sheen) and sheen['w'] < sheen['cardW'] * 0.8,
           f"the band is narrower than the card ({sheen and round(sheen['w'])}px of "
           f"{sheen and round(sheen['cardW'])}px)")

        # ── the part that matters: does the bright band MOVE? ──────────────
        print("\n— sampled over time, the highlight is in different places —")
        box = await page.evaluate("""() => {
            const r = document.querySelector('.wallet-card').getBoundingClientRect();
            return {x: r.x, y: r.y, width: r.width, height: r.height}; }""")
        # Sampled over ~6s, longer than the 5.2s cycle: the sweep RESTS for 45%
        # of each cycle by design, so a 2s window can land entirely inside the
        # rest and see nothing move. The first version did exactly that.
        frames = []
        for i in range(30):
            shot = await page.screenshot(clip=box)
            im = Image.open(io.BytesIO(shot))
            if i == 0:
                im.save(os.path.join(OUT, 'wallet-frame0.png'))
            frames.append(im)
            await page.wait_for_timeout(200)
        moves = []
        for i in range(len(frames) - 1):
            frac, peak = moved_column(frames[i], frames[i + 1])
            if peak > 400:            # a real repaint, not compression noise
                moves.append(round(frac, 3))
        ck(len(moves) >= 3,
           f"the card repaints on at least 3 frame pairs, so something is moving ({len(moves)})")
        ck(len(set(moves)) >= 3,
           f"and the change happens in at least 3 distinct places ({sorted(set(moves))[:6]})")
        spread = (max(moves) - min(moves)) if moves else 0
        ck(spread >= 0.15,
           f"travelling a real distance across the card ({spread:.2f} of its width)")

        # Reduced motion: still glossy, just not moving.
        print("\n— with reduced motion it stops but stays glossy —")
        ctx2 = await b.new_context(viewport={"width": 390, "height": 900},
                                   service_workers="block", reduced_motion="reduce")
        p2 = await ctx2.new_page()
        await p2.route(f"{API}/**", api)
        await p2.route("https://fonts.googleapis.com/**",
                       lambda r: asyncio.ensure_future(
                           r.fulfill(status=200, content_type="text/css", body="")))
        await p2.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                       lambda r: asyncio.ensure_future(
                           r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await p2.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                       lambda r: asyncio.ensure_future(
                           r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await p2.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await p2.wait_for_timeout(2400)
        await p2.evaluate("window.closeAnnounce && closeAnnounce()")
        await p2.evaluate("openWalletSheet()")
        await p2.wait_for_timeout(1400)
        rm = await p2.evaluate("""() => {
            const s = document.querySelector('.wallet-card .sheen');
            const cs = getComputedStyle(s);
            return { name: cs.animationName, bg: cs.backgroundImage.slice(0, 24) }; }""")
        ck(rm['name'] == 'none', f"the animation is off ({rm['name']})")
        ck('gradient' in rm['bg'], f"but the highlight is still painted ({rm['bg']!r})")
        await ctx2.close()

        ck(not errs, f"no page errors ({errs[:1]})")
        await b.close()

    print(f"\n{len(failed)} FAILED" if failed else "\nwallet sheen: all cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    s = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        s.shutdown()
