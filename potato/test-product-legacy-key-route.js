// Unit-level check of /admin/products/fix-legacy-keys's matching logic,
// pulled straight out of server.js so a future edit to the route cannot
// silently drift from what this pins.
//
// The route repairs the real bug: the admin panel used to run its
// slug-making regex over an EXISTING product key too, stripping the hyphen
// out of "product-1" and saving under "product1" instead -- a second,
// separate document, side by side with the untouched "product-1" default.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

const route = src.slice(src.indexOf("app.post('/admin/products/fix-legacy-keys'"),
                         src.indexOf("app.post('/admin/products/fix-legacy-keys'") + 3000);
ck(route.includes("verifyOwner(req)"), 'the route is owner-gated, same as every other product-mutating route');
ck(route.includes("strippedKey === properKey"), 'skips keys with no hyphen to have been stripped in the first place');
ck(route.includes('conflicts.push'), 'a genuine conflict (both copies separately edited) is reported, not merged');
ck(route.includes('if (fixed.length) await batch.commit();'),
   'commits only when there is something to actually fix -- an empty run touches nothing');
ck(route.includes('_productsCacheTs = 0'), 'the 60s product cache is invalidated so the merge is visible immediately');

// The matching rule itself: DEFAULT_PRODUCTS keys are 'product-1'..'product-12'.
// Confirm every one of them actually has a hyphen (the route's whole premise
// depends on this -- if a future default key changed shape, the "no hyphen to
// strip" skip would silently make this route a no-op for it).
const m = src.match(/const DEFAULT_PRODUCTS = (\[[\s\S]*?\n\]);/);
ck(!!m, 'DEFAULT_PRODUCTS found in server.js');
if (m) {
  const products = eval('(' + m[1] + ')');
  ck(products.length >= 10, `at least 10 default products (${products.length})`);
  for (const p of products) {
    const stripped = p.key.replace(/[^a-zA-Z0-9]+/g, '');
    ck(stripped !== p.key && stripped === p.key.replace('-', ''),
       `${p.key} strips to ${stripped} (a real, different key) -- this is exactly what the admin bug produced`);
  }
}

console.log(bad ? `\n${bad} FAILED` : '\nlegacy product key route: all cases pass');
process.exit(bad ? 1 : 0);
