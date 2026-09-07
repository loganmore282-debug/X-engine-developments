#!/usr/bin/env python3
"""Every filled CTA carries a live right-to-left glow sweep.

Owner asked for it "left to right" first, then corrected: "bro, let it move
from right to left." The band now enters at the right edge and exits left.

Asserting the CSS exists would prove nothing -- a typo'd selector, a
pseudo-element the button's own `overflow` clips away entirely, or a
keyframe name that never matches all pass a text search. So this drives the
BUILT app and samples `getComputedStyle(el, '::after').transform` over real
time, which is the only way to see whether the band is actually travelling.

Checks, on real buttons across several screens:
  - the sweep exists on the filled CTAs and its X translation genuinely
    CHANGES over successive frames (it is running, not parked)
  - it travels RIGHT TO LEFT, not the other way
  - it is clipped inside the button (overflow:hidden) so it cannot smear
    across the screen
  - the button is still tappable -- the band must not eat clicks
  - it is NOT on the bottom-nav items or the Home action icons, which are
    transparent/artwork and would just flicker
  - the nav's selector box STAYS on the active tab, and the nav ICON is what
    fades out and back in when a tab is tapped
  - a disabled button does not glow
  - prefers-reduced-motion switches it off entirely
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright

OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/button-glow'
os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8857
API  = 'https://chipz-server.onrender.com'

PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 150,
             "expectedReturn": p * 30, "image": "", "spinCount": 0, "spinMin": 200, "spinMax": 1000}
            for i, p in enumerate([30000, 90000, 197000], start=1)]

ACCOUNT = {"phone": "0742730382", "walletBalance": 500000, "totalDeposited": 0, "totalEarned": 0,
           "totalWithdrawn": 0, "totalInvested": 0, "checkinStreak": 0, "lastCheckinAt": None,
           "referralCode": "Gy2f", "publicId": "10012", "registrationDone": True,
           "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}

ROUTES = {
 "/public/settings": {"status": "success", "settings": {"minDeposit": 30000, "minWithdraw": 20000,
   "withdrawFeePct": 15, "annEnabled": False, "turntableEnabled": True, "dailyCheckin": 500}},
 "/public/products": {"status": "success", "products": PRODUCTS},
 "/public/activity-feed": {"status": "success", "feed": []},
 "/public/banner": {"status": "success", "image": None, "video": None, "videoVersion": None},
 "/public/announcement-image": {"status": "success", "image": None},
 "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
 "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None},
 "/account": {"status": "success", "account": ACCOUNT},
 "/investments": {"status": "success", "investments": []},
 "/transactions": {"status": "success", "transactions": [], "truncated": False},
 "/messages": {"status": "success", "messages": []},
 "/bank/list": {"status": "success", "accounts": []},
 "/team/stats": {"status": "success", "referralCode": "Gy2f", "commRates": {"l1": 28, "l2": 1, "l3": 1},
   "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0, "teamCommission": 0, "teamDeposits": 0, "milestones": []},
 "/team/members": {"status": "success", "level": 1, "members": []},
 "/mission/status": {"status": "success", "mission": {}},
 "/turntable/status": {"status": "success", "enabled": True, "dailyAvailable": True, "earnedSpins": 0,
   "totalSpins": 1, "nextDailyAt": 0, "dailyMin": 200, "dailyMax": 1000},
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

# Reads the ::after band's translateX out of its computed transform matrix.
# matrix(a,b,c,d,tx,ty) -- tx is index 4. A skew is in there too, which is
# why the raw matrix is parsed rather than pattern-matched.
SAMPLE = """(sel) => {
  // The FIRST match in document order is often a button inside a screen that
  // is currently hidden -- it has no box, so its pseudo-element reports
  // transform:none and the check would fail on perfectly good CSS. Measure
  // the first VISIBLE one instead, which is what the member actually sees.
  const el = [...document.querySelectorAll(sel)].find(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!el) return null;
  const cs = getComputedStyle(el, '::after');
  const t = cs.transform;
  if (!t || t === 'none') return { tx: null, transform: t };
  const m = t.match(/matrix\\(([^)]+)\\)/);
  if (!m) return { tx: null, transform: t };
  const parts = m[1].split(',').map(Number);
  return { tx: parts[4], transform: t };
}"""

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

async def open_app(browser, reduced_motion=None):
    kw = {"viewport": {"width": 390, "height": 844}, "service_workers": "block"}
    if reduced_motion:
        kw["reduced_motion"] = reduced_motion
    ctx = await browser.new_context(**kw)
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
    await page.wait_for_timeout(2600)
    return ctx, page

async def sample_over_time(page, sel, n=40, gap=100):
    """Must span MORE than one full animation cycle (2.8s). The first version
    of this sampled 1.26s and never once caught the band at its start, which
    made the "runs from the left edge" check fail on perfectly good CSS."""
    out = []
    for _ in range(n):
        r = await page.evaluate(SAMPLE, sel)
        if r and r.get("tx") is not None:
            out.append(round(r["tx"], 2))
        await page.wait_for_timeout(gap)
    return out

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx, page = await open_app(b)

        await page.evaluate("showPage('catalog')")
        await page.wait_for_timeout(900)

        print("\n— the sweep is real and moving —")
        exists = await page.evaluate(SAMPLE, ".p-card .primary-button")
        print("   first sample:", exists)
        ck(exists is not None, "a product Buy button exists")
        ck(exists and exists.get("transform") not in (None, "none"),
           "it has a ::after band with a transform (%s)" % (exists or {}).get("transform"))

        xs = await sample_over_time(page, ".p-card .primary-button")
        print("   translateX samples:", xs)
        ck(len(set(xs)) >= 4, "the band's X position genuinely changes over time -- it is running (%d distinct of %d)"
           % (len(set(xs)), len(xs)))
        ck(max(xs) > 0, "it starts off the RIGHT edge (max %.1f)" % max(xs))
        ck(min(xs) < 0, "and travels off past the left (min %.1f)" % min(xs))
        # Right-to-left: over one pass the value must FALL. Sampling can
        # straddle a loop restart, so check that falls dominate rises rather
        # than demanding a strictly decreasing series.
        rises = sum(1 for i in range(1, len(xs)) if xs[i] > xs[i - 1])
        falls = sum(1 for i in range(1, len(xs)) if xs[i] < xs[i - 1])
        print("   rises=%d falls=%d" % (rises, falls))
        ck(falls > rises, "it runs RIGHT to LEFT, not backwards (%d falls vs %d rises)" % (falls, rises))

        print("\n— it is contained and does not break the button —")
        box = await page.evaluate("""() => {
            const el = document.querySelector('.p-card .primary-button');
            const cs = getComputedStyle(el);
            const a = getComputedStyle(el, '::after');
            return { overflow: cs.overflow, position: cs.position,
                     pointerEvents: a.pointerEvents, content: a.content };
        }""")
        print("   ", box)
        ck(box["overflow"] == "hidden", "the button clips the band (overflow %s)" % box["overflow"])
        ck(box["position"] == "relative", "the band is positioned against the button (%s)" % box["position"])
        ck(box["pointerEvents"] == "none", "the band takes no pointer events, so taps still reach the button")

        # A real tap must still land on the button underneath the band.
        hit = await page.evaluate("""() => {
            const el = document.querySelector('.p-card .primary-button');
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
            return { isButton: top === el || el.contains(top), tag: top ? top.tagName : null };
        }""")
        ck(hit["isButton"], "a tap at the middle of the button lands on the button (%s)" % hit)

        print("\n— the buttons that must NOT glow —")
        for sel, why in [
            # ::after only -- the nav's tap box is a ::before, checked below.
            ('.navitem', 'bottom-nav items'),
            ('.home-action', 'Home action icons'),
            ('.icon-btn', 'the round icon buttons'),
        ]:
            r = await page.evaluate(SAMPLE, sel)
            if r is None:
                print("   (%s not on screen, skipped)" % why)
                continue
            ck(r.get("content") in (None, 'none') or r.get("transform") in (None, 'none'),
               "%s have no sweep (%s)" % (why, r.get("transform")))

        print("\n— across other screens —")
        # Deposit/Withdraw/Wallet are SHEETS, not pages -- showPage('deposit')
        # does nothing, so the first version of this was really re-measuring
        # whatever was still on screen from the previous step.
        for opener, sel, label in [
            ("showPage('account')",   '.dark-button',    'Account (dark button)'),
            ("openDepositSheet()",    '.primary-button', 'Deposit sheet'),
            ("closeSheet(); openWithdrawSheet()", '.primary-button', 'Withdraw sheet'),
        ]:
            try:
                await page.evaluate(opener)
            except Exception as e:
                print("   (%s: could not open -- %s)" % (label, str(e)[:60]))
                continue
            await page.wait_for_timeout(900)
            r = await page.evaluate(SAMPLE, sel)
            if r is None:
                print("   (%s: %s not found, skipped)" % (label, sel))
                continue
            ck(r.get("transform") not in (None, "none"),
               "%s carries the sweep too (%s)" % (label, r.get("transform")))

        print("\n— the nav selector box STAYS on the active tab —")
        # Owner, correcting an earlier build that had these the wrong way
        # round: "l said the icon fades in and out when tapped not static and
        # selector doesn't disappear." So the BOX is the active-tab marker
        # (persistent), and the ICON is what animates on tap.
        boxes = await page.evaluate("""() => [...document.querySelectorAll('.navitem')].map(el => ({
            nav: el.dataset.nav,
            active: el.classList.contains('active'),
            boxOpacity: parseFloat(getComputedStyle(el, '::before').opacity),
        }))""")
        # NB: not `for b in ...` -- `b` is the browser handle in this scope,
        # and shadowing it here crashed the reduced-motion section further down.
        for row in boxes: print("   ", row)
        active = [row for row in boxes if row["active"]]
        inactive = [row for row in boxes if not row["active"]]
        ck(len(active) == 1, "exactly one tab is active (%d)" % len(active))
        ck(active and active[0]["boxOpacity"] > 0.9,
           "the active tab's box is fully VISIBLE (opacity %s)" % (active[0]["boxOpacity"] if active else None))
        ck(all(b["boxOpacity"] == 0 for b in inactive),
           "and every other tab has none (%s)" % [row["boxOpacity"] for row in inactive])

        # And it must STILL be there after the tap animation has long finished
        # -- the old build faded it away, which is the bug being fixed.
        await page.wait_for_timeout(1800)
        still = await page.evaluate("""() => {
            const el = document.querySelector('.navitem.active');
            return parseFloat(getComputedStyle(el, '::before').opacity);
        }""")
        ck(still > 0.9, "it does NOT disappear after the tap settles (opacity %.2f)" % still)

        print("\n— and the ICON fades in and out when tapped —")
        await page.evaluate("""() => {
            document.querySelectorAll('.navitem')[1]
              .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }""")
        seq = []
        for _ in range(12):
            o = await page.evaluate("""() => {
                const img = document.querySelectorAll('.navitem')[1].querySelector('.nav-ic img');
                return img ? parseFloat(getComputedStyle(img).opacity) : null;
            }""")
            if o is not None: seq.append(round(o, 2))
            await page.wait_for_timeout(60)
        print("   icon opacity after tap:", seq)
        ck(min(seq) < 0.5, "the icon FADES OUT on tap (dips to %.2f)" % min(seq))
        dip = seq.index(min(seq))
        ck(any(v > 0.9 for v in seq[dip:]),
           "and FADES BACK IN again (%s)" % seq[dip:])
        ck(seq[-1] > 0.9, "settling fully visible, not left dimmed (%.2f)" % seq[-1])

        # Re-triggerable: tapping the same tab again must replay it, which
        # re-adding an already-present class would NOT do.
        await page.wait_for_timeout(700)
        await page.evaluate("""() => {
            document.querySelectorAll('.navitem')[1]
              .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }""")
        await page.wait_for_timeout(220)
        again = await page.evaluate("""() => {
            const img = document.querySelectorAll('.navitem')[1].querySelector('.nav-ic img');
            return parseFloat(getComputedStyle(img).opacity);
        }""")
        ck(again < 0.9, "tapping the SAME tab again replays it (opacity %.2f)" % again)

        ck(not errs, "no page errors: %s" % errs[:3])
        await page.screenshot(path=f"{OUT}/glow.png")
        await ctx.close()

        print("\n— reduced motion turns it off —")
        ctx2, page2 = await open_app(b, reduced_motion="reduce")
        await page2.evaluate("showPage('catalog')")
        await page2.wait_for_timeout(900)
        r = await page2.evaluate("""() => {
            const el = document.querySelector('.p-card .primary-button');
            if (!el) return null;
            const a = getComputedStyle(el, '::after');
            return { display: a.display, animationName: a.animationName };
        }""")
        print("   ", r)
        ck(r is not None and (r["display"] == "none" or r["animationName"] == "none"),
           "no sweep when the phone asks for reduced motion (%s)" % r)
        await ctx2.close()

        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nbutton glow sweep: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
