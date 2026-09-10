"""
The announcement dialog sits on the dashboard, not on a colour.

Owner: "l don't need an announcement dialog to be having yellow background l
need it to show dashboard just like my mock ups."

`.announce-bg` was painted `linear-gradient(160deg,#ff8a1f,#e21b2a)` -- the
`.screen` rule lifted straight out of Announcement.dc.html. But `.screen` is the
design CANVAS in those files: every single .dc.html carries that same gradient,
because it is the mockup's stand-in for whatever is behind the phone's content.
It was never the dialog's own background. Copying it made the announcement the
one overlay in the app that hides everything under it behind flat orange.

What is actually under it is Home: maybeShowAnnouncement() is only ever reached
from showPage('home').

This is checked in PIXELS, not in CSS. A backdrop rule can be changed and still
leave the dashboard invisible -- an opaque wrapper, a stacking context, a
full-bleed child. So the test screenshots the open dialog and reads the strip of
screen ABOVE the card:

  * it must not be the orange gradient any more, and
  * it must carry the VARIATION of real content. A flat scrim over a blank page
    would satisfy "not orange" while showing no dashboard at all, so the same
    strip is measured with the dialog closed and the two are compared: the
    colours behind must track what Home actually paints there.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/announce-backdrop'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8879
API = 'https://chipz-server.onrender.com'

ANN_BODY = ("Welcome to the platform. Your daily returns are credited "
            "automatically and your team commission lands the moment a member "
            "you introduced makes a deposit.")

ACCOUNT = {"phone": "0742730382", "walletBalance": 48000, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 30000,
           "checkinStreak": 0, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 30,
             "expectedReturn": p * 3, "image": "", "spinCount": 0, "spinMin": 0, "spinMax": 0}
            for i, p in enumerate([30000, 90000, 180000], start=1)]
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 5000, "withdrawFeePct": 15,
        "commL1": 28, "commL2": 1, "commL3": 1,
        "annEnabled": True, "annTitle": "Welcome", "annBody": ANN_BODY,
        "telegramChannel": "https://t.me/example",
        "cycleDays": 30, "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": True}},
    "/public/products": {"status": "success", "products": PRODUCTS},
    "/public/activity-feed": {"status": "success", "feed": []},
    "/public/banner": {"status": "success", "image": None},
    "/public/announcement-image": {"status": "success", "image": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNDUwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjQ1MCIgZmlsbD0iIzFhMGQwOCIvPjwvc3ZnPg=="},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                             "profilegif": None, "downloadbg": None, "authhero": None,
                             "authcard": None},
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
                          "dailyMin": 500, "dailyMax": 5000},
}
FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """
 const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};
 export const getAuth=()=>({currentUser:user});
 export const signInWithEmailAndPassword=async()=>({user});
 export const createUserWithEmailAndPassword=async()=>({user});
 export const signOut=async()=>{};export const updatePassword=async()=>{};
 export const reauthenticateWithCredential=async()=>{};
 export const EmailAuthProvider={credential:()=>({})};
 export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};
"""


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def strip_colors(png_path, y, x_from, x_to, dpr=2):
    """Row of pixels at CSS-y across a CSS-x span, as RGB tuples."""
    from PIL import Image
    im = Image.open(png_path).convert("RGB")
    return [im.getpixel((x * dpr, y * dpr)) for x in range(x_from, x_to, 6)]


async def main():
    fails, errs = [], []

    def ck(ok, label):
        print(("PASS  " if ok else "FAIL  ") + label)
        if not ok:
            fails.append(label)

    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))

        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            body = next((v for k, v in ROUTES.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        await page.route(f"{API}/**", api)
        await page.route("https://fonts.googleapis.com/**",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(3500)

        shown = await page.evaluate(
            "document.getElementById('announceBg').classList.contains('show')")
        ck(shown, "the announcement opened on Home by itself")
        if not shown:
            await page.evaluate("maybeShowAnnouncement()")
            await page.wait_for_timeout(500)

        css = await page.evaluate("""()=>{const cs=getComputedStyle(
          document.getElementById('announceBg'));
          return {img:cs.backgroundImage, col:cs.backgroundColor};}""")
        print("   backdrop:", css)
        ck(css["img"] == "none",
           "the backdrop paints no gradient of its own (%s)" % css["img"])
        # Translucent, or nothing behind it can show through however the rest
        # of the page is built.
        alpha = 1.0
        if css["col"].startswith("rgba"):
            alpha = float(css["col"].rstrip(")").split(",")[-1])
        ck(alpha < 0.9, "and is see-through (alpha %.2f)" % alpha)

        # Where the card actually is, so the strip sampled is genuinely above it.
        box = await page.evaluate("""()=>{const r=document.querySelector(
          '.announce-wrap').getBoundingClientRect();
          return {top:Math.round(r.top), bottom:Math.round(r.bottom),
                  w:r.width, h:r.height, vw:innerWidth, vh:innerHeight};}""")
        print("   card occupies y=%d..%d of 844" % (box["top"], box["bottom"]))
        ck(box["top"] > 30, "there is real screen above the card (%dpx)" % box["top"])
        # Owner: "think you can see the exact height and width of the dialog,
        # see clearly rather than guess." Measured off his screenshot: the card
        # spans x=45..1034 of 1079 (91.7% of the screen) and y=488..2064 of a
        # ~2072px viewport (76.1% of its height).
        wpc = 100 * box["w"] / box["vw"]
        hpc = 100 * box["h"] / box["vh"]
        print("   card %.1f%% wide x %.1f%% tall (his: 91.7 x 76.1)" % (wpc, hpc))
        ck(abs(wpc - 91.7) <= 1.5, "card width matches his (%.1f%% vs 91.7%%)" % wpc)
        # A CEILING is not a height: 76vh alone let a short announcement render
        # at 51%, which is what made ours look like a different dialog.
        ck(abs(hpc - 76.1) <= 1.5, "card height matches his (%.1f%% vs 76.1%%)" % hpc)

        y = max(8, box["top"] // 2)
        await page.screenshot(path=f"{OUT}/announce-open.png")
        with_dialog = strip_colors(f"{OUT}/announce-open.png", y, 20, 370)

        await page.evaluate("closeAnnounce()")
        await page.wait_for_timeout(700)
        await page.screenshot(path=f"{OUT}/home-behind.png")
        without = strip_colors(f"{OUT}/home-behind.png", y, 20, 370)

        # The old gradient at this height was a solid orange; nothing on Home
        # is. Checked as "is any sampled pixel that orange", not as an average,
        # which a single stray pixel could not fake either way.
        def orangeish(c):
            r, g, bl = c
            return r > 180 and 60 < g < 175 and bl < 90
        orange_now = sum(1 for c in with_dialog if orangeish(c))
        print("   strip at y=%d: %d/%d orange-gradient pixels behind the card"
              % (y, orange_now, len(with_dialog)))
        ck(orange_now < len(with_dialog) * 0.5,
           "the strip above the card is not the orange gradient (%d/%d)"
           % (orange_now, len(with_dialog)))

        # And it is HOME back there, not a flat wash: each sampled pixel must
        # track what Home paints at that spot, darkened by the scrim. Compared
        # per-pixel rather than as an average, so a uniform colour cannot pass
        # by having the same mean as a varied one.
        deltas = [abs(a[0] - c[0]) + abs(a[1] - c[1]) + abs(a[2] - c[2])
                  for a, c in zip(with_dialog, without)]
        spread_behind = max(sum(c) for c in with_dialog) - min(sum(c) for c in with_dialog)
        spread_home = max(sum(c) for c in without) - min(sum(c) for c in without)
        print("   spread behind=%d  spread on Home alone=%d  mean delta=%.0f"
              % (spread_behind, spread_home, sum(deltas) / len(deltas)))
        ck(spread_home > 40,
           "Home genuinely has something to show at that height (spread %d)" % spread_home)
        ck(spread_behind > spread_home * 0.35,
           "and that variation survives the scrim -- the dashboard is visible, "
           "not a flat colour (%d vs %d)" % (spread_behind, spread_home))

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nannouncement backdrop: all pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
