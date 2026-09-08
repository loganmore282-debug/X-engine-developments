"""
The numbers taken off the owner's mockups, pinned.

He sends screenshots of his mockup beside the live app and says things like
"things are small even see number" or "our dialog is too high". Those are real
observations, but "bigger" and "shorter" are not values you can put in a
stylesheet -- and guessing at them is how a screen ends up overshooting in the
other direction, which has already happened once with the nav icons.

So every target here was MEASURED off his mockup, as a fraction of screen
width. That is the only dpr-independent comparison available: his screenshots
and ours are both 720px wide, but the CSS pixel size behind them is unknown,
so glyph heights compare directly while absolute pixel values do not.

Recorded so the next person does not have to re-derive them:

  WITHDRAW (his mockup vs the live screen, device px of ink, both 720 wide)
    balance figure            38 -> 55   undersized 1.45x
    amount input             19 -> 28   undersized 1.47x
    trade-password field     14 -> 21   undersized 1.50x
    "Withdrawal Wallet"      23 -> 24   already right
    "Trade Password"         23 -> 24   already right
    instruction list         18-23 -> 16  OURS IS BIGGER -- left alone
    wallet card number       32 -> 24   OURS IS BIGGER -- widened tracking
                                        instead, which is what actually
                                        differed
  ALERT DIALOG (fractions of screen width)
    card width               73.9%
    card height              53.3%
    warning triangle         11.0%
    OK button                19.3% x 11.0%, fully rounded
  ANNOUNCEMENT DIALOG
    card height              74.9% OF VIEWPORT HEIGHT (ours was 96%)
    close ring               10.7% of screen width, 1px hairline, no fill
    X inside the ring        41% of the ring's diameter

The one deliberate departure from the mockups is colour: they are drawn in a
purple/green theme and Chipz is red/orange, so the OK button and the Join
Channel button use the brand gradient. Every proportion is his.
"""
import asyncio, io, json, os, re, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mockup-proportions'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'user')
PORT = 8871
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone": "0742730382", "walletBalance": 18170.24, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 28000,
           "checkinStreak": 2, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 3, "l2": 1, "l3": 0, "commission": 7840}}
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 5000, "withdrawFeePct": 15,
        "withdrawMultiple": 5000, "commL1": 28, "commL2": 1, "commL3": 1,
        "annEnabled": True, "annTitle": "Welcome",
        "annBody": ("Chipz was built to meet your everyday investing needs.\n\n"
                    "Share your referral link to earn commission on every deposit "
                    "your team makes."),
        "telegramChannel": "https://t.me/chipz",
        "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": True}},
    "/public/products": {"status": "success", "products": []},
    "/public/activity-feed": {"status": "success", "feed": []},
    "/public/banner": {"status": "success", "image": None},
    "/public/announcement-image": {"status": "success", "image": None},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                             "profilegif": None, "downloadbg": None, "authhero": None,
                             "authcard": None},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": [], "truncated": False},
    "/messages": {"status": "success", "messages": [
        {"id": "welcome", "title": "Welcome to the Chipz Investment Returns app!",
         "body": "You can earn daily income through investments via the app.\n\n"
                 "You can also earn commission by sharing your referral link.",
         "date": "31/08/2026", "time": "08:59", "createdAt": 0, "read": False}]},
    "/bank/list": {"status": "success", "accounts": [
        {"id": "b1", "holder": "Mangalita Namugabwe", "network": "MTN Mobile Money",
         "phone": "0769968158"}]},
    "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0,
                    "teamCommission": 0, "teamDeposits": 0, "milestones": []},
    "/turntable/status": {"status": "success", "enabled": False, "dailyAvailable": False,
                          "earnedSpins": 0, "totalSpins": 0, "nextDailyAt": 0,
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


def median_colour(png_bytes):
    """The region's own colour, as the median pixel. A mean would be pulled
    around by whatever text or card edges fall inside the crop."""
    im = Image.open(io.BytesIO(png_bytes)).convert('RGB')
    px = list(im.getdata())
    return tuple(sorted(p[i] for p in px)[len(px) // 2] for i in range(3))


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


async def main():
    errs, fails = [], []

    def ck(ok, label):
        print(("PASS  " if ok else "FAIL  ") + label)
        if not ok:
            fails.append(label)

    def near(actual, target, tol, label, unit='%'):
        ok = abs(actual - target) <= tol
        ck(ok, "%s: %.1f%s against the mockup's %.1f%s (±%.1f)"
           % (label, actual, unit, target, unit, tol))

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
        await page.wait_for_timeout(3000)

        # ── The announcement is up on boot: measure it before closing ──
        print("— announcement dialog —")
        ann = await page.evaluate("""()=>{const w=document.querySelector('.announce-wrap');
          const c=document.querySelector('.announce-close');
          const svg=c?c.querySelector('svg'):null;
          const wr=w?w.getBoundingClientRect():null, cr=c?c.getBoundingClientRect():null;
          const cs=c?getComputedStyle(c):null, ws=w?getComputedStyle(w):null;
          return {h:wr&&+wr.height.toFixed(1), maxH:ws&&ws.maxHeight, vh:innerHeight, vw:innerWidth,
                  ring:cr&&+cr.width.toFixed(1), border:cs&&cs.borderTopWidth,
                  fill:cs&&cs.backgroundColor,
                  svg:svg?+svg.getBoundingClientRect().width.toFixed(1):0};}""")
        print("  ", ann)
        ck(ann["h"] is not None, "the announcement is on screen")
        # The ceiling is the fix for "our dialog is too high" -- it was inset:14px,
        # i.e. 96% of the viewport, edge to edge with no backdrop showing.
        ck(ann["maxH"] and ann["maxH"] != 'none',
           "the card has a height CEILING rather than filling the screen (%s)" % ann["maxH"])
        ceiling = round(100 * float(ann["maxH"].rstrip('px')) / ann["vh"], 1) if ann["maxH"].endswith('px') else None
        if ceiling is not None:
            near(ceiling, 74.9, 3.0, "  ceiling as a share of viewport height")
        ck(ann["h"] <= ann["vh"] * 0.80,
           "and it is nowhere near full height (%.1f%% of viewport)" % (100 * ann["h"] / ann["vh"]))
        near(100 * ann["ring"] / ann["vw"], 10.7, 1.2, "  close ring width")
        ck(ann["border"] == "1px",
           "the ring is a 1px hairline, not a heavy border (%s)" % ann["border"])
        ck(ann["fill"] in ("rgba(0, 0, 0, 0)", "transparent"),
           "with no fill, so the card shows through (%s)" % ann["fill"])
        near(100 * ann["svg"] / ann["ring"], 41.0 / 0.75, 12.0,
             "  X size relative to the ring")   # svg box is larger than its drawn X
        await page.screenshot(path=f"{OUT}/prop-announce.png")
        await page.evaluate("closeAnnounce()")
        await page.wait_for_timeout(500)

        # ── The alert ──
        print("\n— alert dialog —")
        await page.evaluate("notify('Please enter the treasure chest key')")
        await page.wait_for_timeout(500)
        al = await page.evaluate("""()=>{const c=document.querySelector('.notify-card');
          // The warning sign is the emoji glyph now, not an <svg> -- the owner
          // compared ours against his and his is the system emoji. Its ink is
          // measured off the font-size, since a text node has no box of its own.
          const ic=document.querySelector('.notify-icon'), ok=document.querySelector('.notify-ok');
          const r=c.getBoundingClientRect(), orr=ok.getBoundingClientRect();
          const ics=getComputedStyle(ic);
          return {w:+r.width.toFixed(1), h:+r.height.toFixed(1), vw:innerWidth,
                  icon:parseFloat(ics.fontSize), glyph:(ic.textContent||'').trim(),
                  okW:+orr.width.toFixed(1), okH:+orr.height.toFixed(1),
                  radius:getComputedStyle(ok).borderTopLeftRadius,
                  msg:document.getElementById('notifyMsg').textContent};}""")
        print("  ", al)
        near(100 * al["w"] / al["vw"], 73.9, 2.0, "  card width")
        # Height gets a wider tolerance: it is content-driven, and a message
        # that wraps to two lines is taller than one that does not. His mockup's
        # message wraps too, which is why 53.3 is the reference.
        near(100 * al["h"] / al["vw"], 53.3, 6.0, "  card height")
        near(100 * al["icon"] / al["vw"], 11.0, 1.5, "  warning triangle")
        ck(al["glyph"] == "⚠️",
           "the warning sign is the emoji glyph, not a flat drawn triangle (%r)" % al["glyph"])
        near(100 * al["okW"] / al["vw"], 19.3, 2.5, "  OK button width")
        near(100 * al["okH"] / al["vw"], 11.0, 1.5, "  OK button height")
        ck(al["radius"] == "999px", "the OK is a pill, as in the mockup (%s)" % al["radius"])
        ck(al["msg"] == "Please enter the treasure chest key",
           "and it carries the owner's exact wording (%r)" % al["msg"])
        await page.screenshot(path=f"{OUT}/prop-alert.png")
        await page.evaluate("closeNotify()")
        await page.wait_for_timeout(400)

        # ── Withdraw ──
        print("\n— withdraw screen —")
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(800)
        await page.evaluate("openWithdrawSheet()")
        await page.wait_for_timeout(1400)
        w = await page.evaluate("""()=>{const f=s=>{const e=document.querySelector(s);
            return e?parseFloat(getComputedStyle(e).fontSize):0;};
          const ls=s=>{const e=document.querySelector(s);
            return e?getComputedStyle(e).letterSpacing:null;};
          return {balance:f('.wit-bal .val'), amount:f('.wit-amt input'), pw:f('.wit-pw input'),
                  heading:f('.sec-head h2'),
                  instr:f('.wit-instr ol'), num:f('.wallet-card .num'),
                  track:ls('.wallet-card .num'), provider:f('.wallet-card .provider')};}""")
        print("  ", w)
        # The three that measured undersized, at roughly 1.45x their old values.
        ck(w["balance"] >= 38, "the balance figure is %.0fpx (was 28, mockup ratio 1.45x)" % w["balance"])
        ck(w["amount"] >= 22, "the amount you type is %.0fpx (was 16)" % w["amount"])
        ck(w["pw"] >= 21, "the trade-password field is %.0fpx (was 15)" % w["pw"])
        # And the ones that were ALREADY right must not have been dragged up too.
        ck(20 <= w["heading"] <= 24,
           "the section headings were already correct and stayed put (%.0fpx)" % w["heading"])
        ck(12 <= w["instr"] <= 15,
           "so did the instruction list, which is bigger than his already (%.0fpx)" % w["instr"])
        # The card number differed by TRACKING, not size.
        ck(w["num"] >= 22, "the card number keeps its size (%.0fpx)" % w["num"])
        ck(w["track"] and float(w["track"].rstrip("px")) >= 3.0,
           "and gains the mockup's wide tracking (%s)" % w["track"])
        await page.screenshot(path=f"{OUT}/prop-withdraw.png")

        # Deposit is the SAME control on the sibling screen; if it drifts back,
        # the two screens disagree, which is its own complaint waiting to
        # happen. It has to be measured on the Deposit sheet -- a first version
        # read it while Withdraw was open, found no element, and reported 0px
        # against 23px as a failure of the CSS rather than of the test.
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(600)
        await page.evaluate("openDepositSheet()")
        await page.wait_for_timeout(1400)
        dep = await page.evaluate(
            "()=>{const e=document.querySelector('.dep-amt input');"
            "return e?parseFloat(getComputedStyle(e).fontSize):0;}")
        print("   deposit amount field:", dep)
        ck(dep > 0, "the Deposit sheet rendered its amount field at all (%.0fpx)" % dep)
        ck(abs(dep - w["amount"]) < 0.6,
           "and it matches Withdraw's (%.0f vs %.0f)" % (dep, w["amount"]))

        # ── Messages: the backdrop, and the slide ──
        # Owner: "you can see blurry green, and message doesn't slide from
        # down." Measured off the two screenshots at matched width: his
        # backdrop is rgb(163,218,186) -- luminance 189, a LIGHT tinted wash
        # with the list blurred behind it. Ours was rgb(134,125,118),
        # luminance 126: a flat grey-brown dim. Those are opposite operations,
        # not a shade apart, which is why a "make it darker/lighter" tweak
        # would never have got there.
        print("\n— messages —")
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(500)
        await page.evaluate("openMessagesSheet()")
        await page.wait_for_timeout(1200)
        row = await page.evaluate(
            "()=>{const r=document.querySelector('.msg-row');"
            "return r?{shadow:getComputedStyle(r).boxShadow,"
            "bg:getComputedStyle(r).backgroundImage}:null;}")
        if row:
            # His unread row is lit, not merely outlined: a tinted glow and a
            # gradient rather than a flat white rectangle.
            ck("gradient" in row["bg"], "the unread row is a gradient card, not flat white")
            ck("rgba(226, 27, 42" in row["shadow"] or "rgb(226, 27, 42" in row["shadow"],
               "and carries a brand-tinted glow rather than the neutral card shadow")

        # The slide, sampled over real frames.
        frames = await page.evaluate(
            "async ()=>{ openMessageDetail(0);"
            " const seen=[]; const t0=performance.now();"
            " while(performance.now()-t0 < 620){"
            "  const el=document.querySelector('.msg-detail');"
            "  if(el){const t=getComputedStyle(el).transform;"
            "   const m=t&&t!=='none'?t.match(/matrix\\(([^)]*)\\)/):null;"
            "   seen.push(m?Math.round(parseFloat(m[1].split(',')[5])):0);}"
            "  await new Promise(r=>requestAnimationFrame(r));}"
            " return seen;}")
        await page.wait_for_timeout(600)
        det = await page.evaluate(
            "()=>{const bg=document.querySelector('.msg-detail-bg');"
            "const d=document.querySelector('.msg-detail');"
            "const r=d.getBoundingClientRect(); const cs=getComputedStyle(bg);"
            "const ds=getComputedStyle(d);"
            "const br=bg.getBoundingClientRect();"
            "const nav=document.querySelector('.bottom-nav');"
            "const nr=nav?nav.getBoundingClientRect():null;"
            "return {h:+r.height.toFixed(1), vh:innerHeight,"
            " filter:(cs.backdropFilter||cs.webkitBackdropFilter||'none'),"
            " tint:cs.backgroundColor,"
            " topR:ds.borderTopLeftRadius, botR:ds.borderBottomLeftRadius,"
            " left:+r.left.toFixed(1), right:+(innerWidth-r.right).toFixed(1),"
            " bgBottom:+br.bottom.toFixed(1), navTop:nr?+nr.top.toFixed(1):null,"
            " gapUnderCard:+(br.bottom-r.bottom).toFixed(1)};}")
        print("   slide max %d, settles %d | %s" % (max(frames), frames[-1], det))
        # It was translateY(24px) over .22s -- a nudge, i.e. "doesn't slide
        # from down". A real slide starts at roughly the sheet's own height.
        ck(max(frames) >= det["h"] * 0.85,
           "the sheet really slides up from below (travels %dpx of its %dpx height)"
           % (max(frames), det["h"]))
        ck(frames[-1] == 0, "and settles at rest (%d)" % frames[-1])
        ck("blur" in det["filter"],
           "the backdrop is blurred, which is what 'blurry' meant (%s)" % det["filter"])
        # Owner, round 2: "see the message when tapped, it leaves a nav icons
        # but see yours how you did it and you poorly designed it." In his the
        # overlay stops above the bottom bar and the card floats clear of every
        # edge; ours covered the screen and welded the card to the bottom.
        ck(det["navTop"] is not None and abs(det["bgBottom"] - det["navTop"]) <= 1.5,
           "the backdrop stops at the bottom bar, leaving the nav sharp (%.0f vs %.0f)"
           % (det["bgBottom"], det["navTop"]))
        ck(det["topR"] == det["botR"] and det["botR"] != "0px",
           "the card is rounded on every corner -- it floats, not welded to an edge (%s / %s)"
           % (det["topR"], det["botR"]))
        ck(det["left"] >= 12 and det["right"] >= 12,
           "and is inset from both sides like his (%.0f / %.0fpx)"
           % (det["left"], det["right"]))
        ck(det["gapUnderCard"] >= 12,
           "with the same gap beneath it (%.0fpx)" % det["gapUnderCard"])
        # "not even blur" was the tint drowning it: a wash opaque enough to
        # hide the page hides the blur too. Read off the declared alpha, since
        # the composite is checked in pixels just below.
        alpha = float(det["tint"].rstrip(")").split(",")[-1]) if "rgba" in det["tint"] else 1.0
        ck(alpha <= 0.34,
           "the tint stays see-through enough for the blur to read (alpha %.2f)" % alpha)
        # Rendered pixels, not the declared colour: the tint and the blur
        # composite, and only the result can be compared with his screenshot.
        shot = await page.screenshot(clip={"x": 40, "y": 60, "width": 300, "height": 120})
        avg = median_colour(shot)
        lumin = sum(avg) / 3
        print("   backdrop %s luminance %.0f (his: (163,218,186) luminance 189)" % (avg, lumin))
        ck(lumin > 160,
           "the backdrop LIGHTENS the page like his (%.0f) instead of dimming it (was 126)"
           % lumin)
        ck(avg[0] > avg[2] + 40,
           "and it is clearly tinted, not grey %s" % (avg,))
        await page.screenshot(path=f"{OUT}/prop-messages.png")

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    # ── The wording he named, at both ends ──
    print("\n— the two messages he asked for —")
    mod = open(os.path.join(HERE, 'user-src', 'original_module.js'), encoding='utf-8').read()
    srv_src = open(os.path.join(HERE, 'server.js'), encoding='utf-8').read()
    strip = lambda t: re.sub(r'//[^\n]*', '', re.sub(r'/\*[\s\S]*?\*/', ' ', t))
    ck("notify('Please enter the treasure chest key')" in strip(mod),
       "the empty-key message is the owner's wording")
    ck("'Wrong treasure chest password'" in strip(srv_src),
       "and the server says 'Wrong treasure chest password' for a key that is not a key")
    # The other failures are real codes in a wrong state -- calling those
    # "wrong" would send someone hunting for a typo that isn't there.
    ck("This code has expired" in srv_src and "already" in srv_src.lower(),
       "while expired / already-used codes keep saying what is actually wrong")

    print(("\n%d FAILED" % len(fails)) if fails else "\nmockup proportions: all cases pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
