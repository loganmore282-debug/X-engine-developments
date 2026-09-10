#!/usr/bin/env python3
"""The admin panel used to corrupt a product's key on every save.

Owner: "when l save image for the product 1 after that what was product 2
changes again to 1 and when l change it it changes product 1 again".

Root cause, reproduced against the BUILT admin bundle before the fix: the
save handler ran its "make a slug" regex over (p.key || <new-product
fields>) UNCONDITIONALLY. For an EXISTING product p.key is already a real,
validated key ("product-1") -- but the regex still stripped its hyphen,
turning it into "product1". That is a DIFFERENT key, so the save created a
second document instead of updating the first: the untouched "product-1"
default kept existing side by side with the new "product1", both named
"Product-1". Whichever of the two happened to sort into the next slot in the
list is what looked like "Product 2" -- so editing "Product 2" kept landing
back on Product-1's data, exactly the loop the owner described.

This drives the real built admin against a stateful mock that replicates
server.js's actual sanitizeProductInput()/getProducts() merge-and-sort
logic (not a stub), and:
  1. proves the fix: editing and saving an untouched default product's image
     keeps its key and does NOT spawn a duplicate card;
  2. proves the same for a SECOND product edited afterward (the exact
     two-in-a-row sequence the owner hit);
  3. drives the new POST /admin/products/fix-legacy-keys migration against
     a store seeded with the corruption exactly as the old bug would have
     left it, and checks it repairs the unambiguous case and correctly
     refuses to guess on a genuine conflict.
"""
import asyncio, functools, http.server, json, os, socketserver, sys, threading
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/product-key-corruption'
os.makedirs(OUT, exist_ok=True)
ADMIN_ROOT = os.path.join(HERE, 'admin')
SERVER = 'https://chipz-server.onrender.com'
PORT = 8891

DEFAULT_PRODUCTS = [
  {"key": "product-1", "name": "Product-1", "price": 30000,  "cycle": 150, "expectedReturn": 900000},
  {"key": "product-2", "name": "Product-2", "price": 90000,  "cycle": 150, "expectedReturn": 2700000},
  {"key": "product-3", "name": "Product-3", "price": 197000, "cycle": 150, "expectedReturn": 5910000},
  {"key": "product-4", "name": "Product-4", "price": 355000, "cycle": 150, "expectedReturn": 10650000},
]

fails = []
def ck(ok, l):
    print(("PASS  " if ok else "FAIL  ") + l)
    if not ok: fails.append(l)

class Store:
    """Mirrors server.js: sanitizeProductInput()'s order fallback (always 0
    for a single-item save array, exactly like the real /admin/products/save
    body the admin sends) and getProducts()'s merge + sort."""
    def __init__(self):
        self.docs = {}
    def sanitize(self, p, fallback_order):
        key = str(p.get('key') or '').strip()
        if not key:
            return None
        name = str(p.get('name') or '').strip()[:100]
        if not name:
            return None
        try:
            price = round(float(p.get('price')))
        except Exception:
            return None
        if price < 1:
            return None
        order = p.get('order')
        order = float(order) if order not in (None, '', 'null') else fallback_order
        return {"key": key, "name": name, "price": price,
                "cycle": int(float(p['cycle'])) if p.get('cycle') not in (None, '') else None,
                "expectedReturn": round(float(p['expectedReturn'])) if p.get('expectedReturn') not in (None, '') else None,
                "multiplier": float(p['multiplier']) if p.get('multiplier') not in (None, '') else None,
                "image": p.get('image') if isinstance(p.get('image'), str) else '',
                "active": p.get('active') is not False, "comingSoon": p.get('comingSoon') is True,
                "order": order, "spinCount": 0, "spinMin": None, "spinMax": None, "deleted": False}
    def save(self, products):
        saved = []
        for p in products:
            clean = self.sanitize(p, 0)   # single-item array in the real save call -> fallback_order ALWAYS 0
            if not clean:
                return None
            self.docs[clean['key']] = clean
            saved.append(clean)
        return saved
    def products(self):
        saved = [v for v in self.docs.values() if not v.get('deleted')]
        touched = {p['key'] for p in saved}
        merged = saved + [dict(p) for p in DEFAULT_PRODUCTS if p['key'] not in touched]
        merged.sort(key=lambda p: (p.get('order') or 0, p.get('price') or 0))
        return merged
    def fix_legacy_keys(self):
        """Mirrors the new /admin/products/fix-legacy-keys route exactly."""
        fixed, conflicts = [], []
        for default in DEFAULT_PRODUCTS:
            proper_key = default['key']
            stripped_key = ''.join(c for c in proper_key if c.isalnum())
            if stripped_key == proper_key:
                continue
            corrupted = self.docs.get(stripped_key)
            if not corrupted or corrupted.get('deleted'):
                continue
            proper = self.docs.get(proper_key)
            if proper and not proper.get('deleted'):
                conflicts.append({"properKey": proper_key, "strippedKey": stripped_key})
                continue
            rest = {k: v for k, v in corrupted.items() if k != 'key'}
            self.docs[proper_key] = {**rest, "key": proper_key}
            del self.docs[stripped_key]
            fixed.append({"properKey": proper_key, "strippedKey": stripped_key})
        return fixed, conflicts

def serve_static():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ADMIN_ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

async def wire_routes(page, store):
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    async def api(route):
        req = route.request
        path = req.url.split(SERVER, 1)[-1].split('?')[0]
        body = {}
        if req.method == 'POST':
            try: body = json.loads(req.post_data or '{}')
            except Exception: body = {}
        if path == '/admin/check-key':
            return await route.fulfill(status=200, content_type='application/json',
                body=json.dumps({"status": "success", "token": "tok", "username": "", "role": "owner"}))
        if path == '/admin/products' and req.method == 'GET':
            return await route.fulfill(status=200, content_type='application/json',
                body=json.dumps({"status": "success", "products": store.products()}))
        if path == '/admin/products/save':
            saved = store.save(body.get('products') or [])
            if saved is None:
                return await route.fulfill(status=400, content_type='application/json',
                    body=json.dumps({"status": "error", "message": "invalid"}))
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps({"status": "success"}))
        if path == '/admin/products/fix-legacy-keys':
            fixed, conflicts = store.fix_legacy_keys()
            return await route.fulfill(status=200, content_type='application/json',
                body=json.dumps({"status": "success", "fixed": fixed, "conflicts": conflicts}))
        return await route.fulfill(status=200, content_type='application/json', body=json.dumps({"status": "success"}))
    await page.route(f"{SERVER}/**", api)
    await page.route("https://fonts.googleapis.com/**", lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type="text/css", body="")))
    return errs

async def login_to_products(page):
    await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    await page.fill("#keyInput", "whatever")
    await page.click("#loginBtn")
    await page.wait_for_timeout(500)
    await page.click("#productsTab")
    await page.wait_for_timeout(600)

async def cards(page):
    return await page.evaluate("""() => [...document.querySelectorAll('.prod')].map(c => ({
        title: c.querySelector('.pt').textContent.trim(),
        editKey: c.querySelector('[data-edit]').dataset.edit,
    }))""")

async def edit_and_save_image(page, key, image_url):
    await page.click(f'[data-edit="{key}"]')
    await page.wait_for_timeout(250)
    ck((await page.input_value('#pKey')) is not None, f"key field present when editing {key}")
    disabled = await page.evaluate("document.getElementById('pKey').disabled")
    ck(disabled, f"the key field is disabled while editing an existing product ({key}) -- it should never be re-typed")
    await page.fill('#pImage', image_url)
    await page.click('#pSave')
    await page.wait_for_timeout(400)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")

        print("\n— editing product-1's image must not spawn a duplicate —")
        store = Store()
        page = await ctx.new_page()
        errs = await wire_routes(page, store)
        await login_to_products(page)
        before = await cards(page)
        ck(len(before) == 4, "starts with 4 cards (%d)" % len(before))

        await edit_and_save_image(page, 'product-1', 'https://example.com/p1.jpg')
        after = await cards(page)
        keys = [c['editKey'] for c in after]
        print("  keys after saving product-1:", keys)
        ck(len(after) == 4, "still 4 cards, not 5 (%d)" % len(after))
        ck('product-1' in keys, "product-1 still exists")
        ck('product1' not in keys, "no corrupted 'product1' (no hyphen) was created")
        ck(store.docs.get('product-1', {}).get('image') == 'https://example.com/p1.jpg',
           "the image actually landed on product-1")

        print("\n— and then editing product-2 right after (the exact reported sequence) —")
        await edit_and_save_image(page, 'product-2', 'https://example.com/p2.jpg')
        after2 = await cards(page)
        keys2 = [c['editKey'] for c in after2]
        print("  keys after saving product-2 too:", keys2)
        ck(len(after2) == 4, "still exactly 4 cards (%d)" % len(after2))
        ck(sorted(keys2) == ['product-1', 'product-2', 'product-3', 'product-4'],
           "all four original keys survive, untouched (%s)" % keys2)
        second_card = after2[1]
        ck(second_card['editKey'] == 'product-2' and second_card['title'] == 'Product-2',
           "the card in position 2 really IS product-2, not a mislabeled product-1 (%s)" % second_card)

        # Opening that second card must show ITS OWN data, not product-1's.
        await page.click('[data-edit="product-2"]')
        await page.wait_for_timeout(250)
        name = await page.input_value('#pLabel')
        image = await page.input_value('#pImage')
        ck(name == 'Product-2', "opening 'Product 2' shows name Product-2, not Product-1 (%r)" % name)
        ck('p2.jpg' in image, "and its own saved image (%r)" % image)

        ck(not errs, "no page errors: %s" % errs)
        await page.close()

        print("\n— the migration route repairs pre-existing corruption —")
        store2 = Store()
        # Seed the store exactly as the OLD buggy code would have left it:
        # product-1 edited (bug fires) -> spawns "product1"; product-3 never
        # touched; product-4 somehow edited under BOTH keys (a genuine
        # conflict -- must NOT be auto-merged).
        store2.docs['product1'] = {"key": "product1", "name": "Product-1", "price": 30000,
            "cycle": 150, "expectedReturn": 900000, "multiplier": None,
            "image": "https://example.com/legacy-p1.jpg", "active": True, "comingSoon": False,
            "order": 0, "spinCount": 0, "spinMin": None, "spinMax": None, "deleted": False}
        store2.docs['product4'] = {"key": "product4", "name": "Product-4", "price": 355000,
            "cycle": 150, "expectedReturn": 10650000, "multiplier": None,
            "image": "https://example.com/legacy-p4-a.jpg", "active": True, "comingSoon": False,
            "order": 0, "spinCount": 0, "spinMin": None, "spinMax": None, "deleted": False}
        store2.docs['product-4'] = {"key": "product-4", "name": "Product-4", "price": 355000,
            "cycle": 150, "expectedReturn": 10650000, "multiplier": None,
            "image": "https://example.com/legacy-p4-b.jpg", "active": True, "comingSoon": False,
            "order": 0, "spinCount": 0, "spinMin": None, "spinMax": None, "deleted": False}

        page2 = await ctx.new_page()
        errs2 = await wire_routes(page2, store2)
        await login_to_products(page2)
        before_fix = await cards(page2)
        keys_before = sorted(c['editKey'] for c in before_fix)
        print("  cards before fix:", keys_before)
        ck('product1' in keys_before, "the corrupted product1 duplicate is visible before the fix")

        page2.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await page2.click('#fixLegacyKeys')
        await page2.wait_for_timeout(500)

        after_fix = await cards(page2)
        keys_after = sorted(c['editKey'] for c in after_fix)
        print("  cards after fix:", keys_after)
        ck('product1' not in keys_after, "the corrupted product1 duplicate is gone")
        ck('product-1' in keys_after, "and product-1 exists in its place")
        ck(store2.docs.get('product-1', {}).get('image') == 'https://example.com/legacy-p1.jpg',
           "product-1 now carries the image that was stuck on the corrupted copy")
        # 5, not 4: product-1's duplicate was unambiguous and got merged away,
        # but product4/product-4 is a genuine conflict (both separately
        # edited) and is deliberately left as two visible cards for the
        # owner to resolve by hand -- silently picking one would risk
        # discarding whichever copy he actually wanted to keep.
        ck(len(after_fix) == 5, "4 real products + 1 unresolved conflict pair, not silently merged (%d)" % len(after_fix))

        # The genuine conflict (both product4 and product-4 separately
        # edited) must survive untouched -- picking a winner would silently
        # discard real data either way.
        ck('product4' in store2.docs and not store2.docs['product4'].get('deleted'),
           "a real conflict (both copies edited) is left alone, not guessed at")
        ck(store2.docs['product-4']['image'] == 'https://example.com/legacy-p4-b.jpg',
           "product-4's own data is untouched by the conflict check")

        ck(not errs2, "no page errors: %s" % errs2)
        await page2.close()

        await b.close()

    print(("\n%d FAILED" % len(fails)) if fails else "\nproduct key corruption: all cases pass")
    sys.exit(1 if fails else 0)

srv = serve_static()
asyncio.run(main())
