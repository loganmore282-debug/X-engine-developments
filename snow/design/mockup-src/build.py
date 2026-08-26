#!/usr/bin/env python3
"""Snow mockup generator -- built against Codex's design-system spec.
Round 4 (Codex-authored tokens, wave hero, wine/black/white/green only) then
Round 5: applied Codex's critique of the round-4 screenshots -- see
snow/AGENT_LOG.md for the full list of what changed and why.

Regenerate: python3 build.py
Screenshot: python3 shot.py (Playwright, chromium at /opt/pw-browsers/chromium)
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
# Path from the COMMITTED location (snow/design/mockup-src/) to the reference
# bottle photos (snow/design/reference-bottles/) -- siblings under design/.
BOTTLES_REL = "../reference-bottles"

STYLE = """
:root{
  --snow-canvas:#FCFBF9;
  --snow-surface:#FFFFFF;
  --snow-ink:#111111;
  --snow-muted:#737373;
  --snow-wine:#941827;
  --snow-wine-deep:#71101B;
  --snow-green:#2F6B47;
  --snow-border:#E8E4E1;
  --snow-wave-on-wine:#8FE0AE;   /* thin decorative lines on wine surfaces only -- plain --snow-green goes muddy there */
  --snow-wine-soft:#F6E9EB;
  --snow-green-soft:#EEF6F0;
  --snow-neutral-soft:#F1EFEC;
  --snow-radius-card:28px;
  --snow-radius-tile:20px;
  --snow-radius-control:24px;
  --snow-radius-sheet:32px;
}
*{box-sizing:border-box;}
body{margin:0;background:var(--snow-canvas);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--snow-ink);-webkit-font-smoothing:antialiased;}
.mono{font-variant-numeric:tabular-nums;}
button{cursor:pointer;font-family:inherit;}

.app-card{background:var(--snow-surface);border:1px solid var(--snow-border);border-radius:var(--snow-radius-card);box-shadow:0 14px 34px -24px rgba(17,17,17,.25);}
.primary-button{background:var(--snow-wine);color:#fff;border:none;border-radius:var(--snow-radius-control);font-weight:700;}
.secondary-button{background:transparent;color:var(--snow-wine);border:1.5px solid var(--snow-wine);border-radius:var(--snow-radius-control);font-weight:600;}
.status-pill{display:inline-block;border-radius:999px;font-size:10.5px;font-weight:600;padding:3px 10px;}
.status-pill.active{background:var(--snow-green-soft);color:var(--snow-green);}
.status-pill.pending{background:var(--snow-neutral-soft);color:var(--snow-muted);}

.top-bar{display:flex;align-items:center;justify-content:space-between;padding:24px 20px 4px;}
.bottom-nav{background:var(--snow-surface);border-top:1px solid var(--snow-border);display:flex;align-items:center;justify-content:space-around;}
.navitem{display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--snow-muted);}
.navitem.active{color:var(--snow-wine);}
.navitem .lbl{font-size:10.5px;}
.navitem.active .lbl{font-weight:600;}

/* full-bleed hero: Home only -- big wave + both corner line sets */
.brand-hero--full{position:relative;overflow:hidden;min-height:290px;padding-bottom:112px;background:linear-gradient(145deg,var(--snow-wine) 0%,var(--snow-wine-deep) 100%);color:#fff;}
.brand-wave--full{position:absolute;inset:auto 0 -1px;width:100%;height:126px;display:block;}
/* compact wine card: Team referral code / Account identity -- no white wave, top-right lines only */
.brand-card{background:linear-gradient(145deg,var(--snow-wine) 0%,var(--snow-wine-deep) 100%);border-radius:var(--snow-radius-card);position:relative;overflow:hidden;color:#fff;}

.wordmark{display:flex;align-items:center;gap:9px;}
.wordmark .wm-text{font-weight:800;letter-spacing:2px;}

.stat-label{font-size:10px;color:var(--snow-muted);text-transform:uppercase;letter-spacing:.35px;}
.stat-val{font-variant-numeric:tabular-nums;font-size:12.5px;font-weight:600;color:var(--snow-ink);margin-top:2px;}
.section-title{font-size:17px;font-weight:800;color:var(--snow-ink);}

.stat-tile{background:var(--snow-surface);border:1px solid var(--snow-border);border-radius:var(--snow-radius-tile);padding:12px;}
.icon-tile{border-radius:13px;background:var(--snow-wine-soft);color:var(--snow-wine);display:flex;align-items:center;justify-content:center;flex-shrink:0;}

.product-card{background:var(--snow-surface);border:1px solid var(--snow-border);border-radius:var(--snow-radius-card);padding:16px;box-shadow:0 14px 34px -24px rgba(17,17,17,.25);}
.product-card__stats{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.18fr);gap:10px 16px;}
.product-card__cta{width:100%;min-height:44px;margin-top:16px;}
.product-card__thumb{width:56px;height:56px;border-radius:16px;object-fit:cover;flex-shrink:0;background:var(--snow-neutral-soft);}

.plan-card{background:var(--snow-surface);border:1px solid var(--snow-border);border-radius:var(--snow-radius-card);padding:18px;box-shadow:0 14px 34px -24px rgba(17,17,17,.25);}

.segmented-control{display:flex;background:var(--snow-neutral-soft);border-radius:16px;padding:4px;gap:4px;}
.segmented-control .seg{flex:1;text-align:center;padding:9px 0;border-radius:12px;font-size:13px;font-weight:500;color:var(--snow-muted);}
.segmented-control .seg.active{background:#fff;font-weight:700;color:var(--snow-wine);box-shadow:0 4px 12px -8px rgba(17,17,17,.3);}

.settings-list{background:var(--snow-surface);border:1px solid var(--snow-border);border-radius:var(--snow-radius-card);padding:4px 16px;}
.list-row{display:flex;align-items:center;gap:12px;padding:14px 4px;border-bottom:1px solid var(--snow-border);}
.list-row:last-child{border-bottom:none;}
"""

def snowflake_svg(color, size=17):
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.6" stroke-linecap="round"><path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11"/><path d="M12 2l-2 2.3M12 2l2 2.3M12 22l-2-2.3M12 22l2-2.3M4.2 6.5l3 .3M4.2 6.5l1-2.8M19.8 6.5l-3 .3M19.8 6.5l-1-2.8M4.2 17.5l3-.3M4.2 17.5l1 2.8M19.8 17.5l-3-.3M19.8 17.5l-1 2.8"/></svg>'

def wm(size=17, text_size=19, on_dark=False):
    text_color = "#fff" if on_dark else "var(--snow-ink)"
    return f'<div class="wordmark">{snowflake_svg("var(--snow-green)", size)}<div class="wm-text" style="font-size:{text_size}px;color:{text_color};">SNOW</div></div>'

# Codex's exact curved wave-line paths, stroke set per Codex's instruction
# (stroke-width 1.4, fill none, color = --snow-wave-on-wine)
def wave_lines_top_right(w=140, h=133):
    return f'''<svg viewBox="0 0 190 180" aria-hidden="true" style="position:absolute;top:-4px;right:-6px;width:{w}px;height:{h}px;opacity:.9;">
  <path d="M-18 -8 C40 0 69 42 96 86 C121 127 151 150 202 155" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
  <path d="M0 -21 C55 -4 84 35 109 80 C134 123 162 143 205 147" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
  <path d="M20 -34 C70 -8 99 29 123 73 C148 116 174 136 208 140" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
  <path d="M40 -47 C85 -14 114 23 138 66 C161 108 186 128 211 132" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
</svg>'''

def wave_lines_lower_left(w=150, h=88):
    return f'''<svg viewBox="0 0 190 112" aria-hidden="true" style="position:absolute;bottom:-4px;left:-6px;width:{w}px;height:{h}px;opacity:.9;">
  <path d="M-18 100 C22 72 57 62 93 81 C124 98 154 79 204 53" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
  <path d="M-18 86 C23 58 60 48 97 67 C128 84 158 65 204 39" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
  <path d="M-18 72 C25 45 64 35 101 53 C132 70 162 51 204 26" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
  <path d="M-18 58 C28 32 68 22 105 39 C136 56 165 37 204 13" stroke="var(--snow-wave-on-wine)" stroke-width="1.4" fill="none"/>
</svg>'''

def brand_wave_full():
    return '''<svg class="brand-wave--full" viewBox="0 0 390 126" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 104
           C58 68 104 61 154 83
           C205 105 251 95 296 62
           C332 36 362 23 390 31
           L390 126 L0 126 Z"
        fill="var(--snow-canvas)"></path>
</svg>'''

ICONS = {
    "bell": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
    "deposit": '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v8"/><path d="M8.5 12 12 15.5 15.5 12"/></svg>',
    "withdraw": '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-8"/><path d="M8.5 12 12 8.5 15.5 12"/></svg>',
    "chev": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    "home": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9"/></svg>',
    "box": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5 12 4 3 8.5 12 13l9-4.5Z"/><path d="M3 8.5V16l9 4.5 9-4.5V8.5"/><path d="M12 13v7.5"/></svg>',
    "team": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 8.5a3 3 0 1 1 3.5 2.96"/><path d="M15 14.5c3 .3 5.5 2.3 5.5 5.5"/></svg>',
    "user": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    "clock": '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12.5" r="8"/><path d="M12 8.5v4l3 2"/></svg>',
    "copy": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15 8.5V6A1.5 1.5 0 0 0 13.5 4.5H6A1.5 1.5 0 0 0 4.5 6v7.5A1.5 1.5 0 0 0 6 15h2.5"/></svg>',
    "share": '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="6" r="2.3"/><circle cx="6" cy="12" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8.1 10.8 15.9 7.2M8.1 13.2l7.8 3.6"/></svg>',
    "wallet": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M15.5 14.5h2.5"/></svg>',
    "shield": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
    "doc": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/></svg>',
    "headset": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4.5" height="6" rx="1.5"/><rect x="16.5" y="13" width="4.5" height="6" rx="1.5"/><path d="M20 19v.5A3.5 3.5 0 0 1 16.5 23H13"/></svg>',
    "download": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8 11.5 12 15.5 16 11.5"/><path d="M5 18.5h14"/></svg>',
    "logout": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h3"/><path d="M14.5 8.5 19 12l-4.5 3.5"/><path d="M19 12H9.5"/></svg>',
}

def nav_bar(active):
    items = [("home","Home"),("box","My Products"),("team","Team"),("user","Account")]
    html = '<div class="bottom-nav" style="height:72px;">'
    for key,label in items:
        cls = "navitem active" if key==active else "navitem"
        html += f'<div class="{cls}">{ICONS[key]}<div class="lbl">{label}</div></div>'
    html += '</div>'
    return html

def top_bar(on_dark=False):
    return f'''<div class="top-bar">
    {wm(15,17,on_dark=on_dark)}
    <div style="width:38px;height:38px;border-radius:14px;background:{"rgba(255,255,255,.16)" if on_dark else "var(--snow-surface)"};{"border:1px solid var(--snow-border);" if not on_dark else ""}display:flex;align-items:center;justify-content:center;color:{"#fff" if on_dark else "var(--snow-ink)"};">{ICONS['bell']}</div>
  </div>'''

def page(title, body):
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>{STYLE}</style>
</head>
<body>
<div style="width:390px;position:relative;background:var(--snow-canvas);">
{body}
</div>
</body></html>"""

# Full 10-tier catalog, confirmed in snow/CLAUDE.md
PRODUCTS = [
    ("01-qing-shuang.jpg",              "Snow Qing Shuang",                         "30,000",    "6,000",   "900,000"),
    ("02-ice-cool-bing-ku.jpg",         "Snow Ice Cool (Bing Ku)",                  "90,000",    "18,000",  "2,700,000"),
    ("03-brave-the-world.jpg",          "Snow Brave the World",                     "197,000",   "39,400",  "5,910,000"),
    ("04-classic-old-snow.jpg",         "Snow Classic (Old Snow)",                  "355,000",   "71,000",  "10,650,000"),
    ("05-draft-beer-chun-sheng.jpg",    "Snow Draft Beer (Chun Sheng)",             "560,000",   "112,000", "16,800,000"),
    ("06-brave-the-world-superx.jpg",   "Snow Brave the World SuperX",              "950,000",   "190,000", "28,500,000"),
    ("07-marrs-green.jpg",              "Snow Marrs Green",                         "1,000,000", "200,000", "30,000,000"),
    ("08-master-artisan.jpg",           "Snow Jiang Xin Ying Zao (Master Artisan)", "1,250,000", "250,000", "37,500,000"),
    ("09-opera-mask-lianpu.jpg",        "Snow Opera Mask Series (Lianpu)",          "2,550,000", "510,000", "76,500,000"),
    ("10-li.jpg",                       'Snow "Li" (醴)',                       "4,500,000", "900,000", "135,000,000"),
]

# ---------------- HOME ----------------
home_body = f"""
<div class="brand-hero--full">
  {wave_lines_top_right()}
  {wave_lines_lower_left()}
  <div style="position:relative;padding:22px 20px 0;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      {wm(on_dark=True)}
      <div style="width:38px;height:38px;border-radius:14px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;color:#fff;">{ICONS['bell']}</div>
    </div>
    <div style="margin-top:26px;">
      <div style="font-size:12.5px;opacity:.82;">Wallet Balance</div>
      <div class="mono" style="font-size:32px;font-weight:800;margin-top:4px;">UGX 248,500</div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <div style="flex:1;background:rgba(255,255,255,.14);border-radius:16px;padding:10px 12px;">
          <div style="font-size:11px;opacity:.8;">Total Earned</div>
          <div class="mono" style="font-size:14.5px;font-weight:700;margin-top:2px;">UGX 4,750,000</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,.14);border-radius:16px;padding:10px 12px;">
          <div style="font-size:11px;opacity:.8;">Total Invested</div>
          <div class="mono" style="font-size:14.5px;font-weight:700;margin-top:2px;">UGX 475,000</div>
        </div>
      </div>
    </div>
  </div>
  {brand_wave_full()}
</div>

<div style="display:flex;gap:12px;margin:-6px 20px 0;position:relative;z-index:1;">
  <button class="primary-button" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 0;font-size:14.5px;">{ICONS['deposit']}Deposit</button>
  <button class="secondary-button" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 0;font-size:14.5px;">{ICONS['withdraw']}Withdraw</button>
</div>

<div class="app-card" style="margin:18px 20px 0;padding:20px 22px;background:var(--snow-green-soft);border-color:transparent;">
  <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--snow-green);font-weight:700;">Referral Program</div>
  <div style="font-size:18px;font-weight:800;margin-top:4px;max-width:250px;line-height:1.25;color:var(--snow-ink);">Earn 27% on every referral&rsquo;s first investment</div>
</div>

<div style="display:flex;align-items:baseline;justify-content:space-between;margin:26px 20px 12px;">
  <div class="section-title">Investment Plans</div>
  <div style="font-size:12.5px;color:var(--snow-muted);">10 plans</div>
</div>

<div style="display:flex;flex-direction:column;gap:12px;margin:0 20px;">
"""

for img, name, inv, daily, total in PRODUCTS:
    home_body += f"""
  <div class="product-card">
    <div style="display:flex;align-items:center;gap:14px;">
      <img class="product-card__thumb" src="{BOTTLES_REL}/{img}" alt="{name}">
      <div style="flex:1;min-width:0;font-size:14.5px;font-weight:700;color:var(--snow-ink);">{name}</div>
    </div>
    <div class="product-card__stats" style="margin-top:12px;">
      <div><div class="stat-label">Investment</div><div class="stat-val mono">UGX {inv}</div></div>
      <div><div class="stat-label">Daily Cashback</div><div class="stat-val mono" style="color:var(--snow-green);">UGX {daily}</div></div>
      <div><div class="stat-label">Duration</div><div class="stat-val mono">150 days</div></div>
      <div><div class="stat-label">Total Return</div><div class="stat-val mono">UGX {total}</div></div>
    </div>
    <button class="primary-button product-card__cta">Invest</button>
  </div>
"""

home_body += "</div>\n<div style='height:16px;'></div>\n" + nav_bar("home")

with open(os.path.join(OUT, "Home.html"), "w") as f:
    f.write(page("Snow — Home", home_body))

print("wrote Home.html")

# ---------------- MY PRODUCTS ----------------
mp_body = f"""
{top_bar()}

<div style="margin:16px 20px 0;">
  <div style="font-size:22px;font-weight:800;color:var(--snow-ink);">My Products</div>
  <div style="font-size:13px;color:var(--snow-muted);margin-top:3px;">3 active plans &middot; UGX 4,750,000 earned so far</div>
</div>

<div style="display:flex;gap:10px;margin:16px 20px 0;">
  <div class="stat-tile" style="flex:1;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Active Plans</div>
    <div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;">3</div>
  </div>
  <div class="stat-tile" style="flex:1;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Total Invested</div>
    <div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;">UGX 475,000</div>
  </div>
  <div class="stat-tile" style="flex:1;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Total Earned</div>
    <div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;color:var(--snow-green);">UGX 4,750,000</div>
  </div>
</div>

<div class="section-title" style="margin:26px 20px 12px;">Active Plans</div>

<div style="display:flex;flex-direction:column;gap:14px;margin:0 20px;">
"""

plans = [
    ("02-ice-cool-bing-ku.jpg", "Snow Ice Cool (Bing Ku)", "90,000", "18,000", 112, "2,016,000", "07:42:11"),
    ("04-classic-old-snow.jpg", "Snow Classic (Old Snow)", "355,000", "71,000", 38, "2,698,000", "14:05:52"),
    ("01-qing-shuang.jpg", "Snow Qing Shuang", "30,000", "6,000", 6, "36,000", "22:58:03"),
]
for img, name, inv, daily, day, earned, countdown in plans:
    pct = round(day/150*100)
    mp_body += f"""
  <div class="plan-card">
    <div style="display:flex;align-items:center;gap:12px;">
      <img class="product-card__thumb" style="width:40px;height:40px;border-radius:12px;" src="{BOTTLES_REL}/{img}" alt="{name}">
      <div style="flex:1;min-width:0;">
        <div style="font-size:14.5px;font-weight:700;color:var(--snow-ink);">{name}</div>
        <div style="font-size:12px;color:var(--snow-muted);margin-top:1px;">UGX {inv} invested &middot; UGX {daily}/day</div>
      </div>
      <div style="color:var(--snow-muted);flex-shrink:0;">{ICONS['chev']}</div>
    </div>
    <div style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--snow-muted);margin-bottom:6px;">
        <span>Day {day} of 150</span>
        <span class="mono" style="color:var(--snow-green);font-weight:600;">+UGX {earned} earned</span>
      </div>
      <div style="height:8px;border-radius:999px;background:var(--snow-neutral-soft);overflow:hidden;"><div style="height:100%;border-radius:999px;background:var(--snow-green);width:{pct}%;"></div></div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:14px;color:var(--snow-muted);font-size:12px;">
      {ICONS['clock']} Next cashback in <span class="mono" style="color:var(--snow-ink);font-weight:600;">{countdown}</span>
    </div>
  </div>
"""

mp_body += "</div>\n<div style='height:16px;'></div>\n" + nav_bar("box")

with open(os.path.join(OUT, "MyProducts.html"), "w") as f:
    f.write(page("Snow — My Products", mp_body))

print("wrote MyProducts.html")

# ---------------- TEAM ----------------
team_body = f"""
{top_bar()}

<div style="margin:16px 20px 0;">
  <div style="font-size:22px;font-weight:800;color:var(--snow-ink);">Team</div>
  <div style="font-size:13px;color:var(--snow-muted);margin-top:3px;">Invite friends, earn on every level</div>
</div>

<div class="brand-card" style="margin:16px 20px 0;padding:20px;">
  {wave_lines_top_right(110, 104)}
  <div style="position:relative;">
    <div style="font-size:12px;opacity:.82;">Your Referral Code</div>
    <div class="mono" style="font-size:27px;font-weight:800;letter-spacing:1px;margin-top:4px;">Sn7Qk2</div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px;background:rgba(255,255,255,.16);border-radius:14px;padding:9px 12px;">
      <div class="mono" style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">snow-platform.com/r/Sn7Qk2</div>
      {ICONS['copy']}
    </div>
    <button style="width:100%;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;color:var(--snow-wine);border:none;border-radius:var(--snow-radius-control);padding:12px 0;font-size:13.5px;font-weight:700;">
      {ICONS['share']} Share Referral Link
    </button>
  </div>
</div>

<div style="display:flex;gap:10px;margin:16px 20px 0;">
  <div class="stat-tile" style="flex:1;text-align:center;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Level 1</div>
    <div class="mono" style="font-size:17px;font-weight:800;margin-top:3px;color:var(--snow-wine);">27%</div>
  </div>
  <div class="stat-tile" style="flex:1;text-align:center;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Level 2</div>
    <div class="mono" style="font-size:17px;font-weight:800;margin-top:3px;color:var(--snow-wine);">2%</div>
  </div>
  <div class="stat-tile" style="flex:1;text-align:center;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Level 3</div>
    <div class="mono" style="font-size:17px;font-weight:800;margin-top:3px;color:var(--snow-wine);">1%</div>
  </div>
</div>

<div style="display:flex;gap:10px;margin:10px 20px 0;">
  <div class="stat-tile" style="flex:1;text-align:center;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Total Team</div>
    <div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;">38</div>
  </div>
  <div class="stat-tile" style="flex:1;text-align:center;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Active Referrals</div>
    <div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;">14</div>
  </div>
  <div class="stat-tile" style="flex:1;text-align:center;">
    <div style="font-size:10.5px;color:var(--snow-muted);">Team Deposits</div>
    <div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;">UGX 3,140,000</div>
  </div>
</div>

<div class="segmented-control" style="margin:22px 20px 0;">
  <div class="seg active">Level 1</div>
  <div class="seg">Level 2</div>
  <div class="seg">Level 3</div>
</div>

<div class="settings-list" style="margin:14px 20px 0;padding:6px 16px;">
"""

members = [
    ("A", "+2567****0389", "Joined 3 days ago", "active", "Active"),
    ("M", "+2567****2214", "Joined 6 days ago", "active", "Active"),
    ("J", "+2567****7735", "Joined 1 week ago", "pending", "Pending"),
    ("R", "+2567****9042", "Joined 2 weeks ago", "active", "Active"),
]
for initial, phone, joined, pillcls, plabel in members:
    team_body += f"""
  <div class="list-row">
    <div style="width:38px;height:38px;border-radius:50%;background:var(--snow-wine-soft);color:var(--snow-wine);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">{initial}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13.5px;font-weight:600;color:var(--snow-ink);">{phone}</div>
      <div style="font-size:11px;color:var(--snow-muted);margin-top:1px;">{joined}</div>
    </div>
    <div class="status-pill {pillcls}">{plabel}</div>
  </div>
"""

team_body += "</div>\n<div style='height:16px;'></div>\n" + nav_bar("team")

with open(os.path.join(OUT, "Team.html"), "w") as f:
    f.write(page("Snow — Team", team_body))

print("wrote Team.html")

# ---------------- ACCOUNT ----------------
account_body = f"""
{top_bar()}

<div class="brand-card" style="margin:16px 20px 0;padding:22px;">
  {wave_lines_top_right(110, 104)}
  <div style="position:relative;display:flex;align-items:center;gap:16px;">
    <div style="width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;">{snowflake_svg('#fff',26)}</div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:7px;">
        <div class="mono" style="font-size:15.5px;font-weight:700;">+2567 12 345 678</div>
        {ICONS['copy']}
      </div>
      <div style="display:flex;align-items:center;gap:7px;margin-top:5px;">
        <div class="mono" style="font-size:12.5px;opacity:.85;">ID: 004128</div>
        {ICONS['copy']}
      </div>
    </div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 20px 0;">
"""

tiles = [
    ("wallet", "Withdrawal Account"),
    ("deposit", "Deposit History"),
    ("withdraw", "Withdrawal History"),
    ("shield", "Security PIN"),
]
for key, label in tiles:
    account_body += f"""
  <div class="stat-tile" style="display:flex;flex-direction:column;align-items:flex-start;gap:8px;">
    <div class="icon-tile" style="width:34px;height:34px;">{ICONS[key]}</div>
    <div style="font-size:12.5px;font-weight:700;color:var(--snow-ink);">{label}</div>
  </div>
"""

account_body += """
</div>

<div class="settings-list" style="margin:20px 20px 0;">
"""

menu = [
    ("doc", "About Snow"),
    ("doc", "Rules &amp; Terms"),
    ("headset", "Support"),
    ("download", "Get App"),
]
for key, label in menu:
    account_body += f"""
  <div class="list-row">
    <div style="color:var(--snow-wine);flex-shrink:0;">{ICONS[key]}</div>
    <div style="flex:1;font-size:14px;font-weight:500;color:var(--snow-ink);">{label}</div>
    <div style="color:var(--snow-muted);">{ICONS['chev']}</div>
  </div>
"""
account_body += f"""
  <div class="list-row">
    <div style="color:var(--snow-wine-deep);flex-shrink:0;">{ICONS['logout']}</div>
    <div style="flex:1;font-size:14px;font-weight:600;color:var(--snow-wine-deep);">Log Out</div>
  </div>
</div>
"""

account_body += "<div style='height:16px;'></div>\n" + nav_bar("user")

with open(os.path.join(OUT, "Account.html"), "w") as f:
    f.write(page("Snow — Account", account_body))

print("wrote Account.html")
