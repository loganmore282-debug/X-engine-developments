#!/usr/bin/env python3
"""Admin-set backdrops for the Login / Sign Up screen.

Owner: "make when l can put background image on those screens of login tab
and registration tab, make when l can set their opusity and blur, so they
are two sections those tabs plus that upper space of orange, 2 different
images so one image will appear on login and registration tabs, and 1 will
appear on space where orange color is shared."

Two slots, one pair covering BOTH tabs: the orange hero band, and the white
form card. Each with its own opacity and blur.

Three things here can only be checked by rendering, not by reading CSS:

  * that the two images land in the RIGHT sections, and not swapped -- a
    swap is invisible in the stylesheet and obvious on a phone;
  * that opacity and blur reach the elements as real computed values;
  * that the backdrop is BEHIND the wordmark and the input fields. A
    z-index mistake there does not look like a bug, it looks like the login
    form stopped working, because the taps land on the image.
"""
import asyncio, base64, io, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright
from PIL import Image

OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/auth-bg'
os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8891
API  = 'https://chipz-server.onrender.com'

def solid(rgb, w=40, h=40):
    b = io.BytesIO(); Image.new('RGB', (w, h), rgb).save(b, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

# Two flatly different colours, so "which image landed where" is answerable
# from the pixels rather than from the markup.
HERO_IMG = solid((0, 0, 255))     # blue
CARD_IMG = solid((0, 200, 0))     # green

SETTINGS = {"minDeposit": 30000, "minWithdraw": 20000, "annEnabled": False,
            "turntableEnabled": True, "referralRequired": True,
            "authHeroOpacity": 60, "authHeroBlur": 8,
            "authCardOpacity": 25, "authCardBlur": 3}

ROUTES = {
 "/public/settings": {"status": "success", "settings": SETTINGS},
 "/public/products": {"status": "success", "products": []},
 "/public/activity-feed": {"status": "success", "feed": []},
 "/public/banner": {"status": "success", "image": None, "video": None, "videoVersion": None},
 "/public/announcement-image": {"status": "success", "image": None},
 "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
 "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
   "profilegif": None, "downloadbg": None, "authhero": HERO_IMG, "authcard": CARD_IMG},
}

FB_APP  = "export const initializeApp=()=>({});export const getApps=()=>[];"
# Signed OUT: this test is about the screen you see before logging in.
FB_AUTH = """
 export const getAuth=()=>({currentUser:null});
 export const createUserWithEmailAndPassword=async()=>({user:null});
 export const signInWithEmailAndPassword=async()=>({user:null});
 export const signOut=async()=>{};export const updatePassword=async()=>{};
 export const reauthenticateWithCredential=async()=>{};
 export const EmailAuthProvider={credential:()=>({})};
 export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(null),0);};
"""

fails, errs = [], []
def ck(ok, l):
    print(("PASS  " if ok else "FAIL  ") + l)
    if not ok: fails.append(l)

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            body = next((v for k, v in ROUTES.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        await page.route(f"{API}/**", api)
        await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_selector('#authScreen', state='visible', timeout=8000)
        await page.wait_for_timeout(1800)

        print("— both backdrops exist and carry their own settings —")
        st = await page.evaluate("""() => {
            const pick = id => {
                const el = document.getElementById(id);
                if (!el) return null;
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return { img: cs.backgroundImage.slice(0, 30), size: cs.backgroundSize,
                         opacity: cs.opacity, filter: cs.filter,
                         w: Math.round(r.width), h: Math.round(r.height),
                         zIndex: cs.zIndex };
            };
            return { hero: pick('authHeroBg'), card: pick('authCardBg'),
                     heroBox: (b => ({w: Math.round(b.width), h: Math.round(b.height)}))
                              (document.getElementById('authHero').getBoundingClientRect()),
                     cardBox: (b => ({w: Math.round(b.width), h: Math.round(b.height)}))
                              (document.querySelector('.auth-card').getBoundingClientRect()) };
        }""")
        print("   hero:", st["hero"])
        print("   card:", st["card"])
        ck(st["hero"] and st["card"], "both backdrop elements are in the DOM")
        for name in ('hero', 'card'):
            ck(st[name]["img"].startswith('url("data:image/png'),
               "the %s carries an image (%s…)" % (name, st[name]["img"][:24]))
            ck(st[name]["size"] == 'cover', "the %s covers its section (%s)" % (name, st[name]["size"]))
        # The settings are 60/8 and 25/3 -- distinct on purpose, so a single
        # shared variable feeding both would be caught.
        ck(st["hero"]["opacity"] == '0.6',
           "hero opacity is the 60%% that was set (%s)" % st["hero"]["opacity"])
        ck('blur(8px)' in st["hero"]["filter"],
           "hero blur is the 8px that was set (%s)" % st["hero"]["filter"])
        ck(st["card"]["opacity"] == '0.25',
           "card opacity is its OWN 25%%, not the hero's (%s)" % st["card"]["opacity"])
        ck('blur(3px)' in st["card"]["filter"],
           "card blur is its OWN 3px (%s)" % st["card"]["filter"])

        # Blur feathers an element's edges, so each backdrop is pulled out by
        # twice its radius and clipped -- otherwise a soft transparent rim
        # shows all the way round the section.
        print("\n— each backdrop overhangs its section, so no soft rim shows —")
        ck(st["hero"]["w"] > st["heroBox"]["w"] and st["hero"]["h"] > st["heroBox"]["h"],
           "hero backdrop (%dx%d) overhangs its band (%dx%d)"
           % (st["hero"]["w"], st["hero"]["h"], st["heroBox"]["w"], st["heroBox"]["h"]))
        ck(st["card"]["w"] > st["cardBox"]["w"],
           "card backdrop (%d wide) overhangs its card (%d)" % (st["card"]["w"], st["cardBox"]["w"]))
        clipped = await page.evaluate("""() => ({
            hero: getComputedStyle(document.getElementById('authHero')).overflow,
            card: getComputedStyle(document.querySelector('.auth-card')).overflow })""")
        ck(clipped["hero"] == 'hidden' and clipped["card"] == 'hidden',
           "and both sections clip it (%s)" % clipped)

        print("\n— they are BEHIND the content, not over it —")
        hit = await page.evaluate("""() => {
            const at = (el) => { const b = el.getBoundingClientRect();
                const t = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
                return t ? (t.id || t.className || t.tagName) : null; };
            const phone = document.querySelector('#loginPane input');
            return { wordmark: at(document.querySelector('.auth-wordmark')),
                     field: at(phone), tag: phone && phone.tagName };
        }""")
        print("   ", hit)
        ck('authHeroBg' not in str(hit["wordmark"]), "the wordmark is on top, not the image (%s)" % hit["wordmark"])
        ck(hit["tag"] == 'INPUT' and 'authCardBg' not in str(hit["field"]),
           "and a tap in the phone field reaches the INPUT (%s)" % hit["field"])

        # Pixel proof: the hero really is showing the BLUE image and the card
        # the GREEN one. A swapped pair passes every check above.
        print("\n— the right image is in the right half —")
        await page.screenshot(path=f"{OUT}/auth-login.png")
        im = Image.open(f"{OUT}/auth-login.png").convert('RGB')
        # Regions taken from the LIVE boxes, not from guessed coordinates. A
        # hard-coded y for the card sampled 20px below it and read the page
        # canvas instead, which looks exactly like "the image never applied".
        boxes = await page.evaluate("""() => {
            const r = el => { const b = el.getBoundingClientRect();
                return [Math.round(b.left), Math.round(b.top),
                        Math.round(b.right), Math.round(b.bottom)]; };
            return { hero: r(document.getElementById('authHero')),
                     card: r(document.querySelector('.auth-card')) };
        }""")
        def median_rgb(box, inset=14):
            l, t, rt, bt = box
            crop = im.crop((l + inset, t + inset, rt - inset, bt - inset))
            # Median, not mean: the card is mostly backdrop with dark text and
            # input boxes over it, and a median ignores that minority instead
            # of being dragged around by it.
            ch = crop.split()
            return tuple(sorted(list(c.getdata()))[len(list(c.getdata())) // 2] for c in ch)
        heroPx = median_rgb(boxes["hero"])
        cardPx = median_rgb(boxes["card"])
        print("    hero", boxes["hero"], heroPx, "  card", boxes["card"], cardPx)
        # 60% blue over the red/orange gradient must read blue-dominant.
        ck(heroPx[2] > heroPx[0] and heroPx[2] > 100,
           "the top band is showing the BLUE image %s" % (heroPx,))
        # 25% green over white: green stays the largest channel.
        ck(cardPx[1] > cardPx[0] and cardPx[1] > cardPx[2],
           "the form card is showing the GREEN image %s" % (cardPx,))

        print("\n— and the same pair backs the Sign Up tab —")
        await page.evaluate("showAuthTab('register')")
        await page.wait_for_timeout(600)
        reg = await page.evaluate("""() => {
            const c = document.getElementById('authCardBg');
            const cs = getComputedStyle(c);
            return { visible: !!c.offsetParent || cs.display !== 'none',
                     img: cs.backgroundImage.slice(0, 30), opacity: cs.opacity,
                     pane: document.getElementById('registerPane') &&
                           getComputedStyle(document.getElementById('registerPane')).display };
        }""")
        print("   ", reg)
        ck(reg["pane"] != 'none', "the Sign Up pane is the one showing (%s)" % reg["pane"])
        ck(reg["img"].startswith('url("data:image/png') and reg["opacity"] == '0.25',
           "carrying the same card backdrop at the same 25%% (%s)" % reg["opacity"])
        await page.screenshot(path=f"{OUT}/auth-register.png")

        print("\n— with nothing uploaded, the screen is untouched —")
        ROUTES["/public/chipz-images"] = {"status": "success", "referral": None, "logo": None,
            "spin": None, "profilegif": None, "downloadbg": None, "authhero": None, "authcard": None}
        page2 = await ctx.new_page()
        page2.on("pageerror", lambda e: errs.append(str(e)))
        await page2.route(f"{API}/**", api)
        await page2.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/css", body="")))
        await page2.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page2.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await page2.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page2.wait_for_selector('#authScreen', state='visible', timeout=8000)
        await page2.wait_for_timeout(1600)
        none = await page2.evaluate("""() => ({
            hero: getComputedStyle(document.getElementById('authHeroBg')).backgroundImage,
            card: getComputedStyle(document.getElementById('authCardBg')).backgroundImage })""")
        ck(none["hero"] == 'none' and none["card"] == 'none',
           "both backdrops resolve to none, so the brand gradient and the white card show (%s)" % none)
        await page2.screenshot(path=f"{OUT}/auth-default.png")

        ck(not errs, "no page errors: %s" % errs[:3])
        await ctx.close(); await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nauth backgrounds: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
