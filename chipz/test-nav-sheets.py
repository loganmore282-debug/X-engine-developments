import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8825
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone":"0742730382","walletBalance":2000,"totalDeposited":58000,"totalEarned":9840,
 "totalWithdrawn":32164,"totalInvested":28000,"checkinStreak":2,"lastCheckinAt":None,
 "referralCode":"ML3Q4X","publicId":"10012","registrationDone":True,
 "team":{"l1":3,"l2":1,"l3":0,"commission":7840}}
PRODUCTS=[{"key":f"product-{i}","name":f"Product-{i}","price":p,"cycle":150,
  "expectedReturn":p*3,"image":"","spinCount":1 if i>1 else 0,"spinMin":200,"spinMax":1000}
  for i,p in enumerate([30000,90000,180000,300000,600000,900000,1500000],start=1)]
TX=[
 {"id":"1","type":"deposit","amount":28000,"displayAmount":28000,"description":"Deposit: Pending (UGX 28,000)","date":"05/09/2026","time":"23:21"},
 {"id":"2","type":"deposit","amount":28000,"displayAmount":28000,"description":"Deposit: Pending (UGX 28,000)","date":"05/09/2026","time":"19:41"},
 {"id":"3","type":"promocode","amount":2000,"description":"Treasure chest reward","date":"02/09/2026","time":"15:45"},
 {"id":"4","type":"withdraw","amount":-6664,"displayAmount":-6664,"description":"Withdrawal: Paid (UGX 6,664)","date":"02/09/2026","time":"15:43"},
 {"id":"5","type":"commission","amount":7840,"description":"Level 1 Commission","date":"02/09/2026","time":"14:39"},
 {"id":"6","type":"turntable","amount":640.5,"description":"Turntable daily spin","date":"01/09/2026","time":"08:12"},
]
ROUTES={
 "/public/settings":{"status":"success","settings":{"minDeposit":30000,"minWithdraw":20000,
   "withdrawFeePct":15,"commL1":28,"commL2":1,"commL3":1,"annEnabled":True,"annTitle":"",
   "annBody":"Chipz was built to meet your everyday investing needs.\n\nShare your referral link to earn commission on every deposit your team makes.",
   "telegramGroup":"https://t.me/chipz","depositPayAEnabled":True,"depositPayBEnabled":False,
   "brandTagline":"Uganda's boldest way to grow your money","openingCountdownEnabled":False,
   "maintenanceMode":False,"dailyCheckin":500,"turntableEnabled":True}},
 "/public/products":{"status":"success","products":PRODUCTS},
 "/public/activity-feed":{"status":"success","feed":[
   {"kind":"deposit","phone":"077****123","amount":58000},
   {"kind":"withdraw","phone":"075****456","amount":25500},
   {"kind":"deposit","phone":"070****789","amount":90000}]},
 "/public/banner":{"status":"success","image":None},
 "/public/announcement-image":{"status":"success","image":None},
 "/public/manual-pay-images":{"status":"success","selector":None,"hero":None},
 "/public/chipz-images":{"status":"success","referral":None,"logo":None},
 "/account":{"status":"success","account":ACCOUNT},
 "/investments":{"status":"success","investments":[]},
 "/transactions":{"status":"success","transactions":TX,"truncated":False},
 "/messages":{"status":"success","messages":[{"id":"welcome",
   "title":"Welcome to the Chipz Investment Returns app!",
   "body":"You can earn daily income through investments via the app, and also earn daily wages by sharing your referral link with friends and family.",
   "date":"31/08/2026","time":"08:59","createdAt":0,"read":False}]},
 "/bank/list":{"status":"success","accounts":[{"id":"b1","holder":"Mangalita Namugabwe","network":"MTN Mobile Money","phone":"0769968158"}]},
 "/team/stats":{"status":"success","referralCode":"ML3Q4X","commRates":{"l1":28,"l2":1,"l3":1},
   "team":{"l1":2,"l2":0,"l3":0},"totalTeam":2,"teamCommission":7840,"teamDeposits":58000,"milestones":[]},
 "/team/members":{"status":"success","level":1,"members":[
   {"id":"m1","phone":"0771234567","createdAt":None,"invested":28000},
   {"id":"m2","phone":"0759876543","createdAt":None,"invested":90000}]},
 "/mission/status":{"status":"success","mission":{}},
 "/turntable/status":{"status":"success","enabled":True,"dailyAvailable":True,"earnedSpins":3,
   "totalSpins":4,"nextDailyAt":0,"dailyMin":200,"dailyMax":1000},
}
FB_APP="export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH="""
 const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};
 export const getAuth=()=>({currentUser:user});
 export const createUserWithEmailAndPassword=async()=>({user});
 export const signInWithEmailAndPassword=async()=>({user});
 export const signOut=async()=>{};export const updatePassword=async()=>{};
 export const reauthenticateWithCredential=async()=>{};
 export const EmailAuthProvider={credential:()=>({})};
 export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};
"""
def serve():
    h=functools.partial(http.server.SimpleHTTPRequestHandler,directory=ROOT)
    socketserver.TCPServer.allow_reuse_address=True
    s=socketserver.TCPServer(("127.0.0.1",PORT),h)
    threading.Thread(target=s.serve_forever,daemon=True).start(); return s


async def main():
    errs=[]; fails=[]
    def ck(ok,l):
        print(("PASS  " if ok else "FAIL  ")+l)
        if not ok: fails.append(l)
    async with async_playwright() as pw:
        b=await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx=await b.new_context(viewport={"width":390,"height":844},device_scale_factor=2,service_workers="block")
        page=await ctx.new_page()
        page.on("pageerror",lambda e:errs.append(str(e)))
        async def api(r):
            path="/"+r.request.url.split("://",1)[-1].split("/",1)[-1].split("?")[0]
            body=next((v for k,v in ROUTES.items() if path.endswith(k)),{"status":"success"})
            await r.fulfill(status=200,content_type="application/json",body=json.dumps(body))
        await page.route(f"{API}/**",api)
        await page.route("https://fonts.googleapis.com/**",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/css",body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html",wait_until="load")
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce()")
        await page.wait_for_timeout(400)

        # Home carries ONE float now. The owner: "remove spin icon on home
        # screen" -- so the turntable float is gone and the overlap this
        # block used to guard against cannot happen. What still has to hold
        # is that the chest is there, is the only float, and clears the nav
        # bar rather than sitting behind it.
        boxes = await page.evaluate("""()=>{const all=[...document.querySelectorAll('.chest-float')];
          const c=document.querySelector('.chest-float:not(.turntable-float)');
          const nav=document.querySelector('.bottom-nav');
          const r=e=>{if(!e) return null;const b=e.getBoundingClientRect();
            return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),b:+b.bottom.toFixed(1),r:+b.right.toFixed(1)};};
          return {count:all.length, spin:!!document.querySelector('.turntable-float'),
                  chest:r(c), nav:r(nav)};}""")
        print("  floats:",boxes["count"],"spin float:",boxes["spin"],"\n  chest:",boxes["chest"],"\n  nav:",boxes["nav"])
        ck(not boxes["spin"], "the spin float is off Home, as asked")
        ck(boxes["count"]==1 and boxes["chest"], "the treasure chest is the one float left")
        if boxes["chest"] and boxes["nav"]:
            ck(boxes["chest"]["b"] <= boxes["nav"]["y"] + 1,
               "and it sits clear of the nav bar (chest bottom %.0f vs nav top %.0f)"
               % (boxes["chest"]["b"], boxes["nav"]["y"]))

        # nav visible on every sub-screen
        for fn,name in [("openDepositSheet()","Deposit"),("openWithdrawSheet()","Withdraw"),
                        ("openWalletSheet()","Wallet"),("openBalanceRecordSheet()","Balance Record"),
                        ("openMessagesSheet()","Messages"),("openChestSheet()","Chest"),
                        ("openTurntableSheet()","Turntable")]:
            await page.evaluate(fn); await page.wait_for_timeout(500)
            vis = await page.evaluate("""()=>{const n=document.querySelector('.bottom-nav');const b=n.getBoundingClientRect();
              const cs=getComputedStyle(n);
              const top=document.elementFromPoint(b.x+b.width/2, b.y+b.height/2);
              return {onScreen: b.bottom<=innerHeight+1 && b.top<innerHeight, disp:cs.display,
                      navOnTop: !!(top && top.closest('.bottom-nav'))};}""")
            ck(vis["onScreen"] and vis["disp"]!="none" and vis["navOnTop"], f"{name}: nav visible and tappable -> {vis}")
            if name=="Deposit":
                await page.screenshot(path=f"{OUT}/nav-over-deposit.png",full_page=False)
        # tapping a tab while a sheet is open closes it
        await page.evaluate("openDepositSheet()"); await page.wait_for_timeout(400)
        await page.click('.navitem[data-nav="team"]'); await page.wait_for_timeout(700)
        ck(not await page.evaluate("()=>!!document.querySelector('.sheet-bg.show')"),
           "tapping a tab from inside a sheet closes the sheet")
        ck(await page.evaluate("()=>STATE.page")=="team", "and actually switches to that tab")

        # ── the announcement fires on the way to HOME, and nowhere else ──
        # Owner: "l said from deposit to home, not when one clicks on deposit
        # and later goes to another ... l don't want when l can go in deposit
        # and l click to another nav icon not home it should not show
        # announcement dialog, also on withdrawal as well."
        #
        # Deposit and Withdraw are OVERLAYS over Home, so STATE.page is still
        # 'home' while one is open. showPage() closes the sheet BEFORE it sets
        # STATE.page, so the announce guard's "am I on Home?" check read the
        # page the sheet was covering and said yes -- for every tab, not just
        # Home. The new tab then painted underneath the dialog.
        #
        # Driven through real taps on the real bottom bar, because the bug was
        # in the ORDER two lines run in: calling closeSheet() directly, or
        # asserting on the flag, would miss it entirely.
        announced = "()=>document.getElementById('announceBg').classList.contains('show')"
        for opener, screen in (("openDepositSheet()", "Deposit"),
                               ("openWithdrawSheet()", "Withdraw")):
            for tab in ("products", "team", "account"):
                await page.evaluate("showPage('home')"); await page.wait_for_timeout(400)
                await page.evaluate("closeAnnounce()")
                await page.evaluate(opener); await page.wait_for_timeout(400)
                await page.click(f'.navitem[data-nav="{tab}"]'); await page.wait_for_timeout(700)
                ck(not await page.evaluate(announced),
                   f"{screen} -> the {tab} tab: no announcement")
                ck(await page.evaluate("()=>STATE.page") == tab,
                   f"{screen} -> the {tab} tab: and it really switched")

            # The half the owner DOES want, checked in the same loop so a fix
            # that simply muted the dialog everywhere cannot pass this file.
            await page.evaluate("showPage('home')"); await page.wait_for_timeout(400)
            await page.evaluate("closeAnnounce()")
            await page.evaluate(opener); await page.wait_for_timeout(400)
            await page.click('.navitem[data-nav="home"]'); await page.wait_for_timeout(700)
            ck(await page.evaluate(announced), f"{screen} -> the Home tab: announcement shows")

            # ...and the back chevron, which is what "clicked back" literally
            # means and goes through a different path (closeSheet with no args).
            await page.evaluate("closeAnnounce()")
            await page.evaluate(opener); await page.wait_for_timeout(400)
            await page.click('#sheetBg .back'); await page.wait_for_timeout(700)
            ck(await page.evaluate(announced), f"{screen} -> back chevron: announcement shows")
        await page.evaluate("closeAnnounce()")

        # ── no Snow wording in the BUILT app ──
        # Chipz is a fork of Snow. test-no-snow-branding.js checks the
        # sources; the obfuscator encodes string literals, so a rendered
        # screen is the only place the SHIPPED wording can be read. It also
        # catches a source fixed but never rebuilt.
        #
        # This used to drive shareReferral() -- the referral invite text was
        # the worst offender, reading "Join Snow and start earning". That
        # function is gone now (the owner asked for copy, not share), and
        # with it the only sentence that carried a product name into
        # WhatsApp, so what is left to check is the screens themselves.
        for tab in ('home', 'referral', 'team', 'account'):
            await page.evaluate(f"showPage('{tab}')"); await page.wait_for_timeout(450)
            txt = await page.inner_text('#pageHost')
            ck('Snow' not in txt and 'snow' not in txt.lower().replace('snowflake', ''),
               f"the {tab} screen shows no Snow wording")
        await page.evaluate("openAboutSheet()"); await page.wait_for_timeout(500)
        title = await page.evaluate("()=>{const t=document.querySelector('.sheet-title,.sheet-head h2,#sheetTitle');return t?t.textContent.trim():null;}")
        ck(title == 'About Chipz', "the About sheet is titled About Chipz (%r)" % title)

        ck(not errs, "no page errors: "+str(errs))
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nnav + floats: all cases pass")
    sys.exit(1 if fails else 0)
# ── The announce-after-sheet list is matched by TITLE ──
# Owner: "l also want the announcement dialog to show when one has clicked back
# from deposit page to home also when one has clicked back from withdrawal
# page." It was meant to already, and failed on ONE missing string: the deposit
# flow opens three differently-titled sheets ('Recharge' for the chooser and the
# manual form, 'Deposit' for the automatic one most members see) and only
# 'Recharge' was listed.
#
# A title is a string in two places at once, so this checks the source: every
# entry in ANNOUNCE_AFTER_SHEETS must be a title openSheet() is really called
# with, and the deposit and withdraw screens must both be covered. Grepping the
# BUILT file would prove nothing -- the obfuscator encodes string literals.
import re as _re
_src = open('/home/user/X-engine-developments/chipz/user-src/original_module.js',
            encoding='utf-8').read()
_m = _re.search(r"var ANNOUNCE_AFTER_SHEETS = \[([^\]]*)\]", _src)
_listed = _re.findall(r"'([^']+)'", _m.group(1)) if _m else []
_opened = set(_re.findall(r"openSheet\('([^']+)'", _src))
print("\n— announce-after-sheet —")
print("   listed:", _listed)
_f = 0
for _t in _listed:
    ok = _t in _opened
    print(("PASS  " if ok else "FAIL  ") + "%r is a sheet that really exists" % _t)
    if not ok: _f += 1
for _need, _label in (('Deposit', 'the automatic deposit form'),
                      ('Recharge', 'the deposit chooser / manual form'),
                      ('Withdraw', 'the withdraw screen')):
    ok = _need in _listed
    print(("PASS  " if ok else "FAIL  ") + "backing out of %s re-announces (%r listed)" % (_label, _need))
    if not ok: _f += 1
if _f:
    print("\n%d FAILED" % _f)
    sys.exit(1)

srv=serve(); asyncio.run(main())
