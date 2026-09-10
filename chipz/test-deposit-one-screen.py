#!/usr/bin/env python3
"""One Deposit screen, whatever PAY A / PAY B are set to.

Owner: "we still have old designs of deposit page, see our current one but see
the old residue pages, l no longer need them we have that new one, so for
option b it will be PAY B, so remove all those pages of old stuffs of kpay and
others."

There were THREE deposit screens and the SETTINGS decided which one appeared:
the current design (PAY A alone), an old "Recharge" whose method read "K-pay"
(PAY B alone), and another old "Recharge" with a PAY A / PAY B list (both on).
So this drives the built app three times, once per combination, and asserts the
same current screen every time -- checking only the PAY-A-alone case would have
passed against the broken build, since that was the one combination that was
already right.

Also covers the profile icon (the admin logo now, not the GIF) and the admin
panel's own colour and marks.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/dep-one'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
ADMIN_ROOT = os.path.join(HERE, 'admin')
PORT = 8798
ADMIN_PORT = 8799
API = 'https://chipz-server.onrender.com'

# A 1x1 red PNG, used as the "uploaded" brand logo.
LOGO = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA'
        'DUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
GIF = ('data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==')

ACCOUNT = {"userId": "u1", "phone": "0742730382", "publicId": "00001",
           "referralCode": "TCL80", "walletBalance": 5000, "registrationDone": True}
PRODUCTS = [{"key": "p1", "name": "Product-1", "price": 30000, "cycle": 150, "expectedReturn": 90000},
            {"key": "p2", "name": "Product-2", "price": 90000, "cycle": 150, "expectedReturn": 270000}]

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


def routes(pay_a, pay_b):
    return {
        "/public/settings": {"status": "success", "settings": {
            "brandName": "Chipz", "annEnabled": False, "minDeposit": 3000,
            "depositPayAEnabled": pay_a, "depositPayBEnabled": pay_b}},
        "/account": {"status": "success", "account": ACCOUNT},
        "/investments": {"status": "success", "investments": []},
        "/transactions": {"status": "success", "transactions": []},
        "/messages": {"status": "success", "messages": []},
        "/public/products": {"status": "success", "products": PRODUCTS},
        "/public/banner": {"status": "success", "image": None, "video": None},
        "/public/chipz-images": {"status": "success", "referral": None,
                                 "logo": LOGO, "spin": None, "profilegif": GIF},
        "/bank/list": {"status": "success", "accounts": []},
    }


async def open_app(page, pay_a, pay_b):
    table = routes(pay_a, pay_b)

    async def api(r):
        path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        body = next((v for k, v in table.items() if path.endswith(k)), {"status": "success"})
        await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    await page.route(f"{API}/**", api)
    await page.route("https://fonts.googleapis.com/**",
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                     lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.wait_for_timeout(2400)
    await page.evaluate("closeAnnounce && closeAnnounce()")


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")

        for pay_a, pay_b, name, want in [
            (True, False, 'PAY A only', ['PAY-A']),
            (False, True, 'PAY B only', ['PAY B']),
            (True, True, 'both', ['PAY-A', 'PAY B']),
        ]:
            print(f"\n— deposit with {name} —")
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
            page = await ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            await open_app(page, pay_a, pay_b)
            await page.evaluate("openDepositSheet()")
            await page.wait_for_timeout(700)

            got = await page.evaluate("""() => ({
                title: (document.getElementById('sheetTitle')||{}).textContent,
                rows: [...document.querySelectorAll('.pay-row')].map(r => r.textContent.trim()),
                on: [...document.querySelectorAll('.pay-row.on')].map(r => r.textContent.trim()),
                chips: document.querySelectorAll('#depChips .dep-chip').length,
                legacyChips: document.querySelectorAll('.quick-amt').length,
                btn: (document.getElementById('depSubmitBtn')||{}).textContent,
                body: document.getElementById('sheetBody').innerText,
                phoneShown: !!document.getElementById('depPhone') &&
                    (document.getElementById('depPayAFields')||{}).style.display !== 'none' })""")

            # The title is the single clearest tell: the two dead screens both
            # opened as "Recharge".
            ck(got['title'] == 'Deposit',
               f"the sheet is the current Deposit design (title={got['title']!r})")
            ck(got['rows'] == want, f"payment rows are {want} (got {got['rows']})")
            ck('K-pay' not in got['body'], "no K-pay anywhere on it")
            ck(got['legacyChips'] == 0,
               f"none of the old .quick-amt markup is left ({got['legacyChips']} found)")
            ck(got['chips'] == len(PRODUCTS),
               f"the current chip grid is what renders ({got['chips']} chips)")
            ck(got['btn'].strip() == 'Confirm Deposit',
               f"the current button label (got {got['btn']!r})")

            # Single method -> preselected; a choice -> nothing preselected.
            if pay_a and pay_b:
                ck(got['on'] == [], "with both live, neither is preselected")
                ck(got['phoneShown'] is False,
                   "and the phone field waits until PAY-A is chosen")
                # Choosing PAY B must NOT ask for a number here -- its own next
                # screen collects one.
                await page.evaluate("pickDepositPayMethod('B')")
                await page.wait_for_timeout(200)
                hidden = await page.evaluate(
                    "document.getElementById('depPayAFields').style.display === 'none'")
                ck(hidden, "choosing PAY B hides the PAY-A phone field")
                await page.evaluate("pickDepositPayMethod('A')")
                await page.wait_for_timeout(200)
                shown = await page.evaluate(
                    "document.getElementById('depPayAFields').style.display !== 'none'")
                ck(shown, "and choosing PAY-A brings it back")
            else:
                ck(got['on'] == want, f"the only method is preselected ({got['on']})")
                ck(got['phoneShown'] is (True if pay_a else False),
                   "the phone field matches the method")

            ck(not errs, f"no page errors ({errs[:1]})")
            await ctx.close()

        # ── the profile icon is the logo, not the GIF ──
        print("\n— the profile icon is the uploaded logo —")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = await ctx.new_page()
        await open_app(page, True, False)
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(700)
        prof = await page.evaluate("""() => {
            const el = document.querySelector('.acct-logo');
            const img = el && el.querySelector('img');
            return { html: el ? el.className : null, src: img ? img.getAttribute('src') : null }; }""")
        ck(prof['src'] == LOGO,
           "the Account profile mark shows the admin's Brand logo")
        ck(prof['src'] != GIF, "not the profile GIF")
        ck('has-gif' not in (prof['html'] or ''), "and no GIF-specific class is left on it")
        # The GIF keeps the place it was actually asked for.
        home_gif = await page.evaluate("""() => { showPage('home'); return 0; }""")
        await page.wait_for_timeout(700)
        strip = await page.evaluate(
            "() => { const g = document.querySelector('.home-gif img'); return g && g.getAttribute('src'); }")
        ck(strip == GIF, "the GIF still shows on the Home idle strip")
        await ctx.close()

        # ── the admin panel ──
        print("\n— the admin panel: orange, and the uploaded logo —")
        ctx = await b.new_context(viewport={"width": 1100, "height": 800}, service_workers="block")
        page = await ctx.new_page()
        # Catch-all FIRST, specific route SECOND: Playwright gives precedence
        # to the route registered last. The other way round, the catch-all
        # answers /public/chipz-images with an error and the logo assertions
        # fail against a perfectly good build.
        await page.route(f"{API}/**", lambda r: asyncio.ensure_future(r.fulfill(
            status=200, content_type="application/json", body=json.dumps({"status": "error"}))))
        await page.route(f"{API}/public/chipz-images",
                         lambda r: asyncio.ensure_future(r.fulfill(
                             status=200, content_type="application/json",
                             body=json.dumps({"status": "success", "logo": LOGO}))))
        await page.goto(f"http://127.0.0.1:{ADMIN_PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(1500)
        adm = await page.evaluate("""() => {
            const cs = getComputedStyle(document.documentElement);
            const login = document.getElementById('brandMarkLogin');
            const top = document.getElementById('brandMarkTop');
            return { gold: cs.getPropertyValue('--gold').trim(),
                     loginImg: login && login.querySelector('img') && login.querySelector('img').src,
                     topImg: top && top.querySelector('img') && top.querySelector('img').src }; }""")

        # Orange, checked as a colour rather than as a hex string: R clearly
        # above G clearly above B is what "orange, not red" actually means, and
        # a hex compare would fail on any future retune of the same hue.
        def rgb(h):
            h = h.lstrip('#')
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

        r, g, bl = rgb(adm['gold'])
        print(f"    --gold = {adm['gold']}  rgb({r},{g},{bl})")
        ck(g > 60, f"the accent has real green in it, so it reads orange not red (G={g})")
        ck(r > g > bl, f"and ramps R>G>B like an orange ({r}>{g}>{bl})")
        ck(adm['loginImg'] == LOGO, "the login screen mark is the uploaded logo")
        ck(adm['topImg'] == LOGO, "and so is the dashboard topbar mark")
        await ctx.close()
        await b.close()

    print(f"\n{len(failed)} FAILED" if failed else "\ndeposit one-screen: all cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    a = serve(ROOT, PORT)
    b_ = serve(ADMIN_ROOT, ADMIN_PORT)
    try:
        sys.exit(asyncio.run(main()))
    finally:
        a.shutdown(); b_.shutdown()
