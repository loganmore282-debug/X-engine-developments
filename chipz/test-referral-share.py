#!/usr/bin/env python3
"""The Referral share card, held to the owner's mockup by measurement.

Owner: "l want the copy SVG icon to be replaced by that image l made myself,
just like you see on the mock ups, also on copying, the other button should
say copied. l want the same size of card, box and button and icon exactly
that of mock ups rather than guess."

Every MOCK figure below was measured off his two screenshots (1080px wide, of
which 1068 is the phone's own content -- the last ~12px are the capture's
purple edge strip) and is compared as a FRACTION OF SCREEN WIDTH, the only
unit that survives not knowing the CSS width of his phone.

It asserts in BOTH directions, which is the point: three of these were
already correct (card width, field width, button) and a pass that "fixed"
them would be a regression. Only the tile, the field height and two gaps
were wrong.

The card HEIGHT is the useful independent check -- nothing sets it, it falls
out of the gaps and the field, so it landing on his 199.7 means the parts
above it are right rather than merely summing to the right total.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ref-measure'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8763
API = 'https://chipz-server.onrender.com'

# Measured off 045f54dd (before) / bd9e3c89 (after), content width 1068.
MOCK = {
    'card':        (965, 547),
    'card_inset':  52,
    'card_pad':    48,
    'field':       (869, 180),
    'tile':        (124, 114),
    'tile_inset':  37,
    'button':      (865, 127),
    'gap_label_field': 41,
    'gap_field_button': 48,
    'label_ink':   26,
}
CW = 1068.0

ROUTES = {
  "/public/settings": {"status": "success", "settings": {
      "commL1": 28, "commL2": 1, "commL3": 1, "brandName": "Chipz",
      "annEnabled": False}},
  "/account": {"status": "success", "account": {
      "userId": "u1", "phone": "0700000000", "referralCode": "TCL80",
      "walletBalance": 5000, "totalEarned": 0, "totalInvested": 0}},
  "/investments": {"status": "success", "investments": []},
  "/transactions": {"status": "success", "transactions": []},
  "/messages": {"status": "success", "messages": []},
  "/public/products": {"status": "success", "products": []},
  "/public/banner": {"status": "success", "image": None, "video": None},
}

FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
# Every export the module imports must exist, or the ESM import throws and the
# app never boots -- which measures as every box being 0x0 rather than as an
# obvious failure. Kept in step with test-nav-sheets.py's copy.
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
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, service_workers="block")
        page = await ctx.new_page()
        errs = []
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
        await page.evaluate("showPage('referral')")
        await page.wait_for_timeout(900)

        g = await page.evaluate("""()=>{
          const r=e=>{ if(!e) return null; const b=e.getBoundingClientRect();
            return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),
                    b:+b.bottom.toFixed(1),r:+b.right.toFixed(1)}; };
          const card=[...document.querySelectorAll('.app-card')].find(c=>c.textContent.includes('Share URL'));
          const label=card && card.firstElementChild;
          const field=card && card.querySelector('.url-row');
          const tile =card && card.querySelector('.copy-ic, .url-row button');
          const btn  =card && card.querySelector('.primary-button');
          const cs=e=>e?getComputedStyle(e):null;
          return {vw:innerWidth, card:r(card), label:r(label), field:r(field), tile:r(tile), btn:r(btn),
                  cardPad: card?cs(card).padding:null,
                  labelFont: label?cs(label).fontSize:null,
                  btnFont: btn?cs(btn).fontSize:null,
                  btnText: btn?btn.textContent.trim():null,
                  tileHtml: tile?tile.innerHTML.slice(0,60):null};
        }""")
        vw = g['vw']
        fails = []
        def ck(ok, label):
            print(("PASS  " if ok else "FAIL  ") + label)
            if not ok: fails.append(label)
        # 8% OR 2px, whichever is looser. A percentage alone is the wrong
        # yardstick for the small distances: the card padding is 1.5px off his
        # 17.5px, which is nothing to look at but 8.6% -- while every error
        # this round actually found is far outside both bars (icon tile 17.3px
        # / -38%, field height 17.7px / -27%, the gaps 5.0px and 3.5px). A
        # tolerance that flags a 1.5px difference on a JPEG-measured figure
        # trains you to ignore the test.
        TOL, TOL_PX = 0.08, 2.0
        def near(name, ours, mock_px, unit=""):
            want = mock_px / CW * vw
            d = ours - want
            off = d / want if want else 0
            ck(abs(off) <= TOL or abs(d) <= TOL_PX,
               "%s %.1f%s vs mockup %.1f (%+.0f%%, %+.1fpx)" % (name, ours, unit, want, 100 * off, d))
        print("viewport %dpx   (mockup content width %d)\n" % (vw, CW))
        c, f, t, btn = g['card'], g['field'], g['tile'], g['btn']
        ck(bool(c and f and t and btn), "the share card, field, icon tile and button all render")
        if not (c and f and t and btn):
            print("\n%d FAILED" % len(fails)); await b.close(); sys.exit(1)

        print("— already correct before this round; must not drift —")
        near("card width  ", c['w'], MOCK['card'][0])
        near("card inset  ", c['x'], MOCK['card_inset'])
        near("field width ", f['w'], MOCK['field'][0])
        near("button width", btn['w'], MOCK['button'][0])
        near("button height", btn['h'], MOCK['button'][1])
        near("card padding", f['x'] - c['x'], MOCK['card_pad'])
        near("tile inset  ", f['r'] - t['r'], MOCK['tile_inset'])

        print("\n— was wrong, measured off the mockup —")
        near("icon tile w ", t['w'], MOCK['tile'][0])   # was 28.0, mockup 45.3
        near("icon tile h ", t['h'], MOCK['tile'][1])   # was 28.0, mockup 41.6
        near("field height", f['h'], MOCK['field'][1])  # was 48.0, mockup 65.7
        near("label->field", f['y'] - g['label']['b'], MOCK['gap_label_field'])
        near("field->button", btn['y'] - f['b'], MOCK['gap_field_button'])

        print("\n— falls out of the above, so it checks them —")
        # Nothing sets the card's height; it is the sum of what is inside it.
        near("card height ", c['h'], MOCK['card'][1])

        print("\n— the owner's own artwork, and the labels —")
        ck('/copy-clip.png' in (g['tileHtml'] or ''),
           "the tile carries his clipboard image, not a drawn SVG (%r)" % g['tileHtml'])
        ck(g['btnText'] == 'Copy Invite Link',
           "the button reads 'Copy Invite Link' as the mockup does (%r)" % g['btnText'])
        # This used to require the URL to occupy TWO lines, because in his
        # mockup it did -- but only because the link was long
        # (".../#pages/register/?ref=CODE"). He then asked for the short form
        # ("let the link be '/refCode=' not other more words"), so a two-line
        # wrap is no longer reachable and requiring it would be pinning a
        # side effect of wording he has since replaced.
        #
        # What still matters is the field's own box: it is 66px in his mockup
        # (ours was 48), and the field must still be ABLE to wrap, because a
        # custom domain or a longer code can make the link long again. So the
        # height is asserted directly, and the wrap capability is asserted as
        # capability -- not as a wrap that happens to occur today.
        box = await page.evaluate("""()=>{const r=document.querySelector('.url-row');
          const s=r.querySelector('span'); const cs=getComputedStyle(s);
          return {h: r.getBoundingClientRect().height,
                  clamp: cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp'),
                  wrap: cs.overflowWrap || cs.wordWrap};}""")
        ck(box['h'] >= 60, "the field keeps its mockup height (%.1fpx, his is 66)" % box['h'])
        ck(str(box['clamp']).strip() in ('2', '2 '),
           "and still allows two lines for a longer link (clamp=%r)" % box['clamp'])
        ck('anywhere' in str(box['wrap']),
           "breaking mid-URL, since a link is one unbroken word (%r)" % box['wrap'])
        print("\n— what a copy actually shows —")
        # Owner: "on copying, the other button should say copied." Driven, not
        # grepped: the obfuscator encodes every string literal, so "Copied" is
        # not present as text at any layer of the built file and a search would
        # pass whether the label were right, wrong or missing.
        await ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        await page.click('.app-card .primary-button')
        await page.wait_for_timeout(250)
        st = await page.evaluate(
            "()=>{const b=document.querySelector('.app-card .primary-button');"
            "return {text:b.textContent.trim(), copied:b.classList.contains('copied')};}")
        ck(st['text'] == 'Copied', "the labelled button says 'Copied' after a copy (%r)" % st['text'])

        # It must also go BACK. A button stuck on "Copied" reads as a button
        # that has stopped working the next time someone wants to share.
        await page.wait_for_timeout(2200)
        st = await page.evaluate(
            "()=>document.querySelector('.app-card .primary-button').textContent.trim()")
        ck(st == 'Copy Invite Link', "and returns to 'Copy Invite Link' afterwards (%r)" % st)

        # The tile swaps his clipboard art for a tick, then swaps it BACK --
        # flashCopied() restores innerHTML, so a broken restore would leave the
        # tile permanently ticked and his artwork gone for the session.
        await page.click('.copy-ic')
        await page.wait_for_timeout(250)
        st = await page.evaluate("()=>{const b=document.querySelector('.copy-ic');"
            "return {svg:b.innerHTML.includes('<svg'), copied:b.classList.contains('copied')};}")
        ck(st['svg'] and st['copied'], "the icon tile shows a tick after a copy (%r)" % st)
        await page.wait_for_timeout(2200)
        st = await page.evaluate("()=>document.querySelector('.copy-ic').innerHTML")
        ck('/copy-clip.png' in st, "and his artwork comes back afterwards (%r)" % st[:50])

        print("\n— BOTH controls acknowledge, whichever was tapped —")
        # Owner: "why when l copy link with the other icon and shows tick, the
        # button which says copy invite link doesn't show copied, yet l wanted
        # it to say it in all cases whether clicking copy icon or button."
        pair = ("()=>({btn:document.querySelector('.app-card .primary-button').textContent.trim(),"
                " tick:document.querySelector('.copy-ic').innerHTML.includes('<svg')})")
        for tapped, sel in (("icon tile", '.copy-ic'), ("labelled button", '.app-card .primary-button')):
            await page.click(sel)
            await page.wait_for_timeout(250)
            st = await page.evaluate(pair)
            ck(st['btn'] == 'Copied' and st['tick'],
               "tapping the %s puts BOTH in their copied state (%r)" % (tapped, st))
            await page.wait_for_timeout(2200)
            st = await page.evaluate(pair)
            ck(st['btn'] == 'Copy Invite Link' and not st['tick'],
               "...and both return afterwards (%r)" % st)

        # The grouping must NOT be "flash whatever is nearby". copyText() is
        # shared with the manual-pay screen, whose two copy buttons sit in one
        # container and copy DIFFERENT things (account number, account name) --
        # ticking both there would tell the member they copied a name they
        # did not. Proven on the real markup, not by reading the selector.
        groups = await page.evaluate("""()=>{
          const out={};
          document.querySelectorAll('[data-copy-group]').forEach(e=>{
            const g=e.getAttribute('data-copy-group'); (out[g]=out[g]||[]).push(e.className);});
          return out;}""")
        ck(list(groups.keys()) == ['ref'] and len(groups.get('ref', [])) == 2,
           "exactly the two referral controls share a copy group (%r)" % groups)

        await page.screenshot(path=f"{OUT}/referral.png")
        print("\nscreenshot -> %s/referral.png" % OUT)
        ck(not errs, "no page errors: %s" % errs)
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nreferral share card: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
srv.shutdown()
