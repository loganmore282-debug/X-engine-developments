"""
What a cash-out does to the screen, and what Records stops saying.

Owner: "l nolonger need that ugly old notify that cash out processing, don't you
know our card notifies, with [the warning sign], so it can saying other words and
shows amount to be received after the charges plus okay button ... also remove
details in records, ie if treasure code don't put details, if withdrawal failed
due to refund, just put failed, turntable like that no putting words down that
daily spin, welcome bonus like that don't put that welcome gift ... also why when
l withdrawal the value still remains???"

THE BALANCE BUG. The server debits on request -- /withdraw/request does
walletBalance: increment(-amt) before it answers -- so the money really had left
the account; the client just never refreshed STATE.account and every screen kept
painting the figure from before the request.

That makes the fix only provable against a SLOW /account: if the refetch is what
fixes it, stalling the refetch keeps the stale figure on screen. So /account is
delayed 3s here and the balance is read immediately after the dialog opens. It
has to be down by then, which can only happen if the debit was applied locally.

RECORDS. Every row already names what happened, shows the amount and the date.
The line underneath was the SERVER's sentence -- "Turntable daily spin", "Gift
code redeemed: ABC123", "Withdrawal: Failed -- refunded to wallet" -- restating
the title in more words. Deposits and withdrawals keep a ONE-WORD status because
pending/paid/failed is genuinely new; everything else gets nothing.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/records-withdraw'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'user')
PORT = 8881
API = 'https://chipz-server.onrender.com'

BAL = 50000
TAKE = 20000
FEE_PCT = 15
NET = TAKE - TAKE * FEE_PCT // 100          # 17,000

ACCOUNT = {"phone": "0742730382", "walletBalance": BAL, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 0,
           "checkinStreak": 0, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}

# The exact shapes the ledger produces, descriptions and all. The point is that
# NONE of these sentences reach the member any more.
TX = [
    {"id": "1", "type": "promocode", "amount": 2000,
     "description": "Gift code redeemed: CHIPZ2026", "date": "05/09/2026", "time": "23:21"},
    {"id": "2", "type": "turntable", "amount": 640.5,
     "description": "Turntable daily spin", "date": "05/09/2026", "time": "19:41"},
    {"id": "3", "type": "admin_credit", "amount": 5000,
     "description": "Welcome gift", "date": "04/09/2026", "time": "10:02"},
    {"id": "4", "type": "commission", "amount": 7840,
     "description": "Level 1 Commission", "date": "03/09/2026", "time": "14:39"},
    # The one he named: a withdrawal that failed and was refunded.
    {"id": "5", "type": "withdraw", "amount": -6664, "displayAmount": -6664,
     "description": "Withdrawal: Failed - refunded to wallet (UGX 6,664)",
     "date": "02/09/2026", "time": "15:43"},
    {"id": "6", "type": "withdraw", "amount": -25500, "displayAmount": -25500,
     "description": "Withdrawal: Paid (UGX 25,500)", "date": "02/09/2026", "time": "12:10"},
    {"id": "7", "type": "deposit", "amount": 28000, "displayAmount": 28000,
     "description": "Deposit: Pending (UGX 28,000)", "date": "01/09/2026", "time": "08:12"},
]

ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 5000, "withdrawFeePct": FEE_PCT,
        "withdrawMultiple": 5000,
        "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": False,
        "cycleDays": 30, "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": False}},
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
    "/transactions": {"status": "success", "transactions": TX, "truncated": False},
    "/messages": {"status": "success", "messages": []},
    "/bank/list": {"status": "success", "accounts": [
        {"id": "b1", "holder": "Mangalita Namugabwe", "network": "MTN Mobile Money",
         "phone": "0769968158"}]},
    "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0,
                    "teamCommission": 0, "teamDeposits": 0, "milestones": []},
    "/turntable/status": {"status": "success", "enabled": False, "dailyAvailable": False,
                          "earnedSpins": 0, "totalSpins": 0, "nextDailyAt": 0,
                          "dailyMin": 0, "dailyMax": 0},
    "/withdraw/request": {"status": "success", "withdrawalId": "w1", "reference": "CHZ-1",
                          "net": NET, "message": "Cash-out requested, processing now"},
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
DELAY = {}


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
            key = next((k for k in ROUTES if path.endswith(k)), None)
            if DELAY.get(key):
                await asyncio.sleep(DELAY[key])
            await r.fulfill(status=200, content_type="application/json",
                            body=json.dumps(ROUTES.get(key, {"status": "success"})))

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

        # ── 1. RECORDS ────────────────────────────────────────────────────
        await page.evaluate("openBalanceRecordSheet()")
        await page.wait_for_selector("#balBody .rec", timeout=6000)
        await page.wait_for_timeout(900)
        rows = await page.evaluate("""()=>[...document.querySelectorAll('#balBody .rec')]
          .map(r=>({title:((r.querySelector('.t1')||{}).textContent||'').trim(),
                    sub:((r.querySelector('.t3')||{}).textContent||'').trim(),
                    pill:((r.querySelector('.rec-pill')||{}).textContent||'').trim(),
                    text:(r.innerText||'').replace(/\\n/g,' | ')}))""")
        for r in rows:
            print("   %-22s pill=%-9s sub=%r" % (r["title"][:22], r["pill"] or "-", r["sub"]))
        ck(len(rows) == len(TX), "every record rendered (%d of %d)" % (len(rows), len(TX)))

        # The sentences that must no longer reach the member. Checked against
        # the whole row's text, not just the sub-line: moving the description
        # somewhere else in the row would still be showing it.
        for phrase in ["daily spin", "Welcome gift", "Gift code redeemed",
                       "CHIPZ2026", "refunded to wallet", "Level 1 Commission"]:
            hit = [r["title"] for r in rows if phrase.lower() in r["text"].lower()]
            ck(not hit, "no row repeats %r (%s)" % (phrase, hit or "none"))

        by_pill = [r for r in rows if r["pill"]]
        ck(len(by_pill) == 3,
           "only the deposits and withdrawals carry a status (%d)" % len(by_pill))
        ck(all(r["pill"] in ("Paid", "Pending", "Failed") for r in by_pill),
           "and each is ONE word: %s" % [r["pill"] for r in by_pill])
        # The one he named by name.
        refunded = next((r for r in rows if "6,664" in r["text"] or "6664" in r["text"]), None)
        ck(refunded is not None and refunded["pill"] == "Failed",
           "the refunded withdrawal just says Failed (%r)"
           % (refunded["pill"] if refunded else None))
        ck(all(not r["sub"] for r in rows),
           "no row carries a description line at all")
        await page.screenshot(path=f"{OUT}/records.png")
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(500)

        # ── 2. THE CASH-OUT ───────────────────────────────────────────────
        # /account stalled, so a balance that drops can ONLY be the local debit.
        DELAY["/account"] = 3.0
        DELAY["/transactions"] = 3.0
        await page.evaluate("openWithdrawSheet()")
        await page.wait_for_selector("#witAmount", timeout=6000)
        await page.wait_for_timeout(600)
        before = await page.evaluate("(STATE.account||{}).walletBalance")
        await page.fill("#witAmount", str(TAKE))
        await page.fill("#witPin", "123456")
        await page.click("#witSubmitBtn")
        await page.wait_for_selector("#notifyBg.show", timeout=8000)
        after = await page.evaluate("(STATE.account||{}).walletBalance")
        msg = (await page.text_content("#notifyMsg") or "").strip()
        icon = (await page.text_content(".notify-icon") or "").strip()
        toasts = await page.evaluate("document.querySelectorAll('.toast,#toastHost').length")
        okTxt = (await page.text_content(".notify-ok") or "").strip()
        print("   balance %s -> %s (with /account stalled 3000 ms)" % (before, after))
        print("   card: %r  icon=%r  ok=%r" % (msg, icon, okTxt))

        ck(before == BAL, "started from the seeded balance (%s)" % before)
        ck(after == BAL - TAKE,
           "the balance drops the moment the cash-out is accepted (%s, expected %s)"
           % (after, BAL - TAKE))
        ck(toasts == 0, "no dark toast pill anywhere (%d)" % toasts)
        ck(icon == "⚠️", "it is the warning card, not a pill (%r)" % icon)
        ck(okTxt.upper() == "OK", "with the OK button (%r)" % okTxt)
        # "shows amount to be received after the charges"
        ck("17,000" in msg,
           "the card states what will actually be received, after the charge (%r)" % msg)
        ck("20,000" in msg, "and what was asked for (%r)" % msg)
        ck("15%" in msg, "and names the charge (%r)" % msg)
        await page.screenshot(path=f"{OUT}/cashout-card.png")

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nrecords + cash-out: all pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
