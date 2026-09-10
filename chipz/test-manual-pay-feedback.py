#!/usr/bin/env python3
"""The manual payment overlay's own toasts and loaders.

Owner: "on manual payment page, l need those loaders, ie on redirect loaders
after finishing, l need to see such notifies, ie when one taps confirm but when
no number or operator set, and when invalid number is set, also that loader
after putting number and confirming, and also that loader after reaching final
payment page ... loaders load data ie payment numbers and names and others,
also one mock up on invitation rewards, there is no slash bar '|' on ours."

Every case is driven through the REAL overlay. The two that need care:

  * The mid-flight loader is read in the SAME page task as the call. Its raise
    is synchronous and the request resolves on a later tick, so a Python-side
    read after the click races it and would report a working loader as absent.

  * The code screen's loader is lowered on a double requestAnimationFrame, so
    "did it cover the blank fields" is answered by sampling INSIDE that window
    rather than after it.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mp-feedback'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8803
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"userId": "u1", "phone": "0742730382", "publicId": "00001",
           "referralCode": "TCL80", "walletBalance": 5000, "registrationDone": True}
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "brandName": "Chipz", "annEnabled": False, "minDeposit": 3000,
        "depositPayAEnabled": False, "depositPayBEnabled": True,
        "commL1": 28, "commL2": 1, "commL3": 1,
        "manualPayReminderMtn": "1: Dial *165#\n2: Send Money"}},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": []},
    "/messages": {"status": "success", "messages": []},
    "/public/products": {"status": "success", "products": [
        {"key": "p1", "name": "Product-1", "price": 30000, "cycle": 150, "expectedReturn": 90000}]},
    "/public/banner": {"status": "success", "image": None, "video": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None,
                             "spin": None, "profilegif": None},
    "/bank/list": {"status": "success", "accounts": []},
    "/team/stats": {"status": "success", "referralCode": "TCL80",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0,
                    "teamCommission": 0, "teamDeposits": 0, "milestones": []},
}
INIT_OK = {"status": "success", "depositId": "dep-1", "amount": 27000,
           "assignedNumber": "0791399585", "holderName": "Kyarimpa Madrine",
           "expiresAt": 9999999999999}
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


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


async def toast(page):
    return await page.evaluate("""() => {
        const t = document.getElementById('manPayToast');
        return { shown: !!t && t.classList.contains('show'),
                 msg: (document.getElementById('manPayToastMsg')||{}).textContent || '' }; }""")


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  service_workers="block")
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        slow = {"on": False}

        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            if path.endswith("/deposit/manual/init"):
                if slow["on"]:
                    await asyncio.sleep(1.2)
                await r.fulfill(status=200, content_type="application/json",
                                body=json.dumps(INIT_OK))
                return
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
        await page.wait_for_timeout(2400)
        await page.evaluate("closeAnnounce && closeAnnounce()")

        async def open_selector():
            await page.evaluate("openDepositSheet()")
            await page.wait_for_timeout(500)
            await page.evaluate("""() => {
                document.getElementById('depAmount').value = '27000';
                document.getElementById('depPhone').value = '0769968158';
                submitDepositChoice(); }""")
            await page.wait_for_timeout(1000)

        await open_selector()
        ck(await page.evaluate("document.getElementById('manualPayBg').classList.contains('show')"),
           "the manual payment overlay is open")

        print("\n— a toast for each thing that can be wrong —")
        # 1. No operator chosen.
        await page.evaluate("manualPayConfirm(27000)")
        await page.wait_for_timeout(200)
        t = await toast(page)
        ck(t['shown'] and 'operator' in t['msg'].lower(),
           f"no operator selected -> {t['msg']!r}")

        # 2. Operator chosen, number empty.
        await page.evaluate("""() => document.querySelector('.mp-method[data-method="MTN"]').click()""")
        await page.wait_for_timeout(200)
        await page.evaluate("manualPayConfirm(27000)")
        await page.wait_for_timeout(200)
        t = await toast(page)
        ck(t['shown'] and 'payment account' in t['msg'].lower(),
           f"no number -> {t['msg']!r}")

        # 3. Half a number typed. Too short to be anything, so it reads as an
        # unfinished field rather than a wrong one.
        await page.evaluate("""() => { document.getElementById('manPayPhone').value = '7373'; }""")
        await page.evaluate("manualPayConfirm(27000)")
        await page.wait_for_timeout(200)
        t = await toast(page)
        ck(t['shown'] and 'payment account' in t['msg'].lower(),
           f"half a number -> {t['msg']!r}")

        # 4. A full-length number that is not a mobile at all -- a Kampala
        # landline. This is the case the format message exists for.
        await page.evaluate("""() => { document.getElementById('manPayPhone').value = '0414123456'; }""")
        await page.evaluate("manualPayConfirm(27000)")
        await page.wait_for_timeout(200)
        t = await toast(page)
        ck(t['shown'] and 'format is incorrect' in t['msg'].lower(),
           f"a landline -> {t['msg']!r}")

        # 5. Right length, right leading 7, but a prefix no Uganda network uses.
        await page.evaluate("""() => { document.getElementById('manPayPhone').value = '0719968158'; }""")
        await page.evaluate("manualPayConfirm(27000)")
        await page.wait_for_timeout(200)
        t = await toast(page)
        ck(t['shown'] and 'format is incorrect' in t['msg'].lower(),
           f"an unused prefix -> {t['msg']!r}")

        # It is a toast, not the app's alert dialog: nothing to dismiss, and it
        # clears itself.
        notify_open = await page.evaluate(
            "document.getElementById('notifyBg').classList.contains('show')")
        ck(not notify_open, "and it is NOT the app's OK-button alert dialog")
        await page.wait_for_timeout(2200)
        t = await toast(page)
        ck(not t['shown'], "the toast clears itself without a tap")

        print("\n— the loader while the order is being created —")
        slow["on"] = True
        mid = await page.evaluate("""() => {
            document.getElementById('manPayPhone').value = '0769968158';
            manualPayConfirm(27000);
            const l = document.getElementById('manPayLoading');
            return { up: !!l && !l.classList.contains('mp-hidden'),
                     text: l ? l.innerText.trim() : '' }; }""")
        ck(mid['up'], "tapping Confirm raises the loader straight away")
        ck('Loading' in mid['text'], f"and it says Loading ({mid['text']!r})")

        print("\n— the loader covers the code screen while its figures land —")
        # Sampled inside the double-rAF window: the fields are filled and the
        # loader is still up, which is the frame this exists to hide.
        covered = await page.evaluate("""() => new Promise(res => {
            const seen = [];
            const tick = () => {
                const l = document.getElementById('manPayLoading');
                const scr = document.getElementById('manPayScreen');
                if (scr && !scr.classList.contains('mp-hidden')) {
                    seen.push({ loader: !!l && !l.classList.contains('mp-hidden'),
                                num: document.getElementById('manPayMerchantNumber').textContent,
                                name: document.getElementById('manPayMerchantName').textContent });
                }
                if (seen.length >= 3) return res(seen);
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        })""")
        ck(any(s['loader'] for s in covered),
           f"the loader is still up as the code screen appears ({[s['loader'] for s in covered]})")
        ck(all(s['num'] and s['name'] for s in covered),
           "and the account number and holder name are never blank while it shows")

        await page.wait_for_timeout(900)
        after = await page.evaluate("""() => ({
            loader: !document.getElementById('manPayLoading').classList.contains('mp-hidden'),
            num: document.getElementById('manPayMerchantNumber').textContent,
            name: document.getElementById('manPayMerchantName').textContent })""")
        ck(not after['loader'], "the loader comes down once the screen is painted")
        ck(after['num'] == '0791399585' and after['name'] == 'Kyarimpa Madrine',
           f"with the real figures in place ({after['num']}, {after['name']})")

        print("\n— the Invitation Reward heading has the accent bar —")
        await page.evaluate("closeManualPayOverlay({fromAction:true}); showPage('referral')")
        await page.wait_for_timeout(900)
        bar = await page.evaluate("""() => {
            const h = [...document.querySelectorAll('h3')].find(x => /Invitation Reward/.test(x.textContent));
            if (!h) return null;
            const b = h.querySelector('.inv-bar');
            if (!b) return { has: false };
            const r = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
            return { has: true, w: r.width, h: r.height, left: r.left < hr.left + 12,
                     bg: getComputedStyle(b).backgroundImage.slice(0, 30) }; }""")
        ck(bar and bar.get('has'), "the bar is there")
        ck(bar and bar['w'] >= 3 and bar['w'] <= 6, f"a slim bar ({bar and bar['w']}px wide)")
        ck(bar and bar['h'] >= 12, f"and tall enough to read as one ({bar and bar['h']}px)")
        ck(bar and bar['left'], "sitting to the LEFT of the heading, as his mockup has it")
        ck(bar and 'gradient' in (bar['bg'] or ''),
           f"in the brand gradient, matching the Account section bars ({bar and bar['bg']!r})")

        ck(not errs, f"no page errors ({errs[:1]})")
        await b.close()

    print(f"\n{len(failed)} FAILED" if failed else "\nmanual pay feedback: all cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    h = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        h.shutdown()
