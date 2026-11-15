#!/usr/bin/env node
'use strict';
// Moves the DNS "A" records that point at the OLD server to the NEW server (used by migrate.sh). Domains are at Hostinger (the same API as hostinger-dns.js).
//   node dns-move.js plan   --old IP --new IP --hosts FILE --tokens "file1,file2"           show what would change, change nothing
//   node dns-move.js ttl    ...                                                              lower the timer of those records to 300 seconds (so the later switch is quick)
//   node dns-move.js switch ... --backup FILE [--old6 "ipv6,ipv6"]                           old IP -> new IP (and drop AAAA records that point at the old server)
//   node dns-move.js back   ... --backup FILE                                                put every record changed by "switch" back as it was
//   node dns-move.js verify ... --hosts FILE                                                 ask public resolvers where each address points now
// Only the records whose content is the OLD address are touched (replace-by-name-and-type, the rest of the zone is never rewritten). Tokens are never printed.
// Exit code: 0 all done, 2 done but some addresses are at a DNS host we have no token for (listed), 1 error.
const fs = require('fs'), dns = require('dns');
const API = process.env.HOSTINGER_API || 'https://developers.hostinger.com';
const args = process.argv.slice(2), mode = args.shift();
const opt = {}; for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
const die = (m) => { console.error(m); process.exit(1); };
const IP = /^\d{1,3}(\.\d{1,3}){3}$/;
const OLD = opt.old, NEW = opt.new;
if (!['plan', 'ttl', 'switch', 'back', 'verify'].includes(mode)) die('modes: plan | ttl | switch | back | verify');
if (!IP.test(OLD || '') || !IP.test(NEW || '')) die('need --old IP and --new IP');
const hosts = fs.existsSync(opt.hosts || '') ? fs.readFileSync(opt.hosts, 'utf8').split(/\s+/).map(s => s.trim().toLowerCase()).filter(h => h && !h.startsWith('*') && h.includes('.')) : [];
const tokens = [...new Set(String(opt.tokens || '').split(',').filter(f => f && fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8').replace(/\s+/g, '')).filter(Boolean))];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function call(token, method, zone, body) {
  const r = await fetch(API + '/api/dns/v1/zones/' + encodeURIComponent(zone), {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) {}
  if (!r.ok) { const e = new Error('Hostinger said ' + r.status + ' for ' + method + ' ' + zone + ': ' + text.slice(0, 200)); e.status = r.status; throw e; }
  return json;
}
// the API answers with a list of {name,type,ttl,records:[{content}]} (possibly inside "data")
const items = (z) => (Array.isArray(z) ? z : (z && (z.data || z.zone || z.records)) || []).filter(x => x && x.name !== undefined && x.type);
const contents = (it) => (it.records || []).map(r => String(r.content === undefined ? r : r.content));
const put = (tok, zone, name, type, ttl, vals) => call(tok, 'PUT', zone, { overwrite: true, zone: [{ name, type, ttl, records: vals.map(content => ({ content })) }] });
const del = (tok, zone, name, type) => call(tok, 'DELETE', zone, { filters: [{ name, type }] });

function candidates(host) { const p = host.split('.'), out = []; for (let i = 0; i <= p.length - 2; i++) out.push(p.slice(i).join('.')); return out; }   // longest first
async function findZones(list) {
  const found = new Map(), dead = new Set(), lost = [];
  for (const h of list) {
    if ([...found.keys()].some(z => h === z || h.endsWith('.' + z))) continue;
    let ok = false;
    for (const c of candidates(h)) {
      if (dead.has(c)) continue;
      for (const t of tokens) {
        try { const z = await call(t, 'GET', c); found.set(c, { token: t, items: items(z) }); ok = true; break; }
        catch (e) { if (e.status === 429) { await sleep(3000); } }
      }
      if (ok) break; dead.add(c);
    }
    if (!ok) lost.push(h);
  }
  return { found, lost };
}

(async () => {
  if (mode === 'verify') {
    const R = new dns.promises.Resolver(); R.setServers(['1.1.1.1', '8.8.8.8']);
    let bad = 0;
    for (const h of hosts) { const a = await R.resolve4(h).catch(() => []); const ok = a.length && a.every(x => x === NEW); if (!ok) bad++; console.log((ok ? 'NEW   ' : 'OTHER ') + h + ' -> ' + (a.join(', ') || 'no answer')); }
    console.log(bad ? bad + ' address(es) still answer with the old (or another) address: public resolvers keep an answer until its timer ends. Run this again later.' : 'every address answers with the new server');
    return;
  }
  if (!tokens.length) { console.log('No Hostinger token found: DNS must be changed by hand (see the list below).'); }
  const { found, lost } = tokens.length ? await findZones(hosts) : { found: new Map(), lost: hosts };
  const old6 = String(opt.old6 || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const changes = []; let maxTtl = 0, before = 0;
  if (mode === 'back') {
    const b = JSON.parse(fs.readFileSync(opt.backup, 'utf8'));
    for (const c of b.changes) {
      const tok = (found.get(c.zone) || {}).token || tokens[0]; if (!tok) { console.log('cannot restore (no token): ' + c.zone + ' ' + c.name + ' ' + c.type); continue; }
      await put(tok, c.zone, c.name, c.type, c.before.ttl, c.before.contents); console.log('restored ' + (c.name === '@' ? '' : c.name + '.') + c.zone + ' ' + c.type + ' -> ' + c.before.contents.join(', '));
    }
    return;
  }
  for (const [zone, z] of found) {
    for (const it of z.items) {
      const cs = contents(it), ttl = Number(it.ttl) || 0;
      if (it.type === 'A' && cs.includes(OLD)) {
        before++; maxTtl = Math.max(maxTtl, ttl);
        const after = cs.map(c => c === OLD ? NEW : c);
        changes.push({ zone, name: it.name, type: 'A', before: { ttl, contents: cs }, after: { ttl: 300, contents: after }, token: z.token });
      } else if (it.type === 'AAAA' && mode === 'switch' && old6.length && cs.length && cs.some(c => old6.includes(c.toLowerCase()))) {
        const rest = cs.filter(c => !old6.includes(c.toLowerCase()));
        changes.push({ zone, name: it.name, type: 'AAAA', before: { ttl, contents: cs }, after: { ttl, contents: rest }, token: z.token });
      }
    }
  }
  console.log('zones reachable with the Hostinger token: ' + ([...found.keys()].join(', ') || 'none'));
  for (const c of changes) console.log((mode === 'plan' ? 'would change ' : mode === 'ttl' ? 'timer ' : 'change ') + (c.name === '@' ? '' : c.name + '.') + c.zone + ' ' + c.type + '  ' + c.before.contents.join(',') + ' (timer ' + c.before.ttl + ')  ->  ' + (mode === 'ttl' ? c.before.contents.join(',') + ' (timer 300)' : c.after.contents.length ? c.after.contents.join(',') + ' (timer ' + c.after.ttl + ')' : 'removed'));
  if (!changes.length) console.log('no record of the reachable zones points at ' + OLD + (mode === 'switch' ? ' (already moved?)' : ''));
  console.log('MAXTTL=' + maxTtl);
  if (mode === 'switch' && changes.length) {   // the backup is written BEFORE the first change, so "back" always has what it needs
    if (!opt.backup) die('--backup FILE is required for switch');
    fs.writeFileSync(opt.backup, JSON.stringify({ time: new Date().toISOString(), old: OLD, new: NEW, changes: changes.map(({ token, ...c }) => c) }, null, 1), { mode: 0o600 });
  }
  if (mode === 'ttl') for (const c of changes) if (c.before.ttl > 300 || !c.before.ttl) await put(c.token, c.zone, c.name, 'A', 300, c.before.contents);
  if (mode === 'switch') for (const c of changes) {
    if (c.type === 'A') await put(c.token, c.zone, c.name, 'A', 300, c.after.contents);
    else if (c.after.contents.length) await put(c.token, c.zone, c.name, 'AAAA', c.after.ttl, c.after.contents);
    else await del(c.token, c.zone, c.name, 'AAAA');
  }
  if (lost.length) {
    console.log('NOT at Hostinger (or no token for them): change these by hand at the place that hosts their DNS, so that they point at ' + NEW + ':');
    for (const h of lost) { const ip = await dns.promises.resolve4(h).catch(() => []); if (ip.includes(OLD) || !ip.length) console.log('  ' + h + '   (now ' + (ip.join(', ') || 'no answer') + ')'); }
    process.exitCode = 2;
  }
})().catch(e => die('dns-move: ' + (e && e.message || e)));
