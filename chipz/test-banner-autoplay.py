#!/usr/bin/env python3
"""The Home banner video must run on its own, with nothing to tap.

Owner: "l dont want it to be tappable or pause or play, l want it to go or
run on its own."

Before this, the banner carried the mockup's play ring: a full-size button
laid over the video that toggled play/pause on tap. This drives the BUILT app
against a real, playable video and proves the banner now:

  - starts by itself, with no interaction at all (currentTime advances)
  - has no play button, and no native controls
  - cannot be paused, tapped, or long-pressed -- a tap at the middle of the
    banner does not land on the video and does not stop it
  - still falls back to the striped hero if the video will not load
  - and prefers an uploaded video (served from /public/banner-video) over a
    typed link, building the versioned URL the server expects

The video is generated in-browser with MediaRecorder, so it is a genuinely
decodable file rather than a stub that would make the checks vacuous.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/banner-autoplay'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8847
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

# A real webm, recorded from a canvas. Nothing here is stubbed: the browser
# encodes it and the same browser decodes it back in the banner.
MAKE_VIDEO = """async () => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const g = c.getContext('2d');
  let i = 0;
  const draw = () => { g.fillStyle = ['#e21b2a','#ff8a1f','#111'][i++ % 3];
                       g.fillRect(0,0,320,180); };
  draw();
  const stream = c.captureStream(25);
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  const t = setInterval(draw, 40);
  await new Promise(r => setTimeout(r, 1500));
  clearInterval(t);
  await new Promise(r => { rec.onstop = r; rec.stop(); });
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}"""

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

async def open_app(ctx, banner, video_b64=None):
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    R = routes(banner)
    async def api(r):
        path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        body = next((v for k, v in R.items() if path.endswith(k)), {"status": "success"})
        await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    await page.route(f"{API}/**", api)
    if video_b64 is not None:
        import base64
        raw = base64.b64decode(video_b64)
        async def vid(r):
            await r.fulfill(status=200, content_type="video/webm", body=raw,
                            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable"})
        await page.route("**/banner-video*", vid)
        await page.route("**/clip.webm", vid)
    await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/css", body="")))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.wait_for_timeout(2600)
    await page.evaluate("localStorage.clear()")
    return page

async def main():
    async with async_playwright() as pw:
        # Deliberately NOT launched with --autoplay-policy=no-user-gesture-
        # required: that flag would make autoplay succeed no matter what the
        # markup said, and prove nothing. Under the default policy a MUTED
        # video is the one thing allowed to start without a gesture -- which
        # is exactly the property the banner depends on, on real phones too.
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")

        maker = await ctx.new_page()
        await maker.goto("about:blank")
        video_b64 = await maker.evaluate(MAKE_VIDEO)
        await maker.close()
        ck(len(video_b64) > 2000, "recorded a real webm to play (%d base64 chars)" % len(video_b64))

        # --- 1. an UPLOADED video (the database path) ---
        page = await open_app(ctx, {"image": None, "video": None, "videoVersion": "abc123def456"}, video_b64)
        url = await page.evaluate("() => STATE.homeBannerVideo")
        print("  banner src:", url)
        ck(url and "/public/banner-video" in url, "an uploaded video is played from /public/banner-video")
        ck(url and "v=abc123def456" in url, "and its URL carries the version, so the year-long cache can never go stale")

        await page.wait_for_timeout(1400)
        st = await page.evaluate("""() => {
            const v = document.getElementById('homeBannerVideo');
            if (!v) return null;
            const cs = getComputedStyle(v);
            return { t0: v.currentTime, paused: v.paused, muted: v.muted, loop: v.loop,
                     autoplay: v.autoplay, controls: v.controls, readyState: v.readyState,
                     pointerEvents: cs.pointerEvents,
                     playBtns: document.querySelectorAll('.hb-play').length,
                     btnsInBanner: document.querySelectorAll('.home-banner button').length };
        }""")
        print("  video state:", st)
        ck(bool(st), "the banner rendered a <video>")
        ck(st and st["readyState"] >= 2, "the video actually decoded (readyState %s)" % (st or {}).get("readyState"))
        ck(st and not st["paused"], "it is playing, with no interaction at all")
        ck(st and st["autoplay"] and st["muted"] and st["loop"], "autoplay + muted + loop are all set")
        ck(st and not st["controls"], "no native controls")
        ck(st and st["playBtns"] == 0, "the play ring is gone")
        ck(st and st["btnsInBanner"] == 0, "there is no button in the banner at all")
        ck(st and st["pointerEvents"] == "none", "the video takes no pointer events, so it cannot be tapped")

        # It has to keep running on its own. Sampled rather than compared as a
        # single before/after pair: the clip is short and loop is on, so
        # currentTime legitimately wraps back towards zero mid-check. What
        # matters is that it keeps MOVING and never pauses itself.
        SAMPLE = "() => { const v = document.getElementById('homeBannerVideo'); return [v.currentTime, v.paused]; }"
        samples = []
        for _ in range(5):
            await page.wait_for_timeout(250)
            samples.append(await page.evaluate(SAMPLE))
        times = [round(t, 3) for t, _ in samples]
        print("  currentTime samples:", times)
        ck(len(set(times)) >= 4, "time keeps moving on its own: %s" % times)
        ck(not any(paused for _, paused in samples), "and it never paused itself")
        t1 = samples[-1][0]

        # Tapping the banner must not reach the video or stop it.
        box = await page.evaluate("""() => {
            const b = document.querySelector('.home-banner'); const r = b.getBoundingClientRect();
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }""")
        hit = await page.evaluate("""([x,y]) => {
            const el = document.elementFromPoint(x, y);
            return el ? el.tagName + '.' + (el.className || '') : null;
        }""", [box["x"], box["y"]])
        print("  element at banner centre:", hit)
        ck(hit is not None and "VIDEO" not in hit, "a tap at the banner centre does not land on the video")
        await page.mouse.click(box["x"], box["y"])
        await page.mouse.click(box["x"], box["y"])
        await page.wait_for_timeout(400)
        after = await page.evaluate("""() => { const v = document.getElementById('homeBannerVideo');
            return { paused: v.paused, t: v.currentTime }; }""")
        ck(not after["paused"], "two taps on the banner did not pause it")
        ck(after["t"] > t1, "and it kept running through them (%.2fs -> %.2fs)" % (t1, after["t"]))
        await page.screenshot(path=f"{OUT}/banner-playing.png")
        await page.close()

        # --- 2. a typed LINK still works, and an upload outranks it ---
        page = await open_app(ctx, {"image": None, "video": "clip.webm", "videoVersion": None}, video_b64)
        url = await page.evaluate("() => STATE.homeBannerVideo")
        ck(url == "clip.webm", "a typed link is used as-is when nothing is uploaded (%s)" % url)
        await page.close()

        page = await open_app(ctx, {"image": None, "video": "clip.webm", "videoVersion": "zz99"}, video_b64)
        url = await page.evaluate("() => STATE.homeBannerVideo")
        ck(url and "banner-video" in url, "an uploaded video wins over a leftover link (%s)" % url)
        await page.close()

        # --- 3. a video that will not load falls back, not to a blank block ---
        page = await open_app(ctx, {"image": None, "video": "missing.mp4", "videoVersion": None}, None)
        await page.wait_for_timeout(1200)
        fb = await page.evaluate("""() => {
            const b = document.querySelector('.home-banner');
            return { failed: b.classList.contains('hb-video-failed'),
                     videoShown: getComputedStyle(document.getElementById('homeBannerVideo')).display };
        }""")
        print("  fallback:", fb)
        ck(fb["failed"] and fb["videoShown"] == "none", "an unplayable video falls back to the striped hero")
        await page.close()

        ck(not errs, "no page errors: " + str(errs[:3]))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nbanner autoplay: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
