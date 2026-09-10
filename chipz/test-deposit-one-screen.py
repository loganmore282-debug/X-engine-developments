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

Also covers the profile icon (the uploaded GIF) and the admin panel's own
colour and marks.
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
    instructions = []
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
                    document.getElementById('depPhone').offsetParent !== null,
                instr: [...document.querySelectorAll('.dep-instr li')].map(li => li.textContent.trim()) })""")

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

            # Owner: "l want even if pay a or b, the payment phone should be
            # there ... whether single on A available or B available." An
            # earlier round hid it for PAY B, reasoning that the manual overlay
            # asks again on its own screen; he overruled that, and the field is
            # unconditional now. So it is asserted VISIBLE in all three
            # combinations, and still visible after switching methods -- a
            # section that comes and goes as the radio changes is what reads as
            # the form breaking.
            ck(got['phoneShown'] is True, "the Payment Phone field is on the screen")

            # Owner: "even deposit instructions shouldn't change please it
            # should use that new one, no changing." Collected per combination
            # and compared across all three after the loop.
            instructions.append((name, got['instr']))

            if pay_a and pay_b:
                ck(got['on'] == [], "with both live, neither is preselected")
                for pick in ('B', 'A'):
                    await page.evaluate(f"pickDepositPayMethod('{pick}')")
                    await page.wait_for_timeout(200)
                    still = await page.evaluate(
                        "document.getElementById('depPhone').offsetParent !== null")
                    ck(still, f"and it stays visible with PAY {pick} selected")
            else:
                ck(got['on'] == want, f"the only method is preselected ({got['on']})")

            ck(not errs, f"no page errors ({errs[:1]})")
            await ctx.close()

        # ── PAY B uses the same "Redirecting to payment…" loader as PAY-A ──
        # Owner: "the loader to redirecting to payment page on manual payment
        # should be there not the other old one." PAY B used to swap the
        # button's label for a small in-button spinner instead.
        print("\n— the manual path shows the redirect loader —")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = await ctx.new_page()
        await open_app(page, False, True)
        await page.evaluate("openDepositSheet()")
        await page.wait_for_timeout(600)
        # Read in the SAME page task as the call. proceedToManualPaymentMethod()
        # raises the loader synchronously and only then waits 400ms before
        # opening the overlay, so a Python-side read after the click would race
        # that timer; this cannot.
        mid = await page.evaluate("""() => {
            document.getElementById('depAmount').value = '20000';
            // The phone is filled in here too. It was not, and this section
            // passed anyway until the blank-number guard was added -- which
            // means it had been exercising a path that skipped validation
            // entirely. Both fields are what a member actually submits.
            document.getElementById('depPhone').value = '0742730382';
            submitDepositChoice();
            const el = document.getElementById('depRedirect');
            return { shown: !!el && el.classList.contains('show'),
                     text: el ? el.innerText.trim() : '',
                     btnHtml: document.getElementById('depSubmitBtn').innerHTML }; }""")
        ck(mid['shown'], "tapping Confirm on PAY B raises the redirect loader")
        ck('edirect' in mid['text'], f"and it says what it is doing ({mid['text']!r})")
        ck('mini-spin' not in mid['btnHtml'],
           "the old in-button spinner is not what is shown any more")
        await page.wait_for_timeout(900)
        after = await page.evaluate("""() => ({
            loader: document.getElementById('depRedirect').classList.contains('show'),
            overlay: document.getElementById('manualPayBg').classList.contains('show'),
            btnDisabled: document.getElementById('depSubmitBtn').disabled })""")
        ck(after['overlay'], "the manual payment overlay opens")
        ck(not after['loader'], "and the loader comes back down once it does")
        ck(not after['btnDisabled'],
           "the Confirm button is re-enabled, so backing out and retrying works")
        await ctx.close()

        # ── a blank number is refused on BOTH methods ──
        # Owner: "when pay b is selected and no putting number, it just
        # continues to payment page why???" Only the PAY-A branch validated the
        # phone; the manual branch checked the amount and nothing else. Both
        # methods are driven here with the field left EMPTY, and the pass
        # condition is what actually went wrong for him: no request left the
        # app and no payment screen opened.
        print("\n— a blank payment phone is refused, whichever method —")
        for pay_a, pay_b, pick, label in [(True, False, 'A', 'PAY-A'),
                                          (False, True, 'B', 'PAY B')]:
            ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                      service_workers="block")
            page = await ctx.new_page()
            calls = []
            await open_app(page, pay_a, pay_b)
            page.on("request", lambda r: calls.append(r.url))
            await page.evaluate("openDepositSheet()")
            await page.wait_for_timeout(600)
            await page.evaluate("""() => {
                document.getElementById('depAmount').value = '20000';
                document.getElementById('depPhone').value = '';   // left blank
                submitDepositChoice(); }""")
            await page.wait_for_timeout(1200)
            state = await page.evaluate("""() => ({
                pay: document.getElementById('depStatusBg').classList.contains('show'),
                manual: document.getElementById('manualPayBg').classList.contains('show'),
                notify: document.getElementById('notifyBg').classList.contains('show'),
                msg: (document.getElementById('notifyMsg')||{}).textContent || '' })""")
            money = [u for u in calls if '/deposit/' in u]
            ck(not state['pay'] and not state['manual'],
               f"{label}: no payment screen opens (poll={state['pay']}, manual={state['manual']})")
            ck(not money, f"{label}: no deposit request is sent ({money[:1]})")
            ck(state['notify'] and 'number' in state['msg'].lower(),
               f"{label}: and it says why ({state['msg']!r})")
            await ctx.close()

        # A valid number still gets through, so the guard is not just a wall.
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = await ctx.new_page()
        await open_app(page, False, True)
        await page.evaluate("openDepositSheet()")
        await page.wait_for_timeout(600)
        await page.evaluate("""() => {
            document.getElementById('depAmount').value = '20000';
            document.getElementById('depPhone').value = '0742730382';
            submitDepositChoice(); }""")
        await page.wait_for_timeout(1200)
        opened = await page.evaluate(
            "document.getElementById('manualPayBg').classList.contains('show')")
        ck(opened, "PAY B still proceeds once the number is filled in")
        await ctx.close()

        # ── the instruction card never changes ──
        print("\n— the deposit instructions are the same on every method —")
        for nm, lst in instructions:
            print(f"    {nm}: {len(lst)} items")
        first_name, first = instructions[0]
        for nm, lst in instructions[1:]:
            ck(lst == first, f"{nm} matches {first_name} exactly")
        ck(len(first) == 4, f"the design's own four lines, no extras ({len(first)})")
        ck(not any('PAY B' in x for x in first),
           "and no method-specific line was slipped in")

        # ── the profile icon is the logo, not the GIF ──
        print("\n— the profile icon is the uploaded GIF —")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = await ctx.new_page()
        await open_app(page, True, False)
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(700)
        prof = await page.evaluate("""() => {
            const el = document.querySelector('.acct-logo');
            const img = el && el.querySelector('img');
            return { html: el ? el.className : null, src: img ? img.getAttribute('src') : null }; }""")
        ck(prof['src'] == GIF, "the Account profile mark shows the uploaded GIF")
        ck(prof['src'] != LOGO,
           "and outranks the Brand logo, which this fixture also serves")
        ck('has-gif' in (prof['html'] or ''), "with its own uncropped class on the slot")
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
