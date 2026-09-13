#!/usr/bin/env python3
"""The team member avatar, and the doubled "Joined".

Owner, on a screenshot of one member row: "why the logo is empty?"

Because it was. Team.dc.html draws these avatars as bare gradient discs and
that is what got built -- a div with a background and nothing inside it. Every
member is deliberately anonymous on this screen (the name is the literal
"User", the phone is masked), so there is no per-person picture to show and an
empty disc just reads as an image that failed.

The same screenshot also shows "Joined Joined 1 day ago", which he did not
mention: timeAgo() already returns its own "Joined" prefix and the template
added another.

Both are read off the rendered page rather than the source -- the mark is
built by a function whose name the obfuscator removes, and the point is what
lands in the row.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/team-avatar'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8813
API = 'https://chipz-server.onrender.com'

# An 8x8 solid GREEN PNG as the "uploaded" Brand logo: nothing like the disc's
# own warm gradient, so a sampled pixel says which of the two is on screen.
#
# Generated rather than hand-written, and checked. The first version of this
# fixture was a hand-rolled base64 string that is not a valid PNG at all --
# PIL refuses it outright -- and the test still reported the image as loaded,
# because a DOM check on naturalWidth is not a check on what got painted. The
# disc rendered as the bare gradient and every assertion passed.
LOGO = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAF'
        'UlEQVR42mMUWODBgA0wMeAAg1MCAMagAQjZvtLwAAAAAElFTkSuQmCC')
LOGO_RGB = (16, 160, 72)

# Anchored to the REAL clock, not a fixed epoch. A hardcoded one drifts: the
# first version pinned NOW to a constant and the browser, running today, read
# its "1 day ago" row as four days old.
import time
DAY = 86400
NOW = int(time.time())

ACCOUNT = {"userId": "u1", "phone": "0742730382", "publicId": "00001",
           "referralCode": "TCL80", "walletBalance": 5000, "registrationDone": True}
MEMBERS = [
    {"phone": "256701014", "invested": 0, "createdAt": (NOW - DAY) * 1000},
    {"phone": "256702025", "invested": 30000, "createdAt": (NOW - 9 * DAY) * 1000},
    {"phone": "256703036", "invested": 0, "createdAt": None},   # no timestamp at all
]

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


def routes(logo):
    return {
        "/public/settings": {"status": "success", "settings": {
            "brandName": "Chipz", "annEnabled": False, "minDeposit": 3000,
            "depositPayAEnabled": True, "commL1": 28, "commL2": 1, "commL3": 1}},
        "/account": {"status": "success", "account": ACCOUNT},
        "/investments": {"status": "success", "investments": []},
        "/transactions": {"status": "success", "transactions": []},
        "/messages": {"status": "success", "messages": []},
        "/public/products": {"status": "success", "products": [
            {"key": "p1", "name": "Product-1", "price": 30000, "cycle": 150,
             "expectedReturn": 90000}]},
        "/public/banner": {"status": "success", "image": None, "video": None},
        "/public/chipz-images": {"status": "success", "referral": None, "logo": logo,
                                 "spin": None, "profilegif": None},
        "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
        "/bank/list": {"status": "success", "accounts": []},
        "/team/stats": {"status": "success", "referralCode": "TCL80",
                        "commRates": {"l1": 28, "l2": 1, "l3": 1},
                        "team": {"l1": 3, "l2": 0, "l3": 0}, "totalTeam": 3,
                        "teamCommission": 12000, "teamDeposits": 28000, "milestones": []},
        "/team/members": {"status": "success", "members": MEMBERS},
    }


async def open_team(ctx, logo):
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    table = routes(logo)

    async def api(r):
        path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
        body = next((v for k, v in table.items() if path.endswith(k)), {"status": "success"})
        await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

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
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.wait_for_timeout(2400)
    await page.evaluate("window.closeAnnounce && closeAnnounce()")
    await page.evaluate("showPage('team')")
    await page.wait_for_timeout(1600)
    return page, errs


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 900},
                                  service_workers="block")

        print("— with nothing uploaded, the disc carries the wordmark —")
        page, errs = await open_team(ctx, None)
        rows = await page.evaluate(
            "document.querySelectorAll('.team-member').length")
        ck(rows == 3, f"the three members render ({rows})")
        av = await page.evaluate("""() => {
            const a = document.querySelector('.team-member .avatar');
            if (!a) return null;
            const s = a.querySelector('span'), r = a.getBoundingClientRect();
            return { empty: !a.children.length,
                     text: a.textContent.trim(),
                     fs: s ? parseFloat(getComputedStyle(s).fontSize) : 0,
                     color: s ? getComputedStyle(s).color : '',
                     w: r.width, h: r.height,
                     sw: s ? s.getBoundingClientRect().width : 0 }; }""")
        ck(bool(av) and not av['empty'], "the disc is no longer empty")
        ck(bool(av) and av['text'] == 'CHIPZ', f"it carries the brand wordmark ({av and av['text']!r})")
        ck(bool(av) and av['color'].startswith('rgb(255, 255, 255'),
           f"in white, readable on the gradient ({av and av['color']})")
        # Sized for a 44px circle, not the profile card's 68px one.
        ck(bool(av) and 9 <= av['fs'] <= 14, f"sized for this disc, not the bigger one ({av and av['fs']}px)")
        ck(bool(av) and av['sw'] <= av['w'] - 2,
           f"and it FITS inside the circle ({av and round(av['sw'])}px of {av and round(av['w'])}px)")

        print("\n— the join line says Joined exactly once —")
        joined = await page.evaluate(
            "[...document.querySelectorAll('.team-member .joined')].map(e=>e.textContent.trim())")
        for t in joined:
            ck(t.lower().count('joined') == 1, f"{t!r}")
        ck(any('1 day ago' in t for t in joined), f"and still says how long ago {joined}")
        ck(all(t and t != '—' for t in joined),
           f"a member with no timestamp still reads as a sentence {joined}")
        await page.screenshot(path=os.path.join(OUT, 'team-wordmark.png'), full_page=False)
        ck(not errs, f"no page errors ({errs[:1]})")
        await page.close()

        print("\n— an uploaded Brand logo takes over, same as the profile card —")
        page, errs = await open_team(ctx, LOGO)
        got = await page.evaluate("""() => {
            const a = document.querySelector('.team-member .avatar');
            const img = a && a.querySelector('img');
            if (!img) return { img: false };
            const r = img.getBoundingClientRect(), ar = a.getBoundingClientRect();
            return { img: true, loaded: img.naturalWidth > 0,
                     fit: getComputedStyle(img).objectFit,
                     fills: Math.abs(r.width - ar.width) < 1.5 && Math.abs(r.height - ar.height) < 1.5,
                     clipped: getComputedStyle(a).overflow }; }""")
        ck(got['img'], "the uploaded logo is used instead of the wordmark")
        ck(got.get('loaded'), "and it really loaded")
        ck(got.get('fills'), "filling the disc rather than sitting in a corner")
        ck(got.get('fit') == 'cover', f"cover, so a square upload is not letterboxed ({got.get('fit')})")
        ck(got.get('clipped') == 'hidden', f"clipped to the circle ({got.get('clipped')})")

        # The assertion that actually matters: the PIXELS at the centre of the
        # disc are the logo's, not the gradient's. Everything above is DOM
        # state, and DOM state said the image was fine while the disc rendered
        # as a bare gradient -- see the note on LOGO.
        el = await page.query_selector('.team-member .avatar')
        shot = await el.screenshot(path=os.path.join(OUT, 'avatar-logo.png'))
        from PIL import Image
        import io as _io
        disc = Image.open(_io.BytesIO(shot)).convert('RGB')
        mid = disc.getpixel((disc.width // 2, disc.height // 2))
        near = all(abs(a - b) <= 26 for a, b in zip(mid, LOGO_RGB))
        ck(near, f"and the middle of the disc is the logo's own green {mid} vs {LOGO_RGB}")
        await page.screenshot(path=os.path.join(OUT, 'team-logo.png'), full_page=False)
        ck(not errs, f"no page errors with a logo set ({errs[:1]})")
        await page.close()

        print("\n— the Account profile card is untouched at its own size —")
        page, errs = await open_team(ctx, None)
        await page.evaluate("showPage('account')")
        await page.wait_for_timeout(1200)
        acct = await page.evaluate("""() => {
            const s = document.querySelector('.acct-logo span');
            return s ? parseFloat(getComputedStyle(s).fontSize) : 0; }""")
        ck(acct == 19, f"still the 19px wordmark it always was ({acct}px)")
        ck(not errs, f"no page errors on Account ({errs[:1]})")
        await page.close()

        await b.close()

    print(f"\n{len(failed)} FAILED" if failed else "\nteam member avatar: all cases pass")
    return 1 if failed else 0


if __name__ == "__main__":
    s = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        s.shutdown()
