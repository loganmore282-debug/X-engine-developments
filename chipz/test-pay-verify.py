#!/usr/bin/env python3
"""The recharge status page: new copy, a real header, working nav, and Verify.

Owner: "change this, we need to use new words, even on success and failing,
not the same words as old ... also bro include nav arrow '<', and its title
space, on that payment page. also why the nav icons don't work when on payment
page, they should work suitably ... also add a button saying verify, so one can
tap it but it should not stop autopolling, also they should not call at the
same time to strike api of payment provider."

The assertion that carries this round is the last one. "They should not call at
the same time" is a CONCURRENCY property, and no amount of reading the source
proves it -- so the status endpoint is stubbed with a real delay, every request
is timestamped on arrival and departure, and the test measures the maximum
number of requests in flight at once. It must never exceed 1, while the poll is
still demonstrably running and the Verify tap still gets an answer.

Verified to discriminate by reverting each change; see the round's notes.
"""
import asyncio, json, os, sys, functools, threading, http.server, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/pay-verify'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
PORT = 8796
API = 'https://chipz-server.onrender.com'

# The exact four steps the owner wrote, minus the amount/number that are
# interpolated. Checked as substrings so punctuation drift is caught.
STEPS = [
    "A payment request for UGX 20,000 has been sent to +256742730382.",
    "Check your phone for the payment prompt.",
    "Approve the payment to complete your recharge.",
    "Your balance will be updated automatically once the payment is confirmed.",
]
# The wording being replaced. None of it may survive anywhere on the page --
# "not the same words as old" is the request.
OLD_WORDS = [
    "Payment prompt sent to",
    "Approve it on your phone to complete this recharge",
    "Recharge successful",
    "Your wallet has been credited",
    "Recharge failed",
    "Your recharge could not be completed",
    "Still processing",
    "This is taking longer than usual",
    "Payment under review",
]

ROUTES = {
    "/public/settings": {"status": "success", "settings": {"brandName": "Chipz", "annEnabled": False,
        "minDeposit": 20000, "depositPayAEnabled": True, "depositPayBEnabled": False}},
    "/account": {"status": "success", "account": {"userId": "u1", "phone": "0742730382",
        "publicId": "00001", "referralCode": "TCL80", "walletBalance": 5000, "registrationDone": True}},
    "/investments": {"status": "success", "investments": []},
    "/transactions": {"status": "success", "transactions": []},
    "/messages": {"status": "success", "messages": []},
    "/public/products": {"status": "success", "products": [
        {"key": "p1", "name": "Product-1", "price": 30000, "cycle": 150, "expectedReturn": 90000}]},
    "/public/banner": {"status": "success", "image": None, "video": None},
    "/team/stats": {"status": "success", "referralCode": "TCL80", "commRates": {"l1": 28, "l2": 1, "l3": 1},
                    "team": {"l1": 0, "l2": 0, "l3": 0}, "totalTeam": 0, "teamCommission": 0,
                    "teamDeposits": 0, "milestones": []},
    "/team/members": {"status": "success", "level": 1, "members": []},
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
        if not ok:
            fails.append(label)

    # Live concurrency accounting for the status endpoint.
    inflight = {"now": 0, "max": 0, "total": 0}

    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))

        async def status_route(r):
            inflight["now"] += 1
            inflight["total"] += 1
            inflight["max"] = max(inflight["max"], inflight["now"])
            # A real, visible delay is the whole point: with an instant reply
            # the poll and a tap could never overlap even if the code allowed
            # it, and this test would pass on a broken app.
            await asyncio.sleep(1.2)
            inflight["now"] -= 1
            await r.fulfill(status=200, content_type="application/json",
                            body=json.dumps({"status": "success", "state": "pending"}))

        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            if path.endswith("/deposit/marzpay"):
                await r.fulfill(status=200, content_type="application/json",
                                body=json.dumps({"status": "success", "depositId": "dep-1"}))
                return
            body = next((v for k, v in ROUTES.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        # ORDER MATTERS: Playwright gives precedence to the route registered
        # LAST, so the catch-all goes first and the status endpoint after it.
        # Registered the other way round, the catch-all answers
        # /deposit/marzpay/status, the counters below never move, and
        # "peak concurrency <= 1" passes having measured nothing at all. The
        # "requests really were being made" assertion exists to catch exactly
        # that, and did.
        await page.route(f"{API}/**", api)
        await page.route(f"{API}/deposit/marzpay/status", status_route)
        await page.route("https://fonts.googleapis.com/**",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/css", body="")))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_APP)))
        await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js",
                         lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="text/javascript", body=FB_AUTH)))

        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(2600)
        await page.evaluate("closeAnnounce && closeAnnounce()")

        # ── open the status page through the real form ──
        await page.evaluate("openDepositSheet()")
        await page.wait_for_timeout(700)
        await page.evaluate("""() => {
            document.getElementById('depAmount').value = '20000';
            document.getElementById('depPhone').value = '0742730382';
        }""")
        await page.evaluate("() => { submitDeposit(); }")
        await page.wait_for_timeout(900)

        print("— the pending screen says the owner's four steps —")
        shown = await page.evaluate(
            "!!document.getElementById('depStatusBg').classList.contains('show')")
        ck(shown, "the recharge status page opened")

        items = await page.evaluate("""() =>
            [...document.querySelectorAll('#depStatusBody .pay-steps li')].map(li => li.textContent.trim())""")
        ck(len(items) == 4, f"exactly four numbered steps (got {len(items)})")
        for i, want in enumerate(STEPS):
            got = items[i] if i < len(items) else ''
            ck(got == want, f"step {i + 1}: {want!r}" + ("" if got == want else f"  -- got {got!r}"))

        # A real <ol>, so the browser draws the numbers. A <div> with "1." typed
        # into each line would satisfy a text check and renumber wrongly the
        # moment a step is added or removed.
        tag = await page.evaluate(
            "() => { const e = document.querySelector('#depStatusBody .pay-steps'); return e && e.tagName; }")
        ck(tag == 'OL', f"they are a real ordered list, not hand-typed numbers (got {tag})")

        marker = await page.evaluate("""() => {
            const li = document.querySelector('#depStatusBody .pay-steps li');
            return li ? getComputedStyle(li).textAlign : null; }""")
        ck(marker == 'left', f"the list is left-aligned so the numbers line up (got {marker})")

        page_text = await page.evaluate(
            "document.getElementById('depStatusBg').innerText")
        ck("dial *165#" in page_text or "*165#" in page_text,
           "the USSD fallback the owner asked for in an earlier round is still there")

        print("\n— the header: a back arrow and a title —")
        head = await page.evaluate("""() => {
            const h = document.querySelector('#depStatusBg .sheet-head');
            if (!h) return null;
            const back = h.querySelector('button.back');
            const title = h.querySelector('h2');
            const bb = back && back.getBoundingClientRect();
            const hb = h.getBoundingClientRect();
            return { hasBack: !!back, hasSvg: !!(back && back.querySelector('svg path')),
                     title: title && title.textContent.trim(),
                     backLeft: bb && bb.left, backW: bb && bb.width, top: hb.top, hH: hb.height }; }""")
        ck(bool(head and head["hasBack"]), "there is a back button")
        ck(bool(head and head["hasSvg"]), "drawn as the app's chevron, not a text character")
        ck(bool(head and head["title"]), f"and a title in the header ({head and head['title']!r})")
        ck(bool(head and head["top"] == 0), "the header sits at the top of the page")
        ck(bool(head and head["backLeft"] is not None and head["backLeft"] < 60),
           "the arrow is on the left where a back control belongs")

        # The icon must not have been pushed off-centre by the new header --
        # the card centres inside the REMAINING height, not the whole page.
        centred = await page.evaluate("""() => {
            const card = document.querySelector('#depStatusBg .pay-card');
            const body = document.querySelector('#depStatusBg .pay-body');
            if (!card || !body) return null;
            const c = card.getBoundingClientRect(), b = body.getBoundingClientRect();
            return Math.abs((c.top - b.top) - (b.bottom - c.bottom)); }""")
        ck(centred is not None and centred < 6,
           f"the card is still centred in the space below the header (off by {centred}px)")

        print("\n— the nav bar works from this page —")
        nav_hit = await page.evaluate("""() => {
            const t = document.querySelector('.navitem[data-nav="account"]');
            if (!t) return null;
            const b = t.getBoundingClientRect();
            const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return !!(el && el.closest('.navitem')); }""")
        ck(nav_hit is True, "a nav tab is genuinely hit-testable, not just visible")

        before_len = await page.evaluate("history.length")
        # Tap it the way a member does.
        await page.evaluate(
            """() => document.querySelector('.navitem[data-nav="account"]').click()""")
        await page.wait_for_timeout(700)
        after = await page.evaluate("""() => ({
            payOpen: document.getElementById('depStatusBg').classList.contains('show'),
            page: (window.STATE || {}).page,
            bodyLocked: document.body.style.overflow === 'hidden',
            histLen: history.length,
            appVisible: !!document.getElementById('app') &&
                        getComputedStyle(document.getElementById('app')).display !== 'none' })""")
        ck(after["payOpen"] is False, "tapping a nav tab closes the payment page")
        ck(after["page"] == 'account', f"and the app really moved to that tab (page={after['page']!r})")
        ck(after["bodyLocked"] is False, "body scroll is released, not left locked")
        # The page owns no history entry, so the teardown must not spend one.
        ck(after["histLen"] >= before_len,
           f"no history entry was consumed (was {before_len}, now {after['histLen']})")
        ck(after["appVisible"] is True, "and the member is still inside the app")

        print("\n— Verify: one provider call at a time —")
        # Back to a fresh pending screen.
        await page.evaluate("showPage('home')")
        await page.wait_for_timeout(400)
        await page.evaluate("openDepositSheet()")
        await page.wait_for_timeout(600)
        await page.evaluate("""() => {
            document.getElementById('depAmount').value = '20000';
            document.getElementById('depPhone').value = '0742730382'; }""")
        await page.evaluate("() => { submitDeposit(); }")
        await page.wait_for_timeout(800)

        vis = await page.evaluate("""() => {
            const v = document.getElementById('depVerifyBtn');
            const c = document.getElementById('depStatusCloseBtn');
            return { v: v && v.style.display !== 'none' && v.textContent.trim(),
                     closeHidden: !c || c.style.display === 'none' }; }""")
        ck(vis["v"] == 'Verify', f"a Verify button is offered while pending (got {vis['v']!r})")
        ck(vis["closeHidden"] is True, "and Close is not, since the payment is still live")

        inflight["max"] = 0
        inflight["total"] = 0
        # Hammer Verify right through the autopoll's own ticks. The poll fires
        # every 3s and each reply takes 1.2s, so taps land both during and
        # between requests -- which is exactly the overlap being tested.
        for _ in range(9):
            await page.evaluate("""() => {
                const b = document.getElementById('depVerifyBtn');
                if (b) b.click(); }""")
            await page.wait_for_timeout(800)

        ck(inflight["max"] <= 1,
           f"never more than one status request in flight at once (peak was {inflight['max']})")
        ck(inflight["total"] >= 2,
           f"and requests really were being made throughout ({inflight['total']} of them)")

        # The autopoll must still be alive after all that tapping.
        polled_before = inflight["total"]
        await page.evaluate("""() => { const b = document.getElementById('depVerifyBtn');
            if (b) { b.disabled = true; } }""")   # stop manual taps, leave the poll alone
        await page.wait_for_timeout(4200)
        ck(inflight["total"] > polled_before,
           f"the autopoll kept running on its own after Verify was used "
           f"({polled_before} -> {inflight['total']})")

        still_pending = await page.evaluate(
            "document.getElementById('depStatusBg').classList.contains('show')")
        ck(still_pending is True, "the page stayed open through all of it")

        print("\n— none of the old wording survives —")
        # Drive each terminal state through the real setters and read the page.
        await page.evaluate("setDepositStatusSuccess()")
        succ = await page.evaluate("""() => ({
            title: document.getElementById('depStatusTitle').textContent.trim(),
            body: document.getElementById('depStatusBody').innerText.trim(),
            verifyHidden: document.getElementById('depVerifyBtn').style.display === 'none',
            closeShown: document.getElementById('depStatusCloseBtn').style.display !== 'none' })""")
        ck(succ["title"] == 'Payment confirmed', f"success has new wording ({succ['title']!r})")
        ck("UGX 20,000" in succ["body"],
           f"and names the amount actually recharged -- {succ['body']!r}")
        ck(succ["verifyHidden"] and succ["closeShown"],
           "success offers Close and drops Verify")

        await page.evaluate("setDepositStatusFailed('')")
        fail_txt = await page.evaluate("""() => ({
            title: document.getElementById('depStatusTitle').textContent.trim(),
            body: document.getElementById('depStatusBody').innerText.trim() })""")
        ck(fail_txt["title"] == 'Payment not completed', f"failure has new wording ({fail_txt['title']!r})")
        ck("has not changed" in fail_txt["body"],
           "and says the Chipz balance did not move")
        # It must NOT claim anything about the member's mobile money account.
        ck("nothing has been taken" not in fail_txt["body"].lower(),
           "without claiming what happened inside their mobile money account")

        await page.evaluate("setDepositStatusUnknown()")
        unk = await page.evaluate("""() => ({
            title: document.getElementById('depStatusTitle').textContent.trim(),
            verify: document.getElementById('depVerifyBtn').style.display !== 'none',
            close: document.getElementById('depStatusCloseBtn').style.display !== 'none' })""")
        ck(unk["title"] == 'Still waiting for the provider', f"the give-up state is reworded ({unk['title']!r})")
        ck(unk["verify"] and unk["close"],
           "and keeps Verify available -- the payment is unresolved, not over")

        await page.evaluate("setDepositStatusReview()")
        rev = await page.evaluate("document.getElementById('depStatusTitle').textContent.trim()")
        ck(rev == 'We are checking this payment', f"review is reworded ({rev!r})")

        # Sweep every old phrase across all five states in one pass.
        seen = []
        for setter in ["setDepositStatusPending(20000, '0742730382')", "setDepositStatusSuccess()",
                       "setDepositStatusFailed('')", "setDepositStatusUnknown()",
                       "setDepositStatusReview()"]:
            await page.evaluate(f"{setter}")
            txt = await page.evaluate(
                "document.getElementById('depStatusBg').innerText")
            seen.append(txt)
        joined = "\n".join(seen)
        leftover = [w for w in OLD_WORDS if w.lower() in joined.lower()]
        ck(not leftover, f"no old phrase survives in any state (found: {leftover})")

        # The back button closes the page, same as Close.
        await page.evaluate("openDepositStatusModal(20000, '0742730382')")
        await page.wait_for_timeout(200)
        await page.evaluate("() => document.querySelector('#depStatusBg .sheet-head button.back').click()")
        await page.wait_for_timeout(400)
        closed = await page.evaluate(
            "document.getElementById('depStatusBg').classList.contains('show')")
        ck(closed is False, "the header's back arrow closes the page")

        await b.close()

    if errs:
        for e in dict.fromkeys(errs):
            print("  page error: " + e)
        fails.append("page errors")
    print(f"\n{len(fails)} FAILED" if fails else "\npay verify: all cases pass")
    return 1 if fails else 0


if __name__ == "__main__":
    httpd = serve()
    try:
        sys.exit(asyncio.run(main()))
    finally:
        httpd.shutdown()
