#!/usr/bin/env python3
"""The Account wallet balance: large, bold, and in the brand orange.

Owner, against a reference screenshot of another app whose balance is big and
in that app's own brand colour: "l told you that the number of account balance
is large and UGX and colored in the colour of site, so ours should be that
orange."

So the WHOLE figure -- the "UGX" as well as the digits -- carries the brand
orange, and it is visibly bigger and heavier than ordinary text.

The size is not a matter of taste alone: it has to survive the longest figure
a real member can actually hold. Product-12 pays UGX 240,000,000, so
"UGX 240,000,000.00" is a genuinely reachable balance -- and at the wrong font
size it wraps onto two lines or spills out of the card on a 390px phone. This
measures the RENDERED width of real figures instead of trusting the number in
the stylesheet.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright

OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/balance-style'
os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
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

        print("— it is large, bold, and the brand orange —")
        ctx, page = await open_account(b, 520782)
        style = await page.evaluate("""() => {
            const el = document.querySelector('.bal-value');
            if (!el) return null;
            const cs = getComputedStyle(el);
            const brand = getComputedStyle(document.documentElement)
                            .getPropertyValue('--chipz-orange').trim();
            return { text: el.textContent.trim(), size: parseFloat(cs.fontSize),
                     weight: cs.fontWeight, color: cs.color, brandToken: brand };
        }""")
        print("   ", style)
        ck(style is not None, "the balance element exists")
        ck(style["size"] >= 40, "it is LARGE (%.0fpx, was 34px)" % style["size"])
        ck(int(style["weight"]) >= 700, "and bold (weight %s)" % style["weight"])
        ck(parse_rgb(style["color"]) == BRAND_ORANGE_RGB,
           "and painted in the brand orange #ff8a1f (%s)" % style["color"])
        ck(style["brandToken"].lower() == '#ff8a1f',
           "which really is the site's own --chipz-orange token (%s)" % style["brandToken"])
        # "UGX and colored" -- the currency word must carry the colour too, not
        # just the digits. It is one text node, so this is really a check that
        # nothing inside it overrides the colour.
        ck(style["text"].startswith("UGX"),
           "the UGX is part of the same coloured figure (%r)" % style["text"])
        await page.screenshot(path=f"{OUT}/balance.png")
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
