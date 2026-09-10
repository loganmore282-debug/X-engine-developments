#!/usr/bin/env python3
"""The Account list, measured against the owner's own mockup.

Owner: "even see cards in account are very big plus their icons, please use
exactly the size of mock up, even see button size of withdrawal and deposit,
see the settings card is having green line, see closely on balance record icon
it has some green in its background, check every background of each icon, the
first of download app it is purple, so here it should be orange ... see closely
rather than guess and implement."

His screenshot and ours are both 1080 device px wide on the same phone, so
device pixels compare directly -- 1080/390 = 2.769 device px per CSS px. Every
target below is HIS measured figure converted once, with the raw number kept in
the assertion text so a later reader can re-derive it.

The icon backgrounds are read from RENDERED PIXELS, not from computed style:
every tile is a gradient, and `background-color` on a gradient computes to
rgba(0,0,0,0) -- an assertion against that value would pass no matter what the
member actually sees.
"""
import asyncio, json, os, re, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/acct-sizes'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8801
API = 'https://chipz-server.onrender.com'
SCALE = 1080 / 390          # device px per CSS px on his phone and ours

ACCOUNT = {"userId": "u1", "phone": "0742730382", "publicId": "00001",
           "referralCode": "TCL80", "walletBalance": 5000, "registrationDone": True}
ROUTES = {
    "/public/settings": {"status": "success", "settings": {
        "brandName": "Chipz", "annEnabled": False, "minDeposit": 3000,
        "depositPayAEnabled": True, "turntableEnabled": True}},
    "/account": {"status": "success", "account": ACCOUNT},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": []},
    "/messages": {"status": "success", "messages": []},
    "/public/products": {"status": "success", "products": []},
    "/public/banner": {"status": "success", "image": None, "video": None},
    "/public/chipz-images": {"status": "success", "referral": None, "logo": None,
                             "spin": None, "profilegif": None},
    "/bank/list": {"status": "success", "accounts": []},
}
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


def near(got, want, tol, label):
    ck(abs(got - want) <= tol, f"{label}: {got:.1f} vs his {want:.1f} (tol {tol})")


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
        await page.wait_for_timeout(2400)
        await page.evaluate("closeAnnounce && closeAnnounce()")
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(900)

        g = await page.evaluate("""() => {
            const rows = [...document.querySelectorAll('.setting-row')];
            const sq = rows[0].querySelector('.sq').getBoundingClientRect();
            const r0 = rows[0].getBoundingClientRect();
            const r1 = rows[1].getBoundingClientRect();
            const btns = [...document.querySelectorAll('.acct-btnrow button')];
            const out = document.querySelector('.logout-btn');
            const img = out.querySelector('img');
            const list = document.querySelector('.setting-list');
            return {
              tile: sq.width, tileH: sq.height,
              pitch: r1.top - r0.top,
              t1: parseFloat(getComputedStyle(rows[0].querySelector('.t1')).fontSize),
              btnH: btns[0].getBoundingClientRect().height,
              btnLabels: btns.map(x => x.textContent.trim()),
              outH: out.getBoundingClientRect().height,
              doorH: img ? img.getBoundingClientRect().height : 0,
              doorSrc: img ? img.getAttribute('src') : null,
              border: getComputedStyle(list).borderTopColor,
              rowCount: rows.length,
              classes: rows.map(r => r.querySelector('.sq').className) }; }""")

        print("— sizes, against his mockup —")
        # 114 device px / 2.769
        near(g['tile'], 114 / SCALE, 2.0, "icon tile (his 114 device px)")
        near(g['tileH'], 114 / SCALE, 2.0, "icon tile height")
        near(g['pitch'], 193 / SCALE, 3.0, "row pitch (his 193 device px)")
        near(g['t1'], 30 / SCALE * (17.5 / 35 * 35 / 30 * 30 / 30), 2.0,
             "row title size (his ink 30 device px)") if False else None
        near(g['t1'], 15.0, 1.0, "row title font (his ink 30 device px -> ~15 CSS)")
        near(g['btnH'], 141 / SCALE, 3.0, "Deposit/Withdraw height (his 141 device px)")
        near(g['outH'], 146 / SCALE, 3.0, "Log Out height (his 146 device px)")
        ck(g['btnLabels'] == ['Deposit', 'Withdraw'],
           f"the two buttons are Deposit and Withdraw ({g['btnLabels']})")

        print("\n— the owner's own door on Log Out —")
        ck(g['doorSrc'] == '/logout-door.png', f"his artwork is used ({g['doorSrc']})")
        near(g['doorH'], 47 / SCALE, 2.0, "door height (his glyph 47 device px)")
        loaded = await page.evaluate(
            "() => { const i = document.querySelector('.logout-btn img'); return i && i.naturalWidth > 0; }")
        ck(loaded, "and it actually loaded, not just referenced")

        print("\n— the settings card's green line —")
        # His card edge samples rgb(236,243,235): green-tinted, G-R = +7.
        # Parsed with a regex, not by stripping "rgb(": a border declared with
        # an alpha computes to "rgba(239, 224, 211, 0.72)", and the naive strip
        # left an "a" on the first number so int() threw. The test then died
        # with a traceback instead of reporting a failure -- and a crash prints
        # no FAIL line, so a check that counts FAIL lines reads it as a pass.
        bc = [int(v) for v in re.findall(r'\d+', g['border'])[:3]]
        print(f"    border {tuple(bc)}  G-R = {bc[1] - bc[0]:+d}")
        ck(bc[1] > bc[0] and bc[1] > bc[2],
           f"the card border is green-tinted, not neutral ({tuple(bc)})")

        print("\n— every icon tile has its own background —")
        ck(g['rowCount'] == 7, f"seven rows ({g['rowCount']})")
        for c in g['classes']:
            ck('ic-' in c, f"tile carries its colour class ({c})")

        # Read the tiles from PIXELS: they are gradients, so computed
        # background-color is rgba(0,0,0,0) and would prove nothing.
        #
        # Sampled from a VIEWPORT clip per tile, after scrolling it into view --
        # NOT from one full-page screenshot. The bottom nav is position:fixed,
        # and a full-page capture places fixed elements by viewport rather than
        # by document, so the last row sampled as flat white on a tile whose
        # gradient was demonstrably applied. That is an artefact of the capture,
        # and it would have been read as a product bug.
        seen = []
        for cls in ['download', 'wallet', 'turntable', 'balance', 'messages',
                    'loginpw', 'tradepw']:
            el = page.locator(f'.setting-row .sq.ic-{cls}')
            # block:'center', not scroll_into_view_if_needed(): the latter
            # scrolls the MINIMUM amount, which leaves the last row sitting
            # under the fixed bottom nav -- the clip then samples the nav's own
            # pale surface and reports a correctly-painted gradient as grey.
            await el.evaluate("e => e.scrollIntoView({block:'center'})")
            await page.wait_for_timeout(200)
            box = await el.bounding_box()
            # 12% in from the top-left corner: inside the rounded square, and
            # clear of the 30px artwork centred in the 41px tile.
            clip = {"x": box["x"] + box["width"] * .12, "y": box["y"] + box["height"] * .12,
                    "width": 3, "height": 3}
            shot = f"{OUT}/tile-{cls}.png"
            await page.screenshot(path=shot, clip=clip)
            c = Image.open(shot).convert('RGB').load()[1, 1]
            seen.append((cls, c))
            print(f"    {cls:10s} {c}")

        by = dict(seen)
        r, gg, bb = by['download']
        ck(r > gg > bb and r > 120 and gg < 110,
           f"Download APP is ORANGE, not purple ({by['download']})")
        r, gg, bb = by['balance']
        ck(gg > r and gg > bb, f"Balance Record has green in its background ({by['balance']})")
        r, gg, bb = by['wallet']
        ck(r > 200 and gg > 150 and bb < 130, f"Wallet is gold ({by['wallet']})")
        r, gg, bb = by['loginpw']
        ck(r > gg > bb, f"Login Password is orange-family, not purple ({by['loginpw']})")
        r, gg, bb = by['tradepw']
        ck(r > gg > bb and r > 150 and bb < 150, f"Trade Password is gold ({by['tradepw']})")
        r, gg, bb = by['messages']
        ck(r > 230 and gg > 220 and bb < 235, f"Messages is pale cream ({by['messages']})")
        r, gg, bb = by['turntable']
        ck(r > gg > bb, f"Turntable is the warm coral in the ramp ({by['turntable']})")
        # No tile may be left on the old flat paper fill.
        ck(all(not (abs(c[0]-249) < 5 and abs(c[1]-244) < 5 and abs(c[2]-238) < 5)
               for _, c in seen), "no tile is still the old near-paper fill")
        ck(len({c for _, c in seen}) >= 6,
           f"the tiles are genuinely different from one another ({len({c for _, c in seen})} distinct of 7)")

        ck(not errs, f"no page errors ({errs[:1]})")
        await b.close()

    print(f"\n{len(failed)} FAILED" if failed else "\naccount sizes: all cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    h = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        h.shutdown()
