#!/usr/bin/env node
'use strict';
// Generates Soda's nginx site: ONE host serving the member app, the API under
// /api and the admin panel under a secret path.
//
//   node deploy/make-nginx.js dev  <admin-path>             plain HTTP on :8090, any host/IP (testing, no domain yet)
//   node deploy/make-nginx.js prod <host> <admin-path>      HTTP on :80 for <host>; then `certbot --nginx -d <host>` adds HTTPS
//   node deploy/make-nginx.js prod <host> <admin-path> <admin-host>
//        TWO hosts: the member app + API on <host>; the admin panel (and the API it needs) ONLY on
//        <admin-host>, e.g. sv37ah.p-colasoda.com/Panel7x9k . <host> then answers 404 for the admin
//        path and for /api/admin/*, and <admin-host> shows nothing except the admin path.
//        Certbot: `certbot --nginx -d <host> -d <admin-host>`.
//   ... --also=mysoda,go     (prod only, any of the forms above)
//        EXTRA addresses of the member app: each word becomes <word>.<host> (mysoda.p-colasoda.com),
//        or give a full host name. They serve exactly the same app as <host>.
//        Re-run certbot with every name and --expand so ONE certificate covers them all.
//
// <admin-path> is the secret URL segment of the admin panel (letters/digits,
// 6+ chars), e.g. "k7q2mx9p" -> https://<host>/k7q2mx9p/ . It is NOT written
// into the app or the panel (both use relative addresses), so it can be changed
// by regenerating this file; it is deliberately not listed in robots.txt.
//
// Why a generator and not a template with placeholders: nginx's add_header
// does not inherit into a location that sets its own add_header, so every
// location here repeats the full security header set -- written once, below.
const argv = process.argv.slice(2);
const alsoArg = argv.find(x => x.startsWith('--also='));
const [mode, a, b, c] = argv.filter(x => !x.startsWith('--'));
const usage = () => { console.error('usage: node deploy/make-nginx.js dev <admin-path> | prod <host> <admin-path> [admin-host]'); process.exit(1); };
if (mode !== 'dev' && mode !== 'prod') usage();
const host = mode === 'prod' ? a : '_';
const adminPath = mode === 'prod' ? b : a;
const adminHost = mode === 'prod' && c ? c : '';
if (mode === 'prod' && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(host || '')) { console.error('Host must look like mysoda.example.com'); usage(); }
if (adminHost && (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(adminHost) || adminHost.toLowerCase() === String(host).toLowerCase())) { console.error('Admin host must be a different full host name, e.g. sv37ah.example.com'); usage(); }
const extraHosts = [];
if (alsoArg) {
  if (mode !== 'prod') { console.error('--also only applies to prod'); usage(); }
  for (const raw of alsoArg.slice(7).split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
    const h = raw.includes('.') ? raw : raw + '.' + String(host).toLowerCase();
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(h) || h.includes('..')) { console.error('Not a usable address: ' + raw); usage(); }
    if (h === String(host).toLowerCase() || h === adminHost.toLowerCase()) { console.error('"' + raw + '" is already the main or the admin address'); usage(); }
    if (!extraHosts.includes(h)) extraHosts.push(h);
  }
  if (extraHosts.length > 10) { console.error('At most 10 extra addresses'); usage(); }
}
if (!/^[A-Za-z0-9]{6,32}$/.test(adminPath || '')) { console.error('Admin path must be 6-32 letters/digits'); usage(); }
const PORT = process.env.SODA_API_PORT || '3001';
const ROOT = process.env.SODA_ROOT || '/srv/soda-src/soda';
const prod = mode === 'prod';

const MEMBER_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
// The panel's push (Firebase Cloud Messaging, until Web Push replaces it) talks to Google.
const ADMIN_CSP = MEMBER_CSP.replace("connect-src 'self'", "connect-src 'self' https://*.googleapis.com");
const PERMS = 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';
const hdr = (csp, extra = []) => [
  'add_header X-Frame-Options "DENY" always;',
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header Referrer-Policy "no-referrer" always;',
  `add_header Content-Security-Policy "${csp}" always;`,
  `add_header Permissions-Policy "${PERMS}" always;`,
  'add_header Cross-Origin-Resource-Policy "same-site" always;',
  ...(prod ? ['add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;'] : []),
  ...extra,
].map(l => '        ' + l).join('\n');
const proxy = (extra = '') => `        rewrite ^/api/(.*)$ /$1 break;
        proxy_pass http://soda_node;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;${extra}`;

const serverBlock = (name, role) => `server {
${prod ? '    listen 80;\n    listen [::]:80;' : '    listen 8090;\n    listen [::]:8090;'}
    server_name ${name};

    server_tokens off;   # inside this server only: a top-level copy clashes with other sites' files
    # Compress what compresses (the app page is ~350 KB of script; JSON replies shrink a lot too).
    # Inside this server only, so it never clashes with a gzip line in the main nginx.conf.
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_vary on;
    gzip_types text/plain text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml;
    client_max_body_size 8m;
${prod ? `
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
` : ''}
    # ── API: /api/x -> Node /x ────────────────────────────────────────
${role === 'member' ? '    # two-host setup: the admin API is reachable only on the admin host\n    location ^~ /api/admin/ { return 404; }\n' : ''}    location ~ ^/api/admin/(login|check-key)$ {
        limit_req zone=soda_admin_login burst=5 nodelay;
${hdr(MEMBER_CSP, ['add_header X-Robots-Tag "noindex, nofollow" always;'])}
${proxy()}
    }
    location ~ ^/api/auth/(login|signup|password/change)$ {
        limit_req zone=soda_member_login burst=10 nodelay;
${hdr(MEMBER_CSP, ['add_header X-Robots-Tag "noindex, nofollow" always;'])}
${proxy()}
    }
    location /api/ {
        limit_req zone=soda_api burst=40 nodelay;
${hdr(MEMBER_CSP, ['add_header X-Robots-Tag "noindex, nofollow" always;'])}
${proxy()}
    }
    location = /health { proxy_pass http://127.0.0.1:${PORT}/health; access_log off; }

${role !== 'member' ? `    # ── admin panel: a secret path, same files as always ──────────────
    location = /${adminPath} { return 301 /${adminPath}/; }
    location ^~ /${adminPath}/ {
        alias ${ROOT}/admin/;
        index index.html;
        try_files $uri $uri/ =404;
${hdr(ADMIN_CSP, ['add_header X-Robots-Tag "noindex, nofollow" always;', 'add_header Cache-Control "no-cache" always;'])}
    }

` : ''}${role === 'admin' ? `    # ── admin host: nothing here except the secret path and the API behind it ──
    location = /robots.txt {
        default_type text/plain;
        return 200 "User-agent: *\\nDisallow: /\\n";
    }
    location / { return 404; }
}
` : `    # ── member app ────────────────────────────────────────────────────
    root ${ROOT}/user;
    index index.html;
    location = /robots.txt {
        default_type text/plain;
        return 200 "User-agent: *\\nDisallow: /api/\\n";
    }
    # Old-style referral links (<origin>/refCode=<code>) are a real path.
    location ^~ /refCode= { rewrite ^ /index.html break; }
    location = / {
        try_files $soda_bot_html /index.html =404;
${hdr(MEMBER_CSP, ['add_header Cache-Control "no-cache" always;'])}
    }
    location = /index.html {
        try_files $soda_bot_html /index.html =404;
${hdr(MEMBER_CSP, ['add_header Cache-Control "no-cache" always;'])}
    }
    location = /share.html {
        try_files $soda_bot_html /share.html =404;
${hdr(MEMBER_CSP, ['add_header Cache-Control "no-cache" always;'])}
    }
    location = /sw.js {
${hdr(MEMBER_CSP, ['add_header Cache-Control "no-cache" always;'])}
    }
    location = /manifest.json {
${hdr(MEMBER_CSP, ['add_header Cache-Control "no-cache" always;'])}
    }
    location / {
        try_files $uri $uri/ =404;
${hdr(MEMBER_CSP)}
    }
}
`}`;

process.stdout.write(`# Generated by deploy/make-nginx.js (${mode}) -- do not edit by hand; regenerate.
# One host: member app at /, API at /api/ (prefix stripped before it reaches
# Node on 127.0.0.1:${PORT}), admin panel at /${adminPath}/ .

# Node stays reachable over a few kept-open connections (no new TCP handshake per API call).
upstream soda_node {
    server 127.0.0.1:${PORT};
    keepalive 32;
}

limit_req_zone $binary_remote_addr zone=soda_api:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=soda_admin_login:10m rate=1r/s;
limit_req_zone $binary_remote_addr zone=soda_member_login:10m rate=3r/s;

# Link-preview crawlers (WhatsApp, Telegram, ...) get an empty page, every real
# browser gets the real one (see no-preview.html and soda/CLAUDE.md).
map $http_user_agent $soda_bot_html {
    default '';
    ~*(WhatsApp|facebookexternalhit|Facebot|TelegramBot|Twitterbot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|redditbot|Pinterest|vkShare|Viber|line-poker) '/no-preview.html';
}
${prod ? `
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_session_cache shared:SodaSSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
` : ''}
${serverBlock([host].concat(extraHosts).join(' '), adminHost ? 'member' : 'both')}${adminHost ? '\n' + serverBlock(adminHost, 'admin') : ''}`);
