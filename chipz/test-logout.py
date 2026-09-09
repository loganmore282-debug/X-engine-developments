#!/usr/bin/env python3
"""Logging out stays logged out.

Owner: "why is it that when l try to log out the app logs in automatically
again because the cached credentials autofills hence triggering auto login yet
l don't want to use that very account."

There are TWO auto-login routes and doLogout() only disarmed one:

  1. Credential Management silent sign-in -- already handled by
     navigator.credentials.preventSilentAccess().
  2. The autofill auto-submit. Chrome refills the saved phone/password on the
     login screen, that fires the onAutoFillStart animation, and the listener
     calls doLogin(). doLogout() set `_autofillLoginTried = false`, which
     RE-ARMED that listener for precisely the moment Chrome was about to
     refill -- so the logout made the bug more likely, not less.

Route 2 is what this drives, by dispatching the same animationstart event
Chrome's own fill produces. A test that only checked "does doLogout call
signOut" would pass against the broken app: it did sign out, and was then
signed straight back in.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/logout'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8771
API = 'https://chipz-server.onrender.com'

ROUTES = {
  "/public/settings": {"status": "success", "settings": {"brandName": "Chipz", "annEnabled": False}},
  "/account": {"status": "success", "account": {"userId": "u1", "phone": "0742730382",
      "publicId": "00001", "referralCode": "TCL80", "walletBalance": 5000,
      "registrationDone": True}},
  "/investments": {"status": "success", "investments": []},
  "/transactions": {"status": "success", "transactions": []},
  "/messages": {"status": "success", "messages": []},
  "/public/products": {"status": "success", "products": []},
  "/public/banner": {"status": "success", "image": None, "video": None},
}
FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
# A stub that models the real thing: signOut() flips the current user to null
# and notifies, and signIn() flips it back -- so an unwanted auto-login is
# observable here exactly as it is on the phone.
FB_AUTH = """
 const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};
 let cur=user; const subs=[];
 window.__signInCalls=0;
 export const getAuth=()=>({currentUser:cur});
 export const createUserWithEmailAndPassword=async()=>({user});
 export const signInWithEmailAndPassword=async()=>{
   window.__signInCalls++; cur=user; subs.forEach(cb=>cb(cur)); return {user};};
 export const signOut=async()=>{ cur=null; subs.forEach(cb=>cb(null)); };
 export const updatePassword=async()=>{};
 export const reauthenticateWithCredential=async()=>{};
 export const EmailAuthProvider={credential:()=>({})};
 export const onAuthStateChanged=(a,cb)=>{subs.push(cb);setTimeout(()=>cb(cur),0);};
"""

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

async def main():
    fails, errs = [], []
    def ck(ok, label):
        print(("PASS  " if ok else "FAIL  ") + label)
        if not ok: fails.append(label)
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
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
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce && closeAnnounce()")

        # The auth screen is toggled with an inline display style, not a
        # class -- the first version of this checked a class that does not
        # exist, so it read "signed out" while the app was plainly signed in.
        on_auth = ("()=>getComputedStyle(document.getElementById('authScreen'))"
                   ".display !== 'none'")
        ck(not await page.evaluate(on_auth), "signed in to begin with")

        # The member's own account id, five digits now.
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(700)
        txt = await page.inner_text('#pageHost')
        ck('ID: 00001' in txt, "the account screen shows the 5-digit id (%r)"
           % next((l for l in txt.splitlines() if l.strip().startswith('ID')), None))

        await page.evaluate("doLogout()")
        await page.wait_for_timeout(700)
        ck(await page.evaluate(on_auth), "doLogout() lands on the sign-in screen")
        ck(await page.evaluate("()=>window.__signInCalls") == 0,
           "and no sign-in has been attempted yet")

        # Now the thing that actually broke it: Chrome refills the saved
        # credentials and fires its autofill animation on both fields.
        before = await page.evaluate("()=>window.__signInCalls")
        await page.evaluate("""()=>{
          const p=document.getElementById('loginPhone'), w=document.getElementById('loginPassword');
          p.value='0742730382'; w.value='hunter2';
          for (const el of [p,w])
            el.dispatchEvent(new AnimationEvent('animationstart',
              {animationName:'onAutoFillStart', bubbles:true}));
        }""")
        await page.wait_for_timeout(900)
        after = await page.evaluate("()=>window.__signInCalls")
        ck(after == before,
           "autofill after a logout does NOT sign back in (%d sign-in call(s))" % (after - before))
        ck(await page.evaluate(on_auth),
           "and the member is still on the sign-in screen, free to use another account")

        # The member must still be able to log in deliberately.
        await page.evaluate("doLogin()")
        await page.wait_for_timeout(900)
        ck(await page.evaluate("()=>window.__signInCalls") > before,
           "tapping Log In still works -- the block is on AUTO-submit only")

        ck(not errs, "no page errors: %s" % errs)
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nlogout: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
