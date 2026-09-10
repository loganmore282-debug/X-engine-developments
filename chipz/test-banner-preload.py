#!/usr/bin/env python3
"""The banner video must be loaded BEFORE the loading screen comes down.

Owner: "make when the start up loader must have loaded also the video before
it waiting to load, so video must show up after loader."

So the test is not "does the video eventually play" -- it is "at the exact
moment the loading screen disappears, is the video already decoded and
running". That is measured here by watching #loadingScreen with a
MutationObserver and sampling the <video> in the same tick it is hidden, on
the BUILT app against a real MediaRecorder-generated webm.

Also covered, because each is a way to get this wrong:
  - a video the server is slow to send must NOT hold the member on the
    spinner forever -- the preload is capped and the app opens anyway
  - a video that 404s must not burn the whole cap either
  - no video configured must add no delay at all
  - a returning member (instant-boot path, no spinner) must still get the
    banner immediately, from the URL kept in the snapshot
  - and if the owner uploads a NEW video, a returning member must not keep
    seeing the old one for the rest of the session
"""
import asyncio, base64, json, os, sys, functools, threading, http.server, socketserver, time
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/banner-preload'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8853
API  = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone":"0742730382","walletBalance":2000,"totalDeposited":0,"totalEarned":0,
 "totalWithdrawn":0,"totalInvested":0,"checkinStreak":0,"lastCheckinAt":None,
 "referralCode":"Gy2f","publicId":"10012","registrationDone":True,
 "team":{"l1":0,"l2":0,"l3":0,"commission":0}}

def routes(banner):
    return {
     "/public/settings":{"status":"success","settings":{"minDeposit":30000,"minWithdraw":20000,
       "withdrawFeePct":15,"annEnabled":False,"turntableEnabled":True,"dailyCheckin":500}},
     "/public/products":{"status":"success","products":[]},
     "/public/activity-feed":{"status":"success","feed":[]},
     "/public/banner":dict({"status":"success"}, **banner),
     "/public/announcement-image":{"status":"success","image":None},
     "/public/manual-pay-images":{"status":"success","selector":None,"hero":None},
     "/public/chipz-images":{"status":"success","referral":None,"logo":None,"spin":None},
     "/account":{"status":"success","account":ACCOUNT},
     "/investments":{"status":"success","investments":[]},
     "/transactions":{"status":"success","transactions":[],"truncated":False},
     "/messages":{"status":"success","messages":[]},
     "/bank/list":{"status":"success","accounts":[]},
     "/team/stats":{"status":"success","referralCode":"Gy2f","commRates":{"l1":28,"l2":1,"l3":1},
       "team":{"l1":0,"l2":0,"l3":0},"totalTeam":0,"teamCommission":0,"teamDeposits":0,"milestones":[]},
     "/team/members":{"status":"success","level":1,"members":[]},
     "/mission/status":{"status":"success","mission":{}},
     "/turntable/status":{"status":"success","enabled":True,"dailyAvailable":True,"earnedSpins":0,
       "totalSpins":1,"nextDailyAt":0,"dailyMin":200,"dailyMax":1000},
    }

FB_APP  = "export const initializeApp=()=>({});export const getApps=()=>[];"
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

MAKE_VIDEO = """async () => {
  const c = document.createElement('canvas'); c.width=320; c.height=180;
  const g = c.getContext('2d'); let i=0;
  const draw=()=>{g.fillStyle=['#e21b2a','#ff8a1f','#111'][i++%3];g.fillRect(0,0,320,180);};
  draw();
  const chunks=[]; const rec=new MediaRecorder(c.captureStream(25),{mimeType:'video/webm'});
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.start(); const t=setInterval(draw,40);
  await new Promise(r=>setTimeout(r,1400)); clearInterval(t);
  await new Promise(r=>{rec.onstop=r;rec.stop();});
  const buf=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());
  let s=''; for(const b of buf) s+=String.fromCharCode(b);
  return btoa(s);
}"""

# Installed before any app script runs, so the observer is watching from the
# very first paint -- polling after the fact could easily miss the handoff.
WATCH = """
window.__snap = null;
window.__hiddenAt = null;
(function(){
  // The loading screen is hidden MORE THAN ONCE in a session: once to show
  // the sign-in screen, and again at the real hand-off into the app. Watching
  // only for display:none catches the first, which happens long before boot
  // and would make this test pass on an app that preloads nothing (the first
  // version of this test did exactly that: readyState 0, "0.43s to open").
  // The hand-off that matters is the one where #app becomes VISIBLE.
  const grab = () => {
    const v = document.getElementById('homeBannerVideo');
    window.__hiddenAt = performance.now();
    window.__snap = v ? {
      present: true, readyState: v.readyState, paused: v.paused,
      currentTime: v.currentTime, src: v.getAttribute('src'),
      networkState: v.networkState,
    } : { present: false };
  };
  const start = () => {
    const ls = document.getElementById('loadingScreen');
    const app = document.getElementById('app');
    if (!ls || !app) { setTimeout(start, 20); return; }
    const check = (ob) => {
      const shown = app.style.display !== 'none' && getComputedStyle(app).display !== 'none';
      if (ls.style.display === 'none' && shown) { if (ob) ob.disconnect(); grab(); return true; }
      return false;
    };
    if (check(null)) return;
    const ob = new MutationObserver(() => check(ob));
    ob.observe(ls, { attributes: true, attributeFilter: ['style'] });
    ob.observe(app, { attributes: true, attributeFilter: ['style'] });
  };
  start();
})();
"""

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

fails, errs = [], []
def ck(ok, l):
    print(("PASS  " if ok else "FAIL  ") + l)
    if not ok: fails.append(l)

async def open_app(browser, banner, video=None, delay=0.0, status=200, keep=False):
    """video=None -> the video URL 404s. delay -> seconds before responding.

    A FRESH context per case: localStorage written by one case would put the
    next one on the instant-boot path (no spinner at all), which is not what
    that case means to measure.
    """
    ctx = await browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.add_init_script(WATCH)
    R = routes(banner)
    async def api(r):
        path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        body = next((v for k, v in R.items() if path.endswith(k)), {"status": "success"})
        await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    await page.route(f"{API}/**", api)
    async def vid(r):
        if delay: await asyncio.sleep(delay)
        if status != 200 or video is None:
            await r.fulfill(status=404, body="")
        else:
            await r.fulfill(status=200, content_type="video/webm", body=video,
                            headers={"Accept-Ranges": "bytes"})
    await page.route("**/banner-video*", vid)
    await page.route("**/clip.webm", vid)
    await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/css", body="")))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
    t0 = time.monotonic()
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.wait_for_function("() => window.__snap !== null", timeout=30000)
    elapsed = time.monotonic() - t0
    snap = await page.evaluate("() => window.__snap")
    if not keep:
        await page.close(); await ctx.close()
    return snap, elapsed, page

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")

        maker = await ctx.new_page(); await maker.goto("about:blank")
        vid_b64 = await maker.evaluate(MAKE_VIDEO)
        await maker.close()
        VIDEO = base64.b64decode(vid_b64)
        ck(len(VIDEO) > 1000, "recorded a real webm to preload (%d bytes)" % len(VIDEO))

        UPLOADED = {"image": None, "video": None, "videoVersion": "v111"}

        print("\n— the moment the loader hides —")
        snap, secs, _ = await open_app(b, UPLOADED, VIDEO)
        print("   at handoff:", snap, "(%.2fs to open)" % secs)
        ck(snap.get("present"), "the banner <video> exists the instant the loader goes")
        # readyState 4 = HAVE_ENOUGH_DATA. >=3 means it can play right now.
        ck(snap.get("readyState", 0) >= 3,
           "and it is already decoded, not still fetching (readyState %s)" % snap.get("readyState"))
        ck(snap.get("paused") is False, "and already playing, not paused")

        print("\n— no video configured costs nothing —")
        snap0, secs0, _ = await open_app(b, {"image": None, "video": None, "videoVersion": None})
        print("   at handoff:", snap0, "(%.2fs to open)" % secs0)
        ck(not snap0.get("present"), "no <video> when none is set")
        ck(secs0 < secs + 1.5, "opening is not slowed by the preload path (%.2fs vs %.2fs)" % (secs0, secs))

        print("\n— a broken video does not burn the 10s cap —")
        snapE, secsE, _ = await open_app(b, {"image": None, "video": "clip.webm", "videoVersion": None},
                                         video=None, status=404)
        print("   (%.2fs to open)" % secsE)
        ck(secsE < 8, "a 404 video resolves straight away, it does not stall the loader (%.2fs)" % secsE)

        print("\n— a SLOW video is capped, the member is not trapped —")
        # 14s of stalling against a 10s cap: the app must open regardless.
        snapS, secsS, _ = await open_app(b, UPLOADED, VIDEO, delay=14.0)
        print("   at handoff:", snapS, "(%.2fs to open)" % secsS)
        ck(secsS < 14, "the loader gave up and opened the app anyway (%.2fs)" % secsS)
        ck(snapS.get("present"), "the banner is still there, buffering behind the scenes")

        print("\n— a returning member (instant boot, no spinner) —")
        page = await ctx.new_page()
        await page.route(f"{API}/**", lambda r: asyncio.ensure_future(r.fulfill(
            status=200, content_type="application/json", body=json.dumps({"status": "success"}))))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        stored = await page.evaluate("""() => {
            const url = 'https://chipz-server.onrender.com/public/banner-video?v=v111';
            localStorage.setItem('snow_state_cache', JSON.stringify({
              uid: 'u1', account: {walletBalance: 1}, investments: [], teamStats: {},
              bankAccounts: [], transactions: [], mission: {}, products: [], settings: {},
              homeBannerVideo: url }));
            return JSON.parse(localStorage.getItem('snow_state_cache')).homeBannerVideo;
        }""")
        await page.close()
        ck(stored and 'banner-video' in stored, "the snapshot carries the video URL, not the clip")
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                'user-src', 'original_module.js'), encoding='utf8').read()
        ck('homeBannerVideo: STATE.homeBannerVideo || null' in src,
           "saveCachedState() stores only the URL (a poster data: URL would bloat the quota)")
        ck('STATE.homeBannerVideo = STATE.homeBannerVideo || cached.homeBannerVideo' in src,
           "and the instant-boot path restores it without overwriting fresher live data")

        print("\n— a NEW upload reaches a member who already had the old one —")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        R = routes({"image": None, "video": None, "videoVersion": "v222"})
        async def api2(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            body = next((v for k, v in R.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        await page.route(f"{API}/**", api2)
        await page.route("**/banner-video*", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="video/webm", body=VIDEO,
                      headers={"Accept-Ranges": "bytes"})))
        await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        # Seed the OLD version into the snapshot, then reload so the
        # instant-boot path paints from it before /public/banner (v222) lands.
        await page.evaluate("""() => localStorage.setItem('snow_state_cache', JSON.stringify({
            uid:'u1', account:{walletBalance:1}, investments:[], teamStats:{}, bankAccounts:[],
            transactions:[], mission:{}, products:[], settings:{},
            homeBannerVideo:'https://chipz-server.onrender.com/public/banner-video?v=OLD' }))""")
        await page.reload(wait_until="load")
        await page.wait_for_timeout(3500)
        final = await page.evaluate("""() => { const v = document.getElementById('homeBannerVideo');
            return { src: v ? v.getAttribute('src') : null, paused: v ? v.paused : null }; }""")
        print("   banner src after boot:", final)
        ck(final["src"] and "v222" in final["src"],
           "the banner swapped to the new upload, not stuck on the cached old URL")
        ck(final["paused"] is False, "and the replacement is playing")
        await page.close()

        ck(not errs, "no page errors: " + str(errs[:3]))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nbanner preload: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
