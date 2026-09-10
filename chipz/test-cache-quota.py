#!/usr/bin/env python3
"""The instant-boot snapshot must survive twelve 1200x900 product photos.

saveCachedState() writes STATE (balance, plans, team, transactions, products,
settings) into localStorage so a returning member sees his real numbers with
no network wait. Product photos live inside STATE.products as data: URLs, and
at the 1200x900 frame the admin now stores them at, twelve of them is roughly
1.5-2 MB -- close enough to localStorage's ~5 MB quota that a phone with a
long transaction history can tip over it. The setItem is inside a try/catch,
so that failure is SILENT: the snapshot stops being written, every boot goes
back to a cold wait, and nothing on screen says why.

This drives the BUILT app: it fills localStorage until it is nearly full,
then asks saveCachedState() to store a catalog too big to fit, and checks a
usable snapshot still lands -- with the photos dropped rather than the whole
snapshot lost.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

ROOT = os.path.join(HERE, 'user')
PORT = 8841
API  = 'https://chipz-server.onrender.com'

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

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

async def main():
    fails, errs = [], []
    def ck(ok, l):
        print(("PASS  " if ok else "FAIL  ") + l)
        if not ok: fails.append(l)

    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.route(f"{API}/**", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"status": "success"}))))
        await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(2600)

        res = await page.evaluate("""async () => {
            const out = {};
            localStorage.clear();

            // Twelve product photos at roughly the size a 1200x900 JPEG
            // data URL comes to (~140 KB each).
            const blob = 'x'.repeat(140 * 1024);
            STATE.products = Array.from({length: 12}, (_, i) => ({
              key: 'product-' + (i + 1), name: 'Product-' + (i + 1),
              price: 30000 * (i + 1), cycle: 150, expectedReturn: 900000 * (i + 1),
              image: 'data:image/jpeg;base64,' + blob,
            }));
            STATE.account   = { walletBalance: 12345, phone: '0742730382', publicId: '10012' };
            STATE.settings  = { minDeposit: 30000, minWithdraw: 20000 };
            STATE.investments = []; STATE.teamStats = {}; STATE.bankAccounts = [];
            STATE.transactions = []; STATE.mission = {};

            out.catalogMB = +(JSON.stringify(STATE.products).length / 1048576).toFixed(2);

            // Fill the origin's quota until only a little room is left, so a
            // full-size snapshot cannot possibly fit -- exactly the phone
            // that used to lose its snapshot silently.
            const pad = 'y'.repeat(256 * 1024);
            let n = 0;
            try { for (; n < 200; n++) localStorage.setItem('__fill' + n, pad); }
            catch (e) { out.filledMB = +(n * 0.25).toFixed(2); }

            saveCachedState('u1');
            const raw = localStorage.getItem(CACHED_STATE_KEY);
            out.saved = !!raw;
            if (raw) {
              const p = JSON.parse(raw);
              out.snapKB      = +(raw.length / 1024).toFixed(0);
              out.uid         = p.uid;
              out.balance     = p.account && p.account.walletBalance;
              out.minDeposit  = p.settings && p.settings.minDeposit;
              out.productCount = (p.products || []).length;
              out.imagesKept  = (p.products || []).filter(x => x.image).length;
              out.restores    = !!(loadCachedState('u1'));
            }
            return out;
        }""")
        for k, v in res.items(): print("  %-14s %s" % (k, v))

        ck(res.get("saved"), "a snapshot is still written when the catalog will not fit")
        ck(res.get("productCount") == 12, "all 12 products are in it (got %s)" % res.get("productCount"))
        ck(res.get("imagesKept") == 0, "the photo bytes are what got dropped (kept %s)" % res.get("imagesKept"))
        ck(res.get("balance") == 12345, "the balance survived, so instant boot still paints real numbers")
        ck(res.get("minDeposit") == 30000, "settings survived, so the minimum hints are not 'UGX 0'")
        ck(res.get("restores"), "loadCachedState() reads it back for this uid")

        # And with room to spare, nothing is dropped.
        res2 = await page.evaluate("""() => {
            localStorage.clear();
            STATE.products = STATE.products.map(p => Object.assign({}, p, {
              image: 'data:image/jpeg;base64,' + 'x'.repeat(2 * 1024) }));
            saveCachedState('u1');
            const p = JSON.parse(localStorage.getItem(CACHED_STATE_KEY));
            return { kept: (p.products || []).filter(x => x.image).length };
        }""")
        ck(res2.get("kept") == 12, "with room to spare the photos are kept (%s of 12)" % res2.get("kept"))

        ck(not errs, "no page errors: " + str(errs))
        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\ncache quota: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
