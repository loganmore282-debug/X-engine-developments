#!/usr/bin/env python3
"""The spin wheel carries the amounts, and stops on the one that was paid.

Owner: "why the spin wheel has no amounts?"

It had none because there were no prizes to show -- the payout was any figure
at all between the admin's minimum and maximum, so no wedge could be labelled.
The server now draws from eight named slices and says which one won.

What this proves, against the BUILT app (every string literal is encoded into
the bundle, so reading admin/user/index.html proves nothing):

  1. The eight figures are ON the wheel, and they are the server's own list --
     not something the app derived for itself. Two sides deriving the same
     list independently is the phoneToEmail hazard: they agree until one is
     edited.
  2. The wheel STOPS on the slice that was paid. A wheel that lands on 600
     while the wallet receives 587 is a money screen telling a lie, and it is
     the one thing a member will check.
  3. The currency is said once, not eight times, and no figure is shortened.
  4. The wheel is relabelled when the next spin comes from a different band --
     a product-earned spin carries its own product's prizes, and showing the
     daily ones while paying a product's is the same lie in a subtler form.

Run:  python3 test-spin-wheel.py [outdir]
"""
import asyncio, json, math, os, sys, functools, threading, http.server, socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/spin-wheel'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
# 8905: the running list of every harness's port is in CLAUDE.md, Round 157.
PORT = 8905
from chipz_test_api import API

fails, errs = [], []


def ck(ok, label):
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        fails.append(label)


REGION = {"key": "ug", "name": "Uganda", "currency": "UGX", "dialCode": "256",
          "localLength": 9, "prefixes": ["7"], "utcOffsetMin": 180, "isDefault": True,
          "usesBareLocal": True, "languages": ["en"], "defaultLang": "en"}

ACCOUNT = {"phone": "0742730382", "walletBalance": 128500, "totalDeposited": 200000,
           "totalEarned": 31000, "totalWithdrawn": 0, "totalInvested": 120000,
           "referralCode": "UG7Q4X", "publicId": "00042", "registrationDone": True,
           "spins": 2, "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}

# The daily band, and a DIFFERENT product band, so "the wheel was relabelled"
# cannot pass by the two happening to match.
DAILY = [200, 300, 450, 550, 650, 750, 900, 1000]
PRODUCT = [5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000]
WON_INDEX = 5                      # 750 of the daily band

FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'t'};
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


async def main():
    srv = serve()
    state = {"slices": DAILY, "source": "daily"}
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
            ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                      service_workers="block")
            page = await ctx.new_page()
            page.on("pageerror", lambda e: errs.append(str(e)))

            await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                             lambda r: r.fulfill(status=200, content_type="text/javascript",
                                                 body=FB_APP))
            await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                             lambda r: r.fulfill(status=200, content_type="text/javascript",
                                                 body=FB_AUTH))

            async def api(r):
                path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
                if path.endswith("/turntable/status"):
                    body = {"status": "success", "enabled": True, "dailyAvailable": True,
                            "earnedSpins": 1, "totalSpins": 2,
                            "nextDailyAt": 4102444800000,
                            "dailyMin": 200, "dailyMax": 1000,
                            "nextSource": state["source"],
                            "nextMin": state["slices"][0], "nextMax": state["slices"][-1],
                            "slices": state["slices"]}
                elif path.endswith("/turntable/spin"):
                    body = {"status": "success", "reward": DAILY[WON_INDEX],
                            "source": "daily", "walletBalance": 129250,
                            "earnedSpins": 1, "dailyAvailable": False, "totalSpins": 1,
                            "nextDailyAt": 4102444800000,
                            "slices": DAILY, "sliceIndex": WON_INDEX}
                elif path.endswith("/public/settings"):
                    body = {"status": "success", "region": REGION, "regionCount": 1,
                            "settings": {"turntableEnabled": True, "brandName": "Chipz",
                                         "referralRequired": True}}
                elif path.endswith("/account"):
                    body = {"status": "success", "account": ACCOUNT, "region": REGION}
                elif path.endswith("/public/products"):
                    body = {"status": "success", "products": []}
                else:
                    body = {"status": "success"}
                await r.fulfill(status=200, content_type="application/json",
                                body=json.dumps(body))
            await page.route(f"{API}/**", api)

            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="commit")
            await page.wait_for_timeout(4500)
            await page.evaluate("()=>{ try{ if(typeof closeAnnounce==='function') closeAnnounce(); }catch(e){} }")
            await page.evaluate("()=>{ openTurntableSheet(); }")
            await page.wait_for_timeout(1200)

            # ── 1. the amounts are on the wheel, and they are the server's ──
            labels = await page.eval_on_selector_all(
                '#ttWheel .tt-slice', "els => els.map(e => e.textContent.trim())")
            ck(len(labels) == 8, f"the wheel carries eight figures ({len(labels)})")
            want = [f"{v:,}" for v in DAILY]
            ck(labels == want, f"and they are exactly what the server sent ({labels})")
            ck(all(('k' not in t.lower() and 'm' not in t.lower()) for t in labels),
               "with no figure shortened")

            # The currency belongs under the wheel, once -- eight of
            # "UGX 1,000" is unreadable at 250px.
            cur_line = (await page.inner_text('#ttCur')).strip()
            ck(cur_line == "All amounts in UGX", f"the currency is stated once ({cur_line!r})")
            ck(not any('UGX' in t for t in labels), "and not repeated on every slice")

            # Every label must be inside the wheel's own circle, or a figure
            # sits on the rim or outside it and reads as belonging to nothing.
            geom = await page.evaluate("""() => {
              const w = document.getElementById('ttWheel').getBoundingClientRect();
              const cx = w.left + w.width / 2, cy = w.top + w.height / 2;
              return [...document.querySelectorAll('#ttWheel .tt-slice')].map(e => {
                const r = e.getBoundingClientRect();
                return { d: Math.hypot(r.left + r.width/2 - cx, r.top + r.height/2 - cy),
                         w: r.width, radius: w.width / 2 };
              });
            }""")
            hub = 35   # .tt-wheel .hub is 70px across
            ck(all(g['d'] + g['w'] / 2 < g['radius'] for g in geom),
               "every figure sits inside the rim")
            ck(all(g['d'] > hub for g in geom), "and clear of the SPIN hub")

            # ── 2. it stops on the slice that was paid ─────────────────────
            await page.evaluate("()=>{ doTurntableSpin(); }")
            await page.wait_for_timeout(5200)
            angle = await page.evaluate("""() => {
              const t = getComputedStyle(document.getElementById('ttWheel')).transform;
              if (!t || t === 'none') return 0;
              const m = t.match(/matrix\\(([^)]+)\\)/);
              if (!m) return 0;
              const [a, b] = m[1].split(',').map(Number);
              return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
            }""")
            # Slice i's centre starts at i*45 + 22.5 clockwise from 12
            # o'clock, so after turning by `angle` it sits at centre + angle.
            # The pointer is at 0. Whichever slice is under it is what the
            # member reads as their prize.
            under = round(((0 - angle) % 360 - 22.5) / 45) % 8
            ck(under == WON_INDEX,
               f"the wheel stops on the slice that was paid "
               f"(landed on {under} = {DAILY[under]:,}, paid {DAILY[WON_INDEX]:,})")

            won = await page.inner_text('#chestWinBg') if await page.is_visible('#chestWinBg') else ''
            ck(f"{DAILY[WON_INDEX]:,}" in won.replace(' ', ' '),
               f"and the win card names the same figure ({DAILY[WON_INDEX]:,})")

            # ── 4. a different band relabels the wheel ────────────────────
            state["slices"] = PRODUCT
            state["source"] = "product"
            await page.evaluate("()=>{ try{ closeChestWin(); }catch(e){} }")
            await page.wait_for_timeout(300)
            await page.evaluate("()=>{ refreshTurntable(); }")
            await page.wait_for_timeout(900)
            relabelled = await page.eval_on_selector_all(
                '#ttWheel .tt-slice', "els => els.map(e => e.textContent.trim())")
            ck(relabelled == [f"{v:,}" for v in PRODUCT],
               f"a product spin's own band relabels the wheel ({relabelled[:3]}…)")
            ck(relabelled != want,
               "and it is genuinely different from the daily one, not a coincidence")

            await b.close()
    finally:
        srv.shutdown()

    ck(not errs, f"no page errors ({errs[:2]})")
    print(("\n%d FAILED" % len(fails)) if fails else "\nall good")
    return 1 if fails else 0


sys.exit(asyncio.run(main()))
