import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8835
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone":"0742730382","walletBalance":2000,"totalDeposited":58000,"totalEarned":9840,
 "totalWithdrawn":32164,"totalInvested":28000,"checkinStreak":2,"lastCheckinAt":None,
 "referralCode":"ML3Q4X","publicId":"10012","registrationDone":True,
 "team":{"l1":3,"l2":1,"l3":0,"commission":7840}}
# The product frame is 16:9 -- see test-product-image-frame.py for why it
# stopped being 4:3 (the owner's real artwork is 1721x914 and 4:3 cards were
# far too tall for a phone).
# Twelve products, the same count DEFAULT_PRODUCTS now ships, so every one of
# them gets its frame measured rather than just the first two.
PROD_IMG_W, PROD_IMG_H = 1600, 900
PRODUCTS=[{"key":f"product-{i}","name":f"Product-{i}","price":p,"cycle":150,
  "expectedReturn":p*3,"image":"","spinCount":1 if i>1 else 0,"spinMin":200,"spinMax":1000}
  for i,p in enumerate([30000,90000,197000,355000,560000,950000,1000000,
                        1250000,2550000,4500000,6000000,8000000],start=1)]
# Owner: "make when l can time any product on its opening duration ie it can say
# coming soon in hh:mm:ss ... or even just putting as it is that coming soon."
# These carry exactly what /public/products publishes for each of the three
# closed states. opensAt is an absolute instant, which is the whole point --
# the phone counts down to it rather than computing a window itself.
import time as _t
_SOON_AT = int(_t.time() * 1000) + 3 * 3600 * 1000 + 25 * 60 * 1000   # 3h 25m out
PRODUCTS += [
  {"key":"sched-flat","name":"Flat Soon","price":50000,"cycle":150,"expectedReturn":150000,
   "image":"","spinCount":0,"spinMin":0,"spinMax":0,
   "comingSoon":True,"isOpen":False,"openMode":"soon","opensAt":None},
  {"key":"sched-until","name":"Timed Open","price":60000,"cycle":150,"expectedReturn":180000,
   "image":"","spinCount":0,"spinMin":0,"spinMax":0,
   "comingSoon":False,"isOpen":False,"openMode":"until","opensAt":_SOON_AT},
  {"key":"sched-window","name":"Daily Window","price":70000,"cycle":150,"expectedReturn":210000,
   "image":"","spinCount":0,"spinMin":0,"spinMax":0,
   "comingSoon":False,"isOpen":False,"openMode":"window","opensAt":_SOON_AT},
]

def _frame_jpeg(w, h):
    """A 1600x900 photo the admin panel would have produced, with the corners
    marked so a crop or a letterbox in the card frame is detectable."""
    from PIL import Image, ImageDraw
    import io
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x*255)//(w-1), (y*255)//(h-1), 90)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 40, 40], fill=(255, 0, 0))
    d.rectangle([w-41, h-41, w-1, h-1], fill=(0, 255, 0))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82); return b.getvalue()

PROD_JPEG = _frame_jpeg(PROD_IMG_W, PROD_IMG_H)
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
        for p in PRODUCTS:
            p["image"] = "/testprod.jpg" if p["key"]=="product-1" else ("/does-not-exist.jpg" if p["key"]=="product-2" else "")
        async def api(r):
            path="/"+r.request.url.split("://",1)[-1].split("/",1)[-1].split("?")[0]
            body=next((v for k,v in ROUTES.items() if path.endswith(k)),{"status":"success"})
            await r.fulfill(status=200,content_type="application/json",body=json.dumps(body))
        await page.route(f"{API}/**",api)
        # The real 1200x900 file the admin panel now stores, served as the
        # product-1 photo -- a 404 here would have quietly tested the glyph
        # fallback instead of a real image, which is what used to happen.
        await page.route("**/testprod.jpg",lambda r:asyncio.ensure_future(
            r.fulfill(status=200,content_type="image/jpeg",body=PROD_JPEG)))
        await page.route("https://fonts.googleapis.com/**",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/css",body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",lambda r:asyncio.ensure_future(r.fulfill(status=200,content_type="text/javascript",body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html",wait_until="load")
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce()")
        await page.evaluate("showPage('catalog')"); await page.wait_for_timeout(1400)
        # Every card, not just the first: all twelve frames must be 4:3.
        frames = await page.evaluate("""()=>[...document.querySelectorAll('.p-card .p-img')]
          .map(e=>{const r=e.getBoundingClientRect(); return +(r.width/r.height).toFixed(3);})""")
        ck(len(frames)==len(PRODUCTS), "all %d product cards rendered (got %d)"%(len(PRODUCTS),len(frames)))
        bad = [r for r in frames if abs(r-16/9)>0.02]
        ck(not bad, "every card frame is 16:9 (%d cards, off: %s)"%(len(frames),bad))

        # The real 1600x900 photo must arrive at its native size and cover the
        # frame with nothing letterboxed -- 1600x900 IS 16:9, so object-fit
        # cover has nothing to crop.
        pic = await page.evaluate("""()=>{const i=document.querySelector('.p-card .p-img img');
          if(!i) return null; const f=i.parentNode.getBoundingClientRect(); const r=i.getBoundingClientRect();
          return {nw:i.naturalWidth,nh:i.naturalHeight,complete:i.complete,
                  fit:getComputedStyle(i).objectFit,
                  dw:+(r.width-f.width).toFixed(1), dh:+(r.height-f.height).toFixed(1)};}""")
        print("  product-1 image:", pic)
        ck(bool(pic) and pic["complete"] and pic["nw"]==PROD_IMG_W and pic["nh"]==PROD_IMG_H,
           "the photo loads at its stored %dx%d"%(PROD_IMG_W,PROD_IMG_H))
        ck(bool(pic) and pic["fit"]=="cover" and abs(pic["dw"])<1 and abs(pic["dh"])<1,
           "and fills the frame exactly, no letterbox")

        f = await page.evaluate("""()=>{const c=document.querySelectorAll('.p-card');
          const a=c[0].querySelector('.p-img').getBoundingClientRect();
          const nm=c[0].querySelector('.p-name');
          const b=c[1].querySelector('.p-img');
          return {ratio:+(a.width/a.height).toFixed(3),
                  nameInsideImg: !!(nm && nm.closest('.p-img')),
                  nameText: nm?nm.textContent:null,
                  brokenHasGlyph: !!b.querySelector('.glyph'),
                  brokenKeepsName: !!b.querySelector('.p-name'),
                  brokenNameText: b.querySelector('.p-name')?b.querySelector('.p-name').textContent:null};}""")
        for k,v in f.items(): print("  %-16s %s" % (k,v))
        ck(abs(f["ratio"]-16/9)<0.02, "image frame is 16:9 (%.3f)" % f["ratio"])
        ck(f["nameInsideImg"], "product name sits on the image, no title bar")
        ck(f["brokenHasGlyph"], "a broken image falls back to the glyph")
        ck(f["brokenKeepsName"] and f["brokenNameText"], "and the name survives it: "+str(f["brokenNameText"]))
        # The complaint was card HEIGHT, so measure it rather than trusting
        # the ratio alone: at 4:3 this was 422 px and only two cards fitted.
        h = await page.evaluate("""()=>{const c=document.querySelector('.p-card');
          const r=c.getBoundingClientRect();
          const img=c.querySelector('.p-img').getBoundingClientRect();
          return {card:+r.height.toFixed(0), width:+r.width.toFixed(0), img:+img.height.toFixed(0),
                  visible:[...document.querySelectorAll('.p-card')].filter(e=>{
                    const b=e.getBoundingClientRect(); return b.top<844 && b.bottom>0;}).length};}""")
        print("  card box:", h)
        ck(h["card"] < 380, "the card is short enough for a phone (%d px, was 422)" % h["card"])
        ck(h["img"] < 210, "and the image is the part that shrank (%d px, was 264)" % h["img"])
        ck(h["visible"] >= 3, "three cards fit on screen now (%d)" % h["visible"])

        anims = await page.evaluate("""()=>{const out=[];document.querySelectorAll('#pageHost *').forEach(e=>{
          const cs=getComputedStyle(e); if(cs.animationName && cs.animationName!=='none') out.push(cs.animationName);});
          return [...new Set(out)];}""")
        print("  animations on page:", anims)
        ck(not [a for a in anims if a in ('revealIn','wordIn')], "no entrance animation left")
        await page.screenshot(path=f"{OUT}/cards-43.png",full_page=False)
        # ── OPENING SCHEDULE ──
        # Owner: "make when l can time any product ... it can say coming soon
        # in hh:mm:ss ... or even just putting as it is that coming soon."
        import re as _re
        ctas = await page.evaluate("""()=>[...document.querySelectorAll('.p-card')].map(c=>{
          const b=c.querySelector('.p-cta');
          return {name:((c.querySelector('.p-name')||c.querySelector('h3')||{}).textContent||'').trim(),
                  txt:(b?b.textContent:'').trim(), off:!!(b&&b.disabled),
                  at:b?b.getAttribute('data-opens-at'):null};})""")
        by = {c["name"]: c for c in ctas if c["name"]}
        for n in ("Flat Soon", "Timed Open", "Daily Window"):
            print("   %-13s %r disabled=%s" % (n, by.get(n, {}).get("txt"), by.get(n, {}).get("off")))
        ck(by.get("Flat Soon", {}).get("txt") == "Coming Soon",
           "the plain checkbox still just says Coming Soon, no clock (%r)"
           % by.get("Flat Soon", {}).get("txt"))
        ck(by.get("Flat Soon", {}).get("at") in (None, ""),
           "and carries no countdown target")
        for n in ("Timed Open", "Daily Window"):
            t = by.get(n, {}).get("txt", "")
            ck(bool(_re.match(r"^Coming soon in \d{2}:\d{2}:\d{2}$", t)),
               "%s counts down in HH:MM:SS (%r)" % (n, t))
            ck(by.get(n, {}).get("off") is True, "%s cannot be bought while closed" % n)
        # A scheduled card must be counting DOWN, not printing a frozen figure.
        first = by.get("Timed Open", {}).get("txt")
        await page.wait_for_timeout(2200)
        again = await page.evaluate(
            "()=>{const b=[...document.querySelectorAll('.p-cta')]"
            ".find(x=>x.hasAttribute('data-opens-at'));return b?b.textContent.trim():null;}")
        print("   ticking: %r -> %r" % (first, again))
        ck(first != again, "and it actually ticks (%r -> %r)" % (first, again))
        # An open product is untouched by any of this.
        open_ones = [c for c in ctas if c["txt"] == "Buy Now"]
        ck(len(open_ones) >= 3 and all(not c["off"] for c in open_ones),
           "products with no schedule still say Buy Now and stay tappable (%d)" % len(open_ones))
        ck(not errs,"no page errors: "+str(errs))
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nproduct cards: all cases pass")
    sys.exit(1 if fails else 0)
srv=serve(); asyncio.run(main())
