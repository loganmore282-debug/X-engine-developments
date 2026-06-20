(function(){
  "use strict";
  // Canonical site cloned copies get bounced to.
  var REAL = "https://www.nexus-ug.site/";
  // Allowed hosts: custom domain, any *.edgeone.app subdomain, localhost.
  function hostOk(){
    var h = (location.hostname || "").toLowerCase();
    if (!h) return true;                         // file:// local open
    if (h === "localhost" || h === "127.0.0.1") return true;
    if (h === "nexus-ug.site" || h.slice(-(13)) === ".nexus-ug.site") return true;
    return h.slice(-12) === ".edgeone.app" || h === "edgeone.app";
  }

  // 1. DOMAIN LOCK — block cloned rehosting
  if (!hostOk()) {
    try { document.documentElement.innerHTML = ""; } catch(e){}
    location.replace(REAL);
    return;
  }

  // 2. FRAME-BUST — disabled. GoDaddy domain forwarding (masking) serves the
  // site inside a cross-origin iframe; busting out of it blanked the page.
  // Domain-lock above already redirects clones, so framing is allowed here.

  // 3. CONSOLE SELF-XSS WARNING
  function warn(){
    try {
      console.log("%cSTOP", "color:#2563eb;font-size:48px;font-weight:900;");
      console.log("%cThis is a browser feature for developers. Do not paste or type anything here — it could give an attacker access to your Nexus account and funds.",
        "color:#ef4444;font-size:14px;");
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
  var shield = null;
  function showShield(){
    if (shield) return;
    shield = document.createElement("div");
    shield.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#060e2a;color:#2563eb;display:flex;align-items:center;justify-content:center;text-align:center;font-family:sans-serif;font-size:18px;padding:24px;";
    shield.textContent = "Developer tools detected. Close them to continue using Nexus.";
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
})();
