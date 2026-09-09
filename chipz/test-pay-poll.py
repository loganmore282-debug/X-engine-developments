#!/usr/bin/env python3
"""The recharge poll screen: a page in the app's colours, not a dark modal.

Owner: "l nolonger need those old poll designs, l want new poll designs ie
when one taps deposit, it should open a new page for polling, so for polling
it should show the other 4 triangles rotating, just like those which we placed
on running product, so it will be enlarged and loading. l nolonger need those
dark things, use app color and theme not dark, also for success use exactly
that and failed use that, use exactly rather than guess. however still nav
icons should exist on the poll payment page."

Five things, and the ones that matter are checked from RENDERED pixels or
rendered geometry rather than from class names:

  - the page is LIGHT. Sampled off a screenshot, because "not dark" is a
    property of what reaches the screen, and a stray inherited rule could
    darken it while every declared value still looked right.
  - the NAV is visible AND hittable underneath it (elementFromPoint, not
    just "is it on screen") -- the old modal covered the whole viewport.
  - the polling mark is the orbiting chips, ENLARGED, and actually moving.
  - success and failure show the owner's own two images.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/pay-poll'
os.makedirs(OUT, exist_ok=True)
ROOT = '/home/user/X-engine-developments/chipz/user'
PORT = 8773
API = 'https://chipz-server.onrender.com'

ROUTES = {
  "/public/settings": {"status": "success", "settings": {"brandName": "Chipz", "annEnabled": False}},
  "/account": {"status": "success", "account": {"userId": "u1", "phone": "0742730382",
      "publicId": "00001", "referralCode": "TCL80", "walletBalance": 5000, "registrationDone": True}},
  "/investments": {"status": "success", "investments": []},
  "/transactions": {"status": "success", "transactions": []},
  "/messages": {"status": "success", "messages": []},
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

async def main():
    fails, errs = [], []
    def ck(ok, label):
        print(("PASS  " if ok else "FAIL  ") + label)
        if not ok: fails.append(label)
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
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce && closeAnnounce()")

        print("— polling —")
        await page.evaluate("openDepositStatusModal(20000,'0742730382','MTN Mobile Money')")
        await page.wait_for_timeout(600)
        ck(await page.evaluate("()=>document.getElementById('depStatusBg').classList.contains('show')"),
           "the poll page is open")

        # NOT dark. Read from the screenshot: the complaint is about what the
        # member sees, and a declared background can be overridden.
        await page.screenshot(path=f"{OUT}/pending.png")
        im = Image.open(f"{OUT}/pending.png").convert('RGB')
        W, H = im.size
        strip = im.crop((int(W*0.05), int(H*0.06), int(W*0.95), int(H*0.20)))
        px = list(strip.getdata())
        lum = sum(sum(p)/3 for p in px)/len(px)
        ck(lum > 200, "the page is light, not the old dark sheet (mean luminance %.0f)" % lum)

        # The nav must still be there AND be hittable -- the old modal was
        # inset:0 and swallowed it. elementFromPoint, because "on screen" is
        # not the same as "reachable".
        nav = await page.evaluate("""()=>{const n=document.querySelector('.bottom-nav');
          if(!n) return null; const b=n.getBoundingClientRect();
          const t=document.elementFromPoint(b.x+b.width/2, b.y+b.height/2);
          const bg=document.getElementById('depStatusBg').getBoundingClientRect();
          return {navTop:+b.top.toFixed(1), pageBottom:+bg.bottom.toFixed(1),
                  hit:!!(t&&t.closest('.bottom-nav')), onScreen:b.bottom<=innerHeight+1};}""")
        ck(bool(nav) and nav['hit'] and nav['onScreen'],
           "the nav icons are still there and tappable while polling (%s)" % nav)
        ck(abs(nav['pageBottom'] - nav['navTop']) <= 1.5,
           "the poll page stops at the bar rather than covering it (%.0f vs %.0f)"
           % (nav['pageBottom'], nav['navTop']))

        # The orbiting chips, enlarged, and really turning.
        spin = await page.evaluate("""()=>{const s=document.querySelector('#depStatusIcon .pspin');
          if(!s) return null; const b=s.getBoundingClientRect();
          const o=s.querySelector('.pspin-orbit');
          return {w:+b.width.toFixed(1), chips:s.querySelectorAll('.pspin-chip').length,
                  core:!!s.querySelector('.pspin-core'),
                  anim:getComputedStyle(o).animationName};}""")
        ck(bool(spin) and spin['chips'] == 3 and spin['core'],
           "the polling mark is the orbiting-chips mark from the plan rows (%s)" % spin)
        ck(bool(spin) and spin['w'] >= 120,
           "and it is enlarged, not the 32px plan-row size (%.0fpx)" % (spin or {}).get('w', 0))
        # Sampled over real frames: a keyframe name proves nothing if the
        # animation never runs.
        frames = await page.evaluate("""async ()=>{const o=document.querySelector('#depStatusIcon .pspin-orbit');
          const seen=[]; for(let i=0;i<12;i++){seen.push(getComputedStyle(o).transform);
            await new Promise(r=>setTimeout(r,60));} return seen;}""")
        ck(len(set(frames)) > 3,
           "and it is actually rotating (%d distinct transforms over 12 samples)" % len(set(frames)))

        print("\n— resolved —")
        await page.evaluate("setDepositStatusSuccess()")
        await page.wait_for_timeout(400)
        got = await page.evaluate("()=>document.getElementById('depStatusIcon').innerHTML")
        ck('/pay-success.png' in got, "success shows the owner's green tick (%r)" % got[:60])
        ok = await page.evaluate("""()=>{const i=document.querySelector('#depStatusIcon img');
          return i && i.complete && i.naturalWidth>0;}""")
        ck(ok, "and that image really loads (not a broken src)")

        await page.evaluate("setDepositStatusFailed('Missing or invalid API credentials.')")
        await page.wait_for_timeout(400)
        got = await page.evaluate("()=>document.getElementById('depStatusIcon').innerHTML")
        ck('/pay-failed.png' in got, "failure shows the owner's red cross (%r)" % got[:60])
        ok = await page.evaluate("""()=>{const i=document.querySelector('#depStatusIcon img');
          return i && i.complete && i.naturalWidth>0;}""")
        ck(ok, "and that image really loads too")
        await page.screenshot(path=f"{OUT}/failed.png")

        # The Close button only appears once the poll has settled -- unchanged
        # behaviour, checked because the restyle rewrote this markup.
        ck(await page.evaluate("()=>getComputedStyle(document.getElementById('depStatusCloseBtn')).display") != 'none',
           "Close is offered on a settled state")
        await page.evaluate("setDepositStatusPending(20000,'0742730382','MTN Mobile Money')")
        await page.wait_for_timeout(300)
        ck(await page.evaluate("()=>getComputedStyle(document.getElementById('depStatusCloseBtn')).display") == 'none',
           "and hidden again while a payment is genuinely in flight")

        ck(not errs, "no page errors: %s" % errs)
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\npay poll: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
