'use strict';
// Puts user-src/ch.css into user-src/index.html between /* CH-START */ and /* CH-END */ (the block sits right before /* V2-END */).
// Edit ch.css, run `node apply-ch.js`, then `node build-core.js`.
const fs = require('fs');
const css = fs.readFileSync(__dirname + '/user-src/ch.css', 'utf8').replace(/\s+$/, '');
const file = __dirname + '/user-src/index.html';
let html = fs.readFileSync(file, 'utf8');
const a = html.indexOf('/* CH-START */'), b = html.indexOf('/* CH-END */');
if (a >= 0 && b > a) html = html.slice(0, a) + css + html.slice(b + '/* CH-END */'.length);
else { const v = html.indexOf('/* V2-END */'); if (v < 0) throw new Error('no V2-END marker'); html = html.slice(0, v) + css + '\n' + html.slice(v); }
fs.writeFileSync(file, html);
console.log('ch.css applied (' + css.length + ' bytes)');
