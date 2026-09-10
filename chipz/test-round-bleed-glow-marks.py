#!/usr/bin/env python3
"""The banner bleed, the Team glow, the admin marks, PAY-A and network match.

Owner: "on login and register pages there should be like whites or color
bleeding into the image of banner uploaded from admin panel ... also on team
there are some green behind the number, see our mockup on percentage and number
of team, some green is there behind numbers, see clearly rather than guess ...
also in admin panel still has old svgs and icons ie that slanting 8 and that
ladder svg on the home, please let it be chipz logo ... also l want when l put
pay b let it return to A in userpanel not just to b, so when l put a single 1,
it should be A ... also make sure that manual payments are matching very well
on orders generated ie mtn to mtn, airtel to airtel."

Everything is read off the REAL built app. Two cases needed care:

  * The banner fade is asserted by SAMPLING the rendered hero, not by reading
    the CSS back -- a gradient declared on an element that is transparent, or
    painted under the photo, reads as present and shows as nothing.

  * The network sent for a manual order is read off the intercepted REQUEST
    BODY, not off anything the screen says. The screen would happily agree
    with itself either way; the order is what the admin has to match.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/bleed-glow'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
ADMIN_ROOT = os.path.join(HERE, 'admin')
PORT = 8804
ADMIN_PORT = 8805
API = 'https://chipz-server.onrender.com'

# A 2x2 deep-blue PNG standing in for the uploaded banner: strongly coloured
# and nothing like the page, so anything left of it after the fade shows up.
BANNER = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF'
          'ElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC')

ACCOUNT = {"userId": "u1", "phone": "0742730382", "publicId": "00001",
           "referralCode": "TCL80", "walletBalance": 5000, "registrationDone": True}
INIT_OK = {"status": "success", "depositId": "dep-1", "amount": 27000,
           "assignedNumber": "0791399585", "holderName": "Kyarimpa Madrine",
           "expiresAt": 9999999999999}

FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"


def fb_auth(signed_in):
    user = ("{uid:'u1',email:'742730382@chipz-platform.com',"
            "getIdToken:async()=>'tok'}")
    cb = "cb(user)" if signed_in else "cb(null)"
    return f"""
 const user={user};
 export const getAuth=()=>({{currentUser:{'user' if signed_in else 'null'}}});
 export const createUserWithEmailAndPassword=async()=>({{user}});
 export const signInWithEmailAndPassword=async()=>({{user}});
 export const signOut=async()=>{{}};export const updatePassword=async()=>{{}};
 export const reauthenticateWithCredential=async()=>{{}};
 export const EmailAuthProvider={{credential:()=>({{}})}};
 export const onAuthStateChanged=(a,cb)=>{{setTimeout(()=>{cb},0);}};
"""


failed = []


def ck(ok, label):
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        failed.append(label)


def serve(root, port):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", port), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def routes(pay_a, pay_b, hero=None):
    return {
        "/public/settings": {"status": "success", "settings": {
            "brandName": "Chipz", "annEnabled": False, "minDeposit": 3000,
            "depositPayAEnabled": pay_a, "depositPayBEnabled": pay_b,
            "commL1": 28, "commL2": 1, "commL3": 1}},
        "/account": {"status": "success", "account": ACCOUNT},
        "/investments": {"status": "success", "investments": []},
        "/transactions": {"status": "success", "transactions": []},
        "/messages": {"status": "success", "messages": []},
        "/public/products": {"status": "success", "products": [
            {"key": "p1", "name": "Product-1", "price": 30000, "cycle": 150,
             "expectedReturn": 90000}]},
        "/public/banner": {"status": "success", "image": None, "video": None},
        "/public/chipz-images": {"status": "success", "referral": None, "logo": None,
                                 "spin": None, "profilegif": None, "authhero": hero,
                                 "authcard": None},
        "/bank/list": {"status": "success", "accounts": []},
        "/team/stats": {"status": "success", "referralCode": "TCL80",
                        "commRates": {"l1": 28, "l2": 1, "l3": 1},
                        "team": {"l1": 3, "l2": 0, "l3": 0}, "totalTeam": 45,
                        "teamCommission": 12000, "teamDeposits": 28000,
                        "milestones": []},
    }


async def boot(ctx, table, signed_in=True, sent=None):
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    async def api(r):
        path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        if path.endswith("/deposit/manual/init"):
            if sent is not None:
                try:
                    sent.append(json.loads(r.request.post_data or "{}"))
                except Exception:
                    sent.append({})
            await r.fulfill(status=200, content_type="application/json",
                            body=json.dumps(INIT_OK))
            return
        body = next((v for k, v in table.items() if path.endswith(k)), {"status": "success"})
        await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    await page.route(f"{API}/**", api)
    await page.route("https://fonts.googleapis.com/**",
                     lambda r: asyncio.ensure_future(
                         r.fulfill(status=200, content_type="text/css", body="")))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                     lambda r: asyncio.ensure_future(
                         r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                     lambda r: asyncio.ensure_future(
                         r.fulfill(status=200, content_type="text/javascript",
                                   body=fb_auth(signed_in))))
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.wait_for_timeout(2400)
    await page.evaluate("window.closeAnnounce && closeAnnounce()")
    return page, errs


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  service_workers="block")

        # ── 1. The banner bleeds into the card ─────────────────────────────
        print("— the login banner bleeds into the card —")
        page, errs = await boot(ctx, routes(True, False, hero=BANNER), signed_in=False)
        await page.wait_for_timeout(700)
        shown = await page.evaluate(
            "getComputedStyle(document.getElementById('authScreen')).display !== 'none'")
        ck(shown, "the login screen is up")
        ck(await page.evaluate(
            "document.getElementById('authHero').classList.contains('has-bg')"),
           "the hero knows it has a banner")

        # Sampled off the real pixels: down the middle of the hero, clear of
        # the wordmark, the banner's blue must give way to the card's white.
        await page.screenshot(path=os.path.join(OUT, "auth-hero.png"))
        box = await page.evaluate("""() => {
            const r = document.getElementById('authHero').getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height }; }""")
        strip = await page.screenshot(clip={"x": box["x"] + 8, "y": box["y"],
                                            "width": 6, "height": box["h"]})
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(strip)).convert("RGB")
        col = [im.getpixel((3, y)) for y in range(im.size[1])]
        top = col[int(len(col) * 0.10)]
        bot = col[-2]
        ck(top[2] > top[0] + 25, f"the banner still reads as itself up top {top}")
        ck(min(bot) > 233 and max(bot) - min(bot) < 12,
           f"and has become the card's own white at the bottom {bot}")
        # Continuous, not a step: no two neighbouring rows jump hard.
        jumps = [abs(col[i][2] - col[i + 1][2]) for i in range(int(len(col) * .3), len(col) - 2)]
        ck(max(jumps) < 26, f"a smooth ramp, no hard banner edge (biggest step {max(jumps)})")
        ck(not errs, f"no page errors on the login screen ({errs[:1]})")
        await page.close()

        # With no banner uploaded the hero is the approved plain gradient.
        page, _ = await boot(ctx, routes(True, False, hero=None), signed_in=False)
        ck(not await page.evaluate(
            "document.getElementById('authHero').classList.contains('has-bg')"),
           "with nothing uploaded the plain gradient hero is left alone")
        await page.close()

        # ── 2. The Team numbers carry a green glow ─────────────────────────
        print("\n— green behind the Team numbers —")
        page, errs = await boot(ctx, routes(True, False))
        await page.evaluate("showPage('team')")
        await page.wait_for_timeout(1200)
        glow = await page.evaluate("""() => {
            const read = id => {
                const el = document.getElementById(id);
                if (!el) return null;
                const sh = getComputedStyle(el).textShadow;
                const m = sh.match(/rgba?\\(([^)]+)\\)/);
                if (!m) return { sh: sh };
                const p = m[1].split(',').map(s => parseFloat(s));
                return { sh: sh, r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] };
            };
            return { num: read('teamTotalCount'), pct: read('teamCommPct') }; }""")
        for key, what in (("num", "Total Team number"), ("pct", "commission percentage")):
            v = glow[key]
            ok = v and v.get("g") is not None and v["g"] > v["r"] + 40 and v["g"] > v["b"] + 40
            ck(ok, f"the {what} glows green (rgb {v and (v.get('r'), v.get('g'), v.get('b'))})")
            ck(bool(v) and (v.get("a") or 0) > 0.15,
               f"and strongly enough to see ({v and v.get('a')})")
        ck(glow["num"]["sh"] == glow["pct"]["sh"],
           "both numbers use the one shared glow, so they cannot drift apart")
        ck(not errs, f"no page errors on Team ({errs[:1]})")
        await page.close()

        # ── 3. A single live method presents as PAY-A ──────────────────────
        print("\n— the only live method is called PAY-A —")
        for pay_a, pay_b, want, note in [
                (False, True, ["PAY-A"], "manual alone"),
                (True, False, ["PAY-A"], "the gateway alone"),
                (True, True, ["PAY-A", "PAY B"], "both")]:
            page, errs = await boot(ctx, routes(pay_a, pay_b))
            await page.evaluate("openDepositSheet()")
            await page.wait_for_timeout(600)
            labels = await page.evaluate(
                "[...document.querySelectorAll('.pay-row span:first-child')].map(e=>e.textContent.trim())")
            ck(labels == want, f"{note} -> {labels}")
            if (pay_a, pay_b) == (False, True):
                # The LABEL moved; the identity behind it must not have.
                ck(await page.evaluate("!!document.getElementById('depPayRowB')"),
                   "and it is still the manual path underneath, not renamed to A")
            ck(not errs, f"no page errors with {note} ({errs[:1]})")
            await page.close()

        # ── 4. The order is created on the network that was tapped ─────────
        print("\n— MTN to MTN, Airtel to Airtel —")
        for tile, want in (("MTN", "MTN Mobile Money"), ("Airtel", "Airtel Money")):
            sent = []
            page, errs = await boot(ctx, routes(False, True), sent=sent)
            await page.evaluate("openDepositSheet()")
            await page.wait_for_timeout(500)
            await page.evaluate("""() => {
                document.getElementById('depAmount').value = '27000';
                document.getElementById('depPhone').value = '0769968158';
                submitDepositChoice(); }""")
            await page.wait_for_timeout(1100)
            await page.evaluate(
                f"""() => document.querySelector('.mp-method[data-method="{tile}"]').click()""")
            await page.evaluate("""() => { document.getElementById('manPayPhone').value = '0769968158'; }""")
            await page.evaluate("manualPayConfirm(27000)")
            await page.wait_for_timeout(900)
            got = sent[0].get("network") if sent else None
            ck(got == want, f"tapping {tile} orders a {want} account (got {got!r})")
            # And the screen agrees with the order it just placed, so reopening
            # a pending order cannot show an operator nobody tapped.
            back = await page.evaluate("_manDepChosenMethod")
            ck(back == tile, f"and the {tile} tile stays the selected one ({back!r})")
            ck(not errs, f"no page errors ordering on {tile} ({errs[:1]})")
            await page.close()

        # ── 5. The admin panel's marks ─────────────────────────────────────
        print("\n— the admin panel wears the Chipz mark —")
        ap = await ctx.new_page()
        aerrs = []
        ap.on("pageerror", lambda e: aerrs.append(str(e)))
        await ap.route(f"{API}/**", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"status": "success"}))))
        await ap.goto(f"http://127.0.0.1:{ADMIN_PORT}/index.html", wait_until="load")
        await ap.wait_for_timeout(1200)
        marks = await ap.evaluate("""() => ['brandMarkLogin','brandMarkTop'].map(id => {
            const el = document.getElementById(id);
            if (!el) return null;
            const img = el.querySelector('img');
            return { svg: !!el.querySelector('svg'),
                     src: img ? img.getAttribute('src') : null,
                     w: img ? img.naturalWidth : 0 }; })""")
        for i, name in enumerate(("login screen", "dashboard topbar")):
            m = marks[i]
            ck(bool(m) and not m["svg"], f"the {name} mark is no longer a hand-drawn SVG")
            ck(bool(m) and bool(m["src"]) and "icon" in (m["src"] or ""),
               f"the {name} mark is the Chipz icon ({m and m['src']})")
            ck(bool(m) and m["w"] > 0, f"and the {name} icon really loaded ({m and m['w']}px)")
        # The two shapes he named, gone from the file entirely.
        src = open(os.path.join(ADMIN_ROOT, "index.html"), encoding="utf-8").read()
        ck("M18 14C10 4 4 6 4 12c0 6 7 8 14 2" not in src,
           "Snow's slanting-8 swoosh path is gone from the built panel")
        ck("M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" not in src,
           "and so is the ladder grid")
        ck(not aerrs, f"no page errors in the admin panel ({aerrs[:1]})")
        await ap.close()

        # ── 6. Neither app icon is Snow's snowflake any more ───────────────
        print("\n— the app icon is Chipz, not a snowflake —")
        from PIL import Image as I
        for d in ("user", "admin"):
            for size in (192, 512):
                p = os.path.join(HERE, d, f"icon-{size}.png")
                im = I.open(p).convert("RGB")
                ck(im.size == (size, size), f"{d}/icon-{size}.png is {im.size[0]}x{im.size[1]}")
                # Snow's icon is a blue snowflake on dark red; Chipz's is the
                # brand gradient. Judge on the corners, which the wordmark
                # never touches: warm at BOTH, and the bottom-right lighter
                # and more orange than the top-left, which is the gradient.
                w, h = im.size
                tl = im.getpixel((int(w * .06), int(h * .55)))
                br = im.getpixel((int(w * .94), int(h * .55)))
                ck(tl[0] > tl[2] + 60 and br[0] > br[2] + 60,
                   f"{d}/icon-{size} is warm at both edges, not Snow's blue {tl} {br}")
                ck(br[1] > tl[1] + 25,
                   f"{d}/icon-{size} runs red into orange like the brand gradient")

        await b.close()

    print(f"\n{len(failed)} FAILED" if failed else "\nbleed / glow / marks: all cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    a = serve(ROOT, PORT)
    b_ = serve(ADMIN_ROOT, ADMIN_PORT)
    try:
        sys.exit(asyncio.run(main()))
    finally:
        a.shutdown()
        b_.shutdown()
