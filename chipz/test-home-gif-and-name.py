"""
Two things the owner asked for in the same message, checked against the BUILT
app (user/index.html, the obfuscated artifact that actually ships):

  1. "bro this white space is idle we need to put the gif which is in profile
     also to show up here ... it should appear there I middle too" -- the
     admin's profile GIF now also fills Home's dead strip above the nav.

  2. "l would like to also to edit the app name chipz, so make it when it can
     be editable everywhere" -- the platform's name is one admin setting and
     every screen reads it.

Both are run through the real boot with the network stubbed, twice: once with
the feature configured and once without, because "it appears" is only half the
claim -- the other half is that nothing appears when nothing is set.

The GIF blob is lifted out of test-profile-gif-render.py rather than copied.
It is a real animated GIF several kilobytes long; two copies of it in the repo
would drift, and the one that mattered would be whichever this file happened
to hold.
"""
import asyncio, json, os, re, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/home-gif-shots'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8853
API = 'https://chipz-server.onrender.com'

_sib = open(os.path.join(HERE, 'test-profile-gif-render.py'), encoding='utf-8').read()
_m = re.search(r"'(data:image/gif;base64,[A-Za-z0-9+/=]+)'", _sib)
if not _m:
    print("FAIL  could not read the GIF fixture out of test-profile-gif-render.py")
    sys.exit(1)
GIF = _m.group(1)

ACCOUNT = {"phone": "0742730382", "walletBalance": 2000, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 28000,
           "checkinStreak": 2, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 3, "l2": 1, "l3": 0, "commission": 7840}}
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 150,
             "expectedReturn": p * 3, "image": "", "spinCount": 0, "spinMin": 200, "spinMax": 1000}
            for i, p in enumerate([30000, 90000, 180000, 300000, 600000, 900000, 1500000], start=1)]

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


def routes(brand_name, gif):
    """The stubbed backend. brand_name=None means the setting was never saved,
    which is the state every existing install is in right now."""
    settings = {"minDeposit": 30000, "minWithdraw": 20000, "withdrawFeePct": 15,
                "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": False,
                "depositPayAEnabled": True, "depositPayBEnabled": False,
                "brandTagline": "Uganda's boldest way to grow your money",
                "openingCountdownEnabled": False, "maintenanceMode": False,
                "dailyCheckin": 500, "turntableEnabled": True}
    if brand_name is not None:
        settings["brandName"] = brand_name
    return {
        "/public/settings": {"status": "success", "settings": settings},
        "/public/products": {"status": "success", "products": PRODUCTS},
        "/public/activity-feed": {"status": "success", "feed": [
            {"kind": "deposit", "phone": "077****123", "amount": 58000}]},
        "/public/banner": {"status": "success", "image": None},
        "/public/announcement-image": {"status": "success", "image": None},
        "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
        "/public/chipz-images": {"status": "success", "referral": None, "logo": None,
                                 "spin": None, "profilegif": gif, "downloadbg": None,
                                 "authhero": None, "authcard": None},
        "/account": {"status": "success", "account": ACCOUNT},
        "/investments": {"status": "success", "investments": []},
        "/transactions": {"status": "success", "transactions": [], "truncated": False},
        "/messages": {"status": "success", "messages": []},
        "/bank/list": {"status": "success", "accounts": []},
        "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                        "commRates": {"l1": 28, "l2": 1, "l3": 1},
                        "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0,
                        "teamCommission": 0, "teamDeposits": 0, "milestones": []},
        "/turntable/status": {"status": "success", "enabled": True, "dailyAvailable": True,
                              "earnedSpins": 0, "totalSpins": 1, "nextDailyAt": 0,
                              "dailyMin": 200, "dailyMax": 1000},
    }


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


async def open_app(ctx, table, errs):
    """A fresh page booted against `table`. localStorage is per-context, and
    each caller gets its own context, so no run inherits another's cached
    settings -- which is exactly how a 'the name changed' check could pass
    while reading the previous run's name."""
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))

    async def api(r):
        path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        body = next((v for k, v in table.items() if path.endswith(k)), {"status": "success"})
        await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    await page.route(f"{API}/**", api)
    await page.route("https://fonts.googleapis.com/**",
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.wait_for_timeout(2800)
    try:
        await page.evaluate("closeAnnounce()")
    except Exception:
        pass
    return page


GEOM = """()=>{
  const g = document.querySelector('.home-gif');
  const img = g ? g.querySelector('img') : null;
  const nav = document.querySelector('.bottom-nav');
  const chest = document.querySelector('.chest-float');
  const de = document.documentElement;
  if (!g || !img) return {present:false,
    overflow:+(de.scrollHeight - de.clientHeight).toFixed(1)};
  const r = img.getBoundingClientRect();
  const nr = nav ? nav.getBoundingClientRect() : {top: innerHeight};
  const cr = chest ? chest.getBoundingClientRect() : null;
  return {present:true,
    x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1),
    navTop:+nr.top.toFixed(1), vw:innerWidth, vh:innerHeight,
    chestLeft: cr ? +cr.left.toFixed(1) : null,
    chestTop: cr ? +cr.top.toFixed(1) : null,
    natural:[img.naturalWidth, img.naturalHeight],
    complete: img.complete,
    overflow:+(de.scrollHeight - de.clientHeight).toFixed(1),
    pe: getComputedStyle(g).pointerEvents};
}"""

NAMES = """()=>{
  const wm = document.querySelector('.top-wordmark');
  const b = wm ? wm.querySelector('b') : null;
  const ls = document.querySelector('.ls-wordmark');
  return {title: document.title,
          wordmark: wm ? wm.textContent : null,
          lastLetter: b ? b.textContent : null,
          lastColor: b ? getComputedStyle(b).color : null,
          loadingWordmark: ls ? ls.textContent : null};
}"""


async def main():
    errs = []
    fails = []

    def ck(ok, label):
        print(("PASS  " if ok else "FAIL  ") + label)
        if not ok:
            fails.append(label)

    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")

        # ── 1. GIF configured: it fills Home's idle strip ──
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await open_app(ctx, routes("Chipz", GIF), errs)
        g = await page.evaluate(GEOM)
        for k, v in g.items():
            print("  %-14s %s" % (k, v))
        ck(g["present"], "the GIF is on Home, not only on Account")
        if g["present"]:
            ck(g["w"] > 40 and g["h"] > 40,
               "it is actually laid out, not a 0x0 node (%.1fx%.1f)" % (g["w"], g["h"]))
            ck(g["complete"] and g["natural"][0] > 0,
               "and the image decoded (natural %s)" % (g["natural"],))
            # The whole point was the empty band above the nav. If it renders
            # under the nav, or off the bottom of the screen, it is not
            # filling that band -- it is hiding behind it.
            ck(g["y"] + g["h"] <= g["navTop"] + 1,
               "it sits ABOVE the bottom nav, fully visible (bottom %.1f vs nav top %.1f)"
               % (g["y"] + g["h"], g["navTop"]))
            ck(g["y"] >= 0 and g["y"] + g["h"] <= g["vh"],
               "entirely inside the viewport, nothing cut off")
            ck(g["x"] >= 0 and g["x"] + g["w"] <= g["vw"],
               "and inside it horizontally too")
            # "in middle" -- centred in the space that is actually free, which
            # is the width minus the floating chest's own column.
            free_centre = (18 + (g["vw"] - 96)) / 2
            centre = g["x"] + g["w"] / 2
            ck(abs(centre - free_centre) < 6,
               "centred in the free width (%.1f vs %.1f)" % (centre, free_centre))
            ck(g["chestLeft"] is None or centre < g["chestLeft"],
               "its centre is clear of the floating chest (%.1f < %s)" % (centre, g["chestLeft"]))
            ck(g["pe"] == "none",
               "it takes no pointer events, so it cannot swallow a tap on the chest")
        await page.screenshot(path=f"{OUT}/home-with-gif.png")
        # Animated: two shots of the same region a beat apart must differ.
        if g["present"]:
            clip = {"x": max(0, g["x"]), "y": max(0, g["y"]),
                    "width": min(g["w"], g["vw"] - g["x"]), "height": min(g["h"], g["vh"] - g["y"])}
            a = await page.screenshot(clip=clip)
            await page.wait_for_timeout(700)
            c = await page.screenshot(clip=clip)
            ck(a != c, "and it is animating in that position, not a frozen frame")
        base_overflow = g["overflow"]
        await ctx.close()

        # ── 2. No GIF uploaded: Home is exactly as it was ──
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await open_app(ctx, routes("Chipz", None), errs)
        g2 = await page.evaluate(GEOM)
        ck(not g2["present"],
           "with no GIF uploaded the strip renders nothing at all -- no placeholder box")
        # The block must not have introduced scrolling on a screen that had none.
        ck(base_overflow <= g2["overflow"] + 1,
           "adding the GIF did not push Home into scrolling (overflow %.1f with, %.1f without)"
           % (base_overflow, g2["overflow"]))
        await page.screenshot(path=f"{OUT}/home-without-gif.png")
        await ctx.close()

        # ── 3. A renamed app ──
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await open_app(ctx, routes("Voltrix", None), errs)
        n = await page.evaluate(NAMES)
        for k, v in n.items():
            print("  %-16s %s" % (k, v))
        ck(n["wordmark"] == "VOLTRIX", "Home's wordmark reads the admin-set name (%s)" % n["wordmark"])
        ck(n["lastLetter"] == "X", "with the last letter still carrying the accent treatment")
        ck(n["lastColor"] == "rgb(226, 27, 42)",
           "and that letter is still the brand red (%s)" % n["lastColor"])
        ck(n["title"] == "Voltrix", "the browser tab is renamed too (%s)" % n["title"])
        ck(n["loadingWordmark"] == "VOLTRIX",
           "and so is the loading screen's own static wordmark (%s)" % n["loadingWordmark"])
        # Screens beyond Home.
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(900)
        acct = await page.evaluate("""()=>{const l=document.querySelector('.acct-logo');
          return l ? l.textContent.trim() : null;}""")
        ck(acct == "VOLTRIX", "the Account profile badge shows it (%s)" % acct)
        await page.evaluate("openAboutSheet()")
        await page.wait_for_timeout(700)
        about = await page.evaluate("""()=>{const t=document.querySelector('.sheet-title,#sheetTitle');
          return t ? t.textContent.trim() : null;}""")
        ck(about == "About Voltrix", "and the About sheet is titled from it (%s)" % about)
        await page.screenshot(path=f"{OUT}/renamed.png")
        await ctx.close()

        # ── 4. Nothing known: the mark stays BLANK, it does not guess ──
        # Owner: "let's not make chipz to be default name ... l had made a
        # little bit changes in names but on start up loader it was still
        # saying chipz." A hardcoded fallback is what produced that: the
        # loading screen is up while /public/settings is still in flight, so
        # the fallback was the only thing it could ever show. A blank that
        # fills in is honest; the wrong name is not.
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await open_app(ctx, routes(None, None), errs)
        n4 = await page.evaluate(NAMES)
        print("  ", n4)
        ck((n4["wordmark"] or "").strip() == "",
           "with no name known the wordmark is blank, not a guess (%r)" % n4["wordmark"])
        ck((n4["loadingWordmark"] or "").strip() == "",
           "and so is the loading screen's (%r)" % n4["loadingWordmark"])
        await ctx.close()

        # The blank must not collapse the layout it sits in, or the loader's
        # dots jump up the screen and back down when the name lands. Measured
        # on a page where the loading screen is genuinely UP -- a fresh context
        # (so nothing is remembered) with the settings response held open.
        # Reading the height after boot would measure a display:none element
        # and report 0 for a correct implementation.
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        cold = await ctx.new_page()
        cold.on("pageerror", lambda e: errs.append(str(e)))

        async def held_api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            if path.endswith("/public/settings"):
                await asyncio.sleep(3)
            body = next((v for k, v in routes(None, None).items() if path.endswith(k)),
                        {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        await cold.route(f"{API}/**", held_api)
        await cold.route("https://fonts.googleapis.com/**",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
        await cold.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await cold.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await cold.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="commit")
        await cold.wait_for_timeout(700)
        loader = await cold.evaluate("""()=>{const ls=document.getElementById('loadingScreen');
          const el=document.querySelector('.ls-wordmark');
          const dots=document.querySelector('.ls-text');
          return {up: !!ls && getComputedStyle(ls).display !== 'none',
                  mark: el ? el.textContent : null,
                  h: el ? +el.getBoundingClientRect().height.toFixed(1) : 0,
                  dotsY: dots ? +dots.getBoundingClientRect().top.toFixed(1) : 0};}""")
        print("  ", loader)
        ck(loader["up"], "the loading screen is genuinely on screen for this measurement")
        ck((loader["mark"] or "").strip() == "",
           "a first-ever launch shows no name at all (%r)" % loader["mark"])
        ck(loader["h"] >= 40,
           "and the empty mark still holds its height, so nothing jumps (%.1fpx)" % loader["h"])
        await ctx.close()

        # ── 5. The name is remembered, so the NEXT launch paints it first ──
        # This is the actual fix for the loader complaint. The first launch
        # learns the name over the network; every launch after paints it
        # before the core has even inflated.
        print("\n— remembered across launches —")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await open_app(ctx, routes("Voltrix", None), errs)
        stored = await page.evaluate("()=>localStorage.getItem('chipz_brand_name')")
        ck(stored == "Voltrix", "the name is written to the device (%r)" % stored)
        # Same browser context = same localStorage, so this second page is a
        # relaunch of an app that has already run once.
        page2 = await ctx.new_page()
        early = []
        page2.on("pageerror", lambda e: errs.append(str(e)))
        # Hold the settings request open: this proves the mark is painted from
        # the remembered name and NOT from the response, which is exactly the
        # window the loading screen lives in.
        async def slow_api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            if path.endswith("/public/settings"):
                await asyncio.sleep(3)
            body = next((v for k, v in routes("Voltrix", None).items() if path.endswith(k)),
                        {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        await page2.route(f"{API}/**", slow_api)
        await page2.route("https://fonts.googleapis.com/**",
                          lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
        await page2.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                          lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page2.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                          lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await page2.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="commit")
        await page2.wait_for_timeout(700)
        onload = await page2.evaluate("""()=>{const el=document.querySelector('.ls-wordmark');
          return {mark: el ? el.textContent : null, title: document.title,
                  settingsIn: !!(window.STATE && STATE.settings && STATE.settings.brandName)};}""")
        print("  ", onload)
        ck(not onload["settingsIn"],
           "settings have deliberately NOT arrived yet -- this is the loader's own window")
        ck(onload["mark"] == "VOLTRIX",
           "and the loading screen already shows the remembered name (%r)" % onload["mark"])
        ck(onload["title"] == "Voltrix", "as does the tab title (%r)" % onload["title"])
        await ctx.close()

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nhome gif + editable app name: all cases pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
