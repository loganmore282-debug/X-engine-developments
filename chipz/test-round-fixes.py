#!/usr/bin/env python3
"""Five owner-requested changes, measured in the built app.

  1. Mission Center is gone -- the button, the screen, and the boot fetch.
  2. "Loading..." waves letter by letter instead of bobbing as one block.
  3. A nav icon BOUNCES when tapped (in, out past its own size, settle).
  4. Download APP opens a screen with a centred button over an admin image.
  5. COPY INVITE LINK copies. It used to open the share sheet.

Each of these is a thing you can only confirm by watching it happen, so
none of them is checked by reading the stylesheet: the wave is sampled as
real geometry over time, the bounce is sampled through an actual tap, and
the copy is read back out of the clipboard.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright

OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/round-fixes'
os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8873
API  = 'https://chipz-server.onrender.com'

# A 2x3 portrait PNG, enough to prove the <img> is placed and covers.
DL_BG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAFklEQVR4nGP8"
         "z8Dwn4GBgYERxIAAAB0DA/9m2A0GAAAAAElFTkSuQmCC")

ACCOUNT = {"phone":"0742730382","walletBalance":520782,"totalDeposited":0,"totalEarned":0,
 "totalWithdrawn":0,"totalInvested":0,"checkinStreak":0,"lastCheckinAt":None,
 "referralCode":"Gy2f","publicId":"10012","registrationDone":True,
 "team":{"l1":0,"l2":0,"l3":0,"commission":0}}

ROUTES = {
 "/public/settings":{"status":"success","settings":{"minDeposit":30000,"minWithdraw":20000,
   "annEnabled":False,"turntableEnabled":True}},
 # Section 9 taps a product card, so the catalog has to have one. Nothing
 # earlier in this file depends on the list being empty.
 "/public/products":{"status":"success","products":[
   {"key":"product-1","name":"Product-1","price":28000,"cycle":150,"expectedReturn":840000,
    "dailyIncome":5600,"image":"","spinCount":0,"spinMin":200,"spinMax":1000},
   {"key":"product-2","name":"Product-2","price":58000,"cycle":150,"expectedReturn":1740000,
    "dailyIncome":11600,"image":"","spinCount":1,"spinMin":200,"spinMax":1000}]},
 "/public/activity-feed":{"status":"success","feed":[]},
 "/public/banner":{"status":"success","image":None,"video":None,"videoVersion":None},
 "/public/announcement-image":{"status":"success","image":None},
 "/public/manual-pay-images":{"status":"success","selector":None,"hero":None},
 "/public/chipz-images":{"status":"success","referral":None,"logo":None,"spin":None,
   "profilegif":None,"downloadbg":DL_BG},
 "/account":{"status":"success","account":ACCOUNT},
 "/investments":{"status":"success","investments":[]},
 "/transactions":{"status":"success","transactions":[],"truncated":False},
 "/messages":{"status":"success","messages":[]},
 "/bank/list":{"status":"success","accounts":[]},
 "/team/stats":{"status":"success","referralCode":"Gy2f","commRates":{"l1":28,"l2":1,"l3":1},
   "team":{"l1":0,"l2":0,"l3":0},"totalTeam":0,"teamCommission":0,"teamDeposits":0,"milestones":[]},
 "/team/members":{"status":"success","level":1,"members":[]},
 "/turntable/status":{"status":"success","enabled":True,"dailyAvailable":True,"earnedSpins":0,
   "totalSpins":1,"nextDailyAt":0,"dailyMin":200,"dailyMax":1000},
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

fails, errs, asked = [], [], []
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
        ctx = await b.new_context(viewport={"width":390,"height":844}, service_workers="block",
                                  permissions=["clipboard-read","clipboard-write"])
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        async def api(r):
            path = "/" + r.request.url.split("://",1)[-1].split("/",1)[-1].split("?")[0]
            asked.append(path)
            body = next((v for k,v in ROUTES.items() if path.endswith(k)), {"status":"success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        await page.route(f"{API}/**", api)
        await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))

        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(3200)   # let the app come up

        # ── 2. the loading wave ──
        # Measured with the loading screen RE-SHOWN after boot, not during it.
        # During the real boot the main thread is busy inflating and running
        # the ~265 KB core, so no frames are produced and
        # document.timeline.currentTime sits at 0 -- every letter reads as
        # untransformed and a perfectly good wave measures as motionless.
        # (That is a property of the measurement, not of the animation: the
        # same freeze is why the loading screen exists at all.)
        print("— 2. 'Loading...' waves letter by letter —")
        await page.evaluate("()=>{document.getElementById('loadingScreen').style.display='flex';}")
        await page.wait_for_timeout(120)
        letters = await page.evaluate("()=>[...document.querySelectorAll('#loadingScreen .ls-text i')].map(e=>e.textContent)")
        # Six dots, per the reference screenshot the owner sent.
        ck(''.join(letters) == 'Loading......', "every letter and dot is its own element (%r)" % ''.join(letters))
        ck(len(letters) == 13, "13 of them: 7 letters and 6 dots (%d)" % len(letters))
        ck(''.join(letters).count('.') == 6, "six dots, not three")
        delays = await page.evaluate(
            "()=>[...document.querySelectorAll('#loadingScreen .ls-text i')].map(e=>getComputedStyle(e).animationDelay)")
        secs = [float(d.replace('s','')) for d in delays]
        ck(secs == sorted(secs) and secs[-1] > secs[0],
           "each one starts later than the last, which is what makes it a wave not a bob (%s…%s)" % (delays[0], delays[-1]))
        # "the loader animation wave should be slow" -- both halves of that:
        # the per-letter bob AND how long the ripple takes to cross the word.
        dur = await page.evaluate(
            "()=>getComputedStyle(document.querySelector('#loadingScreen .ls-text i')).animationDuration")
        ck(float(dur.replace('s','')) >= 1.8, "the bob itself is slow (%s a cycle, was 1.15s)" % dur)
        ck(secs[-1] >= 1.0,
           "and the ripple takes over a second to cross the word (%.2fs, was 0.5s)" % secs[-1])
        # Wider spacing, and still centred despite it.
        space = await page.evaluate(
            "()=>getComputedStyle(document.querySelector('#loadingScreen .ls-text')).letterSpacing")
        ck(float(space.replace('px','')) >= 3.5, "the letters are set wide apart (%s)" % space)
        # "even loader animation word is small make it abit big"
        size = await page.evaluate(
            "()=>getComputedStyle(document.querySelector('#loadingScreen .ls-text')).fontSize")
        ck(float(size.replace('px','')) >= 24, "and set bigger (%s, was 18px)" % size)
        centring = await page.evaluate("""() => {
            const t = document.querySelector('#loadingScreen .ls-text').getBoundingClientRect();
            const last = getComputedStyle(document.querySelector('#loadingScreen .ls-text i:last-child')).letterSpacing;
            return { offset: Math.round((t.left + t.width/2) - innerWidth/2), lastSpacing: last };
        }""")
        ck(centring['lastSpacing'] in ('normal', '0px'),
           "with no trailing gap after the final dot (%s)" % centring['lastSpacing'])
        ck(abs(centring['offset']) <= 1,
           "so the word sits centred, not pushed left by it (%dpx off)" % centring['offset'])
        # Sampled geometry: at one instant the letters must be at DIFFERENT
        # heights. A block bob has them all equal, and would pass every
        # stylesheet check above.
        spread = 0
        for _ in range(14):
            tops = await page.evaluate(
                "()=>[...document.querySelectorAll('#loadingScreen .ls-text i')].map(e=>Math.round(e.getBoundingClientRect().top*10)/10)")
            spread = max(spread, max(tops) - min(tops))
            await page.wait_for_timeout(45)
        ck(spread > 3, "and they really are at different heights mid-wave (%.1fpx spread)" % spread)
        await page.screenshot(path=f"{OUT}/loading-wave.png")
        await page.evaluate("()=>{document.getElementById('loadingScreen').style.display='none';}")

        # ── 1. Mission Center is gone ──
        print("\n— 1. Mission Center is gone —")
        ck(not any('/mission' in p for p in asked),
           "boot never calls /mission/status (saved on every launch)")
        await page.evaluate("showPage('team')"); await page.wait_for_timeout(700)
        body = await page.inner_text('#pageHost')
        ck('Mission' not in body, "no Mission Center button on Team")
        gone = await page.evaluate("()=>({sheet:typeof window.openMissionCenterSheet,"
                                   "salary:typeof window.claimMissionSalary,"
                                   "dep:typeof window.claimMissionDeposit})")
        ck(all(v == 'undefined' for v in gone.values()),
           "and none of its functions ship at all: %s" % gone)

        # ── 3. the nav bounce ──
        print("\n— 3. a tapped nav icon bounces —")
        await page.evaluate("showPage('home')"); await page.wait_for_timeout(500)
        anim = await page.evaluate("""async () => {
            const btn = document.querySelector('.navitem[data-nav="home"]');
            const img = btn.querySelector('.nav-ic img');
            const scales = [];
            btn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
            const t0 = performance.now();
            while (performance.now() - t0 < 520) {
                const m = new DOMMatrixReadOnly(getComputedStyle(img).transform);
                scales.push(Math.round(m.a * 1000) / 1000);
                await new Promise(r => requestAnimationFrame(r));
            }
            const op = [...new Set(scales.map(()=>getComputedStyle(img).opacity))];
            return { min: Math.min(...scales), max: Math.max(...scales),
                     last: scales[scales.length-1], n: scales.length, opacity: op[0] };
        }""")
        print("   ", anim)
        ck(anim["min"] < 0.85, "it presses IN below its own size (min scale %.2f)" % anim["min"])
        ck(anim["max"] > 1.05, "then springs OUT past it — that overshoot IS the bounce (max %.2f)" % anim["max"])
        ck(abs(anim["last"] - 1.0) < 0.06, "and settles back to normal (%.2f)" % anim["last"])
        # He rejected the fade twice. It must not dim.
        ck(float(anim["opacity"]) > 0.95,
           "and never fades — a dimming icon reads as loading, not a press (opacity %s)" % anim["opacity"])

        # ── 4. the Download screen ──
        print("\n— 4. Download APP opens a screen with a centred button —")
        await page.evaluate("showPage('account')"); await page.wait_for_timeout(600)
        await page.evaluate("openDownloadSheet()"); await page.wait_for_timeout(600)
        dl = await page.evaluate("""() => {
            const scr = document.querySelector('.dl-screen');
            if (!scr) return null;
            const bg = scr.querySelector('.dl-bg'), btn = document.getElementById('dlInstallBtn');
            const s = scr.getBoundingClientRect(), b = btn.getBoundingClientRect();
            const bgr = bg ? bg.getBoundingClientRect() : null;
            return { title: document.getElementById('sheetTitle').textContent,
                     hasBg: !!bg, bgSrc: bg ? bg.src.slice(0, 20) : null,
                     bgFit: bg ? getComputedStyle(bg).objectFit : null,
                     bgCovers: bgr ? (Math.abs(bgr.width - s.width) < 2 && Math.abs(bgr.height - s.height) < 2) : false,
                     btnText: btn.textContent.trim(),
                     btnCentreX: Math.round(b.left + b.width/2), screenCentreX: Math.round(s.left + s.width/2),
                     btnCentreY: Math.round(b.top + b.height/2), screenCentreY: Math.round(s.top + s.height/2),
                     btnOnTop: (() => { const t = document.elementFromPoint(b.left+b.width/2, b.top+b.height/2);
                                        return !!(t && t.id === 'dlInstallBtn'); })() };
        }""")
        print("   ", dl)
        ck(dl is not None, "the screen renders")
        ck(dl["title"] == 'Download APP', "titled Download APP (%r)" % dl["title"])
        ck(dl["btnText"] == 'Download', "with a button that says Download (%r)" % dl["btnText"])
        ck(dl["hasBg"] and dl["bgSrc"].startswith('data:image/png'),
           "the admin image is placed behind it")
        ck(dl["bgFit"] == 'cover' and dl["bgCovers"],
           "and fills the whole panel (object-fit:%s, covers=%s)" % (dl["bgFit"], dl["bgCovers"]))
        ck(abs(dl["btnCentreX"] - dl["screenCentreX"]) <= 2,
           "the button is centred across (%d vs %d)" % (dl["btnCentreX"], dl["screenCentreX"]))
        ck(abs(dl["btnCentreY"] - dl["screenCentreY"]) <= 60,
           "and vertically in the middle, not pushed off (%d vs %d)" % (dl["btnCentreY"], dl["screenCentreY"]))
        ck(dl["btnOnTop"], "and it is the thing a thumb actually hits — the image is not over it")
        await page.screenshot(path=f"{OUT}/download-screen.png")
        await page.evaluate("closeSheet()"); await page.wait_for_timeout(400)

        # ── 6. the nav selector is wider ──
        # Owner: "the nav tab is still small in width can you extend it abit."
        print("\n— 6. the nav selector box is wider —")
        boxw = await page.evaluate("""() => {
            const it = document.querySelector('.navitem.active');
            const b = it.getBoundingClientRect();
            const cs = getComputedStyle(it, '::before');
            // width from the pseudo-element's own computed box.
            return { box: Math.round(parseFloat(cs.width)), tab: Math.round(b.width),
                     maxW: cs.maxWidth };
        }""")
        print("   ", boxw)
        ck(boxw["box"] > 54, "the box is wider than the old fixed 54px (%dpx)" % boxw["box"])
        # ...but not so wide it touches the next tab's box.
        ck(boxw["box"] <= boxw["tab"] - 4,
           "with a gap left to its neighbours (%dpx box in a %dpx tab)" % (boxw["box"], boxw["tab"]))

        # ── 8. the icons and the chest are big enough ──
        # Owner has asked twice: "the nav icons are small also the treasure
        # chest box at home screen is small". The bar grew with the icons
        # (--nav-h) rather than a bigger glyph being squeezed into the old
        # height, so the thing to prove is that nothing CLIPS as a result --
        # a label cut off at the bottom of the bar is the obvious failure.
        print("\n— 8. nav icons and the treasure chest are bigger —")
        # The chest float only exists on Home, so go there first -- measuring
        # it from whatever tab the previous section left open returns None
        # and reads as "the chest is gone".
        await page.evaluate("showPage('home')")
        await page.wait_for_timeout(600)
        size = await page.evaluate("""() => {
            const bar = document.querySelector('.bottom-nav').getBoundingClientRect();
            const it = document.querySelector('.navitem');
            const img = it.querySelector('.nav-ic img').getBoundingClientRect();
            const lbl = it.querySelector('.lbl').getBoundingClientRect();
            const chest = document.querySelector('.chest-float');
            const cb = chest ? chest.getBoundingClientRect() : null;
            return { icon: Math.round(img.width), barH: Math.round(bar.height),
                     barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom),
                     lblBottom: Math.round(lbl.bottom), itemH: Math.round(it.getBoundingClientRect().height),
                     chest: cb && { w: Math.round(cb.width), top: Math.round(cb.top),
                                    bottom: Math.round(cb.bottom) },
                     chestOnTop: cb ? (() => { const t = document.elementFromPoint(
                         cb.left + cb.width/2, cb.top + cb.height/2);
                         return !!(t && t.closest('.chest-float')); })() : null };
        }""")
        print("   ", size)
        ck(size["icon"] >= 36, "the nav icon is %dpx (was 30, and 23 before that)" % size["icon"])
        ck(size["lblBottom"] <= size["barBottom"],
           "the label still fits inside the bar (%d <= %d)" % (size["lblBottom"], size["barBottom"]))
        ck(size["itemH"] <= size["barH"],
           "and so does the whole tab (%dpx in a %dpx bar)" % (size["itemH"], size["barH"]))
        ck(size["chest"] and size["chest"]["w"] >= 80,
           "the treasure chest is %spx (was 64)" % (size["chest"] or {}).get("w"))
        # It floats over the page, so the two ways it can go wrong are running
        # under the nav bar or off the top of the screen.
        ck(size["chest"]["bottom"] <= size["barTop"],
           "it clears the nav bar (%d <= %d)" % (size["chest"]["bottom"], size["barTop"]))
        ck(size["chest"]["top"] >= 0, "and stays on screen (top %d)" % size["chest"]["top"])
        ck(size["chestOnTop"], "and it is still what a thumb lands on")

        # ── 9. tapping a product card bounces it, and buys nothing ──
        # Owner, on the first version, which dipped opacity: "you failed to
        # understand, cozy when l tap it just cause faint image instead of make
        # product card bounce in or fade in and out minimumly." So the card now
        # gives under the finger and springs back; nothing touches opacity.
        #
        # This block used to assert the opacity dip -- i.e. exactly the
        # behaviour being removed -- and failed here for the right reason when
        # it changed. Rewritten to measure SCALE, read out of the computed
        # transform matrix (matrix(a,...) -> a is scaleX) rather than trusting
        # the class name.
        print("\n— 9. a product card bounces on tap, and does nothing else —")
        await page.evaluate("showPage('catalog')")
        await page.wait_for_timeout(900)
        tap = await page.evaluate("""async () => {
            // Watch for ANY call that could buy something, not just the one we
            // expect -- a stray handler is the whole risk here.
            const calls = [];
            const realFetch = window.fetch;
            window.fetch = (u, o) => { calls.push(String(u)); return realFetch(u, o); };
            const card = document.querySelector('.p-card');
            const img = card.querySelector('.p-img');
            const scaleOf = () => {
                const t = getComputedStyle(card).transform;
                if (!t || t === 'none') return 1;
                const m = t.match(/matrix\(([^,]+),/);
                return m ? parseFloat(m[1]) : 1;
            };
            img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const scales = [], opacities = [];
            const t0 = performance.now();
            while (performance.now() - t0 < 520) {
                scales.push(scaleOf());
                opacities.push(parseFloat(getComputedStyle(card).opacity));
                await new Promise(r => requestAnimationFrame(r));
            }
            window.fetch = realFetch;
            return { min: Math.min(...scales), max: Math.max(...scales),
                     last: scales[scales.length - 1], n: scales.length,
                     minOpacity: Math.min(...opacities),
                     calls: calls.filter(u => /invest|buy|purchase/i.test(u)),
                     sheet: !!document.querySelector('.sheet-bg.show') };
        }""")
        print("   ", tap)
        ck(tap["n"] > 8, "the animation was sampled over real frames (%d)" % tap["n"])
        # In, then out: a press that only shrinks is a dim, not a bounce.
        ck(tap["min"] < 0.995, "the card gives under the finger (down to %.4f)" % tap["min"])
        ck(tap["max"] > 1.001, "and springs back past its own size (up to %.4f)" % tap["max"])
        # "Minimumly" -- big enough to see, small enough not to shove the
        # layout around. A whole card at the nav icon's amplitude would lurch.
        ck(tap["min"] > 0.93 and tap["max"] < 1.05,
           "and stays subtle: %.1f%% in, %.1f%% out"
           % ((1 - tap["min"]) * 100, (tap["max"] - 1) * 100))
        ck(abs(tap["last"] - 1.0) < 0.005, "it settles back to exactly 1 (%.4f)" % tap["last"])
        # The complaint itself: no faint image. Opacity must never move.
        ck(tap["minOpacity"] > 0.99,
           "and it never goes faint -- opacity held at %.2f throughout" % tap["minOpacity"])
        # The half that actually matters.
        ck(tap["calls"] == [], "no purchase call was made: %s" % tap["calls"])
        ck(not tap["sheet"], "and nothing opened — the tap is pure acknowledgement")

        # ...while Buy Now is left completely alone.
        untouched = await page.evaluate("""() => {
            const btn = document.querySelector('.p-card .p-cta');
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return { cardAnimating: document.querySelector('.p-card').classList.contains('card-tap'),
                     btn: btn.textContent.trim() };
        }""")
        ck(not untouched["cardAnimating"],
           "a tap on %r does NOT bounce the card under it" % untouched["btn"])

        # A second tap must animate too. The class is taken off by an
        # animationend listener that matches on the keyframes NAME, so a rename
        # that misses it leaves the class stuck and every tap after the first
        # does nothing -- silent, and invisible to a single-tap test.
        again = await page.evaluate("""async () => {
            const card = document.querySelector('.p-card');
            const img = card.querySelector('.p-img');
            const stuck = card.classList.contains('card-tap');
            img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            let min = 1;
            const t0 = performance.now();
            while (performance.now() - t0 < 460) {
                const t = getComputedStyle(card).transform;
                const m = t && t !== 'none' ? t.match(/matrix\(([^,]+),/) : null;
                if (m) min = Math.min(min, parseFloat(m[1]));
                await new Promise(r => requestAnimationFrame(r));
            }
            return { stuck, min };
        }""")
        ck(not again["stuck"],
           "the class is cleaned up after the first tap, so it can replay")
        ck(again["min"] < 0.995, "and a second tap bounces too (%.4f)" % again["min"])

        # ── 7. Balance Record counts up from zero ──
        print("\n— 7. Balance Record counts up from 0 —")
        await page.evaluate("showPage('account')"); await page.wait_for_timeout(500)
        counted = await page.evaluate("""async () => {
            openBalanceRecordSheet();
            const seen = [];
            const t0 = performance.now();
            while (performance.now() - t0 < 1500) {
                const el = document.getElementById('balBandValue');
                if (el) seen.push(el.textContent.trim());
                await new Promise(r => requestAnimationFrame(r));
            }
            return { first: seen[0], last: seen[seen.length - 1], n: seen.length,
                     distinct: [...new Set(seen)].length };
        }""")
        print("   ", counted)
        num = lambda t: float(t.replace('UGX', '').replace(',', '').strip() or 0)
        ck(num(counted["first"]) == 0, "it starts at zero (%r)" % counted["first"])
        ck(num(counted["last"]) == 520782, "and lands on the real balance (%r)" % counted["last"])
        # A jump straight from 0 to the total would satisfy both of the above.
        ck(counted["distinct"] > 20,
           "having actually counted through the values between (%d distinct figures)" % counted["distinct"])
        await page.evaluate("closeSheet()"); await page.wait_for_timeout(400)

        # ── 5. copy, not share ──
        print("\n— 5. COPY INVITE LINK copies —")
        ck(await page.evaluate("()=>typeof window.shareReferral") == 'undefined',
           "shareReferral is gone entirely, not just unhooked")
        await page.evaluate("showPage('referral')"); await page.wait_for_timeout(700)
        share_called = await page.evaluate("""() => {
            window.__shared = false;
            Object.defineProperty(navigator, 'share',
              { configurable: true, value: async () => { window.__shared = true; } });
            return true;
        }""")
        btn = page.locator('button.primary-button', has_text='COPY INVITE LINK')
        ck(await btn.count() == 1, "the button is there")
        await btn.click()
        await page.wait_for_timeout(500)
        ck(not await page.evaluate("()=>window.__shared"),
           "tapping it does NOT open the phone's share sheet")
        clip = await page.evaluate("()=>navigator.clipboard.readText()")
        print("    clipboard:", repr(clip))
        ck(clip.startswith('http') and 'ref=Gy2f' in clip,
           "it copies the member's own referral link (%r)" % clip)
        ck('undefined' not in clip,
           "and the link is real — the old share path sent the word 'undefined'")
        toast = await page.evaluate("()=>{const t=document.querySelector('.toast,#toast');return t?t.textContent.trim():null;}")
        ck(toast and 'opie' in toast.lower() or (toast or '').lower().startswith('copied'),
           "and it says so (%r)" % toast)

        ck(not errs, "no page errors: %s" % errs[:3])
        await ctx.close(); await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nround fixes: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
