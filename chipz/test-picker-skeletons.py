import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8859
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
        slow={"on":False}
        async def api(r):
            path="/"+r.request.url.split("://",1)[-1].split("/",1)[-1].split("?")[0]
            if slow["on"] and (path.endswith("/public/products") or path.endswith("/investments") or path.endswith("/team/stats")):
                await asyncio.sleep(2.2)
            body=next((v for k,v in ROUTES.items() if path.endswith(k)),{"status":"success"})
            await r.fulfill(status=200,content_type="application/json",body=json.dumps(body))
        await page.route(f"{API}/**",api)
        await page.route("https://fonts.googleapis.com/**",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/css",body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html",wait_until="load")
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce()")

        # ---- bell ----
        bell = await page.evaluate("""()=>{const i=document.querySelector('.act-bell img');
          if(!i) return null; const w=document.querySelector('.act-bell');
          return {src:i.getAttribute('src'), loaded:i.complete&&i.naturalWidth>0, nat:[i.naturalWidth,i.naturalHeight],
                  wrapBg:getComputedStyle(w).backgroundColor};}""")
        print("  bell:", bell)
        ck(bell and bell["src"]=="/act-bell.png" and bell["loaded"], "activity card uses the owner's bell artwork")
        ck(bell and bell["wrapBg"] in ('rgba(0, 0, 0, 0)','transparent'), "no tinted disc behind it")

        # ---- provider picker ----
        await page.evaluate("openWalletSheet()"); await page.wait_for_timeout(900)
        await page.evaluate("toggleWalletEdit(true)"); await page.wait_for_timeout(700)
        ck(await page.evaluate("()=>!!document.querySelector('#walProviderPick')"), "picker present")
        ck(not await page.evaluate("()=>!!document.querySelector('#walProvider').tagName.match(/SELECT/)"), "not a native <select> any more")
        vis0 = await page.evaluate("()=>getComputedStyle(document.querySelector('.prov-list')).display")
        await page.click('.prov-input'); await page.wait_for_timeout(350)
        vis1 = await page.evaluate("()=>getComputedStyle(document.querySelector('.prov-list')).display")
        opts = await page.evaluate("()=>[...document.querySelectorAll('.prov-opt')].map(o=>o.textContent.trim())")
        print("  list closed/open:", vis0, "->", vis1, "| options:", opts)
        ck(vis0=="none" and vis1!="none", "tapping the field opens the list")
        ck(opts==["MTN Mobile Money","Airtel Money"], "shows the providers as plain rows")
        await page.screenshot(path=f"{OUT}/provider-open.png",full_page=False)
        await page.click('.prov-opt:nth-child(2)'); await page.wait_for_timeout(350)
        val = await page.evaluate("()=>document.querySelector('#walProvider').value")
        vis2 = await page.evaluate("()=>getComputedStyle(document.querySelector('.prov-list')).display")
        ck(val=="Airtel Money" and vis2=="none", "picking a row fills the field and closes: "+repr(val))
        # tapping elsewhere closes it
        await page.click('.prov-input'); await page.wait_for_timeout(250)
        await page.evaluate("()=>document.querySelector('.wallet-panel .lbl').click()"); await page.wait_for_timeout(250)
        ck(await page.evaluate("()=>getComputedStyle(document.querySelector('.prov-list')).display")=="none", "tapping outside closes it")
        await page.evaluate("closeSheet()"); await page.wait_for_timeout(400)

        # ---- skeletons ----
        slow["on"]=True
        for tab,sel,label in [("catalog",".sk-pcard","Products"),("products",".sk-band","My Products"),("team",".sk-tcards","Team")]:
            await page.evaluate("()=>{STATE.products=[];STATE.investments=null;STATE.teamStats=null;}")
            # NOT awaited: page.evaluate resolves a returned promise, so
            # returning showPage()'s promise would wait for the whole load and
            # measure after the skeleton was already gone.
            await page.evaluate(f"()=>{{ showPage('{tab}'); }}")
            await page.wait_for_timeout(500)
            n = await page.evaluate("(s)=>document.querySelectorAll(s).length", sel)
            shimmer = await page.evaluate("()=>{const e=document.querySelector('.sk');return e?getComputedStyle(e,'::after').animationName:null;}")
            print("  %-12s skeletons=%s shimmer=%s" % (label, n, shimmer))
            ck(n>0, f"{label}: skeleton shown while loading")
            ck(shimmer=="skShimmer", f"{label}: skeleton shimmers")
            await page.screenshot(path=f"{OUT}/sk-{tab}.png",full_page=False)
            await page.wait_for_timeout(2400)
            gone = await page.evaluate("(s)=>document.querySelectorAll(s).length", sel)
            real = await page.evaluate("()=>document.querySelectorAll('.p-card,.mp-row,.team-member,.mp-band,.team-gcard').length")
            ck(gone==0, f"{label}: skeleton replaced once data lands")
            ck(real>0, f"{label}: real content painted ({real} nodes)")
        ck(not errs,"no page errors: "+str(errs))
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nall cases pass")
    sys.exit(1 if fails else 0)
srv=serve(); asyncio.run(main())
