#!/usr/bin/env python3
"""
Boots the BUILT user/index.html in a real browser and fails on any page
error. This exists because a whole class of bug reached the live site twice
in one session: removing dead code and silently taking a still-used
declaration with it (NUMBER_FONT_STACKS, chipzMarkHtml). `node --check`
passes, the obfuscated build round-trips, and the app then throws
"X is not defined" and hangs forever on the loading screen.

Run it after every build, before committing:
    node build-core.js && python3 smoke-test.py

Two things that are easy to get wrong when writing tests against this app:
  * service_workers="block" is REQUIRED. The SW intercepts API calls before
    Playwright's page.route sees them, which looks exactly like a dead
    endpoint and sends you hunting a bug that isn't there.
  * Firebase's ESM modules load from gstatic and are stubbed below, so the
    app reaches its signed-in state without a network round trip.
"""
import asyncio, json, os, subprocess, sys, threading, http.server, socketserver, functools

PORT = int(os.environ.get('SMOKE_PORT', '8791'))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'user')
API = 'https://mylifeismyhappiness.onrender.com'

ACCOUNT = {"phone": "0742730382", "walletBalance": 2000, "totalDeposited": 58000,
           "totalEarned": 9840, "totalWithdrawn": 32164, "totalInvested": 28000,
           "checkinStreak": 2, "lastCheckinAt": None, "referralCode": "ML3Q4X",
           "publicId": "10012", "registrationDone": True,
           "team": {"l1": 3, "l2": 1, "l3": 0, "commission": 7840}}
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 150,
             "expectedReturn": p * 30, "image": ""}
            for i, p in enumerate([30000, 90000, 180000, 300000], start=1)]
TX = [{"id": "1", "type": "deposit", "amount": 28000, "displayAmount": 28000,
       "description": "Deposit: Pending (UGX 28,000)", "date": "05/09/2026", "time": "23:21"},
      {"id": "2", "type": "withdraw", "amount": -6664, "displayAmount": -6664,
       "description": "Withdrawal: Paid (UGX 6,664)", "date": "02/09/2026", "time": "15:43"}]
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
    "/mission/status": {"status": "success", "mission": {}},
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

# Every screen, reached the way a member reaches it.
TABS = ["catalog", "products", "referral", "team", "account"]
SHEETS = ["openWalletSheet()", "openBalanceRecordSheet()", "openMessagesSheet()",
          "openChangeLoginPasswordSheet()", "openChangeTradePasswordSheet()",
          "openChestSheet()", "openDepositSheet()", "openWithdrawSheet()",
          "openHelpSheet()", "openAboutSheet()"]


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    from playwright.async_api import async_playwright
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await browser.new_context(viewport={"width": 390, "height": 860},
                                        service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.error: {m.text}")
                if m.type == "error" and "ERR_" not in m.text else None)

        async def api(route):
            path = "/" + route.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            body = next((v for k, v in ROUTES.items() if path.endswith(k)), {"status": "success"})
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        await page.route(f"{API}/**", api)
        await page.route("https://fonts.googleapis.com/**",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))

        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(2500)

        # The app must actually get past the loading screen. A missing global
        # leaves it stuck here forever, which is the exact bug this catches.
        still_loading = await page.evaluate(
            "(() => { const el = document.getElementById('loadingScreen');"
            " return !!el && getComputedStyle(el).display !== 'none'; })()")
        if still_loading:
            errors.append("STUCK: loading screen never cleared")

        await page.evaluate("document.getElementById('announceBg')"
                            " && document.getElementById('announceBg').classList.remove('show')")
        for tab in TABS:
            await page.evaluate(f"showPage('{tab}')")
            await page.wait_for_timeout(350)
        await page.evaluate("showPage('home')")
        await page.wait_for_timeout(400)
        for fn in SHEETS:
            await page.evaluate(f"try{{{fn}}}catch(e){{throw e}}")
            await page.wait_for_timeout(350)
            await page.evaluate("try{closeSheet()}catch(e){}")
            await page.wait_for_timeout(120)
        await page.evaluate("notify('smoke test')")
        await page.wait_for_timeout(200)
        await page.evaluate("closeNotify()")
        await browser.close()

    if errors:
        print("SMOKE TEST FAILED")
        for e in dict.fromkeys(errors):
            print("  " + e)
        return 1
    print(f"smoke test: OK — loaded, {len(TABS) + 1} tabs and {len(SHEETS)} sheets opened, no page errors")
    return 0


if __name__ == "__main__":
    httpd = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        httpd.shutdown()
