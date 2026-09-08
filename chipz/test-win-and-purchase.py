"""
The congratulations card's timing and its growing balance, and what a purchase
does now.

Owner: "why does the congratulations card delay to appear when one has claimed
treasure code and also when has got spin rewards, also l want when one buys a
product he is immediately redirected to my products page to see his products, l
nolonger need those ugly notifys that bought product 1, l need what we are using
with this [warning dialog]" and "l want when congratulations card comes let the
balance also have a live growing animation."

The delay was never rendering -- it was round trips. Both win paths used to
fetch /account and the transactions cache BEFORE showing the card, purely to
print "New Balance", and the spin additionally waited a flat 4000ms measured
from when the server answered rather than from when the wheel started, so the
network time was served twice.

That makes the fix only measurable against a SLOW backend, which is the whole
point: on a fast connection the old code looked fine. So every route here is
deliberately delayed, and the assertions are on WALL-CLOCK TIME from the tap:

  redeem   /account delayed 3s   -> card must appear in well under a second
  spin     /turntable/spin 1.5s  -> card must appear at the wheel's own 4s
                                    mark, not at 5.5s

The balance is then sampled across real frames to prove it counts from the
pre-reward figure up to the post-reward one, rather than being written once.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver, time
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/win-purchase'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'user')
PORT = 8877
API = 'https://chipz-server.onrender.com'

BAL_BEFORE = 12000
REWARD = 3500
BAL_AFTER = BAL_BEFORE + REWARD

ACCOUNT = {"phone": "0742730382", "walletBalance": BAL_BEFORE, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 0,
           "checkinStreak": 0, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}
PRODUCTS = [{"key": "product-1", "name": "Product-1", "price": 30000, "cycle": 30,
             "expectedReturn": 90000, "image": "", "spinCount": 0, "spinMin": 0, "spinMax": 0}]
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 5000, "withdrawFeePct": 15,
        "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": False,
        "cycleDays": 30, "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": True}},
    "/public/products": {"status": "success", "products": PRODUCTS},
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
    "/messages": {"status": "success", "messages": []},
    "/bank/list": {"status": "success", "accounts": []},
    "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0,
                    "teamCommission": 0, "teamDeposits": 0, "milestones": []},
    "/turntable/status": {"status": "success", "enabled": True, "dailyAvailable": True,
                          "earnedSpins": 0, "totalSpins": 1, "nextDailyAt": 0,
                          "dailyMin": 500, "dailyMax": 5000},
    # Both winning endpoints answer with the post-credit balance, which is what
    # lets the card open without a follow-up /account at all.
    "/redeem": {"status": "success", "reward": REWARD, "walletBalance": BAL_AFTER},
    "/turntable/spin": {"status": "success", "reward": REWARD, "walletBalance": BAL_AFTER,
                        "source": "daily", "earnedSpins": 0, "dailyAvailable": False,
                        "totalSpins": 0, "nextDailyAt": 0},
    "/invest/create": {"status": "success", "investmentId": "i1",
                       "message": "Bought Product-1 for UGX 30,000"},
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

# Per-path artificial latency, changed mid-test. Boot must stay fast or the app
# never finishes loading; the delays are switched on only for the tap being
# measured.
DELAY = {}


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


async def main():
    fails = []
    errs = []

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
            key = next((k for k in ROUTES if path.endswith(k)), None)
            wait = DELAY.get(key, 0)
            if wait:
                await asyncio.sleep(wait)
            body = ROUTES.get(key, {"status": "success"})
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
        try:
            await page.evaluate("closeAnnounce()")
        except Exception:
            pass

        # ── 1. TREASURE CHEST KEY ──────────────────────────────────────────
        # /account is made painfully slow. The card must not be waiting on it.
        DELAY["/account"] = 3.0
        DELAY["/transactions"] = 3.0
        await page.evaluate("openChestSheet()")
        await page.wait_for_selector("#chestKey", timeout=5000)
        await page.fill("#chestKey", "GIFT123")
        # Armed BEFORE the tap. Reading the balance only once the card has been
        # awaited from Python misses the opening frames -- the count is
        # ease-out, so it is already 5% along by then and "did it start at the
        # old balance?" cannot be answered. This records every frame from the
        # moment the card is shown, so sample 0 is the first painted value.
        await page.evaluate("""()=>{
          window.__balFrames=[];
          const bg=document.getElementById('chestWinBg');
          const el=document.getElementById('chestWinBalance');
          let seen=false;
          (function watch(){
            const open=bg.classList.contains('show');
            // Stops for good once this first card closes, so a later win can
            // never append a second count onto the same list and make the
            // sequence look like it went backwards at the join.
            if(seen && !open) return;
            if(open){
              seen=true;
              const t=el.textContent;
              const last=window.__balFrames[window.__balFrames.length-1];
              if(t!==last) window.__balFrames.push(t);
            }
            requestAnimationFrame(watch);
          })();
        }""")
        t0 = time.monotonic()
        await page.click("#chestOpenBtn")
        await page.wait_for_selector("#chestWinBg.show", timeout=8000)
        card_ms = (time.monotonic() - t0) * 1000
        print("   chest key -> card in %.0f ms (with /account stalled 3000 ms)" % card_ms)
        ck(card_ms < 1500,
           "the win card opens without waiting on /account (%.0f ms)" % card_ms)

        # The balance must MOVE, and it must start at the pre-reward figure. A
        # value written once would give a single frame; reading only the end
        # state would pass against a card with no animation at all.
        await page.wait_for_timeout(1800)
        samples = await page.evaluate("window.__balFrames")
        nums = []
        for s in samples:
            digits = ''.join(c for c in s if c.isdigit() or c == '.')
            if digits:
                nums.append(float(digits))
        distinct = len(set(nums))
        print("   balance samples: %s ... %s  (%d distinct)"
              % (samples[0], samples[-1], distinct))
        ck(distinct >= 6,
           "the balance counts across frames rather than being written once (%d distinct)" % distinct)
        ck(nums and abs(nums[0] - BAL_BEFORE) <= 1,
           "it starts at the balance held BEFORE the win (%s)" % (nums[0] if nums else None))
        ck(nums and abs(nums[-1] - BAL_AFTER) <= 1,
           "it lands on the balance held after (%s)" % (nums[-1] if nums else None))
        # Names the offending pair. This assertion caught a genuine, rare
        # frame-timing defect once (an unclamped negative t painting one frame
        # below the starting figure), and "it only ever grows: False" gave
        # nothing to work from.
        dips = [(i, nums[i - 1], nums[i]) for i in range(1, len(nums)) if nums[i] < nums[i - 1]]
        ck(not dips, "it only ever grows (dips: %s)" % (dips[:3] if dips else "none"))

        await page.screenshot(path=f"{OUT}/chest-win.png")
        await page.evaluate("closeChestWin()")
        DELAY.pop("/account", None)
        DELAY.pop("/transactions", None)
        await page.wait_for_timeout(600)

        # ── 2. THE SPIN ────────────────────────────────────────────────────
        # The wheel's own transition is 4s. With the request taking 1.5s of
        # that, the card must still land at the 4s mark -- the old code paid
        # for the request twice and showed it at 5.5s.
        DELAY["/turntable/spin"] = 1.5
        await page.evaluate("openTurntableSheet()")
        await page.wait_for_selector("#ttSpinBtn:not([disabled])", timeout=6000)
        t0 = time.monotonic()
        await page.click("#ttSpinBtn")
        await page.wait_for_selector("#chestWinBg.show", timeout=12000)
        spin_ms = (time.monotonic() - t0) * 1000
        print("   spin -> card in %.0f ms (wheel is 4000 ms, request 1500 ms)" % spin_ms)
        ck(spin_ms < 4900,
           "the card lands with the wheel, not a request later (%.0f ms)" % spin_ms)
        ck(spin_ms > 3400,
           "it still waits for the wheel to finish spinning (%.0f ms)" % spin_ms)
        ghost = await page.get_attribute("#chestWinGhost", "src")
        ck(ghost.endswith("/spin-wheel.png"),
           "a spin win still shows the wheel artwork, not a chest (%s)" % ghost)
        await page.screenshot(path=f"{OUT}/spin-win.png")
        await page.evaluate("closeChestWin()")
        DELAY.pop("/turntable/spin", None)
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(500)

        # ── 3. BUYING A PRODUCT ────────────────────────────────────────────
        await page.evaluate("showPage('catalog')")
        await page.wait_for_selector(".p-cta", timeout=6000)
        await page.click(".p-cta")
        await page.wait_for_selector("#notifyBg.show", timeout=8000)
        landed = await page.evaluate("STATE.page")
        msg = (await page.text_content("#notifyMsg") or "").strip()
        toasts = await page.evaluate("document.querySelectorAll('#toastHost .toast').length")
        nav = await page.evaluate(
            "(document.querySelector('.navitem.active [class]')||{}).textContent||''")
        active_tab = await page.evaluate(
            "((document.querySelector('.navitem.active .lbl')||{}).textContent||'').trim()")
        print("   after buying: page=%r  tab=%r  toasts=%d  msg=%r"
              % (landed, active_tab, toasts, msg))
        ck(landed == "products", "buying lands on My Products (page=%r)" % landed)
        ck(active_tab == "My Products",
           "and the bottom bar shows it as the open tab (%r)" % active_tab)
        ck(toasts == 0, "no toast pill is left on screen (%d)" % toasts)
        # The wording he objected to came from the server's own message. It
        # must not be what the dialog now says.
        ck("Bought" not in msg, "the dialog is not the server's 'Bought ...' sentence")
        ck("Product-1" in msg and "My Products" in msg,
           "it names the product and where to find it (%r)" % msg)
        # It is the SAME dialog as every other alert -- the warning card with
        # the amber triangle, not a bespoke one.
        icon = await page.evaluate(
            "((document.querySelector('#notifyBg .notify-card .notify-icon')||{})"
            ".textContent||'').trim()")
        ck(icon == "⚠️", "it is the standard alert card, warning sign and all (%r)" % icon)
        # After notifyPop has finished, or the shot catches the card
        # mid-entrance at partial opacity and reads as a see-through dialog.
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/purchase-notify.png")

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nwin card + purchase: all pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
