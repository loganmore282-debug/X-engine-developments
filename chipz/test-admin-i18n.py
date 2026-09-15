#!/usr/bin/env python3
"""The language picker, in the BUILT admin panel.

Owner: "also make when in admin, you can change its language too, everything
there."

Why this cannot be a source check: build-admin.js obfuscates the panel and
encodes every string literal, so "Dashibodi" is not present as text at any
layer of admin/index.html. The only way to know the panel translates is to
run it and read the screen.

Six things are proved here, and each one is a separate way this could ship
looking fine and be broken:

  1. The sign-in screen translates BEFORE anyone has signed in. An operator
     who does not read English must be able to change the language on the one
     screen standing between them and the panel.
  2. The tabs and the dashboard translate after sign-in.
  3. A tab opened AFTER the switch translates too. That is the MutationObserver
     path, and it is the whole of "everything there" -- the panel paints every
     screen by assigning to innerHTML, so a one-off pass over the document
     would translate the open tab and nothing else ever again.
  4. Switching back to English restores the panel word for word, from each
     node's stored original rather than from the translation on screen.
  5. The choice survives a reload.
  6. Money, account ids and the picker's own option labels are NOT translated.

Run:  python3 test-admin-i18n.py [outdir]
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from playwright.async_api import async_playwright
from find_admin_fixtures import R, API          # noqa: E402  (shared fixtures)

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/admin-i18n'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'admin')
# 8903: the running list of every harness's port is in CLAUDE.md, Round 157.
PORT = 8903

fails, errs = [], []


def ck(ok, label):
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        fails.append(label)


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


async def main():
    srv = serve()
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
            ctx = await b.new_context(viewport={"width": 1100, "height": 1000},
                                      service_workers="block")
            page = await ctx.new_page()
            page.on("pageerror", lambda e: errs.append(str(e)))

            async def api(r):
                path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
                body = next((v for k, v in R.items() if path.endswith(k)),
                            {"status": "success"})
                await r.fulfill(status=200, content_type="application/json",
                                body=json.dumps(body))
            await page.route(f"{API}/**", api)

            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await page.wait_for_timeout(700)

            # ── 1. the sign-in screen, before anyone is signed in ──────────
            login_en = await page.inner_text('#loginView')
            ck('Sign in' in login_en, "the sign-in card reads English to start with")
            ck(await page.is_visible('#langLogin'),
               "and the language picker is on it, reachable without signing in")

            opts = await page.eval_on_selector_all(
                '#langLogin option', "els => els.map(e => e.textContent.trim())")
            ck(opts == ['English', 'Luganda', 'Kiswahili', 'Français',
                        'Ikinyarwanda', 'Runyankore'],
               f"it offers every language by its own native name ({opts})")

            await page.select_option('#langLogin', 'sw')
            await page.wait_for_timeout(500)
            login_sw = await page.inner_text('#loginView')
            ck('Ingia' in login_sw, "picking Kiswahili rewrites the sign-in card")
            ck('Sign in' not in login_sw, "and leaves no English button on it")
            ph = await page.get_attribute('#keyInput', 'placeholder')
            ck('Ufunguo' in (ph or ''), f"the password field's placeholder too ({ph})")
            # The picker must not translate its own options: a list of
            # languages that changes language as you change language is
            # unusable, and "Kiswahili" is the same word everywhere.
            opts_sw = await page.eval_on_selector_all(
                '#langLogin option', "els => els.map(e => e.textContent.trim())")
            ck(opts_sw == opts, "the picker's own options stay in their native names")

            # ── 2. the shell ───────────────────────────────────────────────
            await page.fill('#keyInput', 'x')
            await page.click('#loginBtn')
            await page.wait_for_timeout(1800)
            tabs = await page.inner_text('#tabs')
            ck('Dashibodi' in tabs and 'Watumiaji' in tabs,
               "the tab bar is in Kiswahili after signing in")
            ck('Dashboard' not in tabs and 'Users' not in tabs,
               "with no English tab left")
            dash = await page.inner_text('#content')
            ck('Jumla ya watumiaji' in dash, "and so is the dashboard")
            # "Products" and "Messages" have NO row in the panel's own table --
            # they were never findings, because the member app's table already
            # carries them. So these two words are proof the SHARED table was
            # lifted into the bundle at build time, and the only assertion here
            # that a no-op injection would fail.
            ck('Bidhaa' in tabs and 'Ujumbe' in tabs,
               "words that only the app's shared table carries are translated too")
            ck(await page.is_visible('#langSwitch'),
               "the topbar carries the picker on every screen")
            sel = await page.eval_on_selector('#langSwitch', 'e => e.value')
            ck(sel == 'sw', f"and it shows the language in force ({sel})")

            # ── 6a. what must NOT be translated ────────────────────────────
            ck('UGX' in dash, "money keeps its currency label")
            ck('128,500' in dash.replace('\u00a0', ' '),
               "and its figures are untouched")

            # ── 3. a tab opened AFTER the switch ───────────────────────────
            # This is the observer, and it is the difference between the open
            # screen being translated and the panel being translated.
            await page.click('button[data-tab="withdrawals"]')
            await page.wait_for_timeout(1600)
            # The table headings carry text-transform:uppercase, so inner_text
            # returns "STATUS", not "Status" -- matched case-insensitively
            # here because the first version of this assertion looked for
            # "Status", never found it in EITHER language, and so reported a
            # working panel as broken while its companion ("no English
            # heading") passed having measured nothing at all.
            wit = (await page.inner_text('#content')).lower()
            head = (await page.inner_text('#content thead')).lower()
            ck('utoaji' in wit and 'hali' in head,
               "a tab rendered after the switch comes out translated")
            # Scoped to the table HEAD on purpose: "destination" also appears
            # inside the manual-payments help paragraph, which is one of the
            # sentences inline markup breaks into fragments and which
            # therefore stays English -- a whole-tab match would fail on that
            # rather than on a heading.
            ck('status' not in head and 'destination' not in head,
               "with no English column heading left")
            # A sub-tab label carries its own count, so no ROW can ever match
            # one -- these come from the panel's {0}-templates, and the figure
            # has to survive the translation untouched.
            subs = (await page.inner_text('#content .subtabs')).lower()
            ck('yanayosubiri (1)' in subs and 'zote (3)' in subs,
               f"and its counted sub-tab labels come through the templates ({subs[:60]!r})")
            ck('pending' not in subs and 'all (' not in subs,
               "with no English filter label left")

            # ── 4. back to English, word for word ─────────────────────────
            await page.select_option('#langSwitch', 'en')
            await page.wait_for_timeout(600)
            tabs_en = await page.inner_text('#tabs')
            ck('Dashboard' in tabs_en and 'Users' in tabs_en,
               "switching back to English restores the tab bar")
            ck('Dashibodi' not in tabs_en, "and leaves no Kiswahili behind")
            head_en = (await page.inner_text('#content thead')).lower()
            ck('status' in head_en and 'destination' in head_en,
               "the open tab comes back to English too, from its stored original")
            ck('hali' not in head_en, "with no Kiswahili heading left in it")

            # ── 5. remembered across a reload ─────────────────────────────
            await page.select_option('#langSwitch', 'fr')
            await page.wait_for_timeout(500)
            await page.reload(wait_until="load")
            await page.wait_for_timeout(1800)
            tabs_fr = await page.inner_text('#tabs')
            ck('Utilisateurs' in tabs_fr,
               "the choice survives a reload (French tab bar after reload)")
            again = await page.eval_on_selector('#langSwitch', 'e => e.value')
            ck(again == 'fr', f"and the picker still shows it ({again})")

            # ── 6b. a member's own data, in a translated panel ─────────────
            await page.click('button[data-tab="users"]')
            await page.wait_for_timeout(1500)
            users = await page.inner_text('#content')
            ck('0742730382' in users, "a member's phone number is left alone")
            ck('UG7Q4X' in users, "and so is their referral code")

            await b.close()
    finally:
        srv.shutdown()

    ck(not errs, f"no page errors ({errs[:2]})")
    print(("\n%d FAILED" % len(fails)) if fails else "\nall good")
    return 1 if fails else 0


sys.exit(asyncio.run(main()))
