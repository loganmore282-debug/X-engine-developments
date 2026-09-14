#!/usr/bin/env python3
"""The Account wallet balance: large, bold, and in the brand gradient.

Owner, against a reference screenshot of another app whose balance is big and
in that app's own brand colour: "l told you that the number of account balance
is large and UGX and colored in the colour of site, so ours should be that
orange." Then, seeing it flat next to the Deposit button: "but has no gradient
just like you see buttons, other side is conc another is half conc" -- the
button runs deep red at one end into orange at the other, and the figure has
to do the same.

So the WHOLE figure -- the "UGX" as well as the digits -- carries the brand
gradient, and it is visibly bigger and heavier than ordinary text. The gradient
claim is checked by SAMPLING THE RENDERED PIXELS, not by reading the
stylesheet: background-clip:text silently paints nothing on a box that doesn't
hug its text, and a declared gradient proves only that it was declared.

The size is not a matter of taste alone: it has to survive the longest figure
a real member can actually hold. Product-12 pays UGX 240,000,000, so
"UGX 240,000,000.00" is a genuinely reachable balance -- and at the wrong font
size it wraps onto two lines or spills out of the card on a 390px phone. This
measures the RENDERED width of real figures instead of trusting the number in
the stylesheet.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/balance-style'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8867
API  = 'https://chipz-server.onrender.com'

# The brand orange, straight out of the stylesheet's own token.
BRAND_ORANGE_RGB = (255, 138, 31)   # #ff8a1f

def account(balance):
    return {"phone": "0742730382", "walletBalance": balance, "totalDeposited": 0,
            "totalEarned": 0, "totalWithdrawn": 0, "totalInvested": 0, "checkinStreak": 0,
            "lastCheckinAt": None, "referralCode": "Gy2f", "publicId": "10012",
            "registrationDone": True, "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}

def routes(balance):
    return {
     "/public/settings": {"status": "success", "settings": {"minDeposit": 30000,
       "minWithdraw": 20000, "annEnabled": False, "turntableEnabled": True}},
     "/public/products": {"status": "success", "products": []},
     "/public/activity-feed": {"status": "success", "feed": []},
     "/public/banner": {"status": "success", "image": None, "video": None, "videoVersion": None},
     "/public/announcement-image": {"status": "success", "image": None},
     "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
     "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None},
     "/account": {"status": "success", "account": account(balance)},
     "/investments": {"status": "success", "investments": []},
     "/transactions": {"status": "success", "transactions": [], "truncated": False},
     "/messages": {"status": "success", "messages": []},
     "/bank/list": {"status": "success", "accounts": []},
     "/team/stats": {"status": "success", "referralCode": "Gy2f",
       "commRates": {"l1": 28, "l2": 1, "l3": 1}, "team": {"l1": 0, "l2": 0, "l3": 0},
       "totalTeam": 0, "teamCommission": 0, "teamDeposits": 0, "milestones": []},
     "/team/members": {"status": "success", "level": 1, "members": []},
     "/mission/status": {"status": "success", "mission": {}},
     "/turntable/status": {"status": "success", "enabled": True, "dailyAvailable": True,
       "earnedSpins": 0, "totalSpins": 1, "nextDailyAt": 0, "dailyMin": 200, "dailyMax": 1000},
    }

FB_APP  = "export const initializeApp=()=>({});export const getApps=()=>[];"
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

def ink_bands(png, frac=0.22):
    """Mean colour of the GLYPH pixels in the left and right ends of the figure.

    Antialiasing means most pixels in the crop are card-white or a blend, so
    this keeps only solid ink -- warm (red clearly above blue) and not washed
    out -- and averages those. Returns (left_rgb, right_rgb, n_per_band).
    """
    from PIL import Image
    im = Image.open(png).convert('RGB')
    w, h = im.size
    px = im.load()
    def band(x0, x1):
        acc, n = [0, 0, 0], 0
        for x in range(x0, x1):
            for y in range(h):
                r, g, bl = px[x, y]
                if r > 150 and r - bl > 80:       # solid warm ink, not the card
                    acc[0] += r; acc[1] += g; acc[2] += bl; n += 1
        return (tuple(v // n for v in acc), n) if n else (None, 0)
    lo, ln = band(0, max(1, int(w * frac)))
    hi, hn = band(int(w * (1 - frac)), w)
    return lo, hi, min(ln, hn)

def parse_rgb(css):
    nums = [int(float(n)) for n in css.replace('rgba(', '').replace('rgb(', '')
            .replace(')', '').split(',')[:3]]
    return tuple(nums)

async def open_account(browser, balance):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    R = routes(balance)
    async def api(r):
        path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        body = next((v for k, v in R.items() if path.endswith(k)), {"status": "success"})
        await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    await page.route(f"{API}/**", api)
    await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/css", body="")))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.wait_for_timeout(2600)
    await page.evaluate("showPage('account')")
    await page.wait_for_timeout(900)
    return ctx, page

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")

        print("— it is large, bold, and carries the brand gradient —")
        ctx, page = await open_account(b, 520782)
        style = await page.evaluate("""() => {
            const el = document.querySelector('.bal-value');
            if (!el) return null;
            const cs = getComputedStyle(el);
            const root = getComputedStyle(document.documentElement);
            const r = el.getBoundingClientRect();
            const cardW = el.parentElement.clientWidth;
            return { text: el.textContent.trim(), size: parseFloat(cs.fontSize),
                     weight: cs.fontWeight, fill: cs.webkitTextFillColor || cs.color,
                     bgImage: cs.backgroundImage,
                     clip: cs.webkitBackgroundClip || cs.backgroundClip,
                     boxW: Math.round(r.width), cardW,
                     gradToken: root.getPropertyValue('--chipz-grad').trim(),
                     btnBg: getComputedStyle(document.querySelector('.acct-btnrow .primary-button'))
                              .backgroundImage };
        }""")
        print("   ", {k: v for k, v in style.items() if k != 'gradToken'})
        ck(style is not None, "the balance element exists")
        ck(style["size"] >= 40, "it is LARGE (%.0fpx, was 34px)" % style["size"])
        ck(int(style["weight"]) >= 700, "and bold (weight %s)" % style["weight"])
        ck(style["clip"] == "text", "it is clipped to the glyphs (background-clip:%s)" % style["clip"])
        ck(parse_rgb(style["fill"])[:3] == (0, 0, 0) and style["fill"].startswith("rgba"),
           "with a transparent fill so the gradient shows through (%s)" % style["fill"])
        # The very point of the change: the SAME gradient the buttons use.
        ck(style["bgImage"] == style["btnBg"],
           "and it is the exact gradient the Deposit button uses")
        # background-clip:text paints across the ELEMENT's box, so a
        # full-width box would waste both ends of the gradient on empty card.
        ck(style["boxW"] < style["cardW"],
           "the box hugs the digits (%dpx figure in a %dpx card) so the gradient "
           "spans the number, not the card" % (style["boxW"], style["cardW"]))
        # "UGX and colored" -- the currency word must carry the colour too, not
        # just the digits. It is one text node, so this is really a check that
        # nothing inside it overrides the colour.
        ck(style["text"].startswith("UGX"),
           "the UGX is part of the same coloured figure (%r)" % style["text"])
        await page.screenshot(path=f"{OUT}/balance.png")

        # --- the pixel proof -------------------------------------------------
        # Everything above could hold while the figure still rendered flat (or
        # invisible). This crops the actual figure out of a screenshot and
        # measures the ink at each end: the brand gradient goes #e21b2a (green
        # channel 27) to #ff8a1f (green channel 138), so a real gradient shows
        # a clearly GREENER right end. A flat fill shows no difference.
        el = page.locator('.bal-value')
        await el.screenshot(path=f"{OUT}/balance-figure.png")
        L, R, band = ink_bands(f"{OUT}/balance-figure.png")
        print("    ink: left end %s  right end %s  (%d ink pixels per band)"
              % (L, R, band))
        ck(L is not None and R is not None,
           "the figure actually renders ink (not invisible)")
        ck(R[1] - L[1] > 40,
           "it runs deep red into orange like the button: green channel %d on the "
           "left end vs %d on the right" % (L[1], R[1]))
        ck(L[0] > 150 and R[0] > 150,
           "both ends stay warm/brand (red channel %d and %d)" % (L[0], R[0]))
        await ctx.close()

        print("\n— and the longest realistic balance still fits on one line —")
        # product-12 pays 240,000,000, so this is genuinely reachable -- not a
        # theoretical maximum. At the wrong size it wraps or spills the card.
        # walletBalance is stored in whole UGX -- fmtUGXCents only appends the
        # ".00", it does not divide by 100 -- so these are the figures as a
        # member actually holds them.
        for balance, label in [
            (520782,     "a normal balance"),
            (1000000,    "UGX 1,000,000.00"),
            (240000000,  "UGX 240,000,000.00 -- product-12's full payout"),
        ]:
            ctx, page = await open_account(b, balance)
            fit = await page.evaluate("""() => {
                const el = document.querySelector('.bal-value');
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                // scrollWidth > clientWidth means the text is wider than its
                // box, i.e. it has overflowed or been forced to wrap.
                return { text: el.textContent.trim(), boxW: Math.round(r.width),
                         textW: el.scrollWidth, clientW: el.clientWidth,
                         h: Math.round(r.height), lineH: parseFloat(cs.lineHeight),
                         left: Math.round(r.left), right: Math.round(r.right) };
            }""")
            print("   %-46s %s" % (label, fit))
            ck(fit["textW"] <= fit["clientW"] + 1,
               "%s does not overflow its box (%dpx of %dpx)" % (label, fit["textW"], fit["clientW"]))
            # One line: height must stay within a single line-height.
            ck(fit["h"] <= fit["lineH"] * 1.4,
               "%s stays on ONE line (%dpx tall, line-height %.0f)" % (label, fit["h"], fit["lineH"]))
            ck(fit["left"] >= 0 and fit["right"] <= 390,
               "%s stays inside the screen (%d..%d)" % (label, fit["left"], fit["right"]))
            if balance == 240000000:
                await page.screenshot(path=f"{OUT}/balance-largest.png")
            await ctx.close()

        ck(not errs, "no page errors: %s" % errs[:3])
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nbalance style: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
