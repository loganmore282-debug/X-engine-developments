#!/usr/bin/env python3
"""The two new Settings cards, in the BUILT admin panel.

The admin source is obfuscated and deflated into admin/index.html, so
grepping the deployed file proves nothing -- the only way to know the cards
render and the buttons wire up is to run the built panel and look.

What matters here beyond "it appears": the panel has to STATE the two
resolutions, because the owner will size his artwork from what this screen
says and nowhere else, and it has to carry the two warnings that would
otherwise come back as bug reports (an installed phone keeps its old icon,
and WhatsApp keeps a preview it has already fetched).
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/admin-brand'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'admin')
PORT = 8871
API = 'https://chipz-server.onrender.com'

fails, errs = [], []
def ck(ok, l):
    print(("PASS  " if ok else "FAIL  ") + l)
    if not ok: fails.append(l)

R = {
  "/admin/check-key": {"status": "success", "token": "t", "username": "owner", "role": "owner"},
  "/admin/settings": {"status": "success", "settings": {}},
  "/admin/banner": {"status": "success", "image": None, "video": None, "videoVersion": None},
  "/admin/help-banner": {"status": "success", "image": None},
  "/admin/announcement-image": {"status": "success", "image": None},
  "/admin/about-content": {"status": "success", "blocks": []},
  "/admin/push/list": {"status": "success", "count": 0},
  "/admin/manual-numbers/list": {"status": "success", "numbers": []},
  "/admin/manual-pay-images": {"status": "success", "selector": None, "hero": None},
  "/admin/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
     "profilegif": None, "downloadbg": None, "authhero": None, "authcard": None},
  # Nothing uploaded yet: the icon falls back to the built-in one, which is
  # exactly the state where the panel must NOT claim a custom icon is set.
  "/admin/brand-assets": {"status": "success",
     "appIcon": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
     "appIconCustom": False, "linkPreview": None, "linkPreviewCustom": False,
     "sizes": {"appIcon": "512 × 512", "linkPreview": "1200 × 630"}},
}

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 900, "height": 1100}, service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        posted = []
        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            posted.append(path)
            body = next((v for k, v in R.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        await page.route(f"{API}/**", api)
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.fill('#keyInput', 'x')
        await page.click('#loginBtn')
        await page.wait_for_timeout(1200)
        await page.click('button[data-tab="settings"]')
        await page.wait_for_timeout(1500)

        ck('/admin/brand-assets' in posted, "the Settings tab fetches /admin/brand-assets")

        body = await page.inner_text('#content')
        ck('App icon' in body, "there is an App icon card")
        ck('Link preview' in body, "there is a Link preview card")

        # The resolutions have to be ON the screen -- this is where the owner
        # will read them from.
        ck('1024' in body and '512' in body, "the icon card states the size to upload (1024 / 512)")
        ck('corners are rounded for you' in body,
           "and says the corners get rounded, so a plain square is fine to upload")
        ck('1200' in body and '630' in body, "the preview card states 1200 × 630")

        # The two things that otherwise come back as bug reports.
        ck('keep the old icon' in body,
           "it warns that already-installed phones keep the old icon")
        ck('remember the old picture' in body,
           "and that WhatsApp/Facebook remember an already-shared preview")

        # Nothing uploaded: the panel must say so rather than implying the
        # built-in icon is his.
        ck('Built-in Chipz icon' in body, "an un-uploaded icon reads as the built-in one")
        ck(await page.locator('#appIconClear').count() == 0,
           "and offers no Remove button for an icon that was never uploaded")
        ck(await page.locator('#linkPreviewClear').count() == 0,
           "same for a preview that was never set")

        # The inputs exist and accept images.
        for id_ in ('appIconFile', 'linkPreviewFile'):
            el = page.locator('#' + id_)
            ck(await el.count() == 1, f"#{id_} exists")
            ck((await el.get_attribute('accept')) == 'image/*', f"#{id_} accepts images")

        # Screenshot the two cards for the record.
        box = page.locator('h2.sec', has_text='App icon')
        await box.scroll_into_view_if_needed()
        await page.wait_for_timeout(300)
        await page.screenshot(path=f"{OUT}/brand-cards.png")

        # Now the uploaded state: Remove must appear.
        R['/admin/brand-assets'] = dict(R['/admin/brand-assets'],
                                        appIconCustom=True, linkPreviewCustom=True,
                                        linkPreview=R['/admin/brand-assets']['appIcon'])
        await page.click('button[data-tab="dashboard"]')
        await page.wait_for_timeout(400)
        await page.click('button[data-tab="settings"]')
        await page.wait_for_timeout(1500)
        body2 = await page.inner_text('#content')
        ck('Custom icon' in body2, "an uploaded icon reads as Custom icon")
        ck(await page.locator('#appIconClear').count() == 1, "and gets a Remove button")
        ck(await page.locator('#linkPreviewClear').count() == 1, "so does the preview")

        # ── the Login / Sign Up backdrops ──
        # Two sections, each with its own opacity and blur -- the owner will
        # size and tune his artwork from what this screen says, so the fields
        # have to be here and the guidance has to be on them.
        print("\n— the Login & Sign Up backdrop section —")
        body3 = await page.inner_text('#content')
        ck('Login & Sign Up screen' in body3, "there is a Login & Sign Up section")
        ck('Top band' in body3 and 'form card' in body3.lower(),
           "naming both parts: the top band and the form card")
        ck('1200' in body3 and '900' in body3, "with a size for each (1200 wide, 900 wide)")
        # The card image sits behind the input boxes; a strong one makes the
        # form unreadable, which is the mistake worth warning about up front.
        ck('hard to read' in body3, "and a warning to keep the form-card image faint")
        for id_ in ('authHeroFile', 'authCardFile', 'authHeroOp', 'authHeroBlur',
                    'authCardOp', 'authCardBlur', 'saveAuthBg'):
            ck(await page.locator('#' + id_).count() == 1, "#%s exists" % id_)
        # Independent fields, not one shared pair.
        vals = await page.evaluate("""() => ({
            heroOp: authHeroOp.value, heroBlur: authHeroBlur.value,
            cardOp: authCardOp.value, cardBlur: authCardBlur.value,
            heroMax: authHeroOp.max, blurMax: authHeroBlur.max })""")
        print("   ", vals)
        ck(vals["heroOp"] == '100' and vals["cardOp"] == '100',
           "opacity defaults to 100%% so an upload shows as supplied (%s)" % vals)
        ck(vals["heroMax"] == '100' and vals["blurMax"] == '40',
           "with the same caps the server enforces (opacity 100, blur 40)")

        ck(not errs, "no page errors: %s" % errs[:3])
        await ctx.close(); await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nadmin brand panel: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
