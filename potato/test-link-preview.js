'use strict';
// Offline fault-injection tests execute the production payment functions.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest' });
function fn(name) {
  const node = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert(node, 'Missing production function ' + name);
  return source.slice(node.start, node.end);
}
function route(path) {
  const node = tree.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.callee.object?.name === 'app' && n.expression.arguments[0]?.value === path);
  assert(node, 'Missing route ' + path);
  return source.slice(node.start, node.end);
}
function database(seed) {
  const rows = structuredClone(seed), faults = [];
  let serial = 0;
  const fail = (col, id, patch) => {
    const at = faults.findIndex(f => f(col, id, patch));
    if (at >= 0) { faults.splice(at, 1); throw new Error('Injected storage failure'); }
  };
  function apply(row, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value?.op === 'inc') row[key] = (row[key] || 0) + value.n;
      else if (value?.op === 'union') row[key] = [...new Set([...(row[key] || []), ...value.items])];
      else if (value?.op === 'delete') delete row[key];
      else row[key] = structuredClone(value);
    }
  }
  function snapshot(col, id) {
    const value = rows[col]?.[id] && structuredClone(rows[col][id]);
    return { id, exists: !!value, data: () => structuredClone(value), ref: ref(col, id) };
  }
  function ref(col, id) {
    return { id, get: async () => snapshot(col, id),
      update: async patch => { fail(col, id, patch); assert(rows[col]?.[id]); apply(rows[col][id], patch); },
      updateIf: async (filter, patch) => {
        fail(col, id, patch);
        const row = rows[col]?.[id];
        if (!row || !Object.entries(filter).every(([k,v]) => v && '$ne' in Object(v)
          ? (Array.isArray(row[k]) ? !row[k].includes(v.$ne) : row[k] !== v.$ne) : row[k] === v)) return false;
        apply(row, patch); return true;
      },
      createIfAbsent: async data => { fail(col, id, data); rows[col] ||= {}; if (rows[col][id]) return false; rows[col][id] = {}; apply(rows[col][id], data); return true; },
      set: async data => { fail(col, id, data); rows[col] ||= {}; rows[col][id] = {}; apply(rows[col][id], data); },
      delete: async () => { delete rows[col]?.[id]; }
    };
  }
  function query(col, filters = [], limit = Infinity) {
    return { where: (key, op, value) => query(col, [...filters, [key, op, value]], limit),
      limit: n => query(col, filters, n), orderBy: () => query(col, filters, limit),
      doc: id => ref(col, id || 'generated-' + ++serial),
      add: async data => { const r = ref(col, 'generated-' + ++serial); await r.set(data); return r; },
      get: async () => {
        const docs = Object.entries(rows[col] || {}).filter(([,r]) => filters.every(([k,op,v]) => {
          if (op === '==') return r[k] === v;
          if (op === '!=') return r[k] !== v;
          if (op === 'in') return v.includes(r[k]);
          throw new Error('Unknown mock operator ' + op);
        })).slice(0, limit).map(([id]) => snapshot(col,id));
        return { docs, empty: !docs.length, size: docs.length, forEach: cb => docs.forEach(cb) };
      }
    };
  }
  return { rows, faults, collection: col => query(col) };
}

const crypto=require('node:crypto');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
function setup(settings,customImage){
  const routes={};
  const c=vm.createContext({ crypto, Buffer, console, PUBLIC_API_PREFIX:'k7x2', DEFAULT_SETTINGS:{brandName:'Potato'},
    getSettings:async()=>settings, getPotatoImage:async()=>customImage||null,
    getBrandAsset:async()=>({buf:png,mime:'image/png',version:'stock-abc'}), app:{get:(p,h)=>{routes[p]=h}} });
  vm.runInContext([fn('htmlText'),fn('brandName'),fn('linkPreviewImage')].join('\n')+'\n'+route('/public/link-preview-image')+'\n'+route('/public/link-preview-page'),c);
  const call=async(p,headers={})=>{ const out={headers:{}}; const res={set(h){Object.assign(out.headers,h);return res},status(n){out.code=n;return res},send(b){out.body=b;return res},end(){return res}};
    await routes[p]({protocol:'https',get:k=>k==='host'?'app.example.com':'',headers},res); return out; };
  return call;
}
(async()=>{
  // defaults: the brand name, the standard sentence, the app icon as the picture
  let call=setup({brandName:'Potato'});
  let r=await call('/public/link-preview-page');
  assert.match(r.body,/<meta property="og:title" content="Potato">/);
  assert.match(r.body,/<meta property="og:description" content="Join the Potato App and earn a steady income with daily earnings\. Invite friends and earn commissions\.">/);
  assert.match(r.body,/<meta property="og:image" content="https:\/\/app\.example\.com\/k7x2\/public\/link-preview-image\?v=stock-abc">/);
  assert.match(r.body,/<meta name="twitter:card" content="summary">/,'the app icon fallback is small and square');
  assert.match(r.headers['Content-Type'],/text\/html/);
  // the owner's words and picture, and nothing can break out of the page
  const jpg='data:image/jpeg;base64,'+png.toString('base64');
  call=setup({brandName:'Potato',linkPreviewTitle:'Join "Potato" <b>now</b>',linkPreviewText:'Earn & grow'},jpg);
  r=await call('/public/link-preview-page');
  assert.match(r.body,/og:title" content="Join &quot;Potato&quot; &lt;b&gt;now&lt;\/b&gt;"/);
  assert.match(r.body,/og:description" content="Earn &amp; grow"/);
  assert.match(r.body,/twitter:card" content="summary_large_image"/,'the uploaded wide picture is shown large under the text'); assert.match(r.body,/og:image:width" content="1200"/);
  assert.ok(!/<b>now/.test(r.body),'markup in the words is escaped');
  const v=/link-preview-image\?v=([a-f0-9]{12})/.exec(r.body); assert.ok(v,'the custom picture has its own version');
  // the picture route: custom first, the icon when none, with a cache tag
  let img=await call('/public/link-preview-image'); assert.equal(img.headers['Content-Type'],'image/jpeg'); assert.ok(Buffer.isBuffer(img.body)&&img.body.length===png.length);
  img=await setup({brandName:'Potato'})('/public/link-preview-image'); assert.equal(img.headers['Content-Type'],'image/png');
  console.log('PASS: link preview page and picture (real routes)');
})().catch(e=>{console.error(e);process.exit(1)});
// wiring
const nginx=fs.readFileSync(__dirname+'/deploy/make-nginx.js','utf8'), adm=fs.readFileSync(__dirname+'/admin-src/index.html','utf8'), srv=source;
assert.match(nginx,/map \$http_user_agent \$potato_tg_bot \{\s+default 0;\s+~\*TelegramBot 1;/,'only Telegram is matched');
assert.equal((nginx.match(/if \(\$potato_tg_bot\) \{ rewrite \^ \/\$\{API\}\/public\/link-preview-page last; \}/g)||[]).length,3,'the three app addresses send Telegram to the preview page');
assert.match(nginx,/map \$http_user_agent \$potato_bot_html \{[\s\S]*WhatsApp[\s\S]*'\/no-preview\.html'/,'WhatsApp still gets the empty page, so no preview');
const out=require('node:child_process').execFileSync('node',['deploy/make-nginx.js','dev','Tq5m8zr'],{encoding:'utf8',cwd:__dirname});
assert.match(out,/location = \/ \{\n\s+if \(\$potato_tg_bot\)/,'the generated config routes Telegram on the home address');
assert.match(out,/location = \/share\.html \{\n\s+if \(\$potato_tg_bot\)/,'and on the share address');
assert.ok(/id="lpTitle"/.test(adm) && /id="lpText"/.test(adm) && /linkPreviewTitle: \$\('lpTitle'\)\.value, linkPreviewText: \$\('lpText'\)\.value/.test(adm), 'the admin edits the title and the text and saves them');
assert.ok(/\[\['linkPreviewTitle', 70\], \['linkPreviewText', 260\]\]/.test(srv) && /linkPreviewTitle: '', linkPreviewText: ''/.test(srv), 'the server trims and caps them, and defaults are empty');
assert.ok(/id="linkPreviewFile"/.test(adm)&&/wirePotatoImageSlot\('linkpreview'/.test(adm)&&/fileToWideDataUrl/.test(adm),'and uploads a wide picture');
assert.ok(/WhatsApp and other apps show no preview at all/.test(adm),'the panel says WhatsApp shows none');
assert.ok(/'linkPreviewTitle', 'linkPreviewText'\]\.includes\(k\)/.test(srv)&&/'loaderbg', 'linkpreview'[^\]]*\]/.test(srv),'the words stay out of the public settings; the picture is a normal admin slot');
console.log('PASS: link preview wiring (nginx, admin)');
