import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8843
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
 "/public/chipz-images":{"status":"success","referral":None,"logo":None,"spin":None},
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
        mode={"code":True}
        async def api(r):
            path="/"+r.request.url.split("://",1)[-1].split("/",1)[-1].split("?")[0]
            if path.endswith("/invest/create"):
                body = {"status":"error","code":"INSUFFICIENT_BALANCE","message":"Need UGX 30,000, have UGX 5,000"} if mode["code"] \
                       else {"status":"error","message":"Need UGX 30,000, have UGX 5,000"}
                return await r.fulfill(status=400,content_type="application/json",body=json.dumps(body))
            body=next((v for k,v in ROUTES.items() if path.endswith(k)),{"status":"success"})
            await r.fulfill(status=200,content_type="application/json",body=json.dumps(body))
        await page.route(f"{API}/**",api)
        await page.route("https://fonts.googleapis.com/**",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/css",body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html",wait_until="load")
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce()")

        async def buy():
            await page.evaluate("showPage('catalog')"); await page.wait_for_timeout(900)
            await page.evaluate("document.querySelector('.p-cta').click()"); await page.wait_for_timeout(700)

        # --- server sends the code ---
        await buy()
        msg = (await page.inner_text('#notifyMsg')).strip()
        print("  message:", repr(msg))
        ck('Insufficient balance' in msg and 'deposit' in msg, "wording matches the reference")
        m = await page.evaluate("""()=>{const btn=document.querySelector('.notify-ok');
          const card=btn.closest('.notify-card');
          const b=btn.getBoundingClientRect(), c=card.getBoundingClientRect();
          const cs=getComputedStyle(btn);
          return {btnW:+b.width.toFixed(1), cardW:+c.width.toFixed(1), label:btn.textContent.trim(),
                  centred: Math.abs((b.left-c.left)-(c.right-b.right))<2, width:cs.width};}""")
        for k,v in m.items(): print("  %-9s %s" % (k,v))
        ck(m["btnW"] < m["cardW"]*0.72, "button is not stretched across the card (%.0f of %.0f)" % (m["btnW"], m["cardW"]))
        ck(m["centred"], "button is centred")
        await page.screenshot(path=f"{OUT}/insufficient.png",clip={"x":30,"y":250,"width":330,"height":300})
        # tapping OK must land on Deposit
        await page.click('.notify-ok'); await page.wait_for_timeout(900)
        ck(await page.evaluate("()=>!!document.querySelector('.sheet-bg.show')"), "tapping OK opens the Deposit sheet")
        title = await page.evaluate('''()=>{const s=document.querySelector(".sheet-bg.show");return s?s.innerText.trim().split("\\n").slice(0,3).join(" | "):"";}''')
        print("  sheet:", repr(title))
        ck('eposit' in title, "and it is Deposit: "+repr(title))
        await page.evaluate("closeSheet()"); await page.wait_for_timeout(500)

        # --- auto-redirect without tapping OK ---
        await buy()
        ck(await page.evaluate("()=>document.getElementById('notifyBg').classList.contains('show')"), "dialog shown again")
        await page.wait_for_timeout(2300)
        ck(not await page.evaluate("()=>document.getElementById('notifyBg').classList.contains('show')"), "dialog closes itself")
        ck(await page.evaluate("()=>!!document.querySelector('.sheet-bg.show')"), "and redirects to Deposit with no tap")
        await page.evaluate("closeSheet()"); await page.wait_for_timeout(400)

        # --- older backend with no code: message fallback ---
        mode["code"]=False
        await buy()
        msg2 = (await page.inner_text('#notifyMsg')).strip()
        ck('Insufficient balance' in msg2, "works against a backend with no error code yet: "+repr(msg2))
        await page.wait_for_timeout(2300)
        ck(await page.evaluate("()=>!!document.querySelector('.sheet-bg.show')"), "fallback path redirects too")
        ck(not errs,"no page errors: "+str(errs))
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\ninsufficient balance: all cases pass")
    sys.exit(1 if fails else 0)
srv=serve(); asyncio.run(main())
