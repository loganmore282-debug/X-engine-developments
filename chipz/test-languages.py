"""
The language button and the downline loader, in the BUILT app.

test-languages.js proves the pieces in isolation against a stub DOM. This
drives the real obfuscated build in a real browser, because three of the
claims here are about what reaches a screen and nothing static can see them:

  * the button is ON the sign-in screen, at its top right, and only where the
    country offers more than one language;
  * picking a language actually rewrites the screen -- the obfuscator turns
    every string literal into a lookup into an encoded array, so grepping the
    deployed file for "INGIA" proves nothing at all;
  * the choice survives a reload, which is the difference between a language
    picker and a gimmick.

And the Team downline loader (owner: "add the other loader ... while Loading
users on team of specific level ... it will be 4 triangles not Loading...")
is asserted from real frames: a keyframe name in the stylesheet cannot tell
you whether anything moved.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/languages'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
# 8897: 8893 and 8895 belong to test-boot-speed.py. Two harnesses on one port
# die with "Address already in use" in whichever starts second, which reads
# like a real failure and is not.
PORT = 8897
API = 'https://chipz-server.onrender.com'


def region(langs, default_lang):
    return {"key": "ug", "name": "Uganda", "currency": "UGX", "dialCode": "256",
            "localLength": 9, "prefixes": ["7"], "utcOffsetMin": 180, "isDefault": True,
            "usesBareLocal": True, "languages": langs, "defaultLang": default_lang}


ACCOUNT = {"phone": "0742730382", "walletBalance": 12000, "totalDeposited": 20000,
           "totalEarned": 3000, "totalWithdrawn": 0, "totalInvested": 5000,
           "checkinStreak": 1, "lastCheckinAt": None, "referralCode": "UG7Q4X",
           "publicId": "00042", "registrationDone": True,
           "team": {"l1": 2, "l2": 1, "l3": 0, "commission": 0}}

SETTINGS = {"minDeposit": 30000, "minWithdraw": 20000, "withdrawFeePct": 15,
            "withdrawMultiple": 5000, "commL1": 27, "commL2": 2, "commL3": 1,
            "annEnabled": False, "depositPayAEnabled": True, "depositPayBEnabled": False,
            "openingCountdownEnabled": False, "maintenanceMode": False,
            "dailyCheckin": 500, "turntableEnabled": False, "brandName": "Chipz",
            "requireInvestToWithdraw": False, "withdrawWindowEnabled": False}

MEMBERS = [{"phone": "0756110296", "invested": 90000, "createdAt": "2026-09-01T10:00:00Z"},
           {"phone": "0771220399", "invested": 30000, "createdAt": "2026-09-03T08:30:00Z"}]


def routes(reg):
    return {
        "/public/settings": {"status": "success", "settings": SETTINGS, "region": reg, "regionCount": 1},
        "/public/products": {"status": "success", "products": []},
        "/public/activity-feed": {"status": "success", "feed": []},
        "/public/banner": {"status": "success", "image": None},
        "/public/announcement-image": {"status": "success", "image": None},
        "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
        "/public/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None},
        "/public/share-host": {"status": "success", "host": "", "hosts": [], "count": 0},
        "/account": {"status": "success", "account": ACCOUNT, "region": reg},
        "/investments": {"status": "success", "investments": []},
        "/transactions": {"status": "success", "transactions": [], "truncated": False},
        "/messages": {"status": "success", "messages": []},
        "/bank/list": {"status": "success", "accounts": []},
        "/team/stats": {"status": "success", "referralCode": "UG7Q4X",
                        "commRates": {"l1": 27, "l2": 2, "l3": 1},
                        "team": {"l1": 2, "l2": 1, "l3": 0}, "totalTeam": 3,
                        "teamCommission": 0, "teamDeposits": 0, "milestones": []},
        "/turntable/status": {"status": "success", "enabled": False},
    }


FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"


def fb_auth(signed_in):
    who = ("const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};"
           if signed_in else "const user=null;")
    return who + """
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


# Read off the sign-in screen: the button's own box against the hero's, the
# text on the two headings, and one placeholder. The geometry is the point of
# "top right" -- a button that exists but renders at the bottom of the card
# would satisfy every selector check in the world.
AUTH_PROBE = """()=>{
  const q = s => document.querySelector(s);
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden'; };
  const btn = q('#langBtn'), hero = q('.auth-hero');
  const br = btn ? btn.getBoundingClientRect() : null;
  const hr = hero ? hero.getBoundingClientRect() : null;
  return {
    btnVisible: vis(btn),
    btnLabel: ((q('#langBtnLabel')||{}).textContent||'').trim(),
    inHero: !!(br && hr && br.top >= hr.top && br.bottom <= hr.bottom),
    fromTop: br && hr ? Math.round(br.top - hr.top) : null,
    fromRight: br && hr ? Math.round(hr.right - br.right) : null,
    rightHalf: !!(br && br.left > window.innerWidth / 2),
    loginHead: ((q('#loginPane h1')||{}).textContent||'').trim(),
    loginBtn: ((q('#loginBtn')||{}).textContent||'').trim(),
    phonePh: (q('#loginPhone')||{}).placeholder || '',
    remember: ((q('.row-check span')||{}).textContent||'').trim(),
    dial: ((q('#loginDial')||{}).textContent||'').trim(),
    lang: window.LANG || null,
  };
}"""


async def main():
    errs, fails = [], []

    def ck(ok, l):
        print(("PASS  " if ok else "FAIL  ") + l)
        if not ok:
            fails.append(l)

    srv = serve()
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")

            async def open_ctx(signed_in, reg, slow_members=False):
                ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                          device_scale_factor=2, service_workers="block")
                page = await ctx.new_page()
                page.on("pageerror", lambda e: errs.append(str(e)))
                table = routes(reg)

                async def api(r):
                    path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
                    if path.endswith("/public/entry"):
                        await r.fulfill(status=200, content_type="application/json",
                                        body=json.dumps({"status": "success", "rotate": False, "mode": "off", "host": ""}))
                        return
                    if path.endswith("/team/members"):
                        # Stalled on purpose. The loader is only observable
                        # while the request is genuinely in flight, and on a
                        # local stub that is otherwise a single frame.
                        if slow_members:
                            await asyncio.sleep(2.0)
                        await r.fulfill(status=200, content_type="application/json",
                                        body=json.dumps({"status": "success", "level": 2, "members": MEMBERS}))
                        return
                    body = next((v for k, v in table.items() if path.endswith(k)), {"status": "success"})
                    await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

                await page.route(f"{API}/**", api)
                await page.route("https://fonts.googleapis.com/**",
                                 lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
                await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                                 lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
                await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                                 lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript",
                                                                           body=fb_auth(signed_in))))
                return ctx, page

            # ── 1. two languages: the button is there, and it works ──────
            print('— a country that offers English and Swahili —')
            ctx, page = await open_ctx(False, region(["en", "sw"], "en"))
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await page.wait_for_timeout(2600)
            before = await page.evaluate(AUTH_PROBE)
            await page.screenshot(path=f"{OUT}/1-english.png")
            for k, v in before.items():
                print("  %-12s %s" % (k, v))
            ck(before["btnVisible"], "the language button is on the sign-in screen")
            ck(before["inHero"], "inside the hero -- the top of the screen, not buried in the form card")
            ck(before["rightHalf"] and (before["fromRight"] or 99) <= 24,
               "and hard against its right edge: %spx in from the right, %spx down from the top"
               % (before["fromRight"], before["fromTop"]))
            ck(before["btnLabel"] == "English", "it names the language currently in use: " + before["btnLabel"])
            ck(before["lang"] == "en", "which is the country's own default, since nothing was stored")
            ck(before["loginHead"] == "LOGIN", "the screen starts in English")

            # The picker
            await page.click("#langBtn")
            await page.wait_for_timeout(500)
            opts = await page.evaluate(
                "()=>[...document.querySelectorAll('#langSheetBg .lang-opt')].map(e=>e.textContent.replace(/\\s+/g,' ').trim())")
            await page.screenshot(path=f"{OUT}/2-picker.png")
            print("  options     %s" % (opts,))
            ck(len(opts) == 2, "the picker lists exactly the two languages this country allows")
            ck(any("Kiswahili" in o for o in opts),
               "each is written in its OWN language, which is how every language list a person actually uses is written")

            await page.evaluate("()=>{[...document.querySelectorAll('#langSheetBg .lang-opt')].find(e=>/Kiswahili/.test(e.textContent)).click();}")
            await page.wait_for_timeout(700)
            after = await page.evaluate(AUTH_PROBE)
            await page.screenshot(path=f"{OUT}/3-swahili.png")
            for k, v in after.items():
                print("  %-12s %s" % (k, v))
            ck(after["lang"] == "sw", "picking Kiswahili switches the app to it")
            ck(after["loginHead"] == "INGIA",
               "and the heading is rewritten in the built, obfuscated bundle: %s" % after["loginHead"])
            ck(after["loginBtn"] == "Ingia", "the Log In button too: " + after["loginBtn"])
            ck(after["phonePh"] == "Weka namba ya simu", "and the phone field's placeholder: " + after["phonePh"])
            ck(after["remember"] == "Nikumbuke", "and the Remember me label: " + after["remember"])
            ck(after["btnLabel"] == "Kiswahili", "the button now names Kiswahili")
            ck(after["dial"] == "+256",
               "the dialling code is NOT translated -- it is a number, and the translator only ever replaces a whole node that matches a row")
            sheet_open = await page.evaluate("()=>!!document.querySelector('#langSheetBg.show')")
            ck(not sheet_open, "and the picker closes itself once a language is chosen")

            # ── 2. it is remembered ──────────────────────────────────────
            print('\n— and it is still Kiswahili after a reload —')
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await page.wait_for_timeout(2600)
            again = await page.evaluate(AUTH_PROBE)
            ck(again["lang"] == "sw" and again["loginHead"] == "INGIA",
               "the choice is remembered on the device: %s / %s" % (again["lang"], again["loginHead"]))
            ck(again["btnLabel"] == "Kiswahili", "and the button opens already naming it")
            await ctx.close()

            # ── 3. one language: no button at all ────────────────────────
            print('\n— a country that offers only English —')
            ctx, page = await open_ctx(False, region(["en"], "en"))
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await page.wait_for_timeout(2600)
            one = await page.evaluate(AUTH_PROBE)
            ck(not one["btnVisible"],
               "the button is not shown -- one option is not a choice, and a single-language country gains no furniture")
            ck(one["loginHead"] == "LOGIN", "and the screen reads English")
            await page.screenshot(path=f"{OUT}/4-single.png")
            await ctx.close()

            # A stored language the country has since withdrawn must not
            # strand a member: the picker lists only allowed languages, so
            # nothing on screen could switch them back.
            print('\n— a language the country has since withdrawn —')
            ctx, page = await open_ctx(False, region(["en"], "en"))
            await page.add_init_script("try{localStorage.setItem('chipz_lang','sw')}catch(e){}")
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await page.wait_for_timeout(2600)
            stale = await page.evaluate(AUTH_PROBE)
            ck(stale["lang"] == "en" and stale["loginHead"] == "LOGIN",
               "a device holding it falls back to the country's default rather than being stuck: %s" % stale["lang"])
            await ctx.close()

            # ── 4. signed in: the Account row, and the Team loader ───────
            print('\n— signed in —')
            ctx, page = await open_ctx(True, region(["en", "sw"], "en"), slow_members=True)
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            await page.wait_for_timeout(3000)
            await page.evaluate("()=>{try{closeAnnounce()}catch(e){}}")
            await page.evaluate("showPage('account')")
            await page.wait_for_timeout(1200)
            row = await page.evaluate("""()=>{const r=document.querySelector('#langRow');
              if(!r) return {present:false};
              const st=getComputedStyle(r);
              return {present:true, visible: st.display!=='none',
                      value: ((document.querySelector('#langRowValue')||{}).textContent||'').trim()};}""")
            print("  account row %s" % (row,))
            ck(row.get("present") and row.get("visible"),
               "Account carries a Language row, so a member who joined months ago can still change it")
            ck(row.get("value") == "English", "showing which language is in use: %s" % row.get("value"))

            print('\n— the downline loader —')
            await page.evaluate("showPage('team')")
            await page.wait_for_timeout(2500)
            # Tap Level 2 and sample while the (stalled) request is in flight.
            sample = await page.evaluate("""async ()=>{
              const btn=[...document.querySelectorAll('.lv-switcher .lv')].find(b=>b.dataset.level==='2');
              btn.click();
              await new Promise(r=>setTimeout(r,250));
              const box=document.querySelector('#teamMembersBox');
              const mark=box.querySelector('.pspin');
              const orbit=box.querySelector('.pspin-orbit');
              const chips=box.querySelectorAll('.pspin-chip').length;
              const rect=mark?mark.getBoundingClientRect():null;
              const words=(box.textContent||'').trim();
              const frames=[];
              for(let i=0;i<8;i++){
                frames.push(getComputedStyle(orbit).transform);
                await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,70)));
              }
              return {hasMark:!!mark, chips, w:rect?Math.round(rect.width):0,
                      words, distinct:[...new Set(frames)].length};
            }""")
            print("  loader      %s" % (sample,))
            await page.screenshot(path=f"{OUT}/5-team-loading.png")
            ck(sample["hasMark"], "tapping a level that is not cached shows the orbiting-chips mark while it loads")
            ck(sample["chips"] == 3,
               "three chips orbiting one pulsing centre -- four triangles, the same mark the ongoing plans and the payment page use")
            ck(sample["w"] >= 40,
               "drawn large enough to read as a loader rather than as a row decoration: %spx" % sample["w"])
            ck(sample["words"] == "",
               "and no 'Loading...' beside it -- the owner asked for the chips INSTEAD of the word")
            ck(sample["distinct"] >= 3,
               "it is really turning, sampled over real frames rather than trusted from a keyframe name: %d distinct transforms"
               % sample["distinct"])

            await page.wait_for_timeout(2600)
            done = await page.evaluate("""()=>{const box=document.querySelector('#teamMembersBox');
              return {mark:!!box.querySelector('.pspin'), rows:box.querySelectorAll('.team-member').length};}""")
            print("  settled     %s" % (done,))
            ck(not done["mark"] and done["rows"] == 2,
               "and it is replaced by the members when they arrive: %d rows" % done["rows"])

            # Re-tapping a level already fetched must NOT flash the mark: a
            # spinner up for one frame reads as a glitch, not as progress.
            flash = await page.evaluate("""async ()=>{
              const l1=[...document.querySelectorAll('.lv-switcher .lv')].find(b=>b.dataset.level==='1');
              const l2=[...document.querySelectorAll('.lv-switcher .lv')].find(b=>b.dataset.level==='2');
              l1.click(); await new Promise(r=>setTimeout(r,400));
              let seen=false;
              const box=document.querySelector('#teamMembersBox');
              l2.click();
              for(let i=0;i<6;i++){ if(box.querySelector('.pspin')) seen=true;
                await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,40))); }
              return seen;
            }""")
            ck(not flash,
               "returning to a level already fetched shows no loader at all -- it renders from what is held, and a mark that appears for one frame reads as a glitch")

            await ctx.close()
            await b.close()
    finally:
        srv.shutdown()

    ck(not errs, "no page errors anywhere%s" % ("" if not errs else ": " + errs[0]))
    print("\nlanguages (browser): %s" % ("all cases pass" if not fails else "%d case(s) failed" % len(fails)))
    sys.exit(1 if fails else 0)


asyncio.run(main())
