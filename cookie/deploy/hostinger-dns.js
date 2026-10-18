#!/usr/bin/env node
'use strict';
// Hostinger DNS for the wildcard set-up (deploy/set-wildcard.sh): makes the *.domain record and answers the Let's Encrypt DNS check by itself, for the first
// certificate AND for every renewal (certbot calls the "auth" and "cleanup" commands, see set-wildcard.sh).
//   node deploy/hostinger-dns.js check   <domain>             token works and the domain is on this Hostinger account
//   node deploy/hostinger-dns.js wild-a  <domain> <ip>        *.<domain>  A  <ip>
//   node deploy/hostinger-dns.js auth                         (certbot) puts _acme-challenge TXT = $CERTBOT_VALIDATION, waits until it is visible
//   node deploy/hostinger-dns.js cleanup                      (certbot) removes that TXT record again
// The API token (Hostinger hPanel -> API) is read from HOSTINGER_API_TOKEN or /srv/cookie-secrets/hostinger.token (root only); it is never printed.
// A change only ever touches ONE name and type (replace-by-name-and-type), never the rest of the zone.
const fs = require('fs'), dns = require('dns');
const API = process.env.HOSTINGER_API || 'https://developers.hostinger.com';
const TOKEN_FILE = process.env.COOKIE_HOSTINGER_TOKEN_FILE || '/srv/cookie-secrets/hostinger.token';
const token = () => (process.env.HOSTINGER_API_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).replace(/\s+/g, '');
const die = (m, code = 1) => { console.error(m); process.exit(code); };
async function call(method, domain, body) {
  const t = token(); if (!t) throw new Error('No Hostinger token (' + TOKEN_FILE + ').');
  const r = await fetch(API + '/api/dns/v1/zones/' + encodeURIComponent(domain), {
    method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error('Hostinger said ' + r.status + ' for ' + method + ' ' + domain + ': ' + text.slice(0, 300));
  return json;
}
const put = (domain, name, type, ttl, values) => call('PUT', domain, { overwrite: true, zone: [{ name, type, ttl, records: values.map(content => ({ content })) }] });
const del = (domain, name, type) => call('DELETE', domain, { filters: [{ name, type }] });
// the TXT record is visible on the domain's OWN name servers (the ones Let's Encrypt asks)
async function visibleOnAuthoritative(domain, want) {
  const R = dns.promises, ns = await R.resolveNs(domain).catch(() => []), ips = [];
  for (const n of ns) ips.push(...await R.resolve4(n).catch(() => []));
  if (!ips.length) return false;
  for (const ip of ips) {
    const r = new R.Resolver(); r.setServers([ip]);
    const txt = await r.resolveTxt('_acme-challenge.' + domain).catch(() => []);
    if (!txt.some(parts => parts.join('') === want)) return false;
  }
  return true;
}
(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'check') {
    if (!a) die('usage: check <domain>');
    const z = await call('GET', a); console.log('ok: ' + (Array.isArray(z) ? z.length : (z && z.data ? z.data.length : '?')) + ' records in the zone of ' + a);
  } else if (cmd === 'wild-a') {
    if (!a || !/^\d{1,3}(\.\d{1,3}){3}$/.test(b || '')) die('usage: wild-a <domain> <ip>');
    await put(a, '*', 'A', 300, [b]); console.log('*.' + a + ' -> ' + b);
  } else if (cmd === 'auth') {
    const dom = process.env.CERTBOT_DOMAIN, val = process.env.CERTBOT_VALIDATION;
    if (!dom || !val) die('certbot did not give CERTBOT_DOMAIN / CERTBOT_VALIDATION');
    await put(dom, '_acme-challenge', 'TXT', 60, [val]);
    const until = Date.now() + 8 * 60 * 1000;
    while (Date.now() < until) { if (await visibleOnAuthoritative(dom, val)) break; await new Promise(r => setTimeout(r, 10000)); }
    await new Promise(r => setTimeout(r, 15000));   // a little longer for every name server of the zone to agree
  } else if (cmd === 'cleanup') {
    const dom = process.env.CERTBOT_DOMAIN; if (!dom) die('certbot did not give CERTBOT_DOMAIN');
    await del(dom, '_acme-challenge', 'TXT').catch(() => {});   // never fail a certificate because the tidy-up failed
  } else die('commands: check | wild-a | auth | cleanup');
})().catch(e => die('hostinger-dns: ' + (e && e.message || e)));
