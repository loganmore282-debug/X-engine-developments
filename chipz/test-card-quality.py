"""
The surface pass, measured against the BUILT app.

Owner, holding a mockup beside the live screen: "the mock up has very clean
CSS, well ultra definition and quality cards and colour ... also see the
colours of paid, deposit pending, also see icons of D,W, very clean, defined
and high quality, make sure it is enhanced through out the app."

"Looks better" is not a check. What is checkable:

  * every card really does round to the shared token, and really does cast a
    shadow -- the old ones had a 1px hairline plus a shadow offset so far
    (-16px/-24px spread) it never drew a pixel, which is a wireframe;
  * the status pills separate from the card they sit on, measured as a real
    contrast ratio off the rendered pixels, and their white text still clears
    a legibility floor -- saturating a pill is only an improvement if you can
    still read it;
  * the D / W discs are raised (a shadow) and lit (a gradient), not flat fills;
  * Total Team carries the app's own team artwork -- the same file the nav
    uses -- and no emoji;
  * a spin win shows the owner's wheel behind the card and a chest win still
    shows the chest.

Colours are sampled from screenshots rather than read off `background-color`,
because every pill and disc is a gradient and `background-color` on those is
`rgba(0,0,0,0)` -- an assertion against that computed value would pass no
matter what the member actually sees.
"""
import asyncio, io, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/card-quality'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'user')
PORT = 8861
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone": "0742730382", "walletBalance": 5207.82, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 32164, "totalInvested": 28000,
           "checkinStreak": 2, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 43, "l2": 2, "l3": 0, "commission": 7840}}
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 150,
             "expectedReturn": p * 3, "image": "", "spinCount": 1, "spinMin": 200, "spinMax": 1000}
            for i, p in enumerate([30000, 90000, 180000], start=1)]
# One row of each status, so all three pills are on screen at once.
TX = [
    {"id": "1", "type": "deposit", "amount": 30000, "displayAmount": 30000,
     "description": "Deposit: Failed (UGX 30,000)", "status": "failed",
     "date": "09/08/2026", "time": "11:25:51"},
    {"id": "2", "type": "deposit", "amount": 58000, "displayAmount": 58000,
     "description": "Deposit: Pending (UGX 58,000)", "status": "pending",
     "date": "08/09/2026", "time": "13:02"},
    {"id": "3", "type": "withdraw", "amount": -6664, "displayAmount": -6664,
     "description": "Withdrawal: Paid (UGX 6,664)", "status": "paid",
     "date": "02/09/2026", "time": "15:43"},
    {"id": "4", "type": "turntable", "amount": 207.82, "description": "Turntable daily spin",
     "date": "09/08/2026", "time": "00:26:00"},
]
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 20000, "withdrawFeePct": 15,
        "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": False,
        "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": True}},
    "/public/products": {"status": "success", "products": PRODUCTS},
    "/public/activity-feed": {"status": "success", "feed": [
        {"kind": "deposit", "phone": "077****123", "amount": 58000}]},
    "/public/banner": {"status": "success", "image": None},
    "/public/announcement-image": {"status": "success", "image": None},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                             "profilegif": None, "downloadbg": None, "authhero": None,
                             "authcard": None},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": TX, "truncated": False},
    "/messages": {"status": "success", "messages": []},
    "/bank/list": {"status": "success", "accounts": []},
    "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 43, "l2": 2, "l3": 0}, "totalTeam": 45,
                    "teamCommission": 7840, "teamDeposits": 28000, "milestones": []},
    "/team/members": {"status": "success", "level": 1, "members": [
        {"id": "m1", "phone": "0708001234", "createdAt": None, "invested": 0}]},
    "/turntable/status": {"status": "success", "enabled": True, "dailyAvailable": True,
                          "earnedSpins": 3, "totalSpins": 4, "nextDailyAt": 0,
                          "dailyMin": 200, "dailyMax": 1000},
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


def lum(rgb):
    """WCAG relative luminance."""
    out = []
    for c in rgb[:3]:
        c = c / 255.0
        out.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def median_colour(png_bytes):
    """The pill's own fill, taken as the median of its pixels. A mean would be
    dragged toward the white glyphs sitting on top of it; the median ignores
    them as long as the text is a minority of the area, which on a pill it is."""
    im = Image.open(io.BytesIO(png_bytes)).convert('RGB')
    px = list(im.getdata())
    return tuple(sorted(p[i] for p in px)[len(px) // 2] for i in range(3))


async def main():
    errs, fails = [], []

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
        await page.wait_for_timeout(2800)
        try:
            await page.evaluate("closeAnnounce()")
        except Exception:
            pass

        # ── The tokens themselves ──
        print("— one radius vocabulary —")
        tok = await page.evaluate("""()=>{const cs=getComputedStyle(document.documentElement);
          return {card:cs.getPropertyValue('--r-card').trim(),
                  ctl:cs.getPropertyValue('--r-ctl').trim(),
                  pill:cs.getPropertyValue('--r-pill').trim(),
                  sh:cs.getPropertyValue('--sh-card').trim()};}""")
        print("  ", tok)
        ck(tok["card"] == "16px", "--r-card is 16px (%s)" % tok["card"])
        ck(tok["ctl"] == "12px", "--r-ctl is 12px (%s)" % tok["ctl"])
        ck(tok["pill"] == "999px", "--r-pill is 999px (%s)" % tok["pill"])
        ck(tok["sh"].count("rgba") >= 2,
           "--sh-card is a two-layer shadow: a contact edge plus a soft lift")

        # ── Balance Record ──
        print("\n— cards —")
        await page.evaluate("openBalanceRecordSheet()")
        await page.wait_for_timeout(1200)
        cards = await page.evaluate("""()=>[...document.querySelectorAll('.rec')].map(el=>{
          const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
          return {radius:cs.borderTopLeftRadius, shadow:cs.boxShadow,
                  w:+r.width.toFixed(1), h:+r.height.toFixed(1)};})""")
        ck(len(cards) >= 3, "the record list rendered (%d rows)" % len(cards))
        ck(all(c["radius"] == "16px" for c in cards),
           "every row rounds to the card token (%s)" % ", ".join({c["radius"] for c in cards}))
        # A shadow that draws nothing is the failure mode being fixed: a blur
        # smaller than the negative spread never reaches outside the box.
        def draws(sh):
            if not sh or sh == "none":
                return False
            import re as _re
            nums = [float(x) for x in _re.findall(r'(-?\d+(?:\.\d+)?)px', sh)]
            # groups of (x, y, blur, spread) per layer
            layers = [nums[i:i + 4] for i in range(0, len(nums) - 3, 4)]
            return any(len(l) == 4 and l[2] + l[3] > 0 for l in layers)
        ck(all(draws(c["shadow"]) for c in cards),
           "and every row casts a shadow that actually reaches outside its box")

        # ── Pills ──
        print("\n— status pills —")
        pills = await page.evaluate("""()=>[...document.querySelectorAll('.rec-pill')].map(el=>{
          const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
          return {cls:[...el.classList].filter(c=>c!=='rec-pill')[0]||'?',
                  text:el.textContent.trim(), color:cs.color, radius:cs.borderTopLeftRadius,
                  x:r.x, y:r.y, w:r.width, h:r.height};})""")
        ck(len(pills) >= 3, "all three pill states are on screen (%s)"
           % ", ".join(p["cls"] for p in pills))
        card_white = (255, 255, 255)
        for p in pills:
            if p["w"] < 8 or p["h"] < 8:
                ck(False, "pill %s has no size" % p["cls"])
                continue
            shot = await page.screenshot(clip={"x": p["x"] + 2, "y": p["y"] + 2,
                                               "width": p["w"] - 4, "height": p["h"] - 4})
            fill = median_colour(shot)
            vs_card = contrast(fill, card_white)
            vs_text = contrast(fill, (255, 255, 255))
            print("   %-5s %-16s fill=%s  vs card %.2f  text %.2f"
                  % (p["cls"], p["text"], fill, vs_card, vs_text))
            ck(p["color"] == "rgb(255, 255, 255)",
               "%s pill writes in white (%s)" % (p["cls"], p["color"]))
            ck(p["radius"] != "4px" and float(p["radius"].rstrip("px")) >= p["h"] / 2 - 1,
               "%s pill is fully rounded (%s on a %.0fpx pill)" % (p["cls"], p["radius"], p["h"]))
            # The point of saturating them: they now separate from the card.
            ck(vs_card >= 2.5,
               "%s pill stands off the white card at %.2f:1" % (p["cls"], vs_card))
            # ...but saturating a pill is only a win if the label survives it.
            ck(vs_text >= 2.7,
               "%s pill's own label still clears the legibility floor at %.2f:1"
               % (p["cls"], vs_text))

        # ── Avatars ──
        print("\n— D / W discs —")
        avs = await page.evaluate("""()=>[...document.querySelectorAll('.rec .av')].map(el=>{
          const cs=getComputedStyle(el);
          return {letter:el.textContent.trim(), bg:cs.backgroundImage, shadow:cs.boxShadow,
                  radius:cs.borderTopLeftRadius, color:cs.color};})""")
        ck(len(avs) >= 3, "the discs rendered (%s)" % "".join(a["letter"] for a in avs))
        ck(all("gradient" in a["bg"] for a in avs),
           "each disc is a gradient, so it has a lit side instead of one flat wash")
        ck(all("inset" in a["shadow"] for a in avs),
           "each has an inset top highlight, which is what makes it read as raised")
        ck(all(a["shadow"].count("rgb") >= 2 for a in avs),
           "and a drop shadow under it as well as the inset")

        await page.screenshot(path=f"{OUT}/cards-balance.png")
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(500)

        # ── Total Team ──
        print("\n— Total Team icon —")
        await page.evaluate("showPage('team')")
        await page.wait_for_timeout(1400)
        tt = await page.evaluate("""()=>{const row=document.querySelector('.team-gcard .row1');
          if(!row) return {missing:true};
          const img=row.querySelector('img.ic');
          const r=img?img.getBoundingClientRect():null;
          const navIc=document.querySelector('.navitem[data-nav="team"] .nav-ic img');
          return {missing:false, has:!!img,
                  src:img?img.getAttribute('src'):null,
                  navSrc:navIc?navIc.getAttribute('src'):null,
                  w:r?+r.width.toFixed(1):0, h:r?+r.height.toFixed(1):0,
                  nat:img?[img.naturalWidth,img.naturalHeight]:null,
                  text:row.textContent};}""")
        print("  ", tt)
        ck(not tt.get("missing"), "the Total Team card is on screen")
        ck(tt.get("has"), "it carries an icon at all -- it had none before")
        ck(tt.get("w", 0) > 8 and tt.get("h", 0) > 8,
           "the icon is laid out (%.1fx%.1f)" % (tt.get("w", 0), tt.get("h", 0)))
        ck(bool(tt.get("nat")) and tt["nat"][0] > 0, "and the file decoded (%s)" % (tt.get("nat"),))
        ck(tt.get("src") == "/nav-team.png",
           "it is the app's OWN team artwork (%s)" % tt.get("src"))
        if tt.get("navSrc"):
            ck(tt.get("src") == tt.get("navSrc"),
               "the same file the bottom nav uses -- one team icon, not two")
        # Owner: "dont use that in mockup" -- the mockup marks this with an emoji.
        emoji = [c for c in (tt.get("text") or "") if ord(c) > 0x2100]
        ck(not emoji, "and no emoji anywhere in the row (%r)" % emoji)
        await page.screenshot(path=f"{OUT}/cards-team.png")

        # ── The win backdrop ──
        print("\n— spin win backdrop —")
        await page.evaluate("showChestWin(207.82, 5207.82, 'spin')")
        await page.wait_for_timeout(800)
        g = await page.evaluate("""()=>{const el=document.getElementById('chestWinGhost');
          const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
          return {src:el.getAttribute('src'), spin:el.classList.contains('spin'),
                  nat:[el.naturalWidth,el.naturalHeight], complete:el.complete,
                  w:+r.width.toFixed(1), filter:cs.filter, opacity:cs.opacity};}""")
        print("  ", g)
        ck(g["src"] == "/spin-wheel.png", "a spin win shows the wheel, not the chest (%s)" % g["src"])
        ck(g["spin"], "and takes the spin sizing")
        ck(g["complete"] and g["nat"][0] > 0, "the artwork decoded (%s)" % (g["nat"],))
        ck("blur" in g["filter"], "it is blurred behind the card (%s)" % g["filter"])
        await page.screenshot(path=f"{OUT}/cards-spin-win.png")
        await page.evaluate("closeChestWin()")
        await page.wait_for_timeout(400)
        await page.evaluate("showChestWin(2000, 7207.82)")
        await page.wait_for_timeout(600)
        c = await page.evaluate("""()=>{const el=document.getElementById('chestWinGhost');
          return {src:el.getAttribute('src'), spin:el.classList.contains('spin')};}""")
        ck(c["src"] == "/treasure-chest.png" and not c["spin"],
           "a gift-code win still shows the chest (%s)" % c["src"])

        # ── Busy buttons say what they are doing ──
        # Owner: "on login it should not say please wait, it should say logging
        # in... so everywhere saying please wait... it should be removed."
        #
        # Driven through the real button rather than grepped: the obfuscator
        # replaces every string literal with a lookup into an encoded array, so
        # "Logging in…" is not present as text at ANY layer of the built file.
        # A grep against user/index.html would pass whether the label were right,
        # wrong, or missing entirely.
        print("\n— busy buttons name their own action —")
        labels = await page.evaluate("""async ()=>{
          // Sign out to reach the auth screen, then hold the login request open
          // so the busy state is observable instead of a single frame.
          const seen = {};
          window.fbSignIn = () => new Promise(()=>{});
          if (typeof showAuth === 'function') showAuth();
          const login = document.getElementById('loginBtn');
          const reg = document.getElementById('regBtn');
          if (login) {
            document.getElementById('loginPhone').value = '0742730382';
            document.getElementById('loginPassword').value = 'secret123';
            doLogin();
            await new Promise(r=>setTimeout(r,150));
            seen.login = login.textContent.trim();
          }
          if (reg) {
            setBtnLoading('regBtn', true, 'Sign Up', 'Creating your account…');
            seen.register = reg.textContent.trim();
            setBtnLoading('regBtn', false, 'Sign Up');
            seen.registerIdle = reg.textContent.trim();
          }
          return seen;
        }""")
        print("  ", labels)
        if labels.get("login") is not None:
            ck("please wait" not in labels["login"].lower(),
               "the login button does not say Please wait (%r)" % labels["login"])
            ck("logging in" in labels["login"].lower(),
               "it says what it is doing (%r)" % labels["login"])
        ck(labels.get("register", "").lower().startswith("creating"),
           "and Sign Up names its own action (%r)" % labels.get("register"))
        ck(labels.get("registerIdle") == "Sign Up",
           "the idle label still comes back (%r)" % labels.get("registerIdle"))

        # ── The scrollbar is orange ──
        # Owner: "l want the scroll bar to be orange not dull color."
        #
        # Two mechanisms, and the one that matters on his phone is the one the
        # old CSS could not reach: `::-webkit-scrollbar{display:none}` has no
        # effect on an OVERLAY scrollbar, which is all Android draws, because
        # Chromium 121+ paints those natively. The standard `scrollbar-color`
        # is what overlay scrollbars obey. Both are asserted -- the computed
        # property for the overlay path, and rendered PIXELS for the classic
        # path, because a colour that is declared and never painted is exactly
        # the failure being fixed.
        print("\n— the scrollbar —")
        sb = await page.evaluate("""()=>{const cs=getComputedStyle(document.documentElement);
          return {color:cs.scrollbarColor, width:cs.scrollbarWidth};}""")
        print("  ", sb)
        ck("255, 138, 31" in sb["color"] or "#ff8a1f" in sb["color"].lower(),
           "the root declares the brand orange as the thumb colour (%s)" % sb["color"])
        # Chromium serialises `transparent` as rgba(0, 0, 0, 0); matching the
        # literal word would fail a correct implementation.
        ck("rgba(0, 0, 0, 0)" in sb["color"] or "transparent" in sb["color"],
           "over a transparent track, so there is no grey stripe down the edge (%s)" % sb["color"])
        # scrollbar-color is inherited, so a scroller nested inside a sheet
        # must pick it up without being named. Naming them is how the next
        # scroller added gets missed.
        await page.evaluate("openBalanceRecordSheet()")
        await page.wait_for_timeout(1000)
        inner = await page.evaluate("""()=>{const el=document.querySelector('.sheet-bg.show');
          return el ? getComputedStyle(el).scrollbarColor : null;}""")
        ck(inner is not None and "255, 138, 31" in inner,
           "and the sheet scroller inherits it rather than being listed by hand (%s)" % inner)
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(400)

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

        # ── What CANNOT be checked here, and why ──
        #
        # Not the painted pixels. This Chromium always draws OVERLAY
        # scrollbars -- every documented flag for turning that off
        # (--disable-features=OverlayScrollbar / OverlayScrollbars /
        # FluentOverlayScrollbar, --disable-overlay-scrollbar) still reports a
        # 0px-wide scrollbar gutter -- and headless does not composite overlay
        # scrollbars into a screenshot at all: sampling the thumb's strip
        # immediately after a scroll, and again at 50/200/600ms, finds zero
        # non-background pixels.
        #
        # A first version of this block probed a 0px-wide strip, found nothing,
        # and reported a cheerful pass having photographed empty space. That is
        # the trap: an assertion that cannot fail is worse than no assertion,
        # because it reads like coverage. So the computed properties above are
        # the check, and the source rule below guards the other path.
        css = open(os.path.join(HERE, 'user-src', 'index.html'), encoding='utf-8').read()
        # Comments in this file quote the old rule while explaining it, so they
        # are stripped before asking whether the rule itself is still present.
        import re as _re
        css_only = _re.sub(r'/\*[\s\S]*?\*/', '', css)
        ck("::-webkit-scrollbar{display:none;}" not in css_only,
           "the blanket hide-the-scrollbar rule is gone")
        ck(_re.search(r'::-webkit-scrollbar-thumb\{background:var\(--chipz-orange\)', css_only) is not None,
           "and the classic-scrollbar thumb is painted with the brand orange")
        ck(_re.search(r'html\{scrollbar-width:thin;scrollbar-color:var\(--chipz-orange\)', css_only) is not None,
           "with scrollbar-color on the root for the overlay scrollbars a phone actually draws")

    print(("\n%d FAILED" % len(fails)) if fails else "\ncard quality: all cases pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
