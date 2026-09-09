#!/usr/bin/env python3
"""Team cards, held to the owner's mockup by measurement.

Owner: "my mock up has some semi circular circles on the top right of the card,
and see cards have some gradients and big numbers of percentages and number...
also see some green behind the percentage, and number, also on card edges...
see size of card, it is big but ours is small."

His screenshot and ours came off the SAME phone at 1080x2340, so device pixels
compare directly; our card is 973 device px for a CSS width of 354, giving
1 CSS px = 2.749 device px. Every MOCK figure below was measured off his
screenshot and converted with that.

                          ours before   his
    card 1 height             157.2    164.8 CSS
    card 2 height             163.7    177.9
    big figures            34 / 40px   both ~47px
    green glow on edge          none   ~12% alpha over ~16px
    arcs top-right              none   2 hairlines, r 41.5 / 61.5

WHERE THE GREEN GOES was settled by measurement, not by picking one reading of
"green behind the percentage, and number, also on card edges": the haze around
his figures samples (212,228,244) against a (223,229,245) fill -- a shadow in
the GLYPH's own hue. Only the card EDGE is green (G-R = +16 outside it). So the
figures get a halo in the brand red and the green stays on the edge.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/team-measure'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8769
API = 'https://chipz-server.onrender.com'
S = 973 / 354.0          # device px per CSS px on his phone
MOCK = {'card1_h': 453, 'card2_h': 489, 'num_cap': 93, 'pct_cap': 95,
        'arc_r_in': 114, 'arc_r_out': 169, 'arc_inset': 54}

ROUTES = {
  "/public/settings": {"status": "success", "settings": {"brandName": "Chipz", "annEnabled": False,
      "commL1": 28, "commL2": 1, "commL3": 1}},
  "/account": {"status": "success", "account": {"userId": "u1", "phone": "0700000000",
      "referralCode": "TCL80", "walletBalance": 5000}},
  "/investments": {"status": "success", "investments": []},
  "/transactions": {"status": "success", "transactions": []},
  "/messages": {"status": "success", "messages": []},
  "/public/products": {"status": "success", "products": []},
  "/public/banner": {"status": "success", "image": None, "video": None},
  "/team/stats": {"status": "success", "referralCode": "TCL80",
      "commRates": {"l1": 28, "l2": 1, "l3": 1}, "team": {"l1": 0, "l2": 0, "l3": 0},
      "totalTeam": 45, "teamCommission": 0, "teamDeposits": 2800000, "milestones": []},
  "/team/members": {"status": "success", "members": []},
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
                                  device_scale_factor=2.749, service_workers="block")
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
        await page.evaluate("showPage('team')")
        await page.wait_for_timeout(1200)

        g = await page.evaluate("""()=>{
          const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();
            return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};};
          const cards=[...document.querySelectorAll('.team-gcard')];
          const cs=e=>getComputedStyle(e);
          const arc=(e,p)=>{const s=getComputedStyle(e,p);
            return {w:s.width,h:s.height,top:s.top,right:s.right,content:s.content,
              border:s.borderTopWidth+' '+s.borderTopColor};};
          return {card1:r(cards[0]), card2:r(cards[1]),
                  num:cs(document.querySelector('.team-gcard .num')).fontSize,
                  pct:cs(document.querySelector('.team-gcard.comm .pct')).fontSize,
                  numShadow:cs(document.querySelector('.team-gcard .num')).textShadow,
                  shadow:cs(cards[0]).boxShadow,
                  before:arc(cards[0],'::before'), after:arc(cards[0],'::after'),
                  c2before:arc(cards[1],'::before')};}""")
        print("device px per CSS px (his phone) = %.3f\n" % S)
        fails = []
        def ck(ok, label):
            print(("PASS  " if ok else "FAIL  ") + label)
            if not ok: fails.append(label)
        # 4% or 3px, whichever is looser. Deliberately tighter than the 8%/2px
        # used for the referral card: these boxes are ~170px, so 8% would be
        # 14px and would have let card 2 through at the size he called small.
        def near(name, ours_css, mock_dev):
            want = mock_dev / S
            d = ours_css - want
            ck(abs(d)/want <= 0.04 or abs(d) <= 3.0,
               "%s %.1f vs his %.1f CSS (%+.0f%%, %+.1fpx)" % (name, ours_css, want, 100*d/want, d))
        near("card 1 height", g['card1']['h'], MOCK['card1_h'])
        near("card 2 height", g['card2']['h'], MOCK['card2_h'])
        # Both his big figures measure ~47px; ours were 34 and 40.
        for label, got, cap in (("number", g['num'], MOCK['num_cap']),
                                ("percent", g['pct'], MOCK['pct_cap'])):
            want = cap / S / 0.72
            px = float(got.replace('px', ''))
            ck(abs(px - want) <= 3.5,
               "the big %s is %s against his ~%.0fpx" % (label, got, want))

        # The halo behind the figures, in their OWN colour (see the docstring).
        ck('rgba(226, 27, 42' in g['numShadow'] and '18px' in g['numShadow'],
           "the figures carry a brand-red halo, as his carry a blue one (%s)" % g['numShadow'])

        # The card-edge glow is GREEN -- the one place his actually is. Read
        # from the computed shadow's channels so "some green" is a fact, not
        # a colour name someone typed: G must lead R and B.
        import re as _re
        m = _re.search(r'rgba?\((\d+),\s*(\d+),\s*(\d+)', g['shadow'] or '')
        rgb = tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
        ck(bool(m) and rgb[1] > rgb[0] + 40 and rgb[1] > rgb[2] + 40,
           "the card edge glows GREEN (%s from %s)" % (str(rgb), g['shadow']))

        # The two clipped rings, only on card 1 -- his card 2 has none, and a
        # rule that put them on every card would be the obvious wrong fix.
        for label, arc, r in (("outer", g['before'], MOCK['arc_r_out']),
                              ("inner", g['after'], MOCK['arc_r_in'])):
            want_d = 2 * r / S
            got_d = float(arc['w'].replace('px', '')) if arc['w'].endswith('px') else 0
            want_off = (MOCK['arc_inset'] / S) - (r / S)
            got_off = float(arc['top'].replace('px', '')) if arc['top'].endswith('px') else 999
            # `content` is checked FIRST and is not decoration: Chromium still
            # resolves a declared width for a pseudo-element that generates NO
            # box, so geometry alone passes on rings that do not exist --
            # verified by disabling them and watching these assertions pass.
            drawn = arc['content'] not in ('none', 'normal')
            ck(drawn and abs(got_d - want_d) <= 4 and abs(got_off - want_off) <= 4,
               "%s ring is drawn (content %s), %s wide at top %s (his: %.0fpx, offset %.0fpx)"
               % (label, arc['content'], arc['w'], arc['top'], want_d, want_off))
        ck(g['c2before']['content'] in ('none', 'normal'),
           "the Commission Rate card draws NO rings, as in his (content %s)" % g['c2before']['content'])
        await page.screenshot(path=f"{OUT}/team.png")
        im = Image.open(f"{OUT}/team.png")
        im.crop((int(g['card1']['x']*S)-60, int(g['card1']['y']*S)-40,
                 int((g['card1']['x']+g['card1']['w'])*S)+60,
                 int((g['card2']['y']+g['card2']['h'])*S)+40)).save(f"{OUT}/team-cards.png")
        print("\n   screenshot -> %s/team-cards.png" % OUT)
        ck(not errs, "no page errors: %s" % errs)
        await b.close()
    print(("\n%d FAILED" % len(fails)) if fails else "\nteam cards: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve()
asyncio.run(main())
srv.shutdown()
