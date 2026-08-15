(function(){
  "use strict";
  // Owner's real custom domain (space8.com) — the canonical home a
  // cloned/rehosted copy gets bounced to.
  var REAL = "https://space8.com/";
  // DOMAIN LOCK — only these exact hosts (plus any *.onrender.com
  // subdomain, kept as a fallback while the custom domain is still being
  // set up/propagated) may run the app. A cloned/rehosted phishing copy on
  // any other domain wipes itself and bounces to REAL. Fails OPEN on any
  // error so real users are never wrongly locked out.
  function hostOk(){
    try {
      var h = (location.hostname || "").toLowerCase();
      if (!h) return true; // installed PWA / file:// — don't wipe
      var ALLOW = [
        "space8.com",
        "www.space8.com",
        "localhost",
        "127.0.0.1"
      ];
      if (ALLOW.indexOf(h) !== -1) return true;
      if (h.slice(-".onrender.com".length) === ".onrender.com") return true;
      return false;
    } catch (e) { return true; }
  }

  // 1. DOMAIN LOCK — block cloned rehosting
  if (!hostOk()) {
    try { document.documentElement.innerHTML = ""; } catch(e){}
    location.replace(REAL);
    return;
  }

  // 2. FRAME-BUST — refuse to be embedded / proxied in an iframe
  try {
    if (window.top !== window.self) {
      window.top.location = REAL;
      document.documentElement.innerHTML = "";
      return;
    }
  } catch(e) {
    document.documentElement.innerHTML = "";
    return;
  }

  // 3. CONSOLE SELF-XSS WARNING
  function warn(){
    try {
      console.log("%cSTOP", "color:#6C4EFF;font-size:48px;font-weight:900;");
      console.log("%cThis is a browser feature for developers. Do not paste or type anything here — it could give an attacker access to your Space8 account and funds.",
        "color:#ff5c72;font-size:14px;");
    } catch(e){}
  }
  warn();

  // 4. BLOCK CONTEXT MENU (right-click / long-press save)
  document.addEventListener("contextmenu", function(e){ e.preventDefault(); }, { capture:true });

  // 5. BLOCK DEV / SOURCE SHORTCUTS
  document.addEventListener("keydown", function(e){
    var k = (e.key || "").toLowerCase();
    var block =
      e.key === "F12" ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c")) ||
      ((e.ctrlKey || e.metaKey) && (k === "u" || k === "s"));
    if (block) { e.preventDefault(); e.stopPropagation(); return false; }
  }, { capture:true });

  // 6. BLOCK SELECTION / COPY / DRAG OUTSIDE INPUTS (keep forms usable)
  function inForm(t){
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
      (t.isContentEditable === true));
  }
  ["selectstart","copy","cut","dragstart"].forEach(function(ev){
    document.addEventListener(ev, function(e){
      if (!inForm(e.target)) { e.preventDefault(); }
    }, { capture:true });
  });

  // 7. DEVTOOLS-OPEN DETECTION (dimension heuristic) → cover screen
  // Skip on touch/mobile — keyboard open triggers false positives there.
  var isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!isMobile) {
    var shield = null;
    function showShield(){
      if (shield) return;
      shield = document.createElement("div");
      shield.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#f4f2ff;color:#050507;display:flex;align-items:center;justify-content:center;text-align:center;font-family:sans-serif;font-size:18px;padding:24px;";
      shield.textContent = "Developer tools detected. Close them to continue using Space8.";
      (document.body || document.documentElement).appendChild(shield);
    }
    function hideShield(){ if (shield){ shield.remove(); shield = null; } }
    function check(){
      var t = 180;
      var open = (window.outerWidth - window.innerWidth > t) ||
                 (window.outerHeight - window.innerHeight > t);
      if (open) showShield(); else hideShield();
    }
    setInterval(check, 1000);
  }
})();
