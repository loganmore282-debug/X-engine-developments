"""
How far along a running investment is, across the states it actually meets.

Owner, first: "does the progress bar on running investment work properly?"
Owner, later: "remove progress bar on running products."

The bar is gone; the thing it was drawing is not. planStats() still works out
`payoutsMade` of `payoutsTotal`, and the row now states it in words -- "Day 4 of
30" with "26 Days Remaining" beside it. So this file kept every case and changed what
it reads: the rendered TEXT instead of the fill's geometry. The arithmetic
underneath, and every way it can go wrong, is identical.

payoutsMade is the number of daily payouts the server has actually credited, and
/investments calls settleAllForUser() before responding, so opening the screen
settles every day that has come due first -- the count is current at the moment
it is looked at, not as of the last cron tick.

The six cases below are the ones that can actually turn up in the database:

  new         bought today, nothing credited yet          -> Day 0
  mid         half the cycle credited                     -> Day 15 of 30
  matured     whole cycle credited, status matured        -> Finished, no countdown
  over-paid   one day past the total (a rounding day)     -> CLAMPED, not "Day 31"
  legacy      no payoutsTotal field at all                -> falls back to the
                                                              product's own cycle
  strings     every number arrived as a JSON string       -> still correct

The over-paid and strings cases are not hypothetical. The ledger has already
produced a plan that paid one day past its total, and a string-typed amount in
an API response is what turned a "+" into concatenation and produced the
"1,000,000,500"-class corruption recorded in CLAUDE.md.

The legacy case is the one that was WRONG until this file was written:
planStats() fell back to a bare `|| 150`, so a 30-day plan four days in measured
itself against 150 days. That used to read as a bar stuck at 3%; it would now
read as "Day 4 of 150" on a plan sold as a 30-day one, and claim 146 days left.
Same defect, more legible -- which is why the fixture still uses 30-day products
on purpose. A 150-day fixture cannot tell a correct cycle from the old
hardcoded 150.
"""
import asyncio, datetime, json, os, re, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

_time_re = re.compile(r' at (?:[01]\d|2[0-3]):[0-5]\d$')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/plan-progress'
os.makedirs(OUT, exist_ok=True)
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

# label -> (expected "Day X of Y", expected right-hand half)
CASES = [
    (inv("a", "New",       0,  CYCLE, 0),                    f"Day 0 of {CYCLE}",  "30 Days Remaining"),
    (inv("b", "Mid",       15, CYCLE, 15, paid=45000),       f"Day 15 of {CYCLE}", "15 Days Remaining"),
    (inv("c", "Matured",   CYCLE, CYCLE, CYCLE, status="matured", paid=90000),
                                                             f"Day {CYCLE} of {CYCLE}", "Finished"),
    (inv("d", "Overpaid",  CYCLE + 1, CYCLE, CYCLE + 1, paid=93000),
                                                             f"Day {CYCLE} of {CYCLE}", "Finished"),
    (inv("e", "Legacy",    4,  None,  4, paid=12000),        f"Day 4 of {CYCLE}",  "26 Days Remaining"),
    (inv("f", "Strings",   6,  CYCLE, 6, paid=18000, strings=True),
                                                             f"Day 6 of {CYCLE}",  "24 Days Remaining"),
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
          const d=r.querySelector('.mp-days');
          const cs=d?getComputedStyle(d.querySelector('b')):null;
          const tail=d?d.querySelector(':scope > span:last-child'):null;
          const ls=tail?getComputedStyle(tail):null;
          const sp=r.querySelector('.pspin');
          const spr=sp?sp.getBoundingClientRect():null;
          const core=sp?sp.querySelector('.pspin-core'):null;
          return {name:(r.querySelector('.mp-name')||{}).textContent||'',
                  chip:((r.querySelector('.mp-chip')||{}).textContent||'').trim(),
                  days:((d&&d.querySelector('b'))||{}).textContent||'',
                  left:tail?tail.textContent:'',
                  dayPx:cs?parseFloat(cs.fontSize):0, dayColor:cs?cs.color:'',
                  leftPx:ls?parseFloat(ls.fontSize):0, leftColor:ls?ls.color:'',
                  bars:r.querySelectorAll('.mp-bar').length,
                  spin:!!sp, spinW:spr?+spr.width.toFixed(1):0,
                  spinH:spr?+spr.height.toFixed(1):0,
                  chips:sp?sp.querySelectorAll('.pspin-chip').length:0,
                  coreW:core?+core.getBoundingClientRect().width.toFixed(1):0,
                  hidden:sp?sp.getAttribute('aria-hidden'):null,
                  bought:((r.querySelector('.mp-bought')||{}).textContent||'').trim(),
                  countdown:!!r.querySelector('[data-countdown]')};})""")
        ck(len(rows) == len(CASES),
           "every plan rendered a row (%d of %d)" % (len(rows), len(CASES)))
        by_name = {r["name"].strip(): r for r in rows}

        # Owner: "remove progress bar on running products." Asserted on the
        # rendered rows, not by grepping the source -- the obfuscated build
        # encodes class names as strings, so a grep proves nothing here.
        ck(sum(r["bars"] for r in rows) == 0,
           "no plan row draws a progress bar (%d found)" % sum(r["bars"] for r in rows))

        for src, want_days, want_left in CASES:
            name = src["tierLabel"]
            r = by_name.get(name)
            if not r:
                ck(False, "%s: no row rendered" % name)
                continue
            print("   %-9s %-16s %-14s chip=%-8s countdown=%s"
                  % (name, r["days"], r["left"], r["chip"], r["countdown"]))
            ck(r["days"] == want_days, "%s reads %r" % (name, r["days"]))
            ck(r["left"] == want_left, "%s and %r beside it" % (name, r["left"]))

        # The two states that must differ in more than wording.
        ck(by_name["Matured"]["chip"] == "Completed" and not by_name["Matured"]["countdown"],
           "a finished plan says Completed and stops its next-payout countdown")
        ck(by_name["Mid"]["chip"] == "Active" and by_name["Mid"]["countdown"],
           "a running plan says Active and keeps counting down")
        # Over-paying by a day must not produce "Day 31 of 30".
        ck(by_name["Overpaid"]["days"] == f"Day {CYCLE} of {CYCLE}",
           "an over-paid plan clamps rather than counting past its cycle (%s)"
           % by_name["Overpaid"]["days"])
        # With the bar gone this line is the row's own content, not a caption
        # under a track: it has to be set in ink at the row's weight, or it
        # reads as a label for something that is no longer there.
        mid = by_name["Mid"]
        print("   day count %.1fpx %s   |   days-left %.1fpx %s"
              % (mid["dayPx"], mid["dayColor"], mid["leftPx"], mid["leftColor"]))
        ck(mid["dayPx"] > mid["leftPx"],
           "the day count outsizes the half beside it (%.1f vs %.1fpx)"
           % (mid["dayPx"], mid["leftPx"]))
        ck(mid["dayColor"] != mid["leftColor"],
           "and is set in ink, not the muted grey its neighbour uses (%s vs %s)"
           % (mid["dayColor"], mid["leftColor"]))

        # ── THE ONGOING MARK ──
        # Owner: "instead of running use ongoing, also put this animation on
        # aside of running product, it should be well defined."
        for r in rows:
            ck(r["chip"] in ("Active", "Completed"),
               "%s is labelled %r -- never the retired Running/Ongoing/Matured"
               % (r["name"].strip(), r["chip"]))
        print("   ongoing mark: %.1fx%.1fpx, %d chips, core %.1fpx, aria-hidden=%s"
              % (mid["spinW"], mid["spinH"], mid["chips"], mid["coreW"], mid["hidden"]))
        ck(mid["spin"] and by_name["New"]["spin"] and by_name["Legacy"]["spin"],
           "every ongoing plan carries the animation")
        # A finished plan has nothing in motion; an animation there would be
        # saying the opposite of the "Completed"/"Finished" beside it.
        ck(not by_name["Matured"]["spin"] and not by_name["Overpaid"]["spin"],
           "and a matured one does not")
        ck(mid["chips"] == 3, "all three orbiting chips are there (%d)" % mid["chips"])
        # "well defined": rendered at 24/30/36/44 side by side, the three
        # triangles stop being separable below about 30px. Asserted on the
        # RENDERED box, so a stylesheet that failed to load fails here too.
        ck(mid["spinW"] >= 30 and mid["spinH"] >= 30,
           "drawn big enough to read as three chips (%.1fx%.1f)" % (mid["spinW"], mid["spinH"]))
        ck(mid["coreW"] > 10,
           "the centre chip has real size, so the shape is not mush (%.1fpx)" % mid["coreW"])
        ck(mid["hidden"] == "true",
           "it is hidden from screen readers -- the row already says Active")

        # ── DATE STARTED ──
        # Owner: "make sure that one running investment, it shows Date bought."
        # The fixture's createdAt is `days` ago, so the expected date is
        # computed the same way rather than hardcoded.
        print("   bought lines: %s" % [r["bought"] for r in rows])
        for src, _wd, _wl in CASES:
            r = by_name.get(src["tierLabel"])
            if not r:
                continue
            ck(r["bought"].startswith("Started "),
               "%s states when it was started (%r)" % (src["tierLabel"], r["bought"]))
            # Spelled month, never a numeric date: 12/08 is read two different
            # ways by two different members.
            ck(any(m in r["bought"] for m in
                   ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']),
               "%s spells the month rather than numbering it (%r)"
               % (src["tierLabel"], r["bought"]))
        # Owner: "even bought should carry the time bought at."
        # Checked against the exact ISO the fixture sent, converted to the
        # BROWSER's local zone the way the app does -- not recomputed from
        # utcnow(), which drifts by a minute if the clock ticks over between
        # building the fixture and asserting on it.
        off = await page.evaluate("new Date().getTimezoneOffset()")   # minutes, west-positive
        iso = next(c[0]["createdAt"] for c in CASES if c[0]["tierLabel"] == "Mid")
        d = (datetime.datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")
             - datetime.timedelta(minutes=off))
        expect = "Started %d %s %d at %02d:%02d" % (
            d.day, ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.month-1],
            d.year, d.hour, d.minute)
        ck(mid["bought"] == expect,
           "and gets the day and the time right (%r vs %r)" % (mid["bought"], expect))
        # 24-hour, like the ledger's own "23:21" and the plan countdown --
        # one clock across the app, and no am/pm to misread.
        ck(_time_re.search(mid["bought"]) and "am" not in mid["bought"].lower()
           and "pm" not in mid["bought"].lower(),
           "the time is 24-hour (%r)" % mid["bought"])

        await page.screenshot(path=f"{OUT}/plan-progress.png", full_page=True)
        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nplan progress: all cases pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
