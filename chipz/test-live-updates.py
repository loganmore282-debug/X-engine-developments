"""
The app keeps itself current while it sits open, and stops when it is not.

Owner: "make sure that the app always listens to every content and updates
quickly without reloads ... l want every data to be loaded up quickly every
seconds, no reloads."

He asked for Firebase real-time listeners by name. Those are not available to
this data: Firebase here is Auth only, and every figure lives in MongoDB behind
chipz-server, so there is no Firestore document to attach onSnapshot to. What
this checks is the equivalent behaviour -- a short poll that repaints IN PLACE.

The assertions are the ones that separate "live" from "reloading":

  * the figure on screen changes on its own, with NO navigation and NO reload
    (the page's load count is captured at the start and must not move)
  * a list the member is looking at picks up a new row by itself
  * an UNCHANGED payload does not touch the DOM -- proved by marking a node and
    checking the mark survives several ticks. A list rebuilt every few seconds
    would reset scroll and replay its reveal animation, which is exactly the
    "reload" feeling being complained about
  * polling STOPS while the app is hidden, and resumes at once on return. The
    old loop ran all night from a phone in a pocket
  * a failing backend backs off instead of hammering a sleeping Render instance
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver, time
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/live-updates'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'user')
PORT = 8883
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone": "0742730382", "walletBalance": 10000, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 0,
           "checkinStreak": 0, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}
TX0 = [{"id": "1", "type": "promocode", "amount": 2000, "description": "x",
        "date": "05/09/2026", "time": "23:21"}]

# Mutated mid-test, exactly as the real backend would change underneath.
STATEFUL = {"account": dict(ACCOUNT), "tx": list(TX0), "fail": False}
HITS = {"account": 0, "transactions": 0}

ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 5000, "withdrawFeePct": 15,
        "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": False,
        "cycleDays": 30, "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": False,
        # The loop reads its own cadence from settings; 2s is its floor.
        "livePollMs": 2000}},
    "/public/products": {"status": "success", "products": []},
    "/public/activity-feed": {"status": "success", "feed": []},
    "/public/banner": {"status": "success", "image": None},
    "/public/announcement-image": {"status": "success", "image": None},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                             "profilegif": None, "downloadbg": None, "authhero": None,
                             "authcard": None},
    "/investments": {"status": "success", "investments": []},
    "/messages": {"status": "success", "messages": []},
    "/bank/list": {"status": "success", "accounts": []},
    "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0,
                    "teamCommission": 0, "teamDeposits": 0, "milestones": []},
    "/turntable/status": {"status": "success", "enabled": False, "dailyAvailable": False,
                          "earnedSpins": 0, "totalSpins": 0, "nextDailyAt": 0,
                          "dailyMin": 0, "dailyMax": 0},
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
            if path.endswith("/account"):
                HITS["account"] += 1
                if STATEFUL["fail"]:
                    await r.fulfill(status=500, content_type="application/json",
                                    body='{"status":"error"}')
                    return
                body = {"status": "success", "account": STATEFUL["account"]}
            elif path.endswith("/transactions"):
                HITS["transactions"] += 1
                body = {"status": "success", "transactions": STATEFUL["tx"], "truncated": False}
            else:
                key = next((k for k in ROUTES if path.endswith(k)), None)
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

        # A reload would reset this. Nothing below is allowed to move it.
        await page.evaluate("window.__loadMark = (window.__loadMark||0)+1")
        loads_before = await page.evaluate("window.__loadMark")

        # ── 1. A FIGURE UPDATES ITSELF ────────────────────────────────────
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(1200)
        shown_before = await page.evaluate(
            "((document.getElementById('acctWallet')||{}).textContent||'').trim()")
        STATEFUL["account"] = dict(ACCOUNT, walletBalance=77500)
        await page.wait_for_timeout(6000)
        shown_after = await page.evaluate(
            "((document.getElementById('acctWallet')||{}).textContent||'').trim()")
        state_after = await page.evaluate("(STATE.account||{}).walletBalance")
        print("   wallet on screen: %r -> %r  (STATE %s)" % (shown_before, shown_after, state_after))
        ck("10,000" in shown_before, "started at the seeded figure (%r)" % shown_before)
        ck(state_after == 77500, "the app picked up the new balance by itself (%s)" % state_after)
        ck("77,500" in shown_after,
           "and the screen shows it without any navigation (%r)" % shown_after)

        # ── 2. A LIST GROWS BY ITSELF, AND IS LEFT ALONE OTHERWISE ────────
        await page.evaluate("openBalanceRecordSheet()")
        await page.wait_for_selector("#balBody .rec", timeout=6000)
        await page.wait_for_timeout(900)
        rows_before = await page.evaluate("document.querySelectorAll('#balBody .rec').length")
        # Mark a node. If the list is rebuilt on a tick that changed nothing,
        # the mark disappears -- that rebuild is the "reload" feeling.
        await page.evaluate(
            "document.querySelector('#balBody .rec').setAttribute('data-kept','1')")
        await page.wait_for_timeout(6000)
        kept = await page.evaluate("!!document.querySelector('#balBody .rec[data-kept]')")
        ck(kept, "an unchanged list is not rebuilt -- scroll and animations survive")

        STATEFUL["tx"] = [{"id": "2", "type": "turntable", "amount": 500, "description": "y",
                           "date": "06/09/2026", "time": "07:00"}] + TX0
        await page.wait_for_timeout(6000)
        rows_after = await page.evaluate("document.querySelectorAll('#balBody .rec').length")
        print("   records: %d -> %d rows" % (rows_before, rows_after))
        ck(rows_after == rows_before + 1,
           "a new record appears on its own (%d -> %d)" % (rows_before, rows_after))
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(400)

        # ── 3. IT STOPS WHEN THE APP IS NOT BEING LOOKED AT ───────────────
        # The old loop kept polling from a phone in a pocket, all night.
        await page.wait_for_timeout(2500)
        base = HITS["account"]
        await page.evaluate("""()=>{Object.defineProperty(document,'hidden',
          {configurable:true,get:()=>true});
          document.dispatchEvent(new Event('visibilitychange'));}""")
        await page.wait_for_timeout(7000)
        while_hidden = HITS["account"] - base
        print("   /account calls while hidden: %d over 7s" % while_hidden)
        ck(while_hidden <= 1,
           "polling stops while the app is hidden (%d calls)" % while_hidden)

        mid = HITS["account"]
        await page.evaluate("""()=>{Object.defineProperty(document,'hidden',
          {configurable:true,get:()=>false});
          document.dispatchEvent(new Event('visibilitychange'));}""")
        await page.wait_for_timeout(1500)
        on_return = HITS["account"] - mid
        print("   /account calls in the 1.5s after returning: %d" % on_return)
        ck(on_return >= 1,
           "and refreshes immediately on return rather than waiting a tick (%d)" % on_return)

        # ── 4. A DEAD BACKEND IS BACKED OFF, NOT HAMMERED ────────────────
        STATEFUL["fail"] = True
        await page.wait_for_timeout(3000)
        start = HITS["account"]
        await page.wait_for_timeout(9000)
        while_failing = HITS["account"] - start
        print("   /account attempts over 9s of failures: %d" % while_failing)
        ck(while_failing <= 4,
           "a failing backend is backed off, not hammered (%d attempts in 9s)" % while_failing)
        STATEFUL["fail"] = False

        # ── AND NOTHING RELOADED ─────────────────────────────────────────
        loads_after = await page.evaluate("window.__loadMark")
        ck(loads_after == loads_before,
           "the page never reloaded through any of it (%s -> %s)" % (loads_before, loads_after))

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nlive updates: all pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
