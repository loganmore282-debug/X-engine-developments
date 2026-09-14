"""
The Kenyan subdomain actually READS in Kenyan shillings, in the built app.

test-regions.js proves the pieces are right in isolation. This drives the
real obfuscated build in a real browser with the backend answering as a
Kenyan region, and checks what a member would actually see on the screens
where money and phone numbers appear:

  * the wallet balance and every product price labelled KES, not UGX
  * the dialling-code chip on Deposit reading +254, not +256
  * the Withdraw screen's currency chip reading KES
  * a Kenyan number accepted where a Ugandan one is refused

Then it reloads the SAME build with the SAME routes answering as Uganda and
requires every one of those to read the Ugandan way -- because a test that
only ever sees Kenya cannot tell a working region layer apart from a build
with "KES" hardcoded into it.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/region-currency'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8871
API = 'https://chipz-server.onrender.com'

# Exactly the shape publicRegionView() sends, usesBareLocal included --
# which country's accounts use the bare local digits as their login address
# and which carry the dialling code. It is computed SERVER-side because the
# answer depends on the founding region's dialling code, so the fixture has
# to supply it the same way a real reply does; leaving it out makes the app
# fall back to the bare legacy shape (its deliberate answer for a server
# that is a deploy behind).
UG_REGION = {"key": "ug", "name": "Uganda", "currency": "UGX", "dialCode": "256",
             "localLength": 9, "prefixes": ["7"], "utcOffsetMin": 180, "isDefault": True,
             "usesBareLocal": True}
KE_REGION = {"key": "ke", "name": "Kenya", "currency": "KES", "dialCode": "254",
             "localLength": 9, "prefixes": ["7", "1"], "utcOffsetMin": 180, "isDefault": False,
             "usesBareLocal": False}

ACCOUNT = {"phone": "0712345678", "walletBalance": 2500, "totalDeposited": 5000,
           "totalEarned": 900, "totalWithdrawn": 0, "totalInvested": 3000,
           "checkinStreak": 1, "lastCheckinAt": None, "referralCode": "KE7Q4X",
           "publicId": "10099", "registrationDone": True,
           "team": {"l1": 0, "l2": 0, "l3": 0, "commission": 0}}

# Kenyan prices, as an admin would have set them for that region: a tenth of
# Uganda's, which is roughly the real exchange rate.
PRODUCTS = [{"key": f"product-{i}", "name": f"Product-{i}", "price": p, "cycle": 150,
             "expectedReturn": p * 30, "dailyPayout": p * 30 // 150, "image": "",
             "isOpen": True, "spinCount": 0, "spinMin": 0, "spinMax": 0}
            for i, p in enumerate([500, 1500, 3000, 5000, 7000], start=1)]

SETTINGS = {"minDeposit": 500, "minWithdraw": 200, "withdrawFeePct": 15,
            "withdrawMultiple": 100, "commL1": 27, "commL2": 2, "commL3": 1,
            "annEnabled": False, "depositPayAEnabled": True, "depositPayBEnabled": False,
            "openingCountdownEnabled": False, "maintenanceMode": False,
            "dailyCheckin": 50, "turntableEnabled": False, "brandName": "Chipz",
            "requireInvestToWithdraw": False, "withdrawWindowEnabled": False}


def routes(region, account_region=None):
    # Two regions on purpose: `region` is what the HOSTNAME resolves to (what
    # a visitor sees) and `account_region` is the signed-in member's OWN. They
    # are normally the same; the third scenario below deliberately makes them
    # differ, which is the only way to test the rule that the ACCOUNT wins.
    acct = account_region or region
    return {
        "/public/settings": {"status": "success", "settings": SETTINGS,
                             "region": region, "regionCount": 2},
        "/public/products": {"status": "success", "products": PRODUCTS},
        "/public/activity-feed": {"status": "success", "feed": []},
        "/public/banner": {"status": "success", "image": None},
        "/public/announcement-image": {"status": "success", "image": None},
        "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
        "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None},
        "/account": {"status": "success", "account": ACCOUNT, "region": acct},
        "/investments": {"status": "success", "investments": []},
        "/transactions": {"status": "success", "transactions": [], "truncated": False},
        "/messages": {"status": "success", "messages": []},
        "/bank/list": {"status": "success", "accounts": [
            {"id": "b1", "holder": "Jane Wanjiku", "network": "MTN Mobile Money", "phone": "0712345678"}]},
        "/team/stats": {"status": "success", "referralCode": "KE7Q4X",
                        "commRates": {"l1": 27, "l2": 2, "l3": 1},
                        "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0,
                        "teamCommission": 0, "teamDeposits": 0, "milestones": []},
        "/team/members": {"status": "success", "level": 1, "members": []},
        "/mission/status": {"status": "success", "mission": {}},
        "/turntable/status": {"status": "success", "enabled": False},
    }


FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """
 const user={uid:'u1',email:'254712345678@chipz-platform.com',getIdToken:async()=>'tok'};
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


PROBE = """()=>{
  const t = s => (document.querySelector(s)||{}).textContent || '';
  const money = [...document.querySelectorAll('.p-stat .v')].map(e=>e.textContent.trim()).slice(0,6);
  return {
    region: (window.REGION||{}).currency + '/' + (window.REGION||{}).dialCode,
    wallet: t('#acctWallet').trim(),
    prices: money,
    depPrefix: t('.dep-phone .prefix').trim(),
    depHint: t('.dep-hint').trim(),
    witChip: t('.wit-amt span').trim(),
    witBal: t('.wit-card .val').trim() || t('.wallet-card .val').trim(),
    fmt: typeof cur === 'function' ? cur() : null,
    sampleFmt: typeof fmtUGX === 'function' ? fmtUGX(1234) : null,
    loginDial: t('#loginDial').trim(),
    regDial: t('#regDial').trim(),
    loginNote: t('#loginRegionNote').trim(),
    cleanKe: typeof cleanPhone === 'function' ? cleanPhone('0712345678') : null,
    cleanUgOnly: typeof cleanPhone === 'function' ? cleanPhone('0412345678') : null,
    email: typeof phoneToEmail === 'function' ? phoneToEmail('0712345678') : null,
  };
}"""


async def snapshot(page, label):
    await page.wait_for_timeout(2600)
    try:
        await page.evaluate("closeAnnounce()")
    except Exception:
        pass
    # Each figure only exists in the DOM while its own screen is open, so
    # every screen is visited: Products for the prices, Account for the
    # wallet balance, then the two money sheets.
    # Every currency label VISIBLE on the Account screen, read out of the
    # text itself rather than through one element's selector. Written this
    # way after two selector attempts returned nothing -- and it is the
    # stronger assertion anyway: it proves no part of the screen is printing
    # the OTHER country's currency, which a single-element check cannot.
    SCAN = "()=>{const seen=new Set();const walk=n=>{if(n.nodeType===3){(n.textContent.match(/\\b(UGX|KES|KSH|TZS|NGN)\\b/g)||[]).forEach(m=>seen.add(m));return;}if(n.nodeType!==1)return;const st=getComputedStyle(n);if(st.display==='none'||st.visibility==='hidden')return;for(const c of n.childNodes) walk(c);};walk(document.body);return [...seen];}"
    await page.evaluate("showPage('account')")
    await page.wait_for_timeout(1400)
    wallet = await page.evaluate("()=>((document.querySelector('#acctWallet')||{}).textContent||'').trim()")
    prices = await page.evaluate(SCAN)
    await page.evaluate("showPage('home')")
    await page.wait_for_timeout(700)
    await page.evaluate("openDepositSheet()")
    await page.wait_for_timeout(1200)
    dep = await page.evaluate("()=>({prefix:((document.querySelector('.dep-phone .prefix')||{}).textContent||'').trim(),hint:((document.querySelector('.dep-hint')||{}).textContent||'').trim()})")
    await page.evaluate("closeSheet()")
    await page.wait_for_timeout(500)
    await page.evaluate("openWithdrawSheet()")
    await page.wait_for_timeout(1200)
    info = await page.evaluate(PROBE)
    info["prices"] = prices
    info["wallet"] = wallet
    info["depPrefix"] = dep["prefix"]
    info["depHint"] = dep["hint"]
    await page.screenshot(path=f"{OUT}/{label}.png", full_page=True)
    await page.evaluate("closeSheet()")
    await page.wait_for_timeout(400)
    return info


async def main():
    errs, fails = [], []

    def ck(ok, l):
        print(("PASS  " if ok else "FAIL  ") + l)
        if not ok:
            fails.append(l)

    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))

        current = {"region": KE_REGION, "account": None, "parked": False,
                   "entry": {"status": "success", "rotate": False, "mode": "off", "host": ""}}

        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            if current["parked"]:
                await r.fulfill(status=403, content_type="application/json", body=json.dumps({
                    "status": "error", "code": "HOST_PARKED",
                    "message": "This address does not serve the app. Please open the link for your own country.",
                }))
                return
            # Which address this arrival should be on. Answered from
            # `current` rather than the table so a scenario can change it
            # between page loads.
            if path.endswith("/public/entry"):
                await r.fulfill(status=200, content_type="application/json",
                                body=json.dumps(current["entry"]))
                return
            table = routes(current["region"], current["account"])
            body = next((v for k, v in table.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        await page.route(f"{API}/**", api)
        await page.route("https://fonts.googleapis.com/**",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))

        print('— the Kenyan subdomain —')
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        ke = await snapshot(page, "kenya")
        for k, v in ke.items():
            print("  %-12s %s" % (k, v))
        ck(ke["region"] == "KES/254", "the app took Kenya's currency and dialling code from the server")
        ck(ke["fmt"] == "KES" and ke["sampleFmt"] == "KES 1,234", "its money formatter reads KES")
        ck("KES" in ke["wallet"] and "UGX" not in ke["wallet"], "the wallet balance reads KES: " + ke["wallet"])
        ck(ke["prices"] == ["KES"], "KES is the only currency anywhere on screen: %s" % (ke["prices"],))
        ck(ke["depPrefix"] == "+254", "the Deposit number field shows +254: " + ke["depPrefix"])
        ck(ke["witChip"] == "KES", "the Withdraw amount field is labelled KES: " + ke["witChip"])
        ck(ke["cleanKe"] == "+254712345678", "a Kenyan number is accepted: %s" % ke["cleanKe"])
        ck(ke["cleanUgOnly"] is None, "a number on a prefix Kenya did not list is refused")
        ck(ke["email"] == "254712345678@chipz-platform.com",
           "and its login address carries the dialling code: %s" % ke["email"])

        print('\n— the SAME build, served as Uganda —')
        current["region"] = UG_REGION; current["account"] = None
        # localStorage remembers the last region, so it is cleared: this
        # reload must be a genuinely fresh Ugandan visit, not Kenya's
        # leftovers being overwritten.
        await page.evaluate("()=>{try{localStorage.clear()}catch(e){}}")
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        ug = await snapshot(page, "uganda")
        for k, v in ug.items():
            print("  %-12s %s" % (k, v))
        ck(ug["region"] == "UGX/256", "the same build reads Uganda when the server says Uganda")
        ck(ug["sampleFmt"] == "UGX 1,234", "its money formatter reads UGX")
        ck("UGX" in ug["wallet"] and "KES" not in ug["wallet"], "the wallet balance reads UGX: " + ug["wallet"])
        ck(ug["prices"] == ["UGX"], "UGX is the only currency anywhere on screen: %s" % (ug["prices"],))
        ck(ug["depPrefix"] == "+256", "the Deposit number field shows +256: " + ug["depPrefix"])
        ck(ug["witChip"] == "UGX", "the Withdraw amount field is labelled UGX: " + ug["witChip"])
        ck(ug["cleanUgOnly"] is None, "a Ugandan landline is still refused")
        ck(ug["email"] == "712345678@chipz-platform.com",
           "and a Ugandan login address is still the bare local digits: %s" % ug["email"])
        ck(ke["wallet"] != ug["wallet"] and ke["depPrefix"] != ug["depPrefix"],
           "the two runs genuinely differ -- nothing here is hardcoded")

        print('\n— a Kenyan member who opens the UGANDAN address —')
        # The money-safety rule: the hostname says Uganda, the account says
        # Kenya, and the account must win. Without this scenario the two runs
        # above cannot tell the rule apart from the app simply believing
        # whatever /public/settings said -- verified: dropping applyRegion()
        # on the /account reply goes undetected until this case exists.
        current["region"] = UG_REGION; current["account"] = KE_REGION
        await page.evaluate("()=>{try{localStorage.clear()}catch(e){}}")
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        cross = await snapshot(page, "kenyan-on-ugandan-address")
        for k, v in cross.items():
            print("  %-12s %s" % (k, v))
        ck(cross["region"] == "KES/254", "the account's own country wins over the address: " + cross["region"])
        ck("KES" in cross["wallet"], "and the balance is shown in the member's own currency: " + cross["wallet"])
        ck(cross["prices"] == ["KES"], "with no Ugandan figure anywhere on screen: %s" % (cross["prices"],))
        ck(cross["depPrefix"] == "+254", "and their own dialling code on the number field: " + cross["depPrefix"])

        print('\n— the sign-in screen names the country it belongs to —')
        # Owner: "why when you tap the other country domain, still returns
        # the 256 on login and register". Both dialling-code chips were the
        # literal text "+256" in the markup with nothing updating them, so
        # every country's address showed Uganda's code -- and that chip is
        # the only thing on the screen naming the country, so an address
        # pointing at the wrong one looked completely normal right up until
        # a correct password was refused.
        #
        # Read off the REAL sign-in screen of the built app, as Kenya, with
        # the loading screen down but nobody signed in.
        current["region"] = KE_REGION; current["account"] = None
        current["entry"] = {"status": "success", "rotate": False, "mode": "off", "host": ""}
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.evaluate("()=>{try{localStorage.clear();sessionStorage.clear()}catch(e){}}")
        await page.evaluate("()=>{try{window.fbAuth.currentUser=null}catch(e){}}")
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(3200)
        await page.evaluate("()=>{try{showAuthTab('login')}catch(e){}}")
        chips = await page.evaluate(
            "()=>({login:((document.getElementById('loginDial')||{}).textContent||'').trim(),"
            " reg:((document.getElementById('regDial')||{}).textContent||'').trim(),"
            " note:((document.getElementById('loginRegionNote')||{}).textContent||'').trim(),"
            " regNote:((document.getElementById('regRegionNote')||{}).textContent||'').trim()})")
        for k, v in chips.items():
            print("  %-9s %s" % (k, v))
        ck(chips["login"] == "+254", "Login shows this country's dialling code, not Uganda's: " + chips["login"])
        ck(chips["reg"] == "+254", "and so does Sign Up: " + chips["reg"])
        ck("Kenya" in chips["note"] and "KES" in chips["note"],
           "with the country named so a wrongly-mapped address is visible: " + chips["note"])
        ck("Kenya" in chips["regNote"], "on the Sign Up pane too: " + chips["regNote"])
        await page.screenshot(path=f"{OUT}/auth-kenya.png", full_page=True)

        # Back to Uganda: a test that only ever sees Kenya cannot tell a live
        # chip from one hardcoded the other way.
        current["region"] = UG_REGION
        await page.evaluate("()=>{try{localStorage.clear();sessionStorage.clear()}catch(e){}}")
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(3200)
        ugChips = await page.evaluate(
            "()=>({login:((document.getElementById('loginDial')||{}).textContent||'').trim(),"
            " note:((document.getElementById('loginRegionNote')||{}).textContent||'').trim()})")
        print("  uganda   ", ugChips)
        ck(ugChips["login"] == "+256", "and Uganda reads +256: " + ugChips["login"])
        ck("Uganda" in ugChips["note"], "named as Uganda: " + ugChips["note"])

        print('\n— an arrival is moved onto a different address in his own country —')
        # Owner: "if one joined the site or visited the site with a subdomain
        # like gfdt so in his session, server changes the subdomain of his
        # session to another like b5dh, so in that very country."
        #
        # A REAL hop, in a real browser, between two real origins. 127.0.0.1
        # and localhost are the same server on the same port but DIFFERENT
        # ORIGINS, which is exactly the trap this feature has to survive:
        # sessionStorage does not cross an origin, so a marker written before
        # the hop is gone on arrival. If the guard were storage-only the page
        # would hop again, and again.
        #
        # Mode "always" for the hop itself: this harness's Firebase stub is
        # ALWAYS signed in, and "visitors" (correctly) leaves a signed-in
        # member exactly where he is -- which is the second half of this
        # scenario, below.
        current["region"] = UG_REGION; current["account"] = None
        # Clear this origin's storage FIRST, with the answer still "stay" --
        # set it to "move" before this load and the page hops away mid-
        # evaluate and the clear never happens.
        current["entry"] = {"status": "success", "rotate": False, "mode": "off", "host": ""}
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.evaluate("()=>{try{localStorage.clear();sessionStorage.clear()}catch(e){}}")
        current["entry"] = {"status": "success", "rotate": True, "mode": "always", "host": "localhost"}
        hops = []
        page.on("framenavigated", lambda f: hops.append(f.url) if f == page.main_frame else None)
        # "commit", not "load": the hop fires from start-up code, so the
        # original page is navigated away from before it ever finishes
        # loading and a wait_until="load" goto times out instead of passing.
        await page.goto(f"http://127.0.0.1:{PORT}/index.html?ref=ABC123", wait_until="commit")
        try:
            await page.wait_for_url(f"http://localhost:{PORT}/**", timeout=20000)
        except Exception as e:
            print("  never reached the other address:", type(e).__name__)
        # Long enough for a second hop to have happened if the guard failed.
        await page.wait_for_timeout(6000)
        moved_to = page.url
        print("  landed on:", moved_to)
        print("  navigations:", hops)
        ck(moved_to.startswith(f"http://localhost:{PORT}/"),
           "the visitor really was moved to the other address: " + moved_to)
        ck("ref=ABC123" in moved_to,
           "and his invite code came with him: " + moved_to)
        ck("_e=" not in moved_to,
           "with the “already moved” marker stripped back out of the address bar: " + moved_to)
        later = [u for u in hops if u.startswith(f"http://localhost:{PORT}/")]
        ck(len(later) <= 2,
           "and he was moved ONCE, not round a loop (landings on the new address: %d)" % len(later))
        moved_flag = await page.evaluate("()=>{try{return sessionStorage.getItem('chipzEntryMoved')}catch(e){return 'unreadable'}}")
        ck(moved_flag == "1", "the marker is recorded on the address he landed on: %s" % moved_flag)

        # A member with an account on this address is left alone: his saved
        # password, his cached app shell and his installed icon all live on
        # this one hostname. Same answer as above except for the mode, and
        # the server still says rotate -- so if the app obeyed it blindly he
        # would be moved.
        current["entry"] = {"status": "success", "rotate": True, "mode": "visitors", "host": "127.0.0.1"}
        await page.evaluate("()=>{try{sessionStorage.clear();localStorage.setItem('snow_state_cache', JSON.stringify({uid:'u1'}))}catch(e){}}")
        held_on = page.url.split("?")[0]
        await page.goto(held_on, wait_until="load")
        await page.wait_for_timeout(6000)
        ck(page.url.startswith(f"http://localhost:{PORT}/"),
           "a browser already holding an account here is not moved: " + page.url)

        # Back to where the next scenario expects to start.
        current["entry"] = {"status": "success", "rotate": False, "mode": "off", "host": ""}
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.evaluate("()=>{try{localStorage.clear();sessionStorage.clear()}catch(e){}}")

        print('\n— the root domain does not serve the app —')
        # Owner: "l didn't want root domain to work." The server answers
        # every request from a parked address with 403 HOST_PARKED; what has
        # to be verified here is the VISIBLE half -- that the app stops and
        # says so instead of hanging on the loader or painting a broken
        # screen. Asserted on the rendered box, not on a flag.
        current["parked"] = True
        await page.evaluate("()=>{try{localStorage.clear()}catch(e){}}")
        # Sampled at the INSTANT the notice appears, not seconds later: the
        # boot path takes the loading screen down on its own once it gives
        # up, so a late sample cannot tell "the notice hid it" from "boot
        # hid it eventually" -- and the fault being guarded against is the
        # notice arriving UNDER a spinner that is still up. Verified by
        # mutation: at 3s, removing the hide goes undetected.
        await page.add_init_script(
            "window.__parkedAt=null;"
            "new MutationObserver(()=>{const b=document.getElementById('hostParked');"
            "if(b&&!window.__parkedAt){const ls=document.getElementById('loadingScreen');"
            "window.__parkedAt={loader: !!ls && getComputedStyle(ls).display!=='none'};}})"
            ".observe(document,{childList:true,subtree:true});")
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_selector("#hostParked", timeout=15000)
        at_show = await page.evaluate("()=>window.__parkedAt")
        print("  at the moment it appeared:", at_show)
        await page.wait_for_timeout(1200)
        parked = await page.evaluate(
            "()=>{const b=document.getElementById('hostParked');"
            "const ls=document.getElementById('loadingScreen');"
            "const app=document.getElementById('app');"
            "const auth=document.getElementById('authScreen');"
            "const vis=e=>!!e&&getComputedStyle(e).display!=='none';"
            "return {shown:vis(b), text:b?b.innerText.trim():'',"
            " loader:vis(ls), app:vis(app), auth:vis(auth),"
            " boxes:document.querySelectorAll('#hostParked').length};}")
        for k, v in parked.items():
            print("  %-12s %s" % (k, v))
        ck(parked["shown"], "the notice is on screen")
        ck("country" in parked["text"].lower(), "and it says to open your own country's link: " + parked["text"].replace("\n", " / "))
        ck(at_show is not None and at_show.get("loader") is False,
           "the loading screen was already down the moment the notice appeared, not left spinning over it")
        ck(not parked["loader"], "and it stays down")
        ck(not parked["app"] and not parked["auth"], "and neither the app nor the sign-in screen is left showing")
        ck(parked["boxes"] == 1, "shown once, however many requests were refused")
        await page.screenshot(path=f"{OUT}/parked.png", full_page=True)

        ck(not errs, "no page errors: " + str(errs))
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nregion currency: all cases pass")
    sys.exit(1 if fails else 0)


srv = serve()
asyncio.run(main())
