import asyncio, json, os, re, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8853
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
        await page.evaluate("openChestSheet()"); await page.wait_for_timeout(1200)
        info = await page.evaluate("""()=>{const inp=document.querySelector('#chestKey');
          const rules=[...document.querySelectorAll('.chest-rule')];
          const ring=document.querySelector('.glow-ring');
          const rb=getComputedStyle(ring,'::before'), ra=getComputedStyle(ring,'::after');
          const img=document.querySelector('.glow-ring img');
          return {align:getComputedStyle(inp).textAlign, fontSize:getComputedStyle(inp).fontSize,
                  rules:rules.length, ruleClasses:rules.map(r=>r.className),
                  ruleW:rules.length?+rules[0].getBoundingClientRect().width.toFixed(0):0,
                  ringStyle:rb.borderTopStyle, ringWidth:rb.borderTopWidth,
                  outerInset:rb.top, innerStyle:ra.borderTopStyle, innerInset:ra.top,
                  innerColor:ra.borderTopColor, wash:getComputedStyle(ring).backgroundImage,
                  keyBorder:getComputedStyle(document.querySelector('.key-field')).borderTopColor,
                  chestLoaded: img && img.complete && img.naturalWidth>0,
                  chestAnim: getComputedStyle(img).animationName};}""")
        for k,v in info.items(): print("  %-12s %s" % (k,v))
        ck(info["align"]=="center", "key text is centred like the mockup")
        # Owner: "avoid stimulating keyboard when one taps chest box." Opening
        # the screen must NOT focus the key field -- the phone keyboard would
        # cover the chest, the title and the rules before the member has looked
        # at any of it. Asserted on document.activeElement, which is what
        # actually decides whether a phone raises the keyboard.
        focused = await page.evaluate(
            "()=>{const a=document.activeElement;"
            "return a?(a.id||a.tagName.toLowerCase()):null;}")
        print("   focus on open:", focused)
        ck(focused != "chestKey",
           "opening the chest does not focus the key field (focus on %r)" % focused)
        # And tapping the field yourself still works, or it could not be typed in.
        await page.click("#chestKey")
        await page.wait_for_timeout(200)
        after = await page.evaluate("(document.activeElement||{}).id")
        ck(after == "chestKey", "but tapping it does focus it (%r)" % after)
        ck(info["rules"]==2 and set(['chest-rule top','chest-rule bottom'])<=set(info["ruleClasses"]), "hairline above and below the block")
        # Owner: "on treasure chest there are 2 linings circulating the chest
        # box, you can even see clearly that one inside is solid and one outside
        # is dotted ... also some greener background on that chest box."
        ck(info["ringStyle"]=="dotted", "the OUTER ring is fine dots, not heavy dashes")
        ck(info["innerStyle"]=="solid", "and the INNER one is solid (%s)" % info["innerStyle"])
        # Inside, not outside: a solid ring drawn wider than the dotted one
        # would satisfy "two rings" and still be the wrong picture.
        outer = float(info["outerInset"].replace("px",""))
        inner = float(info["innerInset"].replace("px",""))
        ck(inner > outer,
           "the solid ring sits inside the dotted one (%.0f > %.0fpx)" % (inner, outer))
        # The wash behind the chest was orange; his is a green one. Read off the
        # computed gradient so a later re-theme cannot quietly undo it.
        g = info["wash"]
        stops = re.findall(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", g)
        first = [int(n) for n in stops[0]] if stops else None
        ck(first is not None and first[1] > first[0] and first[1] > first[2],
           "the wash behind the chest is green, not the old orange (%s)" % (first,))
        # Owner: "the chest box password input card, it has green on it, don't
        # you see the mockup image." Sampled off his screenshot at
        # rgb(184,213,195) on the border rows.
        kb = [int(n) for n in re.findall(r"\d+", info["keyBorder"])[:3]]
        ck(kb[1] > kb[0] and kb[1] > kb[2],
           "the key field is outlined in green, not plain grey (%s)" % info["keyBorder"])
        ck(info["chestLoaded"], "chest artwork loaded")
        ck(info["chestAnim"]=="chestBounce", "chest still animates here too")
        await page.screenshot(path=f"{OUT}/chest.png",full_page=False)
        ck(not errs,"no page errors: "+str(errs))
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nchest screen: all cases pass")
    sys.exit(1 if fails else 0)
srv=serve(); asyncio.run(main())
