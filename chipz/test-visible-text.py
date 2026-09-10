"""
No screen may render text that is present in the DOM but invisible.

This exists because of a real, live bug: the About page was completely blank
for members. Not empty -- every word was there, wrapped in <span
class="reveal-word">, and every one of them computed to `opacity: 0`.

The cause is worth writing down, because it is a whole class of bug rather
than a one-off. The word-by-word reveal animation was removed on request
("remove live appearing animation everywhere"). The removal added
`.reveal-word{opacity:1}` -- but left the animation's old starting frame,
`.reveal-word{opacity:0;transform:translateY(10px)}`, further down the file.
Same selector, same specificity, later in the source: the stale rule won.
The comment two rules above it even warned about exactly this ("leaving that
behind while removing the transition would hide the About page outright").

Nothing caught it. Every test asserted on textContent, which was correct;
what was wrong was whether any of it reached a pixel. So this file checks
the one thing textContent cannot: that text-bearing elements are actually
painted, on every main screen, and that the About page in particular has ink
on it.
"""
import asyncio, io, json, os, re, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/visible-text'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8867
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone": "0742730382", "walletBalance": 5207.82, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 0, "totalInvested": 28000,
           "checkinStreak": 2, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 3, "l2": 1, "l3": 0, "commission": 7840}}
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 150,
             "expectedReturn": p * 3, "image": "", "spinCount": 0, "spinMin": 200, "spinMax": 1000}
            for i, p in enumerate([30000, 90000, 180000], start=1)]
ABOUT_TEXT = ("Chipz lets you invest in a range of products with daily income, "
              "and earn from a three-level referral programme.")
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 20000, "withdrawFeePct": 15,
        "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": False,
        "depositPayAEnabled": True, "depositPayBEnabled": False,
        "openingCountdownEnabled": False, "maintenanceMode": False,
        "dailyCheckin": 500, "turntableEnabled": True}},
    "/public/products": {"status": "success", "products": PRODUCTS},
    "/public/activity-feed": {"status": "success", "feed": [
        {"kind": "deposit", "phone": "077****123", "amount": 58000}]},
    "/public/banner": {"status": "success", "image": None},
    "/public/announcement-image": {"status": "success", "image": None},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                             "profilegif": None, "downloadbg": None, "authhero": None,
                             "authcard": None},
    # The blocks the About page is built from. Without these the screen is
    # legitimately empty and this whole file would pass against nothing.
    "/public/about-content": {"status": "success", "blocks": [{"type": "text", "text": ABOUT_TEXT}]},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": [
        {"id": "1", "type": "deposit", "amount": 30000, "displayAmount": 30000,
         "description": "Deposit: Paid (UGX 30,000)", "status": "paid",
         "date": "09/08/2026", "time": "11:25"}], "truncated": False},
    "/messages": {"status": "success", "messages": []},
    "/bank/list": {"status": "success", "accounts": []},
    "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 2, "l2": 0, "l3": 0}, "totalTeam": 2,
                    "teamCommission": 7840, "teamDeposits": 28000, "milestones": []},
    "/team/members": {"status": "success", "level": 1, "members": [
        {"id": "m1", "phone": "0708001234", "createdAt": None, "invested": 0}]},
    "/turntable/status": {"status": "success", "enabled": True, "dailyAvailable": True,
                          "earnedSpins": 0, "totalSpins": 1, "nextDailyAt": 0,
                          "dailyMin": 200, "dailyMax": 1000},
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


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def ink_fraction(png_bytes, bg_tolerance=18):
    """How much of this region is NOT the background colour.

    The background is taken as the most common pixel, which on any Chipz
    screen is the canvas. Text is a small minority of a screenshot's pixels,
    so this stays low even on a busy screen -- what matters is that it is not
    ~zero, which is what a page of invisible text looks like."""
    im = Image.open(io.BytesIO(png_bytes)).convert('RGB')
    px = list(im.getdata())
    if not px:
        return 0.0
    bg = max(set(px), key=px.count)
    off = sum(1 for p in px
              if abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > bg_tolerance)
    return off / len(px)


# Elements whose text is legitimately not painted: the ones the app hides on
# purpose. Everything else with words in it must reach a pixel.
INVISIBLE_SWEEP = """() => {
  const bad = [];
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    // Only leaf-ish nodes with their own text, so a transparent WRAPPER is
    // reported once at the element that actually holds the words rather than
    // at every ancestor.
    const own = [...el.childNodes]
      .filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;        // not laid out at all
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // An ancestor may be the thing that is hidden; walk up and skip those,
    // since a hidden PANEL is a design decision, not invisible text.
    let hiddenAncestor = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === 'none' || ps.visibility === 'hidden' || +ps.opacity === 0) {
        hiddenAncestor = true; break;
      }
    }
    if (hiddenAncestor) continue;
    if (+cs.opacity < 0.1) {
      bad.push({ text: own.slice(0, 40), cls: el.className.toString().slice(0, 60),
                 tag: el.tagName, opacity: cs.opacity });
    }
  }
  return bad;
}"""


async def main():
    errs, fails = [], []

    def ck(ok, label):
        print(("PASS  " if ok else "FAIL  ") + label)
        if not ok:
            fails.append(label)

    # ── The structural half: one rule, not two ──
    print("— the cascade trap itself —")
    css = open(os.path.join(HERE, 'user-src', 'index.html'), encoding='utf-8').read()
    css_only = re.sub(r'/\*[\s\S]*?\*/', ' ', css)
    rules = re.findall(r'(?m)^\s*\.reveal-word\s*\{([^{}]*)\}', css_only)
    print("   .reveal-word declarations:", rules)
    ck(len(rules) == 1,
       "there is exactly ONE .reveal-word rule (%d found) -- two of them at the "
       "same specificity is what blanked the About page" % len(rules))
    ck(all('opacity:0' not in r.replace(' ', '') for r in rules),
       "and it does not set opacity:0")

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
        await page.wait_for_timeout(2800)
        try:
            await page.evaluate("closeAnnounce()")
        except Exception:
            pass

        # ── About: the screen that was blank ──
        print("\n— the About page has ink on it —")
        await page.evaluate("openAboutSheet()")
        await page.wait_for_timeout(2000)
        about = await page.evaluate("""()=>{
          const w = [...document.querySelectorAll('.reveal-word')];
          const art = document.getElementById('aboutArticle');
          const r = art ? art.getBoundingClientRect() : null;
          return {words: w.length,
                  opacities: [...new Set(w.map(e=>getComputedStyle(e).opacity))],
                  transforms: [...new Set(w.map(e=>getComputedStyle(e).transform))],
                  text: art ? art.textContent.trim().slice(0, 50) : null,
                  box: r ? {x:r.x, y:r.y, w:r.width, h:r.height} : null};}""")
        print("  ", {k: v for k, v in about.items() if k != 'box'})
        ck(about["words"] > 5, "the article rendered words at all (%d)" % about["words"])
        ck(about["opacities"] == ["1"],
           "every word is fully opaque (%s)" % about["opacities"])
        ck(about["transforms"] == ["none"],
           "and none is translated off its line (%s)" % about["transforms"])
        # textContent was ALWAYS right here -- that is why nothing caught it.
        # The check that matters is whether any of it reaches a pixel.
        if about["box"] and about["box"]["h"] > 20:
            shot = await page.screenshot(clip={
                "x": about["box"]["x"], "y": about["box"]["y"],
                "width": about["box"]["w"], "height": min(about["box"]["h"], 200)})
            frac = ink_fraction(shot)
            print("   ink fraction: %.4f" % frac)
            ck(frac > 0.01,
               "and the rendered region is not blank -- %.2f%% of it is ink, not canvas"
               % (frac * 100))
        await page.screenshot(path=f"{OUT}/about.png")
        # closeSheet, not a page change: the sheet is what is open.
        await page.evaluate("closeSheet()")
        await page.wait_for_timeout(600)

        # ── The same class of bug, anywhere else ──
        print("\n— no invisible text on any main screen —")
        for tab in ['home', 'catalog', 'products', 'referral', 'team', 'account']:
            await page.evaluate(f"showPage('{tab}')")
            await page.wait_for_timeout(1100)
            bad = await page.evaluate(INVISIBLE_SWEEP)
            if bad:
                for x in bad[:6]:
                    print("      %s.%s opacity=%s  %r" % (x["tag"], x["cls"], x["opacity"], x["text"]))
            ck(not bad, "%s renders no text at opacity 0 (%d offender%s)"
               % (tab, len(bad), '' if len(bad) == 1 else 's'))

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nvisible text: all cases pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
