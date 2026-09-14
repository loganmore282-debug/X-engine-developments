#!/usr/bin/env python3
"""Find the blur/tint that leaves the list readable behind the message popup.

Owner: "see the blur in my mockup it is minimal such that you can even see
some texts in background."

Measured off his screenshot vs ours, over the backdrop strip above the card:

              luminance   stdev   edge p99
  his            190.9     10.9        8
  ours           216.2      1.4        3

stdev and edge energy are the ones that matter -- they say how much STRUCTURE
survives. Ours is flat: the content is not blurred, it is erased. Luminance
alone cannot see that, which is how the last tuning pass landed on a backdrop
that hit the right brightness with nothing legible behind it.

So this renders the real popup over the real list at a grid of (blur, tint)
values and reports the same three numbers, rather than picking a radius that
sounds "minimal".
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver, statistics
from PIL import Image, ImageFilter
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/msg-blur'
os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8767
API = 'https://chipz-server.onrender.com'
TARGET = {'lum': 190.9, 'std': 10.9, 'edge': 8}

GRID = [(b, t) for b in (3, 5, 6, 8, 10, 14, 20) for t in (0.10, 0.16, 0.22, 0.26)]

ROUTES = {
  "/public/settings": {"status": "success", "settings": {"brandName": "Chipz", "annEnabled": False}},
  "/account": {"status": "success", "account": {"userId": "u1", "phone": "0700000000",
      "referralCode": "TCL80", "walletBalance": 5000}},
  "/investments": {"status": "success", "investments": []},
  "/transactions": {"status": "success", "transactions": []},
  "/messages": {"status": "success", "messages": [
      {"id": "welcome", "title": "Welcome to the Chipz Investment Returns app!",
       "body": "You can earn daily income through investments via the app, and also earn "
               "daily wages by sharing your referral link with friends and family.",
       "date": "31/08/2026", "time": "08:59", "createdAt": 0, "read": False},
      {"id": "m2", "title": "Daily cashback is credited automatically",
       "body": "Your plans settle every day. Open My Products to follow them.",
       "date": "30/08/2026", "time": "10:15", "createdAt": 0, "read": True}]},
  "/public/products": {"status": "success", "products": []},
  "/public/banner": {"status": "success", "image": None, "video": None},
}
FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """
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
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def stats(path, card_top_frac):
    im = Image.open(path).convert('RGB'); W, H = im.size
    # the strip above the card, skipping the top chrome
    reg = im.crop((int(W*0.06), int(H*0.10), int(W*0.94), int(H*card_top_frac)))
    g = reg.convert('L')
    px = list(g.getdata())
    e = list(g.filter(ImageFilter.FIND_EDGES).getdata())
    return (statistics.mean(px), statistics.pstdev(px), sorted(e)[int(len(e)*0.99)])

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await ctx.new_page()
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
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce && closeAnnounce()")
        await page.evaluate("openMessagesSheet()")
        await page.wait_for_timeout(700)
        await page.click('.msg-row')
        await page.wait_for_timeout(600)
        card_top = await page.evaluate(
            "()=>document.querySelector('.msg-detail').getBoundingClientRect().top/innerHeight")
        print("card top at %.0f%% of the viewport\n" % (100*card_top))
        print("%-6s %-6s %8s %8s %8s   %s" % ("blur", "tint", "lum", "stdev", "edgeP99", "distance from his"))
        best = None
        for blur, tint in GRID:
            await page.evaluate("""([b,t])=>{
              const el=document.getElementById('msgDetailBg');
              el.style.backdropFilter='blur('+b+'px) saturate(1.15)';
              el.style.webkitBackdropFilter='blur('+b+'px) saturate(1.15)';
              el.style.background='rgba(238,112,34,'+t+')';
            }""", [blur, tint])
            await page.wait_for_timeout(180)
            p = f"{OUT}/b{blur}_t{int(tint*100)}.png"
            await page.screenshot(path=p)
            lum, std, edge = stats(p, card_top)
            # normalised distance; stdev and edges carry the "can you read it"
            d = (abs(lum-TARGET['lum'])/TARGET['lum'] + 2*abs(std-TARGET['std'])/TARGET['std']
                 + 2*abs(edge-TARGET['edge'])/TARGET['edge'])
            print("%-6s %-6.2f %8.1f %8.1f %8d   %.3f" % (blur, tint, lum, std, edge, d))
            if best is None or d < best[0]: best = (d, blur, tint, lum, std, edge)
        print("\nclosest: blur %spx tint %.2f  -> lum %.1f stdev %.1f edge %d  (his %.1f / %.1f / %d)"
              % (best[1], best[2], best[3], best[4], best[5], TARGET['lum'], TARGET['std'], TARGET['edge']))
        await b.close()

srv = serve()
asyncio.run(main())
srv.shutdown()
