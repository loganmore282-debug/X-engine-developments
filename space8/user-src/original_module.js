// ═══════════════════════════════════════════════════════════════════════
// Space8 — user app logic
// ═══════════════════════════════════════════════════════════════════════
var SERVER = 'https://mycallbackurl.onrender.com';

var STATE = {
  account: null, products: null, investments: null, settings: null,
  teamStats: null, teamMembers: {1:null,2:null,3:null}, teamExpanded: {1:false,2:false,3:false}, bankAccounts: null,
  hasPayoutPin: false, banners: {}, homeSlides: [], currentPage: 'home',
  loaded: { home:false, products:false, team:false, account:false },
  // Codex-verified real bug (2026-08-17): bumped every time the
  // 'space8-auth' listener fires (sign-in OR sign-out) -- an async render
  // function captures this value before its own fetch, then checks it's
  // unchanged before committing anything to the DOM/STATE. Without it: User
  // A opens a page, signs out before the response lands, User B signs in
  // on the same device within that window, and A's now-late response can
  // overwrite B's screen or cached data with A's own. resetUserState()
  // (below) already clears CACHED state on sign-out, but that alone
  // doesn't stop an already IN-FLIGHT request's response from landing
  // after the fact -- this closes that separate race.
  authEpoch: 0,
};
// ChatGPT-verified bug (2026-08-17): on a shared device, a real sign-out
// only ever cleared STATE.account/STATE.loaded -- STATE.teamMembers/
// teamExpanded/teamStats, STATE.investments, and STATE.bankAccounts all
// stayed cached, so the NEXT person to log in on the same browser/tab
// could still see the PREVIOUS member's referral phone numbers, Active/
// Pending statuses, active plans, and saved withdrawal accounts (all
// treated as valid cache by their respective render functions, which skip
// re-fetching whenever a value is already present). products/settings/
// banners are deliberately left alone -- those are shared catalog data,
// not per-user, so keeping them cached across a login switch is correct
// and desirable. Called from both doLogout() and the 'space8-auth'
// listener's signed-out branch (the actual authoritative place a sign-out
// is detected, whether triggered by a logout tap or a Firebase session
// simply expiring) so neither path can drift out of sync with the other.
function resetUserState(){
  STATE.account = null;
  STATE.investments = null;
  STATE.teamStats = null;
  STATE.teamMembers = {1:null,2:null,3:null};
  STATE.teamExpanded = {1:false,2:false,3:false};
  STATE.bankAccounts = null;
  STATE.hasPayoutPin = false;
  Object.keys(STATE.loaded).forEach(function(k){ STATE.loaded[k] = false; });
}

// ── UTILS ──────────────────────────────────────────────────────────────
function ugx(n){ return 'UGX ' + Math.round(Number(n||0)).toLocaleString('en-UG'); }
// Owner: "regulate the digits size, such that if they exceed 7 figures
// they reduce in size, so make sure the figure sizes will be regulated in
// accordance to number of figures or amount" -- a graduated shrink (not a
// single on/off cutoff) keyed by the actual digit count of the amount, fed
// into --amt-scale (index.html's .bamt font-size: calc(base * scale)) so a
// balance card figure that grows into 8+ digits shrinks proportionally
// instead of overflowing or wrapping, while a normal-sized figure
// (<=7 digits, i.e. under 10,000,000) is completely untouched.
function amtScale(n){
  var d = String(Math.abs(Math.trunc(Number(n) || 0))).length;
  if (d <= 7) return 1;
  if (d === 8) return 0.86;
  if (d === 9) return 0.74;
  if (d === 10) return 0.64;
  return 0.56;
}
// Owner: "when one leaves a screen ie one has gone to deposit, then he
// clicks back, l really like those balances to start from zero then to
// current so it loads like that, even referral link, even number and id" --
// a genuine count-up animation for money/count figures (not just an instant
// static number swap) each time a page is freshly returned to. See
// loadPage()/hideSheet() for exactly when this replays -- NEVER on the
// silent background live-refresh tick, since animating an already-live
// balance back down to zero and up again every 2 seconds would be the
// opposite of what "live" is supposed to feel like.
function animateCountUp(el, endValue, fmt){
  if (!el) return;
  endValue = Number(endValue) || 0;
  fmt = fmt || ugx;
  var startTime = null, duration = 700;
  function tick(ts){
    if (!startTime) startTime = ts;
    var p = Math.min((ts - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = fmt(Math.round(endValue * eased));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
// Same "so it loads like that" ask, for fields that aren't a number
// (referral link, phone, account ID) where counting up makes no sense -- a
// quick fade + rise gives the same "just loaded in" read. Double rAF forces
// the browser to paint the "before" state first so the transition actually
// animates instead of jumping straight to the end state.
function animateReveal(el){
  if (!el) return;
  el.style.transition = 'none';
  el.style.opacity = '0';
  el.style.transform = 'translateY(4px)';
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      el.style.transition = 'opacity .35s ease, transform .35s ease';
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  });
}
function $(id){ return document.getElementById(id); }
function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Owner: "hide those numbers in all levels ie +2567****8387" -- Team's
// referral member rows showed a downline member's real phone number in
// full. server.js's cleanPhone() only ever stores the canonical
// '+256' + 9-digit form (see its own comment), so that's the only shape
// this needs to match; anything else (shouldn't happen) is left unmasked
// rather than mangled.
function maskPhone(phone){
  var s = String(phone || '');
  var m = s.match(/^(\+256)(\d)\d{4}(\d{4})$/);
  return m ? (m[1] + m[2] + '****' + m[3]) : s;
}
// Codex-verified real stored-XSS bug (2026-08-17): openInfoSheet() used to
// insert admin-set aboutText/rulesText straight into innerHTML with NO
// esc() call, unlike the 'support' entry right next to it in the same
// function (which correctly wraps its fields in esc()) -- an inconsistency
// that gave away the intent was always plain text, not admin-authored
// HTML. A compromised owner session (or an admin pasting content from an
// untrusted source without realizing it contains markup) could plant
// <img src=x onerror="..."> as the About/Rules text and have it execute
// in EVERY member's browser the moment they open that screen. escNl()
// escapes first, THEN converts newlines to <br> -- the admin panel's own
// textarea placeholder says "leave a blank line between paragraphs", so
// this preserves that formatting without ever trusting raw HTML.
function escNl(s){ return esc(s).replace(/\n/g, '<br>'); }
// Codex-verified real gap, same trust boundary as the XSS fix above: every
// admin-set external link (Telegram group/channel, announcement CTA) used
// to be handed straight to window.open() with no scheme check --
// window.open() (unlike a plain <a> click) will actually EXECUTE a
// javascript: URL in this page's own context. Only the owner can set these
// (verifyOwner-gated on the server), so this is defense-in-depth against a
// compromised owner session, not a public attack surface, but it's the
// same cheap check every other admin-set external value in this app now
// gets.
function safeExternalUrl(url){
  var u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}
function cleanPhone(p){
  var d = String(p||'').replace(/\D/g,'');
  if (d.startsWith('0')) d = '256' + d.slice(1);
  if (d.startsWith('7') && d.length===9) d = '256' + d;
  if (!d.startsWith('256')) return null;
  if (d.length !== 12) return null;
  if (d[3] !== '7') return null;
  return d;
}
function phoneToEmail(phone){ return String(phone).replace(/\D/g,'').replace(/^0+/,'') + '@space8.com'; }
function timeAgo(iso){
  if (!iso) return '';
  var diff = Date.now() - new Date(iso).getTime();
  var m = Math.floor(diff/60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m/60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h/24) + 'd ago';
}

function toast(msg, isErr){
  var t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(function(){ t.className = 'toast'; }, 3200);
}

function showSuccessPopup(msg){
  var bg = $('successPopupBg');
  $('successPopupMsg').textContent = msg;
  bg.className = 'success-popup-bg show';
  clearTimeout(showSuccessPopup._tm);
  showSuccessPopup._tm = setTimeout(function(){ bg.className = 'success-popup-bg'; }, 1600);
}

function copyText(value, label){
  value = String(value || '');
  if (!value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(function(){ toast((label || 'Value') + ' copied'); }).catch(function(){ toast('Could not copy', true); });
  } else {
    var area = document.createElement('textarea'); area.value = value; document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); toast((label || 'Value') + ' copied'); } catch (_) { toast('Could not copy', true); }
    area.remove();
  }
}

function setBtnLoading(btn, on, label){
  if (!btn) return;
  if (on){
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span>' + (label ? esc(label) : 'Please wait…');
    btn.classList.add('loading'); btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.label || btn.innerHTML;
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

function skRows(n, cls){
  var out = '';
  for (var i=0;i<n;i++) out += '<div class="sk ' + (cls||'sk-card') + '" style="margin-bottom:10px"></div>';
  return out;
}

// ── ICONS ──────────────────────────────────────────────────────────────
var ICONS = {
  satellite: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="m4.5 4.5 3 3M19.5 4.5l-3 3M4.5 19.5l3-3M19.5 19.5l-3-3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
  // Owner: "change deposit svg to exactly that first one, withdrawal svg to
  // that [second one]" -- solid filled style (not the app's usual thin-
  // stroke outline icons), matching the two reference images: a rounded
  // arrow dropping into a $ coin for deposit; a card + segmented coin +
  // arrow for withdrawal.
  // Codex-designed (2026-08-19), replacing an earlier hand-drawn attempt
  // that didn't match the owner's reference images closely enough. Both
  // icons are single-color fill=currentColor with the "cut-out" parts
  // (the $ glyph, the arrow silhouettes) as genuine transparent SVG <mask>
  // holes rather than a second overlaid color, so they stay correct
  // against any badge background. __ID__ is substituted with a fresh
  // per-call mask id by ico() -- see its own comment above.
  deposit: '<svg class="money-action-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">\n  <defs>\n    <mask id="__ID__-dep" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">\n      <rect width="24" height="24" fill="#fff"/>\n      <path transform="translate(0 1.2)" fill="#000" d="M15.92 7.35v.95c1.2.13 2.06.62 2.58 1.31l-.94.7c-.4-.5-.99-.8-1.74-.8-.95 0-1.57.39-1.57 1 0 .57.5.83 1.72 1.1 1.45.33 2.45.9 2.45 2.28 0 1.25-.94 2.08-2.5 2.25v.96h-1.08v-.97c-1.23-.13-2.17-.67-2.65-1.39l.91-.67c.43.58 1.14.96 1.95.96 1 0 1.66-.4 1.66-1.06 0-.62-.57-.86-1.82-1.13-1.45-.32-2.35-.89-2.35-2.24 0-1.18.91-2.02 2.3-2.17v-.96Z"/>\n      <path fill="#000" d="M5.12.72h5.14c1.16 0 2.04 1 1.93 2.16l-.48 4.96c-.02.23.12.41.35.41h1.22c1.53 0 2.3 1.85 1.22 2.93L9.24 16.42a2.06 2.06 0 0 1-2.9 0l-5.26-5.24C0 10.1.77 8.25 2.3 8.25h1.01c.23 0 .37-.18.35-.41L3.19 2.88C3.08 1.72 3.96.72 5.12.72Z"/>\n    </mask>\n  </defs>\n  <circle cx="15.45" cy="14.45" r="7.28" mask="url(#__ID__-dep)"/>\n  <path d="M5.55 1.5C4.91 1.5 4.43 2.05 4.49 2.69l.47 5.02c.09.93-.64 1.71-1.57 1.71H2.27c-.64 0-.96.78-.5 1.23l5.07 5.06c.47.47 1.23.47 1.7 0l5.07-5.06c.46-.45.14-1.23-.5-1.23h-1.12c-.93 0-1.66-.78-1.57-1.71l.47-5.02c.06-.64-.42-1.19-1.06-1.19Z"/>\n</svg>',
  withdraw: '<svg class="money-action-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">\n  <defs>\n    <mask id="__ID__-wd" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">\n      <rect width="24" height="24" fill="#fff"/>\n      <circle cx="5.8" cy="8" r="1.1" fill="#000"/>\n      <circle cx="8.05" cy="8" r="1.1" fill="#000"/>\n      <rect x="3.9" y="13.35" width="4.2" height="1.05" rx=".525" fill="#000"/>\n      <rect x="9.1" y="13.35" width="4.55" height="1.05" rx=".525" fill="#000"/>\n      <path fill="#000" d="M20.2 5.55c.75-.55 1.8-.01 1.8.92v1.72c0 .31-.14.6-.4.79l-4.55 3.48a.69.69 0 0 0 0 1.08l4.55 3.48c.26.19.4.48.4.79v1.72c0 .93-1.05 1.47-1.8.92l-7.95-6.07a1.95 1.95 0 0 1 0-3.12Z"/>\n    </mask>\n  </defs>\n  <g mask="url(#__ID__-wd)">\n    <rect x="1.1" y="4.1" width="20.1" height="13.2" rx="3.25"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z" transform="rotate(45 16.75 16.15)"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z" transform="rotate(90 16.75 16.15)"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z" transform="rotate(135 16.75 16.15)"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z" transform="rotate(180 16.75 16.15)"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z" transform="rotate(225 16.75 16.15)"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z" transform="rotate(270 16.75 16.15)"/>\n    <path d="M15.107 10.016A6.35 6.35 0 0 1 18.393 10.016L17.617 12.914A3.35 3.35 0 0 0 15.883 12.914Z" transform="rotate(315 16.75 16.15)"/>\n  </g>\n</svg>',
  checkin: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
  // Owner wants a light/thin tick, not the old heavy one. The literal ✓
  // (U+2713) character was tried first but Android renders it from a
  // fallback symbol font that ignores font-weight (Codex-diagnosed), so it
  // stayed thick on-device. Back to an inline SVG -- but stroke-width is
  // set by .s8-check in index.html (lighter than the old 2.4), which IS
  // reliably honored on every browser. Same shape everywhere ico('check')
  // is used (checkin button, Task Center claimed pill).
  check: '<svg class="s8-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>',
  // Owner: "remove padlock svg on withdrawal account and use that svg [the
  // supplied SIM card icon], but it should be horizontal not vertical" --
  // real raster icon (user/simcard-icon.png), not an SVG: background removed,
  // recolored to match the app's blue (the other icons' stroke color), and
  // rotated from the supplied portrait orientation to landscape. Both
  // Withdrawal Account spots (Home shortcut + Account matrix tile) use this
  // single ICONS entry, so updating it here covers both automatically.
  lock: '<img src="/simcard-icon.png" alt="" class="ico-lg">',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 0 1 18 0"/><path d="M21 12v5a2 2 0 0 1-2 2h-1v-7ZM3 12v5a2 2 0 0 0 2 2h1v-7Z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M12 8a2.5 2.5 0 1 1-2.5-2.5C11 5.5 12 8 12 8ZM12 8a2.5 2.5 0 1 0 2.5-2.5C13 5.5 12 8 12 8Z"/></svg>',
  cluster: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><path d="M12 7.4V14M12 14 6.6 17.3M12 14l5.4 3.3"/></svg>',
  assistant: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  // Owner: "l need real telegram icons not svg... l need that icon" -- the
  // actual Telegram logo the owner supplied (background-removed via a
  // corner flood-fill, since a blanket white-to-transparent pass would also
  // have erased the white paper-plane inside the circle), not a generic
  // paper-airplane SVG redrawing. Every ico('telegram') call site (the
  // announcement dialog, Account's Join The Community card, the Support
  // screen's contact rows, the assistant's quick-link button) picks this up
  // automatically from this single ICONS entry.
  telegram: '<img src="/telegram-icon.png" alt="Telegram">',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.6 12.4 8.4-8.4M15 8l3 3M18 5l3 3"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 8.4 19.6Z"/><path d="M8.5 9.3c0 3.5 2.7 6.2 6.2 6.2.6 0 1-.5.9-1.1l-.3-1.1a.9.9 0 0 0-1-.6l-1.2.2a5 5 0 0 1-2.9-2.9l.2-1.2a.9.9 0 0 0-.6-1L8.7 7.5a.9.9 0 0 0-1.1.9c0 .3 0 .6.1.9Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  // Owner: "remove that 07xxxxxx plus phone svg, you will put 🏦 svg" -- a
  // classic bank/institution glyph (pediment roof + columns + base), same
  // thin-stroke outline style as every other ICONS entry (unlike the
  // filled deposit/withdraw icons above). Used on the Withdrawal Accounts
  // add-form's account-number field now that it accepts a mobile-money
  // number OR a bank account number, not phone numbers exclusively.
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-6 9 6"/><path d="M4 10h16v9H4z"/><path d="M9 13v4M15 13v4"/><path d="M3 19h18"/></svg>',
  space8logo: '<svg viewBox="0 0 36 28" fill="none"><path d="M18 14C10 4 4 6 4 12c0 6 7 8 14 2 7-6 14-4 14 2 0 6-6 8-14-2Z" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="7" r="2.5" fill="currentColor"/></svg>'
};
// Codex-designed (2026-08-19): mask ids in ICONS.deposit/withdraw are
// __ID__ placeholders, substituted with a fresh id on every ico() call so
// two simultaneous renders of the same icon (e.g. Home's action-row tile
// behind an open Deposit/Withdraw sheet) never share an <svg><mask id>,
// even though the earlier shared-static-id version was already confirmed
// safe -- this is strictly more defensive. A no-op replace() on any icon
// without a __ID__ placeholder, so every other ICONS entry is unaffected.
var ICON_UID = 0;
function ico(name){
  var id = 's8icon' + (++ICON_UID);
  return (ICONS[name] || '').replace(/__ID__/g, id);
}

// ── API LAYER ─────────────────────────────────────────────────────────
// Codex-verified real gap (2026-08-17): /team/milestone/claim moves real
// money (a Task Center reward) but was missing from this list, so a
// service-worker update activating mid-claim could force-reload the page
// (see the controllerchange listener in index.html) before the success
// toast ever showed -- the server may have paid it, but the client would
// reload and a retry then just say "Already claimed" with no explanation.
var MONEY_ENDPOINTS = ['/deposit/marzpay', '/invest/create', '/withdraw/request', '/redeem', '/checkin', '/bank/save', '/team/milestone/claim'];
function isMoneyCall(path){ return MONEY_ENDPOINTS.some(function(p){ return path.indexOf(p) === 0; }); }

// Tracked so a background service-worker update never yanks the page out
// from under a deposit/withdrawal/investment/gift-code/check-in request that's
// actually in flight -- see the reload gate in index.html's plain <script>.
window._moneyCallsInFlight = 0;
async function api(path, body, method, retryOnce){
  var token = null;
  try { if (window.fbAuth && window.fbAuth.currentUser) token = await window.fbAuth.currentUser.getIdToken(); } catch(e){}
  var opts = {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  var isMoney = isMoneyCall(path);
  // A plain fetch() with no timeout can hang indefinitely on a slow/cold-
  // starting server -- there's nothing to catch, so the caller's spinner
  // (setBtnLoading) never clears and just looks permanently stuck. Money
  // calls get a longer allowance (a real Railway cold start can take a
  // while and these must not be aborted mid-transaction any sooner than
  // necessary) but every call now fails, visibly, rather than hanging forever.
  var doFetch = async function(){
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, isMoney ? 40000 : 20000);
    try {
      var res = await fetch(SERVER + path, Object.assign({}, opts, { signal: ctrl.signal }));
      var json;
      try { json = await res.json(); } catch(e) { json = { status:'error', message:'Unexpected response from server' }; }
      if (json.status === 'error' && json.code === 'BANNED') { handleBanned(json.message); }
      return json;
    } finally {
      clearTimeout(timer);
    }
  };
  if (isMoney) window._moneyCallsInFlight++;
  try {
    try {
      return await doFetch();
    } catch (netErr) {
      if (!isMoney && (retryOnce !== false)) {
        try { return await doFetch(); } catch(e2){ return { status:'error', message:'Could not reach the server. Check your connection.' }; }
      }
      return { status:'error', message:'Could not reach the server. Check your connection.' };
    }
  } finally {
    if (isMoney) window._moneyCallsInFlight--;
  }
}

function handleBanned(msg){
  toast(msg || 'Account suspended', true);
  setTimeout(function(){ doLogout(); }, 1500);
}

// ── SHEETS (full pages, not modals — own history entry, phone Back closes
// them without exiting the app) ────────────────────────────────────────
// _sheetStack tracks genuine stacking (2026-08-16, added for the Payout
// Accounts "choose an account for this withdrawal" picker, which opens ON
// TOP of an already-open Withdraw sheet rather than replacing it) -- the
// popstate listener used to unconditionally hide EVERY currently-shown
// sheet on any back navigation, which was fine when only one sheet was
// ever open at a time, but broke as soon as two were stacked: closing the
// picker (a real back-navigation) also hid the Withdraw sheet underneath
// it, defeating the whole "tap an account, come back automatically"
// design. Now popstate only hides the TOPMOST sheet, leaving whatever's
// stacked underneath alone -- correct for both the single-sheet case
// (stack depth 1, unchanged behavior) and genuine stacking.
var _sheetStack = [];
function openSheet(name, html){
  var bg = $(name + 'SheetBg'), sheet = $(name + 'Sheet');
  sheet.innerHTML = html;
  bg.classList.add('show');
  document.body.style.overflow = 'hidden';
  _sheetStack.push(name);
  history.pushState({ overlay: name }, '', '');
}
// Pure DOM close, no history interaction — this is what actually hides a
// sheet. Called both from closeSheet() below (an in-app close/cancel
// button, which triggers history.back() and lets the resulting popstate
// call this) and directly from the popstate listener (the phone's own
// hardware/gesture back button, which never went through closeSheet()).
function hideSheet(name){
  $(name + 'SheetBg').classList.remove('show');
  var i = _sheetStack.lastIndexOf(name);
  if (i !== -1) _sheetStack.splice(i, 1);
  if (!qsa('.sheet-bg.show').length) document.body.style.overflow = '';
  if (_planCountdownTimer) { clearInterval(_planCountdownTimer); _planCountdownTimer = null; }
  // Owner: "when one leaves a screen ie one has gone to deposit, then he
  // clicks back, l really like those balances to start from zero then to
  // current so it loads like that, even referral link, even number and
  // id" -- replay the reveal animation for whichever page is now fully
  // back in view, but only once every sheet has actually closed (a sheet
  // stacked on top of another, e.g. the withdrawal-account picker on top
  // of Withdraw, shouldn't replay it on that intermediate pop -- only the
  // final one that returns to a bare page).
  if (!_sheetStack.length) loadPage(STATE.currentPage);
}
function closeSheet(name){
  if (history.state && history.state.overlay === name) history.back();
  else hideSheet(name); // no matching history entry (shouldn't normally happen) — just hide directly
}
// Codex-verified real bug (2026-08-17): sheets/the assistant panel live
// OUTSIDE #app in the DOM (see index.html), so the sign-out branch's
// `$('app').style.display = 'none'` never actually hid a sheet that was
// already fully rendered and open at the moment of sign-out -- on a shared
// device, that member's already-painted screen (Records, deposit/withdraw
// history, notifications, withdrawal accounts, an open plan detail, an
// assistant conversation) stayed visibly on screen straight through the
// next person's sign-in, even though every async render path is now
// authEpoch-guarded against NEW stale writes. Called on every sign-out so
// nothing already on screen survives the handoff.
function closeAllSheets(){
  while (_sheetStack.length) hideSheet(_sheetStack[_sheetStack.length - 1]);
  if ($('assistPanel').classList.contains('show')) hideAssistant();
  // Codex-verified real bug: the announcement dialog isn't part of
  // _sheetStack (it's a dismissible notice, not a page -- see
  // maybeShowAnnouncement()'s own comment), so it survived a sign-out
  // untouched, leaving it visible over the login screen and body scroll
  // still locked for the next person on a shared device.
  if ($('announceBg').classList.contains('show')) hideAnnouncement();
}
window.addEventListener('popstate', function(){
  var top = _sheetStack[_sheetStack.length - 1];
  if (top) hideSheet(top);
  if ($('assistPanel').classList.contains('show')) hideAssistant();
});
qsa('.sheet-back').forEach(function(btn){
  btn.addEventListener('click', function(){ closeSheet(btn.dataset.close); });
});
// Records shortcut in the Deposit/Withdraw sheet headers -- owner wanted a
// quick way to jump to transaction history from those two screens without
// backing out first, but scoped to THAT screen's own history, not the
// combined Records list. ChatGPT review caught that the first cut of this
// called openRecordsSheet() filtering /transactions -- but /transactions
// only ever gets a row once a deposit is actually credited (see the
// comment on GET /deposits in server.js), so a pending or failed deposit
// would silently vanish from this shortcut while still showing correctly
// on the real Deposit History screen. openHistorySheet() (already used by
// Account -> Deposit History / Withdrawal History) is the correct source:
// it hits /deposits or /withdrawals and renders the real
// Processing/Successful/Unsuccessful status pill. Stacks onto the
// 'generic' sheet slot via the existing _sheetStack mechanism, so the
// phone Back button (or the sheet's own back arrow) returns to
// Deposit/Withdraw underneath, same as the withdrawal-account picker
// already stacks on top of Withdraw.
$('depositRecordsBtn').onclick = function(){ openHistorySheet('deposit'); };
$('withdrawRecordsBtn').onclick = function(){ openHistorySheet('withdrawal'); };

// ── AUTH ──────────────────────────────────────────────────────────────
function showLoginScreen(){ $('screenRegister').style.display = 'none'; $('screenLogin').style.display = 'flex'; }
function showRegisterScreen(){ $('screenLogin').style.display = 'none'; $('screenRegister').style.display = 'flex'; }
$('goRegister').onclick = showRegisterScreen;
$('goLogin').onclick = showLoginScreen;

qsa('.auth-pw-toggle').forEach(function(toggle){
  toggle.addEventListener('click', function(){
    var input = $(toggle.dataset.target);
    var hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    toggle.textContent = hidden ? 'Hide' : 'Show';
  });
});

function showAuthErr(id, msg){
  var el = $(id);
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// Owner: referral links now point at the canonical domain's /auth/register
// path with a refCode param (see referralLink() below) instead of the bare
// root '/?ref=CODE' this used before. render.yaml's static-site routes
// (source:/*, destination:/index.html, added after the /register/ref=CODE
// path form 404'd live on the bare root config) now rewrite every path to
// index.html, so a path form is safe again. Both the new refCode param and
// the two older forms (?ref=CODE, the old /register/ref=CODE path) are
// still parsed as fallbacks, so a link already shared under an older format
// keeps working.
var _refCode = null;
try {
  var _refParams = new URLSearchParams(location.search);
  _refCode = _refParams.get('refCode') || _refParams.get('ref') || null;
} catch (_) {}
if (!_refCode) {
  var _refPath = location.pathname.match(/^\/register\/ref=([^/]+)$/);
  if (_refPath) { try { _refCode = decodeURIComponent(_refPath[1]); } catch (_) {} }
}
if (_refCode && $('regReferral')) {
  $('regReferral').value = _refCode.slice(0, 32);
  // Owner: "I expect it to open the site and fill in the code automatically
  // on registration screen" -- the field was being prefilled, but the
  // screen underneath it was still whichever one is shown by default
  // (Login), so a first-time visitor following a referral link never
  // actually SAW the filled-in code without manually tapping over to
  // Register first.
  showRegisterScreen();
}

// True for the whole span between fbCreateUser() succeeding and /register
// finishing (success OR failure). Firebase signs a newly-created user in
// immediately, which fires the 'space8-auth' listener below on its own --
// without this flag that listener would drop the person straight into the
// app the instant the Firebase account exists, even if /register then
// fails (e.g. a bad referral code) and never actually finished creating
// their Space8 profile. See the listener and enterApp() below.
var _registering = false;
function enterApp(){
  $('screenLogin').style.display = 'none';
  $('screenRegister').style.display = 'none';
  $('app').style.display = 'flex';
  showPage('home');
  startLiveRefresh();
}

$('loginBtn').onclick = async function(){
  showAuthErr('loginErr', '');
  var phone = cleanPhone($('loginPhone').value);
  var pass = $('loginPassword').value;
  if (!phone) return showAuthErr('loginErr', 'Enter a valid Uganda phone number (07XXXXXXXX).');
  if (!pass) return showAuthErr('loginErr', 'Enter your password.');
  setBtnLoading($('loginBtn'), true, 'Signing in…');
  try {
    await window.fbSignIn(phoneToEmail(phone), pass);
  } catch (e) {
    setBtnLoading($('loginBtn'), false);
    // Codex-verified real bug: a failed auto-login (triggered by autofill,
    // see the IIFE below) never let a SECOND autofilled credential retry
    // automatically -- Chrome offering another saved password after a wrong
    // guess would silently need a manual tap instead.
    if (window._resetAutoLoginTried) window._resetAutoLoginTried();
    return showAuthErr('loginErr', 'Incorrect phone number or password.');
  }
  setBtnLoading($('loginBtn'), false);
  showSuccessPopup('Login successful ✓');
};

// Owner: "detect auto input by Google password and it automatically starts
// logging in automatically" -- when Chrome's own saved-password sheet (the
// one it shows on tapping the field, not this app's UI) fills BOTH fields
// at once, auto-submit instead of making the member tap Login themselves.
// Relies on the :-webkit-autofill CSS trick above (index.html) since a
// plain 'input' listener can't tell "browser filled this in one shot" apart
// from "user is still typing it out character by character" -- typing the
// phone number alone, for instance, must never trigger this.
(function(){
  var filled = { phone: false, password: false };
  var tried = false;
  function maybeAutoLogin(){
    if (tried) return;
    if (!filled.phone || !filled.password) return;
    if ($('screenLogin').style.display === 'none') return; // not on the login screen right now
    if (!$('loginPhone').value || !$('loginPassword').value) return;
    tried = true;
    $('loginBtn').click();
  }
  function watch(input, key){
    input.addEventListener('animationstart', function(e){
      if (e.animationName === 'onAutoFillStart') { filled[key] = true; maybeAutoLogin(); }
      else if (e.animationName === 'onAutoFillCancel') { filled[key] = false; }
    });
  }
  watch($('loginPhone'), 'phone');
  watch($('loginPassword'), 'password');
  // A fresh visit to the login screen (or a failed attempt) should allow
  // another auto-login try -- e.g. Chrome offering a DIFFERENT saved
  // credential after the first guess was wrong.
  $('goLogin').addEventListener('click', function(){ tried = false; });
  window._resetAutoLoginTried = function(){ tried = false; };
})();

$('registerBtn').onclick = async function(){
  showAuthErr('registerErr', '');
  var phone = cleanPhone($('regPhone').value);
  var pass = $('regPassword').value, pass2 = $('regPassword2').value;
  var pin = $('regPin').value, pin2 = $('regPin2').value;
  var ref = $('regReferral').value.trim();
  // A previous attempt in THIS session may have already created the
  // Firebase account and then failed on /register (wrong referral code,
  // dropped connection, etc.) -- retrying fbCreateUser for the same phone
  // would only fail with "already in use". Detected by _registering still
  // being true (only a just-failed registration leaves it that way) plus a
  // real signed-in Firebase user.
  var resuming = !!(_registering && window.fbAuth && window.fbAuth.currentUser);
  if (!resuming) {
    if (!phone) return showAuthErr('registerErr', 'Enter a valid Uganda phone number (07XXXXXXXX).');
    if (pass.length < 6) return showAuthErr('registerErr', 'Password must be at least 6 characters.');
    if (pass !== pass2) return showAuthErr('registerErr', 'Passwords do not match.');
  }
  if (!/^\d{4}$/.test(pin)) return showAuthErr('registerErr', 'Choose a 4-digit withdrawal PIN.');
  if (/^(\d)\1{3}$/.test(pin)) return showAuthErr('registerErr', 'That PIN is too easy to guess (e.g. 1111, 2222). Choose 4 digits that are not all the same.');
  if (pin !== pin2) return showAuthErr('registerErr', 'PINs do not match.');
  setBtnLoading($('registerBtn'), true, 'Creating account…');
  _registering = true;
  try {
    if (!resuming) await window.fbCreateUser(phoneToEmail(phone), pass);
    var r = await api('/register', { referralCode: ref || undefined, phone: phone }, 'POST', true);
    if (r.status === 'error') {
      // Firebase account exists, but the Space8 profile isn't finished --
      // stay on this screen (never silently enter the app half-registered)
      // and let them fix the referral code and try again; _registering
      // stays true so the retry above skips fbCreateUser.
      setBtnLoading($('registerBtn'), false);
      return showAuthErr('registerErr', (r.message || 'Could not finish creating your account.') + ' You are signed in — fix the referral code (or clear it) and tap Create Account again.');
    }
    var pinR = await api('/account/payout-pin/set', { pin: pin });
    if (pinR.status === 'error') toast('Account created, but the PIN could not be set — set it later in Account.', true);
  } catch (e) {
    setBtnLoading($('registerBtn'), false);
    // Only clear _registering if no Firebase account actually exists yet --
    // fbCreateUser is the only call in this block that can genuinely throw
    // (api() always resolves with {status:'error'}, never throws), but this
    // check is written to hold regardless of exactly which line threw: if a
    // Firebase user already exists at this point, the account WAS created,
    // and the next retry must still skip fbCreateUser (via `resuming`
    // above) rather than attempt it again and hit "already-in-use",
    // stranding the account with no way to finish registering.
    if (!(window.fbAuth && window.fbAuth.currentUser)) _registering = false;
    var msg = 'Could not create your account.';
    if (String(e.code).indexOf('email-already-in-use') !== -1) msg = 'This phone number is already registered.';
    else if (String(e.code).indexOf('weak-password') !== -1) msg = 'Choose a stronger password (min 6 characters).';
    return showAuthErr('registerErr', msg);
  }
  _registering = false;
  setBtnLoading($('registerBtn'), false);
  showSuccessPopup('Registration successful ✓');
  enterApp();
};

function doLogout(){
  // Codex-verified real bug (2026-08-17): authEpoch used to only bump
  // inside the 'space8-auth' listener, which only fires once Firebase's
  // OWN async sign-out actually completes -- a real gap between tapping
  // Logout and that event landing. An in-flight request started under the
  // OLD session that resolves during that gap still saw the OLD (unchanged)
  // epoch as current, so it could write stale data back into STATE right
  // after resetUserState() just cleared it. Bumping here, synchronously,
  // the instant logout is requested, closes that gap instead of relying
  // solely on the listener's own (later) bump.
  STATE.authEpoch++;
  resetUserState();
  closeAllSheets();
  window.fbSignOut();
}

// ── ROUTER ────────────────────────────────────────────────────────────
function showPage(name){
  STATE.currentPage = name;
  qsa('.page').forEach(function(p){ p.classList.toggle('active', p.id === 'page-' + name); });
  qsa('.navitem').forEach(function(n){ n.classList.toggle('active', n.dataset.page === name); });
  // Assistant bubble is Account-only -- owner: "ai assistant bubble should
  // be in account, so remove it from home, team, products." Gift-code FAB
  // (owner: "3d image of giftCodebox will be on top of where the chat
  // assistant is") shares the same Account-only scope, stacked directly
  // above it.
  $('assistFab').style.display = name === 'account' ? 'flex' : 'none';
  $('giftFab').style.display = name === 'account' ? 'flex' : 'none';
  window.scrollTo(0,0);
  loadPage(name);
  if (name === 'home') maybeShowAnnouncement();
}

// Owner: "l want a dialog with a background image SETTABLE from admin,plus
// blur and opusity ... with telegram button and cancel." Admin's own help
// text (unchanged by this feature) says it shows every time a member opens
// the app and every time they return to Home from another tab -- both of
// those are exactly the two callers of showPage('home') (enterApp() and the
// bottom-nav click handler), so hooking it there covers both without a
// separate timer/listener.
function maybeShowAnnouncement(){
  var sett = STATE.settings || {};
  if (!sett.annEnabled || !sett.annBody) return;
  $('announceTitle').textContent = sett.annTitle || 'Notice';
  $('announceText').textContent = sett.annBody;
  var tgUrl = sett.telegramGroup || sett.telegramChannel;
  var tgBtn = $('announceTgBtn');
  if (tgUrl) {
    tgBtn.style.display = 'flex';
    // Owner: "instead of telegram button and icon,put the word Confirm...
    // l am not saying that telegram link should go away... we just
    // changed the cover so it will read confirm, so when he confirms, he
    // will be redirected to telegram group." Same tgUrl/onclick behavior,
    // just the visible label+icon changed from "Telegram" to "Confirm".
    tgBtn.innerHTML = '<span>Confirm</span>';
    tgBtn.onclick = function(){ var u = safeExternalUrl(tgUrl); if (u) window.open(u, '_blank'); hideAnnouncement(); };
  } else {
    tgBtn.style.display = 'none';
  }
  // Lock body scroll while the dialog is up -- real sheets already do this
  // via openSheet()/hideSheet(), but this dialog isn't part of that stack
  // (it's a dismissible notice, not a page). Without it, once the inner
  // .announce-text scroll hits its end, the scroll silently chains through
  // to the Home page scrolling underneath -- owner: "when you reach at end
  // of text in announcement dialog, it again scrolls the contents in
  // dashboard, that is very bad." overscroll-behavior:contain on
  // .announce-text (index.html) stops the chaining at the text box itself;
  // this stops the dashboard from being scrollable at all while shown.
  document.body.style.overflow = 'hidden';
  $('announceBg').classList.add('show');
}
function hideAnnouncement(){
  $('announceBg').classList.remove('show');
  if (!qsa('.sheet-bg.show').length) document.body.style.overflow = '';
}
// Owner: "remove cancel button there, it will be on top left of dialog,
// clear view and we'll defined (X)" -- the bottom Cancel button is gone;
// a small round (X) top-left of the card is now the dialog's own explicit
// dismiss control (tapping the dark scrim still closes it too, unchanged).
$('announceCloseBtn').innerHTML = ico('x');
$('announceCloseBtn').onclick = hideAnnouncement;
$('announceBg').addEventListener('click', function(e){ if (e.target.id === 'announceBg') hideAnnouncement(); });
qsa('.navitem').forEach(function(n){ n.addEventListener('click', function(){
  qsa('.navitem').forEach(function(item){ item.classList.remove('tap-glow'); });
  n.classList.add('tap-glow');
  setTimeout(function(){ n.classList.remove('tap-glow'); }, 360);
  showPage(n.dataset.page);
}); });

function loadPage(name){
  if (name === 'home') renderHome(true);
  else if (name === 'products') renderProducts();
  else if (name === 'team') renderTeam(true);
  else if (name === 'account') renderAccount(true);
}

// ── BANNER HELPER ─────────────────────────────────────────────────────
function bannerHtml(key, fallbackIcon){
  var src = STATE.banners[key];
  if (src) return '<div class="banner"><img src="' + esc(src) + '" alt=""></div>';
  return '<div class="banner"><div class="fallback-ico">' + ico(fallbackIcon||'satellite') + '</div></div>';
}
// Returns an inline style backing an element with an admin banner image, or
// '' (empty) when that slot has no image set -- the element's CSS default
// (a plain dark tile) then shows through. Used by the split balance cards.
// The data-URI holds only base64 (no quotes/parens), so wrapping it in
// url('...') inside a double-quoted style attribute is safe.
function bcardBg(key){
  var src = (STATE.banners || {})[key];
  return src ? ' style="background-image:url(\'' + esc(src) + '\')"' : '';
}
// A top banner that renders ONLY when the admin has set an image for this
// slot -- unlike bannerHtml(), it shows nothing (no fallback-icon box) when
// unset, so a screen the owner hasn't themed yet just has no banner rather
// than a placeholder. Used on the Gift Code and Check-in screens.
function optBannerHtml(key){
  var src = (STATE.banners || {})[key];
  return src ? '<div class="banner sheet-banner"><img src="' + esc(src) + '" alt=""></div>' : '';
}
// Owner: "l want them to be floating again and again... l will add other
// banners that will slide one after the other" -- the Home-screen banner,
// but auto-cycling through admin-uploaded slides instead of one static
// image. Falls straight back to the existing single-image 'barstack' slot
// (or the default fallback icon) whenever no slides are configured, so an
// owner who never touches this stays on exactly the old behaviour.
// One slide is just shown static -- no point animating a cycle of one.
// Two or more: every <img> shares ONE CSS keyframe animation (defined once
// below) that's visible for exactly its own 1/n slice of the full cycle,
// each phase-shifted by a POSITIVE animation-delay of (index * holdSec) --
// the classic pure-CSS carousel trick, since it needs only one @keyframes
// block regardless of how many slides the admin adds, with no JS interval
// to leak or double up across renderHome()'s own periodic 12s refresh.
// Codex-verified real bug (2026-08-18): this used a NEGATIVE delay here,
// which is the more commonly-quoted version of this trick but is wrong
// for 3+ slides specifically -- working the modular arithmetic through, a
// negative delay of -(i*holdSec) makes slide i visible during real-time
// window [(n-i)*holdSec mod totalSec, ...), which plays back in REVERSE
// order after the first slide (0, n-1, n-2, ..., 1) instead of upload
// order. A POSITIVE delay of (i*holdSec) instead makes the animation not
// start until real time i*holdSec, at which point its own local clock
// begins from frame zero -- exactly the window [i*holdSec,(i+1)*holdSec)
// this needs, with no reverse-order surprise. Before its delay elapses an
// image simply shows this rule's own base `opacity:0` (CSS's normal
// default-fill-mode behaviour during an unstarted delay), so no extra
// fill-mode is needed for the "not this slide's turn yet" state either.
// `.banner img{position:absolute;inset:0;...}` (index.html's CSS) already
// stacks every slide exactly on top of each other, so this only ever needs
// to control opacity, not layout/positioning.
function homeBannerHtml(){
  var slides = (STATE.homeSlides||[]).filter(Boolean);
  if (!slides.length) return bannerHtml('barstack', 'satellite');
  if (slides.length === 1) return '<div class="banner"><img src="' + esc(slides[0]) + '" alt=""></div>';
  var n = slides.length, holdSec = 4, totalSec = holdSec * n;
  var visiblePct = (100 / n).toFixed(4);
  var css = '<style>#homeBannerCarousel img{opacity:0;animation:cs-cycle ' + totalSec + 's steps(1) infinite;}' +
    '@keyframes cs-cycle{0%{opacity:1}' + visiblePct + '%{opacity:0}100%{opacity:0}}</style>';
  var imgs = slides.map(function(src, i){
    return '<img src="' + esc(src) + '" alt="" style="animation-delay:' + (i * holdSec) + 's">';
  }).join('');
  return '<div class="banner" id="homeBannerCarousel">' + css + imgs + '</div>';
}
// Account screen only: the same admin-customizable 'rocherstack' banner
// slot, but with the member's own identity spread across it instead of a
// plain image/fallback-icon — the Space8 mark on one half, phone + the
// server-issued account ID on the other. Falls back to a plain blue
// gradient (not the generic satellite fallback-icon) when no custom image
// is set, since that's the more likely default state and reads better
// behind white text than the icon does.
function identityBannerHtml(acc){
  var src = STATE.banners['rocherstack'];
  return '<div class="identity-banner' + (src?' has-img':'') + '"' + (src?' style="background-image:url(\'' + esc(src) + '\')"':'') + '>' +
    '<div class="identity-mark"><svg viewBox="0 0 36 28" fill="none"><path d="M18 14C10 4 4 6 4 12c0 6 7 8 14 2 7-6 14-4 14 2 0 6-6 8-14-2Z" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="7" r="2.5" fill="currentColor"/></svg></div>' +
    '<div class="identity-info">' +
      '<div class="identity-copyline"><span class="identity-phone">' + esc(acc.phone||'—') + '</span><button class="mini-copy" data-copy="' + esc(acc.phone||'') + '" data-copy-label="Account number" aria-label="Copy account number">' + ico('copy') + '</button></div>' +
      '<div class="identity-copyline"><span class="identity-id mono">ID:' + esc(acc.publicId||'——————') + '</span><button class="mini-copy" data-copy="' + esc(acc.publicId||'') + '" data-copy-label="Account ID" aria-label="Copy account ID">' + ico('copy') + '</button></div>' +
    '</div>' +
  '</div>';
}

// ── HOME ──────────────────────────────────────────────────────────────
async function renderHome(animate){
  // Codex-verified real bug (2026-08-17): captured before the fetch below,
  // checked again right after it resolves -- if a sign-out/sign-in
  // happened while this was in flight (STATE.authEpoch bumped), this
  // render is for a session that's no longer current, so it must not
  // commit anything to STATE or the DOM (that would either leak the
  // previous member's data onto the new one's screen, or stomp the new
  // member's own already-rendered page with stale data).
  var epoch = STATE.authEpoch;
  var el = $('page-home');
  if (!STATE.loaded.home) {
    el.innerHTML =
      '<div class="sk sk-card" style="height:150px;margin:16px 0"></div>' +
      '<div class="action-row">' +
      '<div class="sk" style="height:74px;border-radius:16px;flex:1"></div><div class="sk" style="height:74px;border-radius:16px;flex:1"></div><div class="sk" style="height:74px;border-radius:16px;flex:1"></div>' +
      '</div>' +
      '<div class="sk sk-card" style="height:150px;margin-top:22px"></div>' +
      skRows(2);
  }
  var results = await Promise.all([
    STATE.account ? Promise.resolve({status:'success',account:STATE.account}) : api('/account'),
    STATE.investments ? Promise.resolve({status:'success',investments:STATE.investments}) : api('/investments'),
    STATE.products ? Promise.resolve({status:'success',products:STATE.products}) : api('/public/products'),
    STATE.settings ? Promise.resolve({status:'success',settings:STATE.settings}) : api('/public/settings'),
    api('/public/activity-feed')
  ]);
  if (epoch !== STATE.authEpoch) return;
  var accR = results[0], invR = results[1], prodR = results[2], setR = results[3], feedR = results[4];
  if (accR.status === 'success') STATE.account = accR.account;
  if (invR.status === 'success' && invR.investments) STATE.investments = invR.investments;
  if (prodR.status === 'success') STATE.products = prodR.products;
  if (setR.status === 'success') STATE.settings = setR.settings;
  STATE.loaded.home = true;

  var acc = STATE.account || {};
  var products = (STATE.products||[]).filter(function(p){ return p.active !== false; });
  var checkedIn = acc.lastCheckin && isToday(acc.lastCheckin);
  var feed = feedR.status === 'success' ? (feedR.feed || feedR.items || []) : [];

  // Owner (2026-08-19): "sliding images reach a time and stuck on only the
  // default image, others all where do they go??" -- real bug, confirmed
  // against a real Chromium repro. The OLD approach here detached the
  // still-animating #homeBannerCarousel/#tickerItems node, rebuilt the
  // whole page's innerHTML, then spliced the SAME node back in -- but a
  // CSS animation restarts from frame zero the instant its element is
  // removed from the document, even synchronously, even when the exact
  // same node object is reinserted right after. That "detach it, then
  // splice the same node back in" trick looked reasonable but never
  // actually preserved anything; it only happened to look fine before
  // because the old 12s refresh interval was an exact multiple of the
  // banner's 3-slide, 12s cycle, so the invisible restart always landed on
  // a cycle boundary. Once refreshes got faster than a single slide's 4s
  // hold time (this session's live-refresh speed-up), every slide except
  // the first (zero animation-delay) got reset back into its own "not due
  // yet" phase before ever reaching its visible window -- exactly "stuck
  // on the default image, the others never show".
  // Real fix: give the banner and the ticker their own permanent slot
  // elements that this function creates ONCE and never removes from the
  // document again -- only their `.innerHTML` is ever reassigned, and only
  // when their own content has genuinely changed, so an unrelated balance/
  // product refresh can never interrupt either animation.
  if (!$('homeBannerSlot')) {
    el.innerHTML = '<div id="homeBannerSlot"></div><div id="homeBalanceActionSlot"></div>' +
      '<div class="ticker-bar" id="homeTickerSlot">' +
        '<div class="ticker-icon" id="tickerBellBtn">' + ico('bell') + '</div>' +
        '<div class="ticker-track"><div class="ticker-items" id="tickerItems"></div></div>' +
        '<div class="ticker-icon" id="tickerRecordsBtn">' + ico('doc') + '</div>' +
      '</div>' +
      '<div class="section-title">Products <span class="see-all" id="homeSeeAllProds">See all</span></div>' +
      '<div id="homeProductsSlot"></div>';
  }

  var slidesJson = JSON.stringify(STATE.homeSlides||[]);
  if (slidesJson !== STATE.lastHomeSlidesJson || !$('homeBannerSlot').firstChild) {
    STATE.lastHomeSlidesJson = slidesJson;
    $('homeBannerSlot').innerHTML = homeBannerHtml();
  }

  var balHtml = '<div class="balance-grid">' +
    '<div class="bcard bcard--main"' + bcardBg('balancebg') + '>' +
      '<div class="bamt mono" id="bamtBalance" style="--amt-scale:' + amtScale(acc.walletBalance) + '">' + ugx(acc.walletBalance) + '</div>' +
      '<div class="blab">Account Balance</div>' +
    '</div>' +
    '<div class="bcard"' + bcardBg('cumulativebg') + '>' +
      '<div class="bamt mono" id="bamtEarned" style="--amt-scale:' + amtScale(acc.totalEarned) + '">' + ugx(acc.totalEarned) + '</div>' +
      '<div class="blab">Cumulative Earnings</div>' +
    '</div>' +
    '<div class="bcard"' + bcardBg('investedbg') + '>' +
      '<div class="bamt mono" id="bamtInvested" style="--amt-scale:' + amtScale(acc.totalInvested) + '">' + ugx(acc.totalInvested) + '</div>' +
      '<div class="blab">Total Invested</div>' +
    '</div>' +
  '</div>';
  balHtml += '<div class="action-row">' +
    '<div class="action-btn" id="homeDepositBtn"><div class="ico">' + ico('deposit') + '</div><span>Deposit</span></div>' +
    '<div class="action-btn" id="homeWithdrawBtn"><div class="ico">' + ico('withdraw') + '</div><span>Withdraw</span></div>' +
    '<div class="action-btn ' + (checkedIn?'done':'') + '" id="homeCheckinBtn"><div class="ico">' + ico(checkedIn?'check':'checkin') + '</div><span>' + (checkedIn?'Claimed':'Check In') + '</span></div>' +
  '</div>';
  $('homeBalanceActionSlot').innerHTML = balHtml;

  var prodHtml = '';
  products.slice(0,10).forEach(function(p){ prodHtml += prodCardHtml(p); });
  $('homeProductsSlot').innerHTML = prodHtml;

  wireHomeActions();
  renderTicker(feed);
  qsa('.plan-row', el).forEach(function(row){
    row.onclick = function(){ openPlanDetailSheet(row.dataset.id); };
  });
}
// Matches server.js's nowStr().date exactly: East Africa Time (UTC+3), NOT
// device-local time. Codex-verified real bug (2026-08-17): this used to use
// new Date() (device-local), so a device with the wrong clock/timezone, or
// simply any user outside Kampala, could see the check-in button's
// done/not-done state disagree with what the server actually recorded --
// most visibly right around the EAT midnight boundary.
function eatDateStr(){
  var d = new Date(Date.now() + 3 * 3600000);
  return String(d.getUTCMonth()+1).padStart(2,'0') + '/' + String(d.getUTCDate()).padStart(2,'0') + '/' + d.getUTCFullYear();
}
function isToday(dateStr){
  return dateStr === eatDateStr();
}
// Simple list row (icon, name + "Day X of Y", chevron) -- owner explicit:
// "I don't want active plans to be like that [the rounded ring card], I
// want them to be where on my products it shows arrow" -- i.e. the same
// menuRow()-style chevron list already used for About/Rules/Support.
function planRowHtml(inv){
  var made = inv.payoutsMade||0, total = inv.payoutsTotal||0;
  return '<div class="menu-row plan-row" data-id="' + esc(inv.id) + '">' + ico('satellite') +
    '<div class="info"><div class="name">' + esc(inv.tierLabel) + '</div>' +
    '<div class="sub">Day ' + made + ' of ' + total + ' · +' + ugx(inv.paidOut) + ' earned</div></div>' +
    ico('chev').replace('<svg ', '<svg class="chev" ') +
  '</div>';
}
var _planCountdownTimer = null;
// Elapsed-full-days boundary this plan's cashback is credited on --
// mirrors settleInvestmentIfDue()'s own elapsedDays math in server.js
// exactly (Math.floor((now-createdMs)/86400000)), so the countdown shown
// here always agrees with when the server's 1s reconciler actually pays.
function nextCashbackMs(inv){
  var createdMs = inv.createdAt ? new Date(inv.createdAt).getTime() : NaN;
  var made = inv.payoutsMade || 0, total = inv.payoutsTotal || 0;
  if (!createdMs || isNaN(createdMs) || made >= total) return null;
  return createdMs + (made + 1) * 86400000;
}
function fmtCountdown(ms){
  var s = Math.max(0, Math.floor(ms/1000));
  var hh = String(Math.floor(s/3600)).padStart(2,'0');
  var mm = String(Math.floor((s%3600)/60)).padStart(2,'0');
  var ss = String(s%60).padStart(2,'0');
  return hh + ':' + mm + ':' + ss;
}
function detailField(lab, val){
  return '<div><div style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">' + esc(lab) + '</div><div style="font-weight:700" class="mono">' + val + '</div></div>';
}
function planDetailHtml(inv){
  var nextMs = nextCashbackMs(inv);
  var html =
    '<div data-plan-detail="' + esc(inv.id) + '">' +
    '<div class="sheet-title">' + esc(inv.tierLabel) + '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
        detailField('Purchase Date', esc(inv.date||'-')) +
        detailField('Purchase Time', esc(inv.time||'-')) +
        detailField('Price', ugx(inv.amount)) +
        detailField('Daily Profit', ugx(inv.dailyPayout)) +
        detailField('Total Return', ugx(inv.expectedReturn)) +
        detailField('Accumulated Profit', ugx(inv.paidOut)) +
      '</div>' +
    '</div>' +
    '<div class="card" style="text-align:center">' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-dim);margin-bottom:6px">' + (nextMs ? 'Next Cashback In' : 'Status') + '</div>' +
      '<div id="planCountdownVal" class="mono" style="font-size:26px;font-weight:700;color:var(--blue)">' + (nextMs ? fmtCountdown(nextMs - Date.now()) : 'Matured') + '</div>' +
    '</div>' +
    '</div>';
  return { html: html, nextMs: nextMs };
}
function openPlanDetailSheet(id){
  var inv = (STATE.investments||[]).find(function(i){ return i.id === id; });
  if (!inv) return;
  var d = planDetailHtml(inv);
  // Own sheet slot ('planDetail'), NOT the shared 'generic' one -- Plan
  // Detail is opened from inside My Products, which itself already occupies
  // the 'generic' slot. Codex-verified real bug (2026-08-17): both used to
  // call openSheet('generic', ...), so _sheetStack held two entries with the
  // SAME name pointing at the SAME #genericSheet DOM node. hideSheet() only
  // pops one matching entry per Back press but unconditionally hides the
  // shared bg regardless of stack depth, so a single Back from Plan Detail
  // closed the whole overlay (My Products' content was already gone --
  // overwritten by Plan Detail's own innerHTML) instead of revealing My
  // Products underneath, leaving a ghost entry in _sheetStack. Giving Plan
  // Detail its own bg/container (see index.html's planDetailSheetBg) makes
  // this stack correctly like the withdraw+payout-picker case already does.
  openSheet('planDetail', d.html);
  if (d.nextMs) startPlanCountdown(d.nextMs, id);
}
// True only if the planDetail sheet is open AND still showing THIS plan's
// detail view -- the member may have closed it while a delayed refresh
// below was in flight; a bare "is some sheet open" check isn't enough to
// tell those apart.
function isPlanDetailShowing(id){
  if (!$('planDetailSheetBg').classList.contains('show')) return false;
  var wrap = qs('[data-plan-detail]', $('planDetailSheet'));
  return !!wrap && wrap.dataset.planDetail === id;
}
// Re-renders the SAME already-open detail sheet in place (no openSheet(), no
// new history entry) -- used by startPlanCountdown() once a plan's countdown
// hits zero, so the sheet picks up the day the server just credited instead
// of sitting frozen at 00:00:00 until the member manually reopens it.
function renderPlanDetail(id){
  var inv = (STATE.investments||[]).find(function(i){ return i.id === id; });
  if (!inv) return;
  var d = planDetailHtml(inv);
  $('planDetailSheet').innerHTML = d.html;
  if (d.nextMs) startPlanCountdown(d.nextMs, id);
}
// The server's own 1s cashback reconciler (reconcileCashback() in server.js)
// runs independently of this client-side timer, so a short delay here gives
// it a moment to actually land the credit before we re-fetch -- otherwise a
// re-fetch at the exact instant the countdown hits zero would often still
// read the pre-credit state and show the same "00:00:00" over again.
async function refreshPlanDetailAfterMaturity(invId){
  await new Promise(function(r){ setTimeout(r, 1500); });
  if (!isPlanDetailShowing(invId)) return;
  var r = await api('/investments', null, 'GET');
  if (!isPlanDetailShowing(invId)) return;
  if (r.status === 'success' && r.investments) {
    STATE.investments = r.investments;
    renderPlanDetail(invId);
  } else {
    // Fetch failed -- retry on the same ~1.5s cadence instead of calling
    // renderPlanDetail() with stale data: that would restart the countdown
    // on the SAME already-expired target, whose first synchronous tick
    // immediately re-triggers this function again, turning one slow
    // request into a hot loop. Leaves "00:00:00" showing until this
    // eventually succeeds.
    refreshPlanDetailAfterMaturity(invId);
  }
}
function startPlanCountdown(targetMs, invId){
  if (_planCountdownTimer) clearInterval(_planCountdownTimer);
  var tick = function(){
    var el = $('planCountdownVal');
    if (!el) { clearInterval(_planCountdownTimer); _planCountdownTimer = null; return; }
    var remaining = targetMs - Date.now();
    if (remaining <= 0) {
      el.textContent = '00:00:00';
      clearInterval(_planCountdownTimer); _planCountdownTimer = null;
      refreshPlanDetailAfterMaturity(invId);
      return;
    }
    el.textContent = fmtCountdown(remaining);
  };
  tick();
  _planCountdownTimer = setInterval(tick, 1000);
}
function renderTicker(feed){
  var track = $('tickerItems');
  // Real bug found while wiring up the live 12s background refresh: every
  // renderHome() call (including the silent periodic one) rebuilds this
  // element's innerHTML unconditionally, which restarts the ticker's own
  // 24s CSS scroll animation from position zero every time -- the marquee
  // never completed more than half a loop before visibly snapping back to
  // the start. Skipping the rebuild when the feed content hasn't actually
  // changed since last render (the common case between server-side
  // rebuilds) keeps the animation running smoothly; it only restarts when
  // there's genuinely new activity to show.
  var feedJson = JSON.stringify(feed);
  var changed = feedJson !== STATE.lastFeedJson;
  if (track && changed) {
    STATE.lastFeedJson = feedJson;
    if (!feed.length) track.innerHTML = '<span class="ticker-item">Waiting for activity…</span>';
    else {
      var items = feed.slice(0,18).map(function(f){
        // Real bug found while testing the animation fix above: the
        // server's feed rows (buildActivityFeed() in server.js) use a
        // field named `kind` with values 'deposit'/'withdraw' -- this was
        // checking `f.type === 'withdrawal'`, a field that was never even
        // present on the object, so this ternary always fell through to
        // "deposited" for every row regardless of what kind it actually
        // was. The ticker has never once shown "withdrew" for a real
        // simulated withdrawal.
        var verb = f.kind === 'withdraw' ? 'withdrew' : 'deposited';
        return '<span class="ticker-item">' + esc(f.phone||f.masked||'A member') + ' ' + verb + ' <span class="amt mono">' + ugx(f.amount) + '</span></span>';
      }).join('');
      track.innerHTML = items + items; // doubled so a -50% translate loop is seamless
    }
  }
  STATE.lastFeed = feed;
  // Wiring these two buttons was previously INSIDE the `if (!feed.length)`
  // branch above (an early return before this line), so on a fresh
  // install with no site-wide activity yet, neither button ever got a
  // click handler at all -- fixed by moving the wiring out here,
  // unconditional on whether the ticker itself has anything to show.
  var bellBtn = $('tickerBellBtn');
  if (bellBtn) bellBtn.onclick = openNotificationsSheet;
  var recBtn = $('tickerRecordsBtn');
  if (recBtn) recBtn.onclick = openRecordsSheet;
}
// Every transaction type ever written to the 'transactions' collection
// (grepped every db.collection('transactions').add/.set(...) call site in
// server.js to build this list) -- server-side is the single source of
// truth for what's real; this is presentation only.
var RECORD_META = {
  deposit:    { label: 'Deposit' },
  withdraw:   { label: 'Withdrawal' },
  investment: { label: 'Investment' },
  cashback:   { label: 'Daily Cashback' },
  checkin:    { label: 'Check-in Reward' },
  commission: { label: 'Referral Commission' },
  team_reward:{ label: 'Task Center Reward' },
  admin_credit:{ label: 'Credit' },
  admin_debit: { label: 'Debit' },
  promocode:  { label: 'Gift Code' }
};
function recordMeta(type){
  return RECORD_META[type] || { label: type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Transaction' };
}
// Full personal transaction history -- every deposit, withdrawal,
// investment, daily cashback, check-in reward, referral commission, task
// center reward, gift code redemption and admin credit/debit on THIS
// account. Server-scoped to the caller's own userId (GET /transactions,
// auth-gated) -- nothing here is guessable or another member's data, and
// every row's date/time comes straight from the same server-timestamped
// ledger every balance figure in the app is computed from, not a
// client-side guess.
// Reached only from the home activity-ticker's own records icon now --
// the Deposit/Withdraw sheet header shortcuts use openHistorySheet()
// instead (see its own comment), since /transactions can't show a
// pending/failed deposit or withdrawal the way /deposits and /withdrawals
// can.
//
// _genericAsyncSeq guard (shared with openHistorySheet() below): both
// functions render into the SAME 'generic' sheet slot's body element,
// looked up by id AFTER their own await/then. ChatGPT review caught that
// with no guard, opening one of these, backing out fast, then opening the
// other (or the same one again) before the first response lands lets the
// slower response win and overwrite whichever sheet is now actually open
// with stale content under the wrong title. Each render captures the
// sequence number at the START of its own call and bails silently if a
// newer generic-sheet render has since taken over by the time its
// response arrives.
var _genericAsyncSeq = 0;
async function openRecordsSheet(){
  // Codex-verified real bug (2026-08-17): _genericAsyncSeq alone only
  // catches a NEWER generic-sheet render taking over -- it does nothing if
  // the SAME sheet stays open across a sign-out/sign-in on a shared device,
  // since no new generic-sheet open happens to bump it. This in-flight
  // /transactions response could then render the PREVIOUS member's records
  // into a sheet now sitting on top of the NEXT member's session. authEpoch
  // (see STATE's own comment) catches exactly that.
  var seq = ++_genericAsyncSeq;
  var epoch = STATE.authEpoch;
  openSheet('generic', '<div class="sheet-title">Records</div><div id="recordsBody"><div class="sk sk-line" style="width:60%"></div>' + skRows(4,'sk-card') + '</div>');
  var r = await api('/transactions', null, 'GET');
  if (seq !== _genericAsyncSeq || epoch !== STATE.authEpoch) return;
  var body = $('recordsBody'); if (!body) return;
  var items = (r.status === 'success' && r.transactions) || [];
  if (!items.length) { body.innerHTML = emptyState('doc', 'No more data'); return; }
  body.innerHTML = items.map(function(t){
    var meta = recordMeta(t.type);
    var neg = (t.amount||0) < 0;
    return '<div class="member-row record-row"><div class="info"><div class="phone">' + esc(meta.label) + '</div>' +
      '<div class="date">' + esc(t.description||'') + '<br>' + esc(t.date||'') + ' ' + esc(t.time||'') +
      (t.ref ? '<br>Ref: ' + esc(t.ref) : '') + '</div></div>' +
      '<span class="mono" style="font-weight:700;color:' + (neg?'#ffd0d6':'#fff') + ';flex-shrink:0;margin-left:10px">' +
        (neg?'−':'+') + ugx(Math.abs(t.amount||0)) + '</span></div>';
  }).join('') + listEndFooter();
}
function wireHomeActions(){
  $('homeDepositBtn').onclick = openDepositSheet;
  $('homeWithdrawBtn').onclick = openWithdrawSheet;
  $('homeCheckinBtn').onclick = openCheckinSheet;
  var seeAll = $('homeSeeAllProds'); if (seeAll) seeAll.onclick = function(){ showPage('products'); };
  qsa('.prod-card', $('page-home')).forEach(function(c){
    var invBtn = qs('.invest-btn', c);
    if (invBtn) invBtn.onclick = function(e){ e.stopPropagation(); openInvestSheet(c.dataset.key); };
  });
}
// Owner: "one checkin l wanted it to be like that, so l will add banners" --
// check-in is now its own screen (a banner, the daily reward, the button,
// and the rules) instead of a one-tap Home button. The Home "Check In"
// action tile opens this; the actual claim happens on the button inside.
async function openCheckinSheet(){
  var sett = STATE.settings || (await api('/public/settings')).settings || {};
  var acc = STATE.account || {};
  var reward = Number(sett.dailyCheckin) || 0;
  var checkedIn = acc.lastCheckin && isToday(acc.lastCheckin);
  var html = '<div class="sheet-title">Daily Check-in</div>' +
    optBannerHtml('checkinbg') +
    '<div class="card checkin-card">' +
      '<div class="checkin-reward-lab">Daily check-in reward</div>' +
      '<div class="checkin-reward mono">' + ugx(reward) + '</div>' +
      '<button class="btn btn-primary" id="checkinBtn" style="width:100%;margin-top:16px"' + (checkedIn ? ' disabled' : '') + '>' +
        (checkedIn ? 'Claimed today' : 'Check in now') + '</button>' +
    '</div>' +
    '<div class="checkin-rules">' +
      '<div class="checkin-rule">Daily check-in reward: ' + ugx(reward) + '.</div>' +
      '<div class="checkin-rule">Check in once each day.</div>' +
      '<div class="checkin-rule">You can check in again after midnight (00:00 EAT) each day.</div>' +
    '</div>';
  openSheet('generic', html);
  var btn = $('checkinBtn');
  if (btn && !checkedIn) btn.onclick = function(){ doCheckin(btn); };
}
async function doCheckin(btnEl){
  var btn = btnEl || $('checkinBtn');
  if (!btn || btn.disabled) return;
  // Codex-verified real bug (2026-08-18): this rework moved the claim off
  // the Home button into its own sheet, but dropped the authEpoch guard
  // every other STATE-mutating await in this file carries (see
  // renderHome()'s own comment on why). Concretely: member A taps Check
  // in, then signs out before the response returns; member B signs in on
  // the SAME device while it's still in flight. Without this guard, A's
  // now-late response would still credit A's bonus onto B's in-memory
  // STATE.account, flip B's (unrelated) checkin button to "Claimed", and
  // toast B with A's streak -- a real account-data leak on a shared
  // device, not just a cosmetic glitch. Captured before the request,
  // checked after: if it changed, this response is for a session that's
  // no longer current and must not touch STATE, the DOM, or show a toast.
  var epoch = STATE.authEpoch;
  setBtnLoading(btn, true);
  var r = await api('/checkin', {});
  if (epoch !== STATE.authEpoch) return;
  setBtnLoading(btn, false);
  if (r.status === 'success') {
    // Owner: "l wanted it to be claimed successfully ✓" -- keeps the
    // amount/streak (the only place streak is shown anywhere) but leads
    // with the exact phrasing/tick requested.
    toast('Claimed successfully ✓ — +' + ugx(r.bonus) + ', day ' + r.streak + ' streak');
    // totalEarned bumped alongside walletBalance -- Codex-verified real bug
    // (2026-08-17): server.js increments both together for a check-in (see
    // its own comment on /checkin), but this optimistic update only ever
    // bumped walletBalance, so Cumulative Earnings on Home/Products looked
    // stale (too low) until the next full account refetch.
    STATE.account.walletBalance = (STATE.account.walletBalance||0) + r.bonus;
    STATE.account.totalEarned = (STATE.account.totalEarned||0) + r.bonus;
    STATE.account.lastCheckin = eatDateStr();
    // Reflect the claimed state on the sheet button, and refresh Home behind
    // the sheet so its Check-in tile flips to "Claimed" too.
    if ($('checkinBtn')) { $('checkinBtn').textContent = 'Claimed today'; $('checkinBtn').disabled = true; $('checkinBtn').onclick = null; }
    renderHome();
  } else toast(r.message, true);
}

// ── PRODUCTS ──────────────────────────────────────────────────────────
async function renderProducts(){
  // See renderHome()'s authEpoch comment.
  var epoch = STATE.authEpoch;
  var el = $('page-products');
  if (!STATE.loaded.products) el.innerHTML = '<div class="sk sk-card" style="height:110px;margin:16px 0"></div>' + skRows(4);
  var results = await Promise.all([
    STATE.products ? Promise.resolve({status:'success', products:STATE.products}) : api('/public/products'),
    STATE.investments ? Promise.resolve({status:'success', investments:STATE.investments}) : api('/investments'),
    STATE.account ? Promise.resolve({status:'success', account:STATE.account}) : api('/account')
  ]);
  if (epoch !== STATE.authEpoch) return;
  if (results[0].status === 'success') STATE.products = results[0].products;
  if (results[1].status === 'success' && results[1].investments) STATE.investments = results[1].investments;
  if (results[2].status === 'success') STATE.account = results[2].account;
  STATE.loaded.products = true;

  var products = STATE.products || [];
  var myCount = (STATE.investments||[]).filter(function(i){ return i.status==='active'; }).length;
  var earned = (STATE.account||{}).totalEarned || 0;

  var html = bannerHtml('darkbar', 'satellite');
  html += '<div class="shortcut-row">' +
    '<div class="shortcut" id="shBind">' + ico('lock') + '<span>Bind Bank Account</span></div>' +
    '<div class="shortcut" id="shDeposits">' + ico('history') + '<span>Deposit Records</span></div>' +
    '<div class="shortcut" id="shWithdrawals">' + ico('wallet') + '<span>Withdrawal Records</span></div>' +
  '</div>';
  html += '<div class="mystats">' +
    '<div class="card mystats-link" id="myProductsCard"><div class="lab">My Products</div>' +
      '<div class="mystats-row"><div class="val">' + myCount + '</div>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div></div>' +
    '<div class="card"><div class="lab">Cumulative Earnings</div><div class="val mono">' + ugx(earned) + '</div></div>' +
  '</div>';
  html += '<div class="section-title">All Products</div>';
  products.forEach(function(p){ html += prodCardHtml(p); });
  el.innerHTML = html;

  qsa('.prod-card').forEach(function(c){
    var invBtn = qs('.invest-btn', c);
    if (invBtn) invBtn.onclick = function(e){ e.stopPropagation(); openInvestSheet(c.dataset.key); };
  });
  $('shBind').onclick = function(){ openPayoutSheet(); };
  $('shDeposits').onclick = function(){ openHistorySheet('deposit'); };
  $('shWithdrawals').onclick = function(){ openHistorySheet('withdrawal'); };
  $('myProductsCard').onclick = function(){ openMyProductsSheet(); };
}
// Purchased-plans list, moved here from a dedicated Home section 2026-08-17
// (owner: "I don't want that function or that of active plans, remove it...
// products will be in the area where you see my products so that... card
// will be having arrow") -- reuses the same planRowHtml()/openPlanDetailSheet()
// pair the Home section used, just entered from the "My Products" stat tile
// instead of always showing on Home.
function openMyProductsSheet(){
  var active = (STATE.investments||[]).filter(function(i){ return i.status === 'active'; });
  var html = '<div class="sheet-title">My Products</div>';
  html += active.length ?
    '<div class="menu-list">' + active.map(planRowHtml).join('') + '</div>' :
    emptyState('satellite', 'No active plans yet — purchase one from All Products.');
  openSheet('generic', html);
  qsa('.plan-row', $('genericSheet')).forEach(function(row){
    row.onclick = function(){ openPlanDetailSheet(row.dataset.id); };
  });
}
function prodCardHtml(p){
  var daily = Math.round((p.expectedReturn||0)/(p.cycle||1));
  var disabled = p.active === false || p.comingSoon;
  return '<div class="prod-card ' + (disabled?'soon':'') + '" data-key="' + esc(p.key) + '">' +
    '<div class="top">' +
      '<div class="sat">' + (p.image ? '<img src="'+esc(p.image)+'">' : ico('satellite')) + '</div>' +
      '<div class="name">' + esc(p.name) + '</div>' +
    '</div>' +
    '<div class="grid">' +
      '<div><div class="lab">Price</div><div class="val mono">' + ugx(p.price) + '</div></div>' +
      '<div><div class="lab">Daily Cashback</div><div class="val mono">' + ugx(daily) + '</div></div>' +
      '<div><div class="lab">Amount</div><div class="val mono">' + ugx(p.expectedReturn) + '</div></div>' +
      '<div><div class="lab">Duration</div><div class="val">' + (p.cycle||'-') + ' days</div></div>' +
    '</div>' +
    '<button class="btn btn-primary invest-btn btn-sweep" ' + (disabled?'disabled':'') + '>' + (p.comingSoon?'Coming Soon':'Purchase') + '</button>' +
  '</div>';
}

async function openInvestSheet(key){
  var p = (STATE.products||[]).find(function(x){ return x.key === key; });
  if (!p) return;
  var daily = Math.round((p.expectedReturn||0)/(p.cycle||1));
  var bal = (STATE.account||{}).walletBalance || 0;
  var can = bal >= p.price;
  openSheet('invest',
    '<div class="sheet-title">' + esc(p.name) + '</div>' +
    '<div class="sheet-sub">Confirm your investment</div>' +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Price</div><div style="font-weight:700" class="mono">' + ugx(p.price) + '</div></div>' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Cycle</div><div style="font-weight:700">' + p.cycle + ' days</div></div>' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Daily Income</div><div style="font-weight:700" class="mono">' + ugx(daily) + '</div></div>' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Total Return</div><div style="font-weight:700" class="mono">' + ugx(p.expectedReturn) + '</div></div>' +
      '</div>' +
    '</div>' +
    (!can ? '<div class="auth-err" style="display:block;margin-bottom:14px">Insufficient balance. You have ' + ugx(bal) + '.</div>' : '') +
    '<button class="btn btn-primary btn-sweep" id="confirmInvestBtn" ' + (!can?'disabled':'') + '>Confirm & Purchase</button>' +
    '<button class="btn btn-secondary" style="margin-top:10px" id="cancelInvestBtn">Cancel</button>'
  );
  $('cancelInvestBtn').onclick = function(){ closeSheet('invest'); };
  $('confirmInvestBtn').onclick = async function(){
    var btn = $('confirmInvestBtn');
    setBtnLoading(btn, true, 'Processing…');
    var r = await api('/invest/create', { tierKey: key });
    setBtnLoading(btn, false);
    if (r.status === 'success') {
      toast('Invested in ' + p.name);
      closeSheet('invest');
      STATE.account = null; STATE.investments = null;
      STATE.loaded.home = false; STATE.loaded.products = false;
      loadPage(STATE.currentPage);
    } else toast(r.message, true);
  };
}

// Internal status values (deposits: initiating/pending/matched/failed;
// withdrawals: pending/sending/processing/processed/declined) are our own
// pipeline's bookkeeping states, not user-facing words -- collapsed down to
// the three states a member actually cares about: it went through, it
// didn't, or it's still on its way.
var STATUS_DONE = ['matched', 'processed', 'success', 'completed'];
var STATUS_FAIL = ['failed', 'declined'];
function friendlyStatus(status){
  var s = String(status || '').toLowerCase();
  if (STATUS_DONE.indexOf(s) !== -1) return 'Successful';
  if (STATUS_FAIL.indexOf(s) !== -1) return 'Unsuccessful';
  return 'Processing';
}
// See _genericAsyncSeq's comment above openRecordsSheet() -- shares the
// same guard since both render into the same 'generic' sheet slot and can
// race against each other now that Deposit/Withdraw's header shortcuts
// make it easy to hop between this and the combined Records view quickly.
function openHistorySheet(kind){
  // Same authEpoch reasoning as openRecordsSheet() above.
  var seq = ++_genericAsyncSeq;
  var epoch = STATE.authEpoch;
  openSheet('generic', '<div class="sheet-title">' + (kind==='deposit'?'Deposit':'Withdrawal') + ' History</div><div id="histBody"><div class="sk sk-line" style="width:60%"></div>' + skRows(3,'sk-card') + '</div>');
  api(kind === 'deposit' ? '/deposits' : '/withdrawals').then(function(r){
    if (seq !== _genericAsyncSeq || epoch !== STATE.authEpoch) return;
    var body = $('histBody'); if (!body) return;
    var items = (r.status === 'success' && (r.deposits||r.withdrawals)) || [];
    if (!items.length) { body.innerHTML = emptyState('history','No more data'); return; }
    body.innerHTML = items.map(function(x){
      var s = String(x.status || '').toLowerCase();
      var pillClass = STATUS_DONE.indexOf(s) !== -1 ? 'pill-done' : STATUS_FAIL.indexOf(s) !== -1 ? 'pill-fail' : 'pill-active';
      // Owner: the amount shown was the gross request, before the withdrawal
      // fee -- add what actually lands with the member right underneath it.
      // `net` (= amount - fee) is stored on the withdrawal record itself at
      // request time (see server.js's /withdraw/request), so this always
      // reflects the fee % that was ACTUALLY charged on that withdrawal, not
      // today's live rate -- same "sum the ledger, not a recomputed rate"
      // principle as teamRewards/teamRewardsPaid.
      var receivedLine = (kind === 'withdrawal' && x.net != null)
        ? '<div class="date mono">Received: ' + ugx(x.net) + '</div>' : '';
      return '<div class="member-row record-row"><div class="info"><div class="phone mono">' + ugx(x.amount) + '</div>' +
      receivedLine +
      '<div class="date">' + esc(x.date) + ' ' + esc(x.time) + (x.ref ? '<br>Ref: ' + esc(x.ref) : '') + '</div></div>' +
      '<span class="pill ' + pillClass + '">' + friendlyStatus(x.status) + '</span></div>';
    }).join('') + listEndFooter();
  });
}
function emptyState(icon, msg){
  return '<div class="empty-state">' + ico(icon) + '<p>' + esc(msg) + '</p></div>';
}
function listEndFooter(){
  return '<div class="list-end">No more data</div>';
}

// ── TEAM ──────────────────────────────────────────────────────────────
// Fetches team stats and every level's member list TOGETHER (Promise.all)
// and renders the whole page in one pass -- previously each level's members
// were fetched and painted separately AFTER the stats-only shell already
// rendered, so a visit showed skeleton -> per-level placeholder bars -> real
// breakdown, three visible stages instead of one clean loading transition
// (owner: "when you open team it first opens then shows those bars then
// back to real breakdown"). `STATE.teamMembers[level]` cache is preserved so
// a second visit in the same session still skips re-fetching.
async function renderTeam(animate){
  // See renderHome()'s authEpoch comment. Checked in TWO places here: once
  // inside each per-level member fetch's own .then() (that write to
  // STATE.teamMembers[l] is a cache side effect that happens BEFORE the
  // outer Promise.all below settles, so a single end-of-function check
  // alone wouldn't stop a stale write from re-populating the cache right
  // after resetUserState() just cleared it on a sign-out/sign-in), and
  // again before committing anything to the DOM.
  var epoch = STATE.authEpoch;
  var el = $('page-team');
  if (!STATE.loaded.team) el.innerHTML = '<div class="sk sk-card" style="height:110px;margin:16px 0"></div>' + skRows(3);
  // Stats are fetched (never cached) BEFORE deciding whether to reuse each
  // level's cached member list. Codex-verified real bug (2026-08-17): the
  // member-list cache used to be trusted unconditionally for an entire
  // session, so a referral who joined or invested after the referrer's
  // first Team visit never appeared in that level's list even though the
  // Total Referrals / commission figures above it kept refreshing live --
  // the count and the list underneath it could visibly disagree. Comparing
  // the fresh count against the cached list's length catches exactly that
  // and invalidates only the level(s) that actually changed, so a revisit
  // with no real change still skips re-fetching (the original flicker fix
  // this cache exists for is untouched).
  var statsR = await api('/team/stats');
  if (epoch !== STATE.authEpoch) return;
  if (statsR.status === 'success') STATE.teamStats = statsR;
  STATE.loaded.team = true;
  var freshCounts = (STATE.teamStats || {}).counts || {};
  [1,2,3].forEach(function(l){
    if (!STATE.teamMembers[l]) return;
    if (STATE.teamMembers[l].length !== (freshCounts['l'+l] || 0)) { STATE.teamMembers[l] = null; return; }
    // Codex-verified real bug (2026-08-17): a headcount match alone isn't
    // enough -- a cached member can flip from Pending to Active (invests
    // for the first time) with the level's TOTAL count unchanged, and that
    // status is exactly what the Active/Pending pill shows. hasInvested can
    // only ever go false -> true, never back, so a cached list is only
    // truly safe to reuse once every member in it already reads Active;
    // any remaining Pending entry might have since flipped.
    if (STATE.teamMembers[l].some(function(m){ return !m.hasInvested; })) STATE.teamMembers[l] = null;
  });
  // Each level resolves to { members, failed } rather than a bare array, so
  // a fetch error can be told apart from a genuinely empty level both when
  // rendering (a failed fetch must not read as "No referrals yet") and when
  // caching (only a SUCCESSFUL result is written to STATE.teamMembers[l] --
  // caching [] on failure would otherwise silently treat that level as
  // confirmed-empty forever, since a cached [] is still truthy and skips
  // re-fetching on every later visit).
  var memberFetches = [1,2,3].map(function(l){
    if (STATE.teamMembers[l]) return Promise.resolve({ members: STATE.teamMembers[l], failed: false });
    return api('/team/members?level=' + l, null, 'GET').then(function(r){
      if (epoch !== STATE.authEpoch) return { members: [], failed: true };
      if (r.status !== 'success') return { members: [], failed: true };
      var members = r.members || [];
      STATE.teamMembers[l] = members;
      return { members: members, failed: false };
    });
  });
  // Owner: "referral links tab should be Migrated to team, so it will start
  // up after the banner" -- was on Account; STATE.account is almost always
  // already populated by the time Team is reachable (Home renders first on
  // every app entry), but fetched here too so a referral code/link is never
  // missing on this card specifically.
  if (!STATE.account) {
    var accR = await api('/account');
    if (epoch !== STATE.authEpoch) return;
    if (accR.status === 'success') STATE.account = accR.account;
  }
  var acc = STATE.account || {};
  var results = [statsR].concat(await Promise.all(memberFetches));
  if (epoch !== STATE.authEpoch) return;
  var s = STATE.teamStats || { counts:{l1:0,l2:0,l3:0}, commission:0, milestones:[] };
  var LEVEL_PCT = { 1:28, 2:2, 3:1 };

  var html = bannerHtml('giftbox', 'cluster');
  html += '<div class="card referral-card">' +
    '<div class="referral-label">Your Referral Code</div>' +
    '<div class="referral-row">' +
      '<div class="referral-code mono">' + esc(acc.referralCode||'—') + '</div>' +
      '<button class="iconbtn" id="copyRefCodeBtn" aria-label="Copy referral code">' + ico('copy') + '</button>' +
    '</div>' +
    '<div class="referral-label referral-link-label">Your Referral Link</div>' +
    '<div class="referral-row referral-link-row"><div class="referral-link mono" id="referralLink">' + esc(referralLink(acc.referralCode)) + '</div><button class="iconbtn" id="shareRefBtn" aria-label="Share referral link">' + ico('share') + '</button></div>' +
    '<div class="referral-hint">Copy your code or share your personal link to invite people.</div>' +
  '</div>';
  html += '<div class="mystats">' +
    '<div class="card"><div class="lab">Total Referrals</div><div class="val">' + ((s.counts.l1||0)+(s.counts.l2||0)+(s.counts.l3||0)) + '</div></div>' +
    '<div class="card"><div class="lab">Total Commission</div><div class="val mono">' + ugx(s.commission) + '</div></div>' +
  '</div>';
  var TEAM_PAGE_SIZE = 5;
  [1,2,3].forEach(function(l){
    var lvl = results[l] || { members: [], failed: true };
    html += '<div class="section-title">Level ' + l + ' <span class="see-all">' + LEVEL_PCT[l] + '%</span></div>';
    var expanded = !!STATE.teamExpanded[l];
    var visible = expanded ? lvl.members : lvl.members.slice(0, TEAM_PAGE_SIZE);
    html += lvl.failed ? emptyState('cluster','Could not load this level — reopen the Team tab to retry.') :
      lvl.members.length ?
      '<div class="card">' + visible.map(function(m){
        return '<div class="member-row"><div class="av">' + ico('space8logo') + '</div>' +
          '<div class="info"><div class="phone">' + esc(maskPhone(m.phone)) + '</div><div class="date">Joined ' + timeAgo(m.joinedAt) + '</div></div>' +
          '<span class="pill ' + (m.hasInvested?'pill-active':'pill-pending') + '">' + (m.hasInvested?'Active':'Pending') + '</span></div>';
      }).join('') + '</div>' +
      (lvl.members.length > TEAM_PAGE_SIZE ? '<div class="view-more-row"><button class="view-more-lvl" data-level="' + l + '">' + (expanded ? 'View less' : 'View more (' + (lvl.members.length - TEAM_PAGE_SIZE) + ')') + '</button></div>' : '') +
      listEndFooter() :
      emptyState('cluster','No referrals at this level yet.');
  });
  html += '<div class="section-title">Task Center</div><div id="taskList"></div>';
  el.innerHTML = html;
  // Owner: "even referral link ... like that" -- same fresh-arrival reveal
  // as Home's balances (see animateReveal()'s own comment); the referral
  // CODE right above it gets the same treatment so the two don't look out
  // of sync with each other.
  if (animate) {
    animateReveal(qs('.referral-code', el));
    animateReveal($('referralLink'));
  }
  $('shareRefBtn').onclick = function(){ shareReferral(acc.referralCode); };
  $('copyRefCodeBtn').onclick = function(){ copyText(acc.referralCode, 'Referral code'); };
  qsa('.view-more-lvl', el).forEach(function(btn){ btn.onclick = function(){
    var l = Number(btn.dataset.level);
    STATE.teamExpanded[l] = !STATE.teamExpanded[l];
    renderTeam();
  }; });
  renderTaskList(s.milestones||[]);
}
function renderTaskList(milestones){
  var box = $('taskList'); if (!box) return;
  if (!milestones.length) { box.innerHTML = emptyState('gift','No missions available right now.'); return; }
  var groups = [
    { key:'count', title:'Active Level-1 Missions', items:milestones.filter(function(m){ return m.type === 'count'; }) },
    { key:'deposit', title:'Whole Team Deposit Missions', items:milestones.filter(function(m){ return m.type === 'deposit'; }) }
  ];
  box.innerHTML = groups.map(function(g){
    return '<div class="section-title mission-title">' + g.title + '</div>' + g.items.map(function(m){
      var pct = Math.min(100, Math.round((m.current/m.target)*100));
      var label = m.type === 'deposit' ? ('Team deposits ' + ugx(m.target)) : (m.target + ' active Level-1 referrals');
      return '<div class="milestone-card ' + (m.claimed?'done':'') + '">' +
        '<div class="ico">' + ico('gift') + '</div><div class="info"><div class="t">' + label + '</div>' +
        '<div class="p">Manual reward · ' + ugx(m.reward) + (m.claimed ? ' · Claimed' : ' · ' + (m.type==='deposit'?ugx(m.current):m.current) + ' / ' + (m.type==='deposit'?ugx(m.target):m.target)) + '</div>' +
        (!m.claimed ? '<div class="bar"><i style="width:'+pct+'%"></i></div>' : '') + '</div>' +
        (m.claimed ? '<span class="pill pill-done">' + ico('check') + '</span>' : m.achieved ? '<button class="claim" data-target="'+m.target+'" data-type="'+m.type+'">Claim reward</button>' : '<span class="mission-pending">Not yet reached</span>') +
      '</div>';
    }).join('');
  }).join('');
  qsa('.claim', box).forEach(function(c){ c.onclick = async function(){
    c.disabled = true; c.textContent = 'Claiming…';
    var r = await api('/team/milestone/claim', { target:Number(c.dataset.target), type:c.dataset.type });
    if (r.status === 'success') {
      toast(r.message);
      // Codex-verified real bug (2026-08-17): this used to update neither
      // walletBalance nor totalEarned locally at all -- server.js credits
      // both together for a Task Center reward (type 'team_reward'), so
      // Cumulative Earnings AND wallet balance both looked stale (too low)
      // on Home/Products until whatever next forced a real refetch.
      if (STATE.account && r.amount) {
        STATE.account.walletBalance = (STATE.account.walletBalance || 0) + r.amount;
        STATE.account.totalEarned = (STATE.account.totalEarned || 0) + r.amount;
      }
      STATE.loaded.team=false; STATE.loaded.home=false; STATE.loaded.products=false;
      renderTeam();
    }
    else { c.disabled=false; c.textContent='Claim'; toast(r.message,true); }
  }; });
}
// ── ACCOUNT ───────────────────────────────────────────────────────────
async function renderAccount(animate){
  // See renderHome()'s authEpoch comment.
  var epoch = STATE.authEpoch;
  var el = $('page-account');
  if (!STATE.loaded.account) el.innerHTML = '<div class="sk sk-card" style="height:90px;margin:16px 0"></div>' + skRows(2);
  var r = STATE.account ? {status:'success', account:STATE.account} : await api('/account');
  if (epoch !== STATE.authEpoch) return;
  if (r.status === 'success') STATE.account = r.account;
  STATE.loaded.account = true;
  var acc = STATE.account || {};

  var html = identityBannerHtml(acc);

  var sett = STATE.settings || {};
  if (sett.telegramGroup || sett.telegramChannel) {
    html += '<div class="card telegram-card">' +
      '<div class="referral-label">Join The Community</div>' +
      '<div class="telegram-row">' +
        (sett.telegramGroup ? '<button class="btn btn-secondary" id="telegramGroupBtn">' + ico('telegram') + '<span>Group</span></button>' : '') +
        (sett.telegramChannel ? '<button class="btn btn-secondary" id="telegramChannelBtn">' + ico('telegram') + '<span>Channel</span></button>' : '') +
      '</div>' +
    '</div>';
  }

  html += '<div class="matrix">' +
    '<div class="mtile" id="mBind">' + ico('lock') + '<span>Bind Bank Account</span></div>' +
    '<div class="mtile" id="mDeposits">' + ico('history') + '<span>Deposit Records</span></div>' +
    '<div class="mtile" id="mWithdrawals">' + ico('wallet') + '<span>Withdrawal Records</span></div>' +
    '<div class="mtile" id="mPin">' + ico('shield') + '<span>Change PIN</span></div>' +
  '</div>';

  html += '<div class="menu-list">' +
    '<div class="menu-row" id="passwordRow">' + ico('key') + '<span>Change Password</span>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div>' +
    menuRow('info','About Us','about') +
    menuRow('doc','Rules','rules') +
    menuRow('support','Customer Service','support') +
    '<div class="menu-row" id="getAppRow">' + ico('download') + '<span>Get App</span></div>' +
  '</div>';
  html += '<div class="menu-list" style="margin-top:14px">' +
    '<div class="menu-row" id="logoutRow">' + ico('logout') + '<span>Exit</span></div>' +
  '</div>';

  el.innerHTML = html;
  // Owner: "even number and id ... like that" -- same fresh-arrival reveal
  // as Home's balances/Team's referral link (see animateReveal()'s comment).
  if (animate) {
    animateReveal(qs('.identity-phone', el));
    animateReveal(qs('.identity-id', el));
  }
  $('mBind').onclick = function(){ openPayoutSheet(); };
  $('mDeposits').onclick = function(){ openHistorySheet('deposit'); };
  $('mWithdrawals').onclick = function(){ openHistorySheet('withdrawal'); };
  $('mPin').onclick = openPinSheet;
  $('passwordRow').onclick = openPasswordSheet;
  qsa('.mini-copy', el).forEach(function(btn){ btn.onclick = function(){ copyText(btn.dataset.copy, btn.dataset.copyLabel); }; });
  $('logoutRow').onclick = doLogout;
  $('getAppRow').onclick = promptInstallApp;
  if ($('telegramGroupBtn')) $('telegramGroupBtn').onclick = function(){ var u = safeExternalUrl(sett.telegramGroup); if (u) window.open(u, '_blank'); };
  if ($('telegramChannelBtn')) $('telegramChannelBtn').onclick = function(){ var u = safeExternalUrl(sett.telegramChannel); if (u) window.open(u, '_blank'); };
  qsa('.menu-row[data-key]').forEach(function(row){
    row.onclick = function(){
      if (row.dataset.key === 'support') openSupportSheet();
      else if (row.dataset.key === 'about') openAboutSheet();
      else openInfoSheet(row.dataset.key);
    };
  });
}
async function promptInstallApp(){
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
    return toast('Space8 is already installed on this device.');
  }
  var evt = window._installPrompt;
  if (evt) {
    window._installPrompt = null;
    try {
      await evt.prompt();
      var choice = await evt.userChoice;
      if (choice && choice.outcome === 'accepted') toast('Installing Space8…');
    } catch (_) {
      toast('Use your browser menu to install the app.', true);
    }
    return;
  }
  openSheet('generic', '<div class="sheet-title">Get App</div><div style="font-size:13.5px;line-height:1.6;color:var(--ink-dim)">' +
    'Open your browser menu and choose "Add to Home Screen" (or "Install App") to install Space8 on this device.</div>');
}
function menuRow(icon, label, key){
  return '<div class="menu-row" data-key="' + key + '">' + ico(icon) + '<span>' + esc(label) + '</span>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div>';
}
function referralLink(code){
  // Owner: "let the link be this https://space8-platform.com/auth/register?refCode={your referral code}"
  // -- a fixed canonical domain/path, not location.origin. See the
  // _refCode parsing comment near the top of this file for the matching
  // parse side and why the path form is safe now (render.yaml's static-site
  // rewrite routes).
  return 'https://space8-platform.com/auth/register?refCode=' + encodeURIComponent(String(code || ''));
}
// Owner: wants the shared referral message to be a full launch-announcement
// post (rocket emoji header, deposit/withdrawal terms, the 3-level bonus
// structure, link repeated twice) instead of one plain sentence. The
// numbers in it are pulled from the SAME live settings every other screen
// reads (STATE.settings, falling back to a fresh /public/settings fetch --
// the exact pattern openGiftCodeSheet/openSupportSheet already use just
// above) rather than hardcoded, so this can never go stale/wrong the next
// time the owner changes minDeposit/minWithdraw/withdrawFeePct/commL1-3 in
// the admin panel. The link is baked directly into the text at both spots
// and `url` is deliberately left out of the navigator.share() call -- most
// share targets (WhatsApp, Telegram, SMS) append `url` a second time after
// `text` when both are given, which would tack on a stray THIRD copy of
// the link at the very end.
async function shareReferral(code){
  var link = referralLink(code);
  var s = STATE.settings || (await api('/public/settings')).settings || {};
  var prods = STATE.products;
  if (!prods || !prods.length) {
    try { prods = (await api('/public/products')).products; } catch (_) { prods = []; }
  }
  prods = (prods || []).slice().sort(function(a, b){ return (a.price || 0) - (b.price || 0); });
  var vipLines = prods.slice(0, 3).map(function(p, i){
    var daily = p.cycle ? Math.round((p.expectedReturn || 0) / p.cycle) : 0;
    return '⭐ Invest in VIP ' + (i + 1) + ' and earn ' + ugx(daily) + ' daily';
  }).join('\n');
  var vipCount = prods.length || 15;
  var text =
    '🚀 SPACE8 — NEW! NEW! NEW! OFFICIAL LAUNCH 🚀\n\n' +
    'Get ready for the exciting launch of SPACE8! 🌟\n\n' +
    '💰 Minimum Deposit: ' + ugx(s.minDeposit) + '\n' +
    '💸 Minimum Withdrawal: ' + ugx(s.minWithdraw) + '\n' +
    '⚡ Withdrawals: Available daily with fast processing\n' +
    '📌 Withdrawal Charge: ' + (Number(s.withdrawFeePct) || 0) + '%\n' +
    '🎁 Registration Bonus: ' + ugx(s.welcomeBonus) + '\n' +
    '📅 Daily Check-in Bonus: ' + ugx(s.dailyCheckin) + '\n\n' +
    '🎁 Referral Bonus Structure:\n' +
    '🔥 Level 1: ' + (Number(s.commL1) || 0) + '%\n' +
    '✨ Level 2: ' + (Number(s.commL2) || 0) + '%\n' +
    '💎 Level 3: ' + (Number(s.commL3) || 0) + '%\n\n' +
    '🔗 ' + link + '\n\n' +
    '💼 Some of the VIP products:\n' +
    vipLines + '\n' +
    '⭐ And more exciting plans up to VIP ' + vipCount + '\n\n' +
    'Join SPACE8 and explore the new platform from launch day! 🚀\n\n' +
    '🔗 ' + link + '\n\n' +
    '🚀 SPACE8 — NEW LAUNCH, NEW OPPORTUNITIES!';
  // Owner: "when one clicks share link, it will also embed with that
  // table" -- attach the Space8 Investment Plans graphic alongside the
  // text via the Web Share API's file-sharing capability. Not every
  // browser/OS that has navigator.share ALSO supports sharing files
  // (desktop Chrome/Firefox commonly don't) -- canShare({files}) is the
  // real capability check; a plain `navigator.share` existing is not
  // enough on its own. Falls back to text-only share (unchanged prior
  // behavior) wherever the image can't be attached, never blocking the
  // share entirely just because the image fetch/attach failed.
  var shareData = { title: 'Join Space8', text: text };
  try {
    var imgResp = await fetch('/plans-table.jpg');
    var imgBlob = await imgResp.blob();
    var imgFile = new File([imgBlob], 'space8-investment-plans.jpg', { type: imgBlob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [imgFile] })) shareData.files = [imgFile];
  } catch (_) {}
  if (navigator.share) navigator.share(shareData).catch(function(){});
  else copyText(text, 'Referral message');
}
async function redeemGiftCode(){
  var input = $('giftCodeInput');
  var code = input.value.trim();
  if (!code) return toast('Enter a gift code first', true);
  var btn = $('giftCodeBtn');
  setBtnLoading(btn, true, 'Redeeming…');
  var r = await api('/redeem', { code: code });
  setBtnLoading(btn, false);
  if (r.status === 'success') {
    // Owner: "gift code 'redeemed successfully ✓'" -- exact phrasing/tick.
    toast('+' + ugx(r.reward) + ' redeemed successfully ✓');
    input.value = '';
    // totalEarned bumped alongside walletBalance -- Codex-verified real bug
    // (2026-08-17): server.js credits both together for a gift-code
    // redemption (type 'promocode' is one of totalEarned's live sources),
    // but this only ever bumped walletBalance, so Cumulative Earnings on
    // Home/Products looked stale (too low) until whatever next forced a
    // real refetch. STATE.loaded.products invalidated too, not just home,
    // so Products' own cached figure doesn't stay wrong either.
    if (STATE.account) {
      STATE.account.walletBalance = (STATE.account.walletBalance || 0) + (r.reward || 0);
      STATE.account.totalEarned = (STATE.account.totalEarned || 0) + (r.reward || 0);
    }
    STATE.loaded.home = false;
    STATE.loaded.products = false;
    if (STATE.currentPage === 'home') renderHome();
    else if (STATE.currentPage === 'products') renderProducts();
    closeSheet('generic');
  } else toast(r.message, true);
}
// Owner: "let gift code be given a quick access... 3d image of
// giftCodebox... when tapped one goes to a screen for giftCodes iput, so
// there will be just a line so where one puts a code, and down it redeem
// button, and also a saying that you can get gift codes from telegram
// group." Reuses the same #giftCodeInput/#giftCodeBtn ids and
// redeemGiftCode() the old inline Account card used -- that card is gone
// now, this sheet is its only home.
async function openGiftCodeSheet(){
  var sett = STATE.settings || (await api('/public/settings')).settings || {};
  // Owner: "l wanted a telegram tab not word 'telegram group', l said a
  // tab, dont you see that tab on pico, I SAID THAT TAB" -- a real
  // tappable row (icon + label + chevron), same .menu-row/.menu-list
  // component already used for Password Management/About/Rules/Support on
  // Account, not a word inside a sentence. Positioned above the input
  // (still a plain line, no icon -- unchanged); Redeem/banner untouched.
  // Follow-up: "you didn't add the other sentence on giftCodes 'You can
  // get gift codes in the telegram group'" -- Pico's screenshot has BOTH
  // the descriptive line AND the tab underneath it; the tab replaced the
  // sentence instead of sitting alongside it. Restored above the tab.
  var html = '<div class="sheet-title">Gift Code</div>' +
    optBannerHtml('giftcodebg') +
    (sett.telegramGroup ?
      '<div style="text-align:center;font-size:12.5px;color:var(--ink-dim);margin:16px 0 10px;padding:0 8px">You can get gift codes in the telegram group</div>' +
      '<div class="menu-list" style="margin-bottom:16px"><div class="menu-row" id="giftTgTab">' + ico('telegram') + '<span>Official Telegram Group</span>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div></div>' :
      '') +
    '<div class="card giftcode-card">' +
      '<input id="giftCodeInput" class="giftcode-line-input" type="text" maxlength="32" placeholder="Enter gift code" autocapitalize="off" autocomplete="off">' +
      '<button class="btn btn-primary" id="giftCodeBtn" style="width:100%;margin-top:12px">Redeem</button>' +
    '</div>';
  openSheet('generic', html);
  $('giftCodeBtn').onclick = redeemGiftCode;
  $('giftCodeInput').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('giftCodeBtn').click(); });
  if ($('giftTgTab')) $('giftTgTab').onclick = function(){ var u = safeExternalUrl(sett.telegramGroup); if (u) window.open(u, '_blank'); };
}
async function openInfoSheet(key){
  var s = STATE.settings || (await api('/public/settings')).settings || {};
  var map = {
    rules: ['Rules', s.rulesText ? escNl(s.rulesText) : 'Standard platform rules apply.']
  };
  var m = map[key] || ['Info',''];
  openSheet('generic', '<div class="sheet-title">' + m[0] + '</div><div style="font-size:13.5px;line-height:1.6;color:var(--ink-dim)">' + m[1] + '</div>');
}
// Owner: rebuild About as a long, photo-illustrated company story (heritage,
// engineering, our companies) instead of the old flat admin-editable text
// blurb. Fully static/hardcoded on purpose, not sourced from the aboutText
// setting -- this is a curated, structured piece with embedded photos, not
// a plain text field. Photos are the ones the owner supplied with any real,
// identifiable third-party branding filtered out first (two had visible
// "SPACEX" signage, one a real "RAL Space" facility sign, one a real
// "SpacePrep" building render, one a Soyuz spacecraft, one a lunar lander
// with a legible mission name, one a technician's visible name badge) --
// using those specific real companies'/people's imagery as if it were
// Space8's own would misleadingly imply an affiliation that doesn't exist.
// Only the unbranded, generic photos made it in.
async function openAboutSheet(){
  var html = '<div class="sheet-title">About Us</div>' +
    '<img class="about-photo" src="/about-2.jpg" alt="Satellite constellation">' +
    '<div class="about-body">' +
      '<p>Space8 was built around one obsession: getting hardware to survive the unforgiving trip from a factory floor to a stable orbit, then keep working long after everyone has stopped watching. What began as a small team chasing that exact problem has grown into a name behind some of the quietest, most dependable satellite work most people never hear about — because a spacecraft that does its job right rarely makes headlines.</p>' +

      '<div class="about-section-title">A Heritage Built in Clean Rooms</div>' +
      '<img class="about-photo" src="/about-1.jpg" alt="Satellite in orbit">' +
      '<p>Long before Space8 was a name on a badge, it was a habit: build it right, test it twice, and never ship what you would not personally trust in vacuum. That discipline came from years of hands-on orbital work — antenna arrays tuned by feel, harnesses routed a second time because the first route was merely good enough, thermal blankets stitched and re-stitched until they were right. Every platform that has ever carried the Space8 name inherited that same stubbornness.</p>' +

      '<div class="about-section-title">Precision, By Hand</div>' +
      '<img class="about-photo" src="/about-3.jpg" alt="Engineers integrating satellite hardware">' +
      '<p>Behind every finished spacecraft is a slower, quieter story: engineers in clean-room suits, torque wrenches calibrated that morning, a checklist that gets followed exactly because the alternative is unacceptable. Our integration teams treat every harness, every fastener, and every solder joint as the one thing standing between a mission succeeding and a mission going silent. That patience is not a phase we grow out of — it is the actual product.</p>' +

      '<div class="about-section-title">The Space8 Group</div>' +
      '<img class="about-photo" src="/about-4.jpg" alt="Team preparing a satellite for launch">' +
      '<p>Space8 today is less a single workshop and more a small constellation of its own — a group of focused teams, each owning one hard problem end to end:</p>' +
      '<p><b>Space8 Orbital Systems</b> — spacecraft bus design, structural engineering, and full satellite integration.</p>' +
      '<p><b>Space8 Payload Works</b> — sensor packages, imaging instruments, and communications payloads built to spec.</p>' +
      '<p><b>Space8 Ground Network</b> — the mission control, tracking, and downlink infrastructure that keeps a spacecraft in reach long after launch.</p>' +
      '<p><b>Space8 Materials Lab</b> — thermal, structural, and radiation-hardened materials research feeding straight back into everything above it.</p>' +

      '<div class="about-section-title">Where We\'re Headed</div>' +
      '<p>Orbit keeps getting more crowded, and the margin for error keeps getting thinner — which is exactly the kind of problem this team has always been built for. Space8 keeps doubling down on the unglamorous fundamentals: better materials, tighter tolerances, longer-lived hardware, and people who care enough to double-check their own work. That is the whole philosophy, really. Everything else is just the application of it.</p>' +
    '</div>';
  openSheet('generic', html);
}
// Owner: rebuild Support as its own screen (photo header, tappable contact
// rows, a highlighted hours card) instead of the old flat text dump that
// only ever showed 3 of the 6 fields admin actually configures --
// telegramGroup/telegramChannel/whatsappGroup were set in the admin panel
// but had no render path anywhere ("support items are not fetching and
// showing up... yet they were set" -- they were saved fine, this screen
// just never displayed them). Every row below is real, admin-configured
// data or it doesn't render at all -- no placeholder "—" rows.
async function openSupportSheet(){
  var s = STATE.settings || (await api('/public/settings')).settings || {};
  var rows = [];
  if (s.supportTelegram) rows.push(['telegram', 'Telegram Support', s.supportTelegram]);
  if (s.telegramGroup) rows.push(['telegram', 'Official Telegram Group', s.telegramGroup]);
  if (s.telegramChannel) rows.push(['telegram', 'Telegram Channel', s.telegramChannel]);
  if (s.whatsappGroup) rows.push(['whatsapp', 'WhatsApp Group', s.whatsappGroup]);
  if (s.whatsappContact) rows.push(['whatsapp', 'WhatsApp Contact', s.whatsappContact]);
  var html = '<div class="sheet-title">Customer Service</div>' + bannerHtml('supportbg', 'support');
  html += rows.length ?
    '<div class="menu-list" style="margin-top:14px">' + rows.map(function(r, i){
      return '<div class="menu-row" data-support-link="' + i + '">' + ico(r[0]) + '<span>' + esc(r[1]) + '</span>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div>';
    }).join('') + '</div>' :
    '<div style="margin-top:14px">' + emptyState('support', 'Support contact details have not been set up yet — reach out from the Account tab another way for now.') + '</div>';
  if (s.supportHours) {
    html += '<div class="card" style="text-align:center;margin-top:14px">' +
      '<div style="display:flex;justify-content:center;margin-bottom:6px;color:var(--blue)">' + ico('clock') + '</div>' +
      '<div style="font-size:20px;font-weight:700">' + esc(s.supportHours) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-dim);margin-top:4px">Customer service hours</div>' +
    '</div>';
  }
  html += '<div class="card" style="margin-top:14px;font-size:13px;line-height:1.6;color:var(--ink-dim)">' +
    '<div>1. Have a question? Reach out through any of the channels above — we\'re happy to help.</div>' +
    '<div style="margin-top:8px">2. Keep your password and withdrawal PIN safe. Official Space8 staff will never ask you for either, on any channel.</div>' +
  '</div>';
  openSheet('generic', html);
  rows.forEach(function(r, i){
    var el = qs('[data-support-link="' + i + '"]', $('genericSheet'));
    if (el) el.onclick = function(){ var u = safeExternalUrl(r[2]); if (u) window.open(u, '_blank'); };
  });
}

// ── PAYOUT ACCOUNT / PIN ─────────────────────────────────────────────
// Multiple mobile-money or bank accounts can be bound (server already
// supports this -- /bank/save always adds a new row, never overwrites) -- shown
// here as a list so a member can hold more than one, remove one they no
// longer use, and (2026-08-16, owner correction) pick between them for a
// WITHDRAWAL by navigating here as a real page, not an inline picker
// embedded in the withdraw sheet: openPayoutSheet(pickCallback) opens this
// same screen in "choose" mode -- tap any account, it calls the callback
// with that account and this page closes on its own, dropping the member
// straight back onto the withdraw sheet underneath (which was never
// closed, just temporarily covered -- same stacked-sheet mechanism
// openSheet() already uses everywhere else). Deposits do NOT use this at
// all; they take a phone/network typed fresh each time, unchanged.
var _payoutDeletePending = null;
var _payoutPickCallback = null;
async function openPayoutSheet(pickCallback){
  _payoutPickCallback = pickCallback || null;
  openSheet('payout', '<div class="sk sk-line"></div>');
  await renderPayoutSheet();
}
// Owner: "we are adding banks... let it remain the same, same terms, only
// l want when one selects network mtn,airtel,plus all supported banks."
// The exact set /bank/save and /withdraw/request already whitelist
// server-side -- kept here only to tell the client "is this option a
// mobile-money network" for the account-number field's validation/
// placeholder, never as a security boundary of its own.
var MM_NETWORKS = ['MTN Mobile Money', 'Airtel Money'];
async function renderPayoutSheet(){
  // See renderHome()'s authEpoch comment -- withdrawal-account phone/holder
  // details are exactly the kind of per-user data this guard exists to
  // keep from leaking onto a DIFFERENT member's screen on a shared device.
  var epoch = STATE.authEpoch;
  // Bank list rarely changes -- fetched once and cached on STATE, same
  // spirit as products/settings (server itself also caches it, see
  // getMarzBanks() in server.js), so re-opening this screen doesn't
  // re-fetch it every time. Codex-verified real gap (2026-08-19): only
  // caching on a truthy STATE.banks meant a transient MarzPay outage (or
  // any fetch failure) -- which resolves to a successful-but-empty
  // {status:'success', banks:[]} response, see getMarzBanks()'s own
  // catch-and-serve-last-known-good behavior -- got cached as `[]`
  // (still truthy) and never retried again for the rest of the session,
  // even after MarzPay recovered. Only treat a NON-EMPTY list as cached.
  var calls = [api('/bank/list', null, 'GET')];
  if (!STATE.banks || !STATE.banks.length) calls.push(api('/public/banks', null, 'GET'));
  var results = await Promise.all(calls);
  if (epoch !== STATE.authEpoch) return;
  var r = results[0];
  if (results[1]) STATE.banks = results[1].status === 'success' ? (results[1].banks || []) : [];
  var accounts = r.status === 'success' ? (r.accounts || []) : [];
  STATE.bankAccounts = accounts;
  var picking = !!_payoutPickCallback;
  var listHtml = accounts.length ? accounts.map(function(a){
    var pending = !picking && _payoutDeletePending === a.id;
    return '<div class="record-row acct-row' + (picking ? ' selectable' : '') + '" data-id="' + esc(a.id) + '">' +
      '<div class="info"><div class="phone">' + esc(a.holder) + '</div>' +
      '<div class="date">' + esc(a.network) + ' · ' + esc(a.phone) + '</div>' +
      (pending ?
        '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">' +
          '<input type="password" inputmode="numeric" maxlength="4" placeholder="PIN" class="del-pin" style="width:64px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:8px 10px;color:#fff;font-size:14px">' +
          '<button class="btn-confirm-del" style="background:#fff;color:var(--danger);border:none;border-radius:8px;padding:8px 12px;font-weight:700;font-size:12.5px">Delete</button>' +
          '<button class="btn-cancel-del" style="background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:600;font-size:12.5px">Cancel</button>' +
        '</div>' : '') +
      '</div>' +
      (picking ? ico('chev').replace('<svg ', '<svg class="chev" ') :
        (!pending ? '<button class="acct-del" data-del="' + esc(a.id) + '">' + ico('trash') + '</button>' : '')) +
    '</div>';
  }).join('') : emptyState('wallet', 'No withdrawal accounts bound yet.');

  // In picking mode with nothing to pick from yet, show the add-account
  // form right here instead of a dead end -- owner, 2026-08-17: "in most
  // cases if one has no, it says add payout account after he taps on it
  // and comes back to withdrawal screen automatically." Saving here
  // re-renders this same picker (still in picking mode, see savePayoutBtn
  // below), which now has a real account to tap -- no separate detour.
  var showAddForm = !picking || !accounts.length;

  // Content-only update, no openSheet() here -- the sheet was already
  // opened (and its one history/stack entry pushed) by openPayoutSheet()
  // before this ever runs; re-pushing on every internal interaction
  // (delete-pending toggle, cancel, post-delete, post-add) would mean the
  // phone Back button has to be pressed once per interaction before it
  // actually leaves the page.
  // Owner: "remove that 07xxxxxx plus phone svg, you will put 🏦 svg, so
  // one can put mobile account number or bank account number." One
  // network select (MTN/Airtel + every MarzPay-supported bank) and one
  // generic account-number field -- no separate bank-vs-mobile-money
  // sub-flow, exactly per "no making another category it has remained
  // the same."
  // Owner: "dont allow default selection of any network, the box should be
  // not filled such that one selects the right network" -- a disabled,
  // hidden placeholder option starts selected instead of defaulting onto
  // the first real network, so the field genuinely shows nothing chosen
  // until the member picks one.
  var networkOptionsHtml =
    '<option value="" disabled selected hidden>Select network</option>' +
    '<option value="MTN Mobile Money">MTN Mobile Money</option>' +
    '<option value="Airtel Money">Airtel Money</option>' +
    (STATE.banks || []).map(function(b){ return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join('');
  $('payoutSheet').innerHTML =
    '<div class="sheet-title">' + (picking ? 'Choose Withdrawal Account' : 'Withdrawal Accounts') + '</div>' +
    '<div class="sheet-sub">' + (picking ? (accounts.length ? 'Tap the account to send this withdrawal to.' : 'Add a withdrawal account below, then tap it to continue.') : 'Mobile-money or bank accounts you can withdraw to.') + '</div>' +
    listHtml +
    (!showAddForm ? '' :
      (picking ? '' : '<div class="plain-note">Withdrawals only ever go to an account bound here, never a number typed at withdrawal time. Add another account below, or remove one you no longer use with your withdrawal PIN.</div>') +
      '<div class="auth-form">' +
        '<div class="field">' + ico('wallet') + '<input id="payHolder" placeholder="Account holder name"></div>' +
        '<select id="payNetwork" class="field placeholder" style="appearance:none">' + networkOptionsHtml + '</select>' +
        '<div class="field">' + ico('bank') + '<input id="payPhone" type="text" inputmode="numeric" maxlength="20" placeholder="Mobile-money or bank account number"></div>' +
        '<div class="field">' + ico('shield') + '<input id="payPin" type="password" inputmode="numeric" maxlength="4" placeholder="Your withdrawal PIN" autocomplete="one-time-code"></div>' +
        '<div class="field-hint">Enter the withdrawal PIN you set when you registered.</div>' +
      '</div>' +
      '<button class="btn btn-primary" id="savePayoutBtn" style="margin-top:14px">Add Withdrawal Account</button>');

  if (showAddForm) {
    $('payNetwork').onchange = function(){ this.classList.toggle('placeholder', !this.value); };
    $('savePayoutBtn').onclick = async function(){
      var btn = $('savePayoutBtn');
      var holder = $('payHolder').value.trim(), network = $('payNetwork').value;
      var phone = $('payPhone').value, pin = $('payPin').value;
      if (!network) return toast('Select a network', true);
      var isMM = MM_NETWORKS.indexOf(network) !== -1;
      var acctOk = isMM ? !!cleanPhone(phone) : /^\d{5,20}$/.test(String(phone||'').replace(/\D/g,''));
      if (!holder || !acctOk || !/^\d{4}$/.test(pin)) return toast('Fill in all fields correctly', true);
      setBtnLoading(btn, true, 'Saving…');
      var r2 = await api('/bank/save', { holder: holder, network: network, phone: phone, pin: pin });
      setBtnLoading(btn, false);
      if (r2.status === 'success') { toast('Withdrawal account saved'); STATE.bankAccounts = null; STATE.hasPayoutPin = true; renderPayoutSheet(); }
      else toast(r2.message, true);
    };
  }

  if (picking) {
    qsa('.acct-row', $('payoutSheet')).forEach(function(row){
      row.onclick = function(){
        var acct = accounts.find(function(a){ return a.id === row.dataset.id; });
        var cb = _payoutPickCallback;
        _payoutPickCallback = null;
        closeSheet('payout');
        if (cb && acct) cb(acct);
      };
    });
    return;
  }

  qsa('.acct-del').forEach(function(btn){
    btn.onclick = function(){ _payoutDeletePending = btn.dataset.del; renderPayoutSheet(); };
  });
  qsa('.btn-cancel-del').forEach(function(btn){
    btn.onclick = function(){ _payoutDeletePending = null; renderPayoutSheet(); };
  });
  qsa('.btn-confirm-del').forEach(function(btn){
    btn.onclick = async function(){
      var row = btn.closest('.acct-row');
      var pin = qs('.del-pin', row).value;
      if (!/^\d{4}$/.test(pin)) return toast('Enter your 4-digit PIN', true);
      btn.textContent = '…'; btn.disabled = true;
      var r2 = await api('/bank/delete', { id: _payoutDeletePending, pin: pin });
      if (r2.status === 'success') {
        toast('Account removed');
        _payoutDeletePending = null;
        STATE.bankAccounts = null;
        renderPayoutSheet();
      } else {
        toast(r2.message, true);
        btn.textContent = 'Delete'; btn.disabled = false;
      }
    };
  });
}
async function openPinSheet(){
  // Owner: "when one taps on security pin, it takes long to respond, why".
  // Cause: this used to `await` the payout-pin status call BEFORE opening
  // the sheet, so on a cold Render backend (where api() also runs its own
  // cold-start retries) the tap did nothing visible for several seconds.
  // Fix: open the sheet IMMEDIATELY with a tiny loading line, then fetch the
  // status and swap in the real body once it resolves -- the tap now feels
  // instant.
  var epoch = STATE.authEpoch;
  // Codex-verified real bug (2026-08-18): checking only
  // _sheetStack[last] === 'generic' isn't enough -- Gift Code, Check-in,
  // Records and others ALL share this same slot/stack-name. If the status
  // fetch below is slow and the member backs out and opens a DIFFERENT
  // generic sheet before it resolves, that check still passes (top of
  // stack is still, correctly, 'generic') and this would overwrite
  // whatever THAT sheet is now showing with the PIN form. Fixed the same
  // way openPlanDetailSheet's isPlanDetailShowing() already does it for
  // its own sheet: mark this specific open with a data attribute and
  // confirm it's STILL the thing on screen before writing, not just that
  // some sheet named 'generic' is open.
  openSheet('generic',
    '<div data-generic-sheet="pin">' +
    '<div class="sheet-title">Change PIN</div>' +
    '<div class="sheet-sub"><span class="spin" style="display:inline-block;width:15px;height:15px;border:2px solid var(--line);border-top-color:var(--ink-dim);border-radius:50%;vertical-align:-3px;margin-right:7px;animation:spin .7s linear infinite"></span>Checking…</div>' +
    '</div>'
  );
  var status = await api('/account/payout-pin/status', null, 'GET');
  // Codex-verified real bug: on a shared device, a delayed status response
  // could populate this sheet over the NEXT signed-in user's session if the
  // FIRST user signed out while it was in flight. See renderHome()'s
  // authEpoch comment.
  if (epoch !== STATE.authEpoch) return;
  if (!qs('[data-generic-sheet="pin"]', $('genericSheet'))) return;
  var has = status.status === 'success' && status.hasPayoutPin;
  $('genericSheet').innerHTML =
    '<div class="sheet-title">Change PIN</div>' +
    '<div class="sheet-sub">' + (has ? 'Change your 4-digit withdrawal PIN.' : 'No withdrawal PIN on this account yet — it should have been set at registration. Contact support if this looks wrong.') + '</div>' +
    (has ?
      '<div class="auth-form">' +
        '<div class="field">' + ico('shield') + '<input id="oldPin" type="password" inputmode="numeric" maxlength="4" placeholder="Current PIN" autocomplete="one-time-code"></div>' +
        '<div class="field">' + ico('shield') + '<input id="newPin" type="password" inputmode="numeric" maxlength="4" placeholder="New 4-digit PIN" autocomplete="one-time-code"></div>' +
      '</div><button class="btn btn-primary" id="changePinBtn" style="margin-top:14px">Change PIN</button>' : '');
  var btn = $('changePinBtn');
  if (btn) btn.onclick = async function(){
    var oldPin = $('oldPin').value, newPin = $('newPin').value;
    if (!/^\d{4}$/.test(oldPin) || !/^\d{4}$/.test(newPin)) return toast('Enter valid 4-digit PINs', true);
    if (/^(\d)\1{3}$/.test(newPin)) return toast('That PIN is too easy to guess (e.g. 1111, 2222). Choose 4 digits that are not all the same.', true);
    setBtnLoading(btn, true);
    var r = await api('/account/payout-pin/change', { oldPin: oldPin, newPin: newPin });
    setBtnLoading(btn, false);
    if (r.status === 'success') { toast('PIN changed'); closeSheet('generic'); } else toast(r.message, true);
  };
}

// ── PASSWORD MANAGEMENT ──────────────────────────────────────────────
// Pure client-side Firebase, same as login/register/logout -- no server
// endpoint involved, matching how this app already handles auth. Firebase
// requires a recent sign-in before allowing a sensitive change like this,
// hence re-authenticating with the CURRENT password first (fbChangePassword
// in index.html's plain <script>) rather than calling updatePassword directly.
function openPasswordSheet(){
  openSheet('generic',
    '<div class="sheet-title">Change Password</div>' +
    '<div class="sheet-sub">Change the password you use to log in.</div>' +
    '<div class="auth-form">' +
      '<div class="field">' + ico('key') + '<input id="curPassword" type="password" autocomplete="current-password" placeholder="Current password"></div>' +
      '<div class="field">' + ico('key') + '<input id="newPassword" type="password" autocomplete="new-password" placeholder="New password (min 6 characters)"></div>' +
      '<div class="field">' + ico('key') + '<input id="newPassword2" type="password" autocomplete="new-password" placeholder="Confirm new password"></div>' +
    '</div>' +
    '<button class="btn btn-primary" id="changePasswordBtn" style="margin-top:14px">Change Password</button>'
  );
  $('changePasswordBtn').onclick = changePassword;
}
async function changePassword(){
  var btn = $('changePasswordBtn');
  var cur = $('curPassword').value, next = $('newPassword').value, next2 = $('newPassword2').value;
  if (!cur) return toast('Enter your current password', true);
  if (next.length < 6) return toast('New password must be at least 6 characters', true);
  if (next !== next2) return toast('New passwords do not match', true);
  setBtnLoading(btn, true, 'Updating…');
  try {
    await window.fbChangePassword(cur, next);
    setBtnLoading(btn, false);
    toast('Password changed');
    closeSheet('generic');
  } catch (e) {
    setBtnLoading(btn, false);
    var msg = 'Could not change your password.';
    var code = String(e.code || '');
    if (code.indexOf('wrong-password') !== -1 || code.indexOf('invalid-credential') !== -1) msg = 'Current password is incorrect.';
    else if (code.indexOf('weak-password') !== -1) msg = 'Choose a stronger password (min 6 characters).';
    else if (code.indexOf('too-many-requests') !== -1) msg = 'Too many attempts. Try again later.';
    toast(msg, true);
  }
}

// ── DEPOSIT ───────────────────────────────────────────────────────────
// Deposits take a phone/network typed fresh each time, same as always --
// the owner's "select the account in payout accounts" instruction was
// specifically about WITHDRAWALS (2026-08-16 correction), not deposits.
function openDepositSheet(){
  var acc = STATE.account || {};
  var min = (STATE.settings||{}).minDeposit || 20000;
  openSheet('deposit', bannerHtml('basket','deposit') +
    '<div class="sheet-title">Deposit Funds</div>' +
    '<div class="sheet-sub">Minimum deposit ' + ugx(min) + '.</div>' +
    '<div class="auth-form">' +
      '<div class="field">' + ico('deposit') + '<input id="depAmount" type="text" inputmode="numeric" maxlength="9" placeholder="Amount (UGX)"></div>' +
      '<div class="field">' + ico('phone') + '<input id="depPhone" type="tel" inputmode="tel" maxlength="10" placeholder="07XXXXXXXX" value="' + esc(acc.phone||'') + '"></div>' +
      '<select id="depNetwork" class="field" style="appearance:none">' +
        '<option value="MTN Mobile Money">MTN Mobile Money</option>' +
        '<option value="Airtel Money">Airtel Money</option>' +
      '</select>' +
    '</div>' +
    '<button class="btn btn-primary" id="submitDepositBtn" style="margin-top:14px">Deposit Now</button>' +
    '<div class="instruction-card"><b>Deposit instructions</b><ol>' +
      '<li>Enter the amount you want to deposit, at least ' + ugx(min) + '.</li>' +
      '<li>Enter the mobile-money number to pay from, and pick the correct network.</li>' +
      '<li>Tap Deposit Now — a payment prompt will appear on that phone.</li>' +
      '<li>Approve the prompt using your mobile-money PIN.</li>' +
      '<li>Your wallet balance updates automatically once payment is confirmed.</li>' +
    '</ol></div>'
  );
  $('submitDepositBtn').onclick = async function(){
    var btn = $('submitDepositBtn');
    var amt = parseInt($('depAmount').value, 10);
    var phone = $('depPhone').value, network = $('depNetwork').value;
    if (!amt || amt < min) return toast('Enter at least ' + ugx(min), true);
    if (!cleanPhone(phone)) return toast('Enter a valid mobile-money number', true);
    setBtnLoading(btn, true, 'Initiating…');
    var r = await api('/deposit/marzpay', { amount: amt, phone: phone, network: network });
    setBtnLoading(btn, false);
    if (r.status === 'success') {
      toast('Check your phone to approve the payment');
      closeSheet('deposit');
      pollDepositStatus(r.depositId);
    } else toast(r.message, true);
  };
}
function pollDepositStatus(id){
  var tries = 0;
  var iv = setInterval(async function(){
    tries++;
    var r = await api('/deposit/marzpay/status', { depositId: id });
    if (r.status === 'success' && r.state && r.state !== 'pending') {
      clearInterval(iv);
      if (r.state === 'matched') {
        toast('Deposit successful');
        STATE.account = null; STATE.loaded.home = false;
        if (STATE.currentPage === 'home') renderHome();
      } else toast(r.message || 'Deposit failed', true);
    }
    if (tries > 40) clearInterval(iv);
  }, 3000);
}

// ── WITHDRAW ──────────────────────────────────────────────────────────
function openWithdrawSheet(){
  var min = (STATE.settings||{}).minWithdraw || 20000;
  var feePct = (STATE.settings||{}).withdrawFeePct || 15;
  renderWithdrawSheet(null, min, feePct, true);
}
// Owner correction, 2026-08-16: the account to withdraw to is picked by
// navigating to the real Payout Accounts page (openPayoutSheet in "choose"
// mode, stacked on top of this sheet) and tapping one there -- it returns
// here automatically with the tapped account applied. NOT an inline list
// embedded in this sheet (that was the wrong shape, tried and reverted).
// **No account is ever auto-selected, even when exactly one is bound** --
// owner, 2026-08-17: "he picks the number from withdrawal accounts even if
// it is 1, it should not auto select." The sheet always opens with a
// "Select payout account" placeholder row (acct === null) and only shows a
// real account once the member has explicitly tapped through the picker,
// same blue .acct-row styling either way. A member with ZERO bound
// accounts still taps this same row: openPayoutSheet's picker (see
// renderPayoutSheet) now shows the add-account form INLINE whenever
// picking with nothing to pick from yet, so adding one there re-renders
// the same picker with the new account now tappable -- no separate
// "bind first" detour, and it returns to this sheet automatically via the
// same pickCallback every other picker selection already uses.
// isFirstRender controls whether this pushes a new history entry
// (openSheet) or just updates the sheet's content in place (coming back
// from the picker) -- re-pushing on every account change would mean the
// phone Back button has to be pressed once per account switch before it
// actually leaves the sheet.
// Owner: "control withdrawal requests time... EAT time, settable in
// admin settings." The actual enforcement is entirely server-side
// (/withdraw/request rejects a request outside the window regardless of
// what this note says, since a client's clock can be wrong or spoofed) --
// this is purely an informational heads-up so a member sees the window
// up front instead of only discovering it from a rejected request.
function h12Label(h){ var ap = h < 12 ? 'AM' : 'PM'; var hh = h % 12; if (hh === 0) hh = 12; return hh + ':00 ' + ap; }
function withdrawHoursNoteHtml(){
  var s = STATE.settings || {};
  if (!s.withdrawHoursEnabled) return '';
  return '<li>Withdrawals can only be requested between ' + h12Label(s.withdrawHoursStart) + ' and ' + h12Label(s.withdrawHoursEnd) + ' (East Africa Time).</li>';
}
function renderWithdrawSheet(acct, min, feePct, isFirstRender){
  var html = bannerHtml('marscrate','withdraw') +
    '<div class="sheet-title">Withdraw Funds</div>' +
    '<div class="record-row acct-row selectable" id="wdAcctRow">' +
      '<div class="info"><div class="phone">' + (acct ? esc(acct.holder) : 'Select payout account . . . . . . . . . .') + '</div>' +
      (acct ? '<div class="date">' + esc(acct.network) + ' · ' + esc(acct.phone) + '</div>' : '') + '</div>' +
      ico('chev').replace('<svg ', '<svg class="chev" ') +
    '</div>' +
    '<div class="auth-form" style="margin-top:14px">' +
      '<div class="field">' + ico('withdraw') + '<input id="wdAmount" type="text" inputmode="numeric" maxlength="9" placeholder="Amount (UGX), min ' + ugx(min) + '"></div>' +
      '<div class="field-hint" id="feePreview">Fee ' + feePct + '% applies — enter an amount to see what you\'ll receive.</div>' +
      '<div class="field">' + ico('shield') + '<input id="wdPin" type="password" inputmode="numeric" maxlength="4" placeholder="4-digit security PIN"></div>' +
    '</div>' +
    '<button class="btn btn-primary" id="submitWithdrawBtn" style="margin-top:14px" ' + (acct?'':'disabled') + '>Request Withdrawal</button>' +
    '<div class="instruction-card"><b>Withdrawal instructions</b><ol>' +
      '<li>Tap the account row above to choose which withdrawal account receives the money.</li>' +
      '<li>Enter the amount you want to withdraw, at least ' + ugx(min) + '.</li>' +
      '<li>Enter your 4-digit security PIN to confirm.</li>' +
      '<li>The withdrawal fee (' + feePct + '%) is deducted automatically — the fee preview above shows what you\'ll actually receive.</li>' +
      '<li>Tap Request Withdrawal. Each request is reviewed before money is sent.</li>' +
      withdrawHoursNoteHtml() +
    '</ol></div>';

  if (isFirstRender) openSheet('withdraw', html);
  else $('withdrawSheet').innerHTML = html;

  $('wdAcctRow').onclick = function(){
    openPayoutSheet(function(newAcct){
      renderWithdrawSheet(newAcct, min, feePct, false);
    });
  };
  $('wdAmount').addEventListener('input', function(){
    var amt = parseInt(this.value,10) || 0;
    var fee = Math.round(amt * feePct / 100);
    $('feePreview').textContent = amt > 0 ? ('Fee ' + ugx(fee) + ' — you receive ' + ugx(amt-fee)) : ('Fee ' + feePct + '% applies.');
  });
  $('submitWithdrawBtn').onclick = async function(){
    var btn = $('submitWithdrawBtn');
    if (!acct) return toast('Select a payout account first', true);
    var amt = parseInt($('wdAmount').value, 10);
    var pin = $('wdPin').value;
    if (!amt || amt < min) return toast('Enter at least ' + ugx(min), true);
    if (!/^\d{4}$/.test(pin)) return toast('Enter your 4-digit PIN', true);
    setBtnLoading(btn, true, 'Processing…');
    // method is never read from the client (server.js derives it from the
    // bound account's own stored isBank flag) -- not sent here at all.
    var r = await api('/withdraw/request', { amount: amt, holder: acct.holder, network: acct.network, phone: acct.phone, pin: pin });
    setBtnLoading(btn, false);
    if (r.status === 'success') {
      toast('Withdrawal requested');
      closeSheet('withdraw');
      STATE.account = null; STATE.loaded.home = false;
      if (STATE.currentPage === 'home') renderHome();
    } else toast(r.message, true);
  };
}

// ── FLOATING ASSISTANT (server-side, Claude-backed) ─────────────────────
var ASSIST_QUICK = ['How do I deposit?', 'How do I withdraw?', 'How do referrals work?', 'How do I invest?'];
var ASSIST_HISTORY = []; // {role:'user'|'assistant', text}
function addMsg(text, who){
  var body = $('assistBody');
  var div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}
function addTyping(){
  var body = $('assistBody');
  var div = document.createElement('div');
  div.className = 'msg bot typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}
async function assistSend(text){
  addMsg(text, 'user');
  ASSIST_HISTORY.push({ role: 'user', text: text });
  var typing = addTyping();
  var reply;
  try {
    var r = await api('/assistant/chat', { message: text, history: ASSIST_HISTORY.slice(-8) });
    reply = (r && r.status === 'success' && r.reply) ? r.reply : 'The assistant is unavailable right now — reach Support from the Account tab.';
  } catch (e) {
    reply = "Couldn't reach the assistant — check your connection, or reach Support from the Account tab.";
  }
  typing.remove();
  addMsg(reply, 'bot');
  ASSIST_HISTORY.push({ role: 'assistant', text: reply });
}
function openAssistant(){
  $('assistPanel').classList.add('show');
  history.pushState({ overlay: 'assist' }, '', '');
  if (!$('assistBody').childElementCount) {
    addMsg("Hi! I'm the Space8 assistant. Ask me anything about deposits, withdrawals, investing, referrals or your account.", 'bot');
    var sett = STATE.settings || {};
    var links = '';
    if (sett.telegramGroup) links += '<button class="btn btn-secondary" id="assistGroupBtn">' + ico('telegram') + '<span>Telegram Group</span></button>';
    links += '<button class="btn btn-secondary" id="assistCareBtn">' + ico('support') + '<span>Customer Care</span></button>';
    $('assistLinks').innerHTML = links;
    if ($('assistGroupBtn')) $('assistGroupBtn').onclick = function(){ var u = safeExternalUrl(sett.telegramGroup); if (u) window.open(u, '_blank'); };
    // Pure DOM close (not closeSheet/history.back()) -- the assistant
    // panel and a sheet are two different full-screen overlays sharing
    // the same history slot mechanism; closing this one first keeps
    // exactly one overlay "current" at a time instead of a sheet opening
    // stacked behind the still-open assistant panel.
    $('assistCareBtn').onclick = function(){ hideAssistant(); openSupportSheet(); };
    $('assistQuick').innerHTML = ASSIST_QUICK.map(function(q){ return '<div class="qchip">' + esc(q) + '</div>'; }).join('');
    qsa('.qchip').forEach(function(c){ c.onclick = function(){ assistSend(c.textContent); }; });
  }
}
function hideAssistant(){ $('assistPanel').classList.remove('show'); }
$('assistFab').onclick = openAssistant;
$('giftFab').onclick = openGiftCodeSheet;
$('assistClose').onclick = function(){
  if (history.state && history.state.overlay === 'assist') history.back();
  else hideAssistant();
};
$('assistSend').onclick = function(){
  var input = $('assistInput');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  assistSend(text);
};
$('assistInput').addEventListener('keydown', function(e){
  if (e.key === 'Enter') { e.preventDefault(); $('assistSend').click(); }
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────
async function openNotificationsSheet(){
  // Codex-verified real bug (2026-08-17): this had NEITHER the
  // _genericAsyncSeq nor the authEpoch guard the sibling generic-sheet
  // functions above already use, despite rendering into the exact same
  // shared #genericSheet container after an await -- a sign-out/sign-in on
  // a shared device while this was in flight could render the PREVIOUS
  // member's notifications (and mark them read under whichever account is
  // ACTUALLY signed in by the time the response lands) into the new
  // member's screen.
  var seq = ++_genericAsyncSeq;
  var epoch = STATE.authEpoch;
  openSheet('generic', '<div class="sheet-title">Notifications</div><div id="notifBody">' + skRows(3) + '</div>');
  var r = await api('/notifications', null, 'GET');
  if (seq !== _genericAsyncSeq || epoch !== STATE.authEpoch) return;
  var body = $('notifBody'); if (!body) return;
  var items = r.status === 'success' ? (r.notifications || []) : [];
  body.innerHTML = items.length ? items.map(function(n){
    var unread = !n.readAt && !n.read;
    return '<div class="card" style="margin-bottom:10px;border:' + (unread ? '1px solid var(--blue-glow)' : '1px solid transparent') + '">' +
      '<div style="display:flex;gap:10px;align-items:flex-start"><div style="width:9px;height:9px;border-radius:50%;margin-top:6px;background:' + (unread ? 'var(--blue)' : 'var(--line)') + ';flex-shrink:0"></div><div style="min-width:0;flex:1">' +
      '<div style="font-weight:700;margin-bottom:4px">' + esc(n.title || 'Space8 update') + '</div>' +
      '<div style="font-size:13px;color:var(--ink-dim);line-height:1.5">' + esc(n.body || '') + '</div>' +
      (n.createdAt ? '<div style="font-size:11px;color:var(--blue-mute);margin-top:8px">' + esc(timeAgo(n.createdAt)) + '</div>' : '') +
      '</div></div></div>';
  }).join('') + listEndFooter() : emptyState('doc','No more data');
  var unreadIds = items.filter(function(n){ return n.id && !n.readAt && !n.read; }).map(function(n){ return n.id; });
  if (unreadIds.length) api('/notifications/read', { ids: unreadIds }, 'POST', false).catch(function(){});
}
$('notifBtn').onclick = openNotificationsSheet;



// ── BOOT ──────────────────────────────────────────────────────────────
async function boot(){
  // Real bug (2026-08-17, owner: "loader takes long to load"): these three
  // GET calls don't depend on each other at all, but used to run one after
  // another (await, await, await) -- on Render's free-tier cold start
  // (mentioned throughout this codebase), each one pays real round-trip
  // latency back-to-back instead of overlapping. Promise.all lets them
  // share the same cold-start wait instead of tripling it.
  var bootR = await Promise.all([api('/public/settings'), api('/public/banners'), api('/public/products')]);
  var setR = bootR[0], bannerR = bootR[1], prodR = bootR[2];
  if (setR.status === 'success') STATE.settings = setR.settings;
  if (bannerR.status === 'success') { STATE.banners = bannerR.banners || {}; STATE.homeSlides = bannerR.homeSlides || []; }
  if (STATE.banners.authbg) {
    document.documentElement.style.setProperty('--auth-bg-url', 'url("' + STATE.banners.authbg + '")');
  }
  var blurPx = (STATE.settings||{}).authBgBlurPx;
  var tintPct = (STATE.settings||{}).authBgTintPct;
  document.documentElement.style.setProperty('--auth-bg-blur', (blurPx != null ? blurPx : 20) + 'px');
  document.documentElement.style.setProperty('--auth-bg-tint', (tintPct != null ? tintPct : 78) / 100);
  if (STATE.banners.appbg) {
    document.documentElement.style.setProperty('--app-bg-url', 'url("' + STATE.banners.appbg + '")');
  }
  var appBlurPx = (STATE.settings||{}).appBgBlurPx;
  var appTintPct = (STATE.settings||{}).appBgTintPct;
  document.documentElement.style.setProperty('--app-bg-blur', (appBlurPx != null ? appBlurPx : 20) + 'px');
  document.documentElement.style.setProperty('--app-bg-tint', (appTintPct != null ? appTintPct : 78) / 100);
  var cardBlurPx = (STATE.settings||{}).cardBlurPx;
  var cardOpacityPct = (STATE.settings||{}).cardOpacityPct;
  document.documentElement.style.setProperty('--card-blur', (cardBlurPx != null ? cardBlurPx : 0) + 'px');
  document.documentElement.style.setProperty('--card-alpha', (cardOpacityPct != null ? cardOpacityPct : 100) / 100);
  var authCardBlurPx = (STATE.settings||{}).authCardBlurPx;
  var authCardOpacityPct = (STATE.settings||{}).authCardOpacityPct;
  document.documentElement.style.setProperty('--auth-card-blur', (authCardBlurPx != null ? authCardBlurPx : 0) + 'px');
  document.documentElement.style.setProperty('--auth-card-alpha', (authCardOpacityPct != null ? authCardOpacityPct : 100) / 100);
  if ((STATE.settings||{}).announcementBg) {
    document.documentElement.style.setProperty('--ann-bg-url', 'url("' + STATE.settings.announcementBg + '")');
  }
  var annBlurPx = (STATE.settings||{}).annBgBlurPx;
  var annTintPct = (STATE.settings||{}).annBgTintPct;
  document.documentElement.style.setProperty('--ann-bg-blur', (annBlurPx != null ? annBlurPx : 6) + 'px');
  document.documentElement.style.setProperty('--ann-bg-tint', (annTintPct != null ? annTintPct : 55) / 100);
  // Glow-sweep speed/size (owner-adjustable in admin). Speed comes over the
  // wire as milliseconds; size as a % width. The CSS carries its own
  // fallback defaults, so only push a var when a real value is present.
  var st = STATE.settings || {};
  if (st.sweepBtnSpeedMs != null) document.documentElement.style.setProperty('--sweep-btn-speed', st.sweepBtnSpeedMs + 'ms');
  if (st.sweepBtnWidthPct != null) document.documentElement.style.setProperty('--sweep-btn-w', st.sweepBtnWidthPct + '%');
  if (st.sweepGiftSpeedMs != null) document.documentElement.style.setProperty('--sweep-gift-speed', st.sweepGiftSpeedMs + 'ms');
  if (st.sweepGiftWidthPct != null) document.documentElement.style.setProperty('--sweep-gift-w', st.sweepGiftWidthPct + '%');
  // Fetched above (not left to renderHome/renderProducts' own first call) so
  // the images below are already warm in the browser's cache by the time
  // either page actually renders -- renderHome/renderProducts both already
  // skip re-fetching when STATE.products is already set.
  if (prodR.status === 'success') STATE.products = prodR.products;
  await preloadImages();
}
function preloadImages(){
  var urls = [];
  Object.keys(STATE.banners||{}).forEach(function(k){ if (STATE.banners[k]) urls.push(STATE.banners[k]); });
  (STATE.homeSlides||[]).forEach(function(src){ if (src) urls.push(src); });
  (STATE.products||[]).forEach(function(p){ if (p.image) urls.push(p.image); });
  var loadOne = function(src){
    return new Promise(function(resolve){
      var img = new Image();
      img.onload = img.onerror = function(){ resolve(); };
      img.src = src;
    });
  };
  // Capped so one slow/broken image URL can't leave the loading screen up
  // indefinitely -- same reasoning as the api() fetch timeout above.
  var timeout = new Promise(function(resolve){ setTimeout(resolve, 6000); });
  return Promise.race([Promise.all(urls.map(loadOne)), timeout]);
}
window.addEventListener('space8-auth', async function(e){
  var user = e.detail;
  // Bumped on EVERY auth transition (sign-in or sign-out) -- see STATE's
  // authEpoch comment for why this exists.
  STATE.authEpoch++;
  // Wait for boot() (settings/banners/products fetch + image preload) so the
  // loading screen stays up until images are already cached, instead of
  // handing off to Home/Products/the auth screens and having their images
  // visibly pop in a beat later.
  await _bootPromise;
  $('loadingScreen').style.display = 'none';
  if (user) {
    // A registration attempt currently in flight (its own handler above
    // will call enterApp() once /register actually finishes) -- don't race
    // it into the app early on a Firebase account that doesn't have a
    // finished Space8 profile yet.
    if (_registering) return;
    // Self-heal: covers a Firebase account left over from a PAST failed
    // registration attempt (a previous session, or this one after a
    // wrong-referral-code retry was abandoned) -- /register is idempotent
    // (locked + a registrationDone guard, see completeRegistrationCore in
    // server.js), so calling it again with no referral code is always safe
    // and guarantees the account eventually gets a real profile, welcome
    // bonus and referral code of its own instead of staying permanently
    // half-registered just because the original code was wrong once.
    //
    // Real bug, confirmed live (owner report, phone signed in fine but
    // balance/referral code/ID all blank and every action said "User not
    // found"): this used to only catch registrationDone:false -- a
    // PARTIALLY finished registration. It never caught the doc being
    // MISSING ENTIRELY (Firebase account created, but the very first
    // /register call after that never landed at all -- a dropped
    // connection, the app closed right after signup), because /account
    // returns a 404 status:'error' for that case, not status:'success', so
    // the old condition never matched and the account was permanently
    // stranded with no automatic recovery. /register self-heals a missing
    // doc on its own (see the comment in server.js's /register route), so
    // the only gap was ever telling the client TO call it here.
    try {
      var accR = await api('/account');
      var needsRegister = (accR.status === 'success' && accR.account && accR.account.registrationDone === false) ||
        (accR.status === 'error' && accR.code === 'NOT_FOUND');
      if (needsRegister) {
        var regR = await api('/register', {}, 'POST', true);
        if (regR.status === 'error') {
          // Codex-verified real bug (2026-08-17): this used to ignore the
          // response entirely and always fall through to enterApp(), so a
          // failed self-heal (rate limit, banned account, dropped
          // connection) dropped the member into an empty/broken app shell
          // with no profile instead of a recoverable state. Route to the
          // exact same register-screen retry flow the explicit Create
          // Account button already uses on failure -- _registering stays
          // true, so tapping Create Account again skips fbCreateUser and
          // just retries /register.
          $('app').style.display = 'none';
          _registering = true;
          showRegisterScreen();
          showAuthErr('registerErr', (regR.message || 'Could not finish creating your account.') + ' You are signed in — fix the referral code (or clear it) and tap Create Account again.');
          return;
        }
      }
    } catch (_) {}
    enterApp();
  } else {
    $('app').style.display = 'none';
    // A pending referral code (from _refCode's top-level parse) means this
    // load is a fresh visitor following a shared link -- without this
    // check, showLoginScreen() below would unconditionally win the race
    // against that earlier showRegisterScreen() call (Firebase's own auth
    // check is async and always resolves after the synchronous top-level
    // parse), landing the visitor back on Login with their referral code
    // silently sitting filled-in on a screen they can't see.
    if (_refCode) showRegisterScreen(); else showLoginScreen();
    stopLiveRefresh();
    resetUserState();
    closeAllSheets();
  }
});

// Lightweight server-confirmed live refresh: balance, investments (daily
// cashback/maturity payouts), and -- while Team is the open page -- referral
// counts/rewards are all refreshed in the background while the app is
// visible, without a browser reload. Owner: "upgrade realtime update of all
// website loaded data... deposits, withdrawals, dailyprofit balance should
// increase immediately, referrals, rewards... it must be very very very
// fast" -- ticked from every 12s down to every 2s (still far inside
// globalLimiter's 400 req/min-per-user budget: at most 3 reads/tick = 90/min
// even on the Team page) and now also covers Team, not just Home/Products.
// A same-user action (checkin/invest/withdraw/redeem) still applies its own
// optimistic STATE update the instant the response lands, same as before --
// this loop is what catches everything that ISN'T the viewer's own tap:
// server-side cashback/maturity credits, an admin approving a deposit or
// withdrawal, a downline referral joining/investing, a milestone reward.
var _liveRefreshTimer = null;
function startLiveRefresh(){
  if (_liveRefreshTimer) return;
  _liveRefreshTimer = setInterval(async function(){
    if (document.hidden || !STATE.account || !window.fbAuth || !window.fbAuth.currentUser) return;
    // Codex-verified real bug (2026-08-17): stopLiveRefresh() (called on
    // sign-out) only clears the interval so no FUTURE tick fires -- it
    // can't cancel a tick whose fetch was already in flight. That response
    // used to write straight into STATE.account/STATE.investments with no
    // check at all, so it could land after a sign-out + a DIFFERENT
    // member's sign-in on the same device and silently overwrite their
    // just-loaded session with the previous member's data. Same authEpoch
    // guard every other async render already uses.
    var epoch = STATE.authEpoch;
    var results = await Promise.all([api('/account', null, 'GET', false), api('/investments', null, 'GET', false)]);
    if (epoch !== STATE.authEpoch) return;
    if (results[0].status === 'success') STATE.account = results[0].account;
    if (results[1].status === 'success') STATE.investments = results[1].investments || [];
    if (STATE.currentPage === 'home') renderHome();
    else if (STATE.currentPage === 'products') renderProducts();
    else if (STATE.currentPage === 'team') renderTeam();
  }, 2000);
}
function stopLiveRefresh(){ if (_liveRefreshTimer) { clearInterval(_liveRefreshTimer); _liveRefreshTimer = null; } }
document.addEventListener('visibilitychange', function(){ if (!document.hidden && STATE.account) { STATE.loaded.home = false; if (STATE.currentPage === 'home') renderHome(); } });

// Hide the "Space8" wordmark AND the notification bell once the page
// scrolls -- the topbar has no opaque background of its own (it sits on
// the app wallpaper, see #app::before/::after above), so on scroll they
// used to overlap scrolled-past content instead of a solid bar. Both fade
// back in near the top (CSS: .topbar.scrolled .wordmark, .topbar.scrolled
// .iconbtn). Owner: "l also want notification bell to disappear when one
// scroll down, just like you did on the space8 word" -- same toggle
// already does both, since the bell (#notifBtn) is the topbar's only
// .iconbtn.
(function(){
  var topbar = $('topbar');
  if (!topbar) return;
  var ticking = false;
  window.addEventListener('scroll', function(){
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      topbar.classList.toggle('scrolled', window.scrollY > 12);
      ticking = false;
    });
  }, { passive: true });
})();
var _bootPromise = boot();
