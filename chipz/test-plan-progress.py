"""
The running-investment progress bar, across the states it actually meets.

Owner: "does the progress bar on running investment work properly?"

It does, and this is what makes that answer checkable rather than a reading of
the code. The bar's width comes from planStats(): `payoutsMade / payoutsTotal`,
where payoutsMade is the number of daily payouts the server has actually
credited. /investments calls settleAllForUser() before responding, so opening
the screen settles every day that has come due first -- the bar is current at
the moment it is looked at, not as of the last cron tick.

The six cases below are the ones that can actually turn up in the database:

  new         bought today, nothing credited yet          -> 0%
  mid         75 of 150 credited                          -> exactly 50%
  matured     150 of 150, status matured                  -> 100%, no countdown
  over-paid   151 of 150 (a rounding day)                 -> CLAMPED to 100%
  legacy      no payoutsTotal field at all                -> falls back to the
                                                              product's own cycle
  strings     every number arrived as a JSON string       -> still correct

The over-paid and strings cases are not hypothetical. The ledger has already
produced a plan that paid one day past its total, and a string-typed amount in
an API response is what turned a "+" into concatenation and produced the
"1,000,000,500"-class corruption recorded in CLAUDE.md.

The legacy case is the one that was WRONG until this file was written:
planStats() fell back to a bare `|| 150`, so a 30-day plan four days in
measured itself against 150 days and read 3% instead of 13% -- a bar that
looks stuck on a plan that is running fine.
"""
import asyncio, datetime, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/plan-progress'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'user')
PORT = 8875
API = 'https://chipz-server.onrender.com'
CYCLE = 30          # the products in this fixture are 30-day plans on purpose:
                    # a 150-day fixture cannot tell a correct denominator from
                    # the old hardcoded 150.


def ago(days):
    return (datetime.datetime.utcnow() - datetime.timedelta(days=days)).isoformat() + 'Z'


ACCOUNT = {"phone": "0742730382", "walletBalance": 5000, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 180000,
           "checkinStreak": 0, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": CYCLE,
             "expectedReturn": p * 3, "image": "", "spinCount": 0, "spinMin": 0, "spinMax": 0}
            for i, p in enumerate([30000, 90000, 180000], start=1)]

def inv(iid, label, made, total, days, status="active", paid=0, strings=False):
    d = {"id": iid, "tierKey": "product-1", "tierLabel": label, "amount": 30000,
         "status": status, "expectedReturn": 90000, "dailyPayout": 3000,
         "payoutsMade": made, "paidOut": paid, "createdAt": ago(days)}
    if total is not None:
        d["payoutsTotal"] = total
    if strings:
        for k in ("amount", "expectedReturn", "dailyPayout", "payoutsMade", "paidOut", "payoutsTotal"):
            if k in d:
                d[k] = str(d[k])
    return d

# label -> (expected fill %, expected "Day X of Y")
CASES = [
    (inv("a", "New",       0,  CYCLE, 0),                                  0.0, f"Day 0 of {CYCLE}"),
    (inv("b", "Mid",       15, CYCLE, 15, paid=45000),                    50.0, f"Day 15 of {CYCLE}"),
    (inv("c", "Matured",   CYCLE, CYCLE, CYCLE, status="matured", paid=90000),
                                                                         100.0, f"Day {CYCLE} of {CYCLE}"),
    (inv("d", "Overpaid",  CYCLE + 1, CYCLE, CYCLE + 1, paid=93000),      100.0, f"Day {CYCLE} of {CYCLE}"),
    (inv("e", "Legacy",    4,  None,  4, paid=12000),                     13.3, f"Day 4 of {CYCLE}"),
    (inv("f", "Strings",   6,  CYCLE, 6, paid=18000, strings=True),        20.0, f"Day 6 of {CYCLE}"),
]
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 5000, "withdrawFeePct": 15,
        "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": False,
        "cycleDays": CYCLE, "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": False}},
    "/public/products": {"status": "success", "products": PRODUCTS},
    "/public/activity-feed": {"status": "success", "feed": []},
    "/public/banner": {"status": "success", "image": None},
    "/public/announcement-image": {"status": "success", "image": None},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                             "profilegif": None, "downloadbg": None, "authhero": None,
                             "authcard": None},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": [c[0] for c in CASES]},
    "/transactions": {"status": "success", "transactions": [], "truncated": False},
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
        await page.wait_for_timeout(3000)
        try:
            await page.evaluate("closeAnnounce()")
        except Exception:
            pass
        await page.evaluate("showPage('products')")
        await page.wait_for_timeout(1600)
        # 'all', or the matured plans are filtered off the screen and half of
        # these cases would silently not be measured.
        await page.evaluate("switchPlanFilter('all')")
        await page.wait_for_timeout(900)

        rows = await page.evaluate("""()=>[...document.querySelectorAll('.mp-row')].map(r=>{
          const bar=r.querySelector('.mp-bar'), fill=r.querySelector('.mp-bar i');
          const br=bar?bar.getBoundingClientRect():null, fr=fill?fill.getBoundingClientRect():null;
          return {name:(r.querySelector('.mp-name')||{}).textContent||'',
                  chip:((r.querySelector('.mp-chip')||{}).textContent||'').trim(),
                  days:((r.querySelector('.mp-days span')||{}).textContent||'').trim(),
                  barW:br?+br.width.toFixed(2):0, fillW:fr?+fr.width.toFixed(2):0,
                  pct:(br&&br.width)?+(100*fr.width/br.width).toFixed(1):null,
                  radius:bar?getComputedStyle(bar).borderTopLeftRadius:null,
                  countdown:!!r.querySelector('[data-countdown]')};})""")
        ck(len(rows) == len(CASES),
           "every plan rendered a row (%d of %d)" % (len(rows), len(CASES)))
        by_name = {r["name"].strip(): r for r in rows}

        for src, want_pct, want_days in CASES:
            name = src["tierLabel"]
            r = by_name.get(name)
            if not r:
                ck(False, "%s: no row rendered" % name)
                continue
            print("   %-9s %5.1f%%  (%.1f/%.1fpx)  %-16s chip=%-8s countdown=%s"
                  % (name, r["pct"], r["fillW"], r["barW"], r["days"], r["chip"], r["countdown"]))
            # The bar is measured from RENDERED geometry, not the inline style:
            # a width the browser never applied is not a progress bar.
            ck(abs(r["pct"] - want_pct) <= 1.2,
               "%s fills %.1f%% where %.1f%% is due" % (name, r["pct"], want_pct))
            ck(r["days"] == want_days,
               "%s reads %r" % (name, r["days"]))

        # The two states that must differ in more than width.
        ck(by_name["Matured"]["chip"] == "Matured" and not by_name["Matured"]["countdown"],
           "a finished plan says Matured and stops its next-payout countdown")
        ck(by_name["Mid"]["chip"] == "Running" and by_name["Mid"]["countdown"],
           "a running plan says Running and keeps counting down")
        # Over-paying by a day must not produce a bar wider than its track.
        ck(by_name["Overpaid"]["fillW"] <= by_name["Overpaid"]["barW"] + 0.5,
           "an over-paid plan clamps to the track (%.1f <= %.1f)"
           % (by_name["Overpaid"]["fillW"], by_name["Overpaid"]["barW"]))
        ck(by_name["Mid"]["radius"] == "999px",
           "the track is rounded like every other bar in the app (%s)" % by_name["Mid"]["radius"])

        await page.screenshot(path=f"{OUT}/plan-progress.png", full_page=True)
        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nplan progress: all cases pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
