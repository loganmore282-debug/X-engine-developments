(function(){
  "use strict";
  // 1. FRAME-BUST — refuse to be embedded / proxied in an iframe.
  //
  // Busts to THIS page's own URL, not a hard-coded domain. It used to hold a
  // constant left over from the fork -- Snow's live site -- so a framed Chipz
  // app sent its own members to a different product. Using location.href is
  // also simply more correct: the app answers on chipz-app.onrender.com today
  // and on whatever custom domain it gets later, and a constant would be
  // wrong again the day that changes.
  try {
    if (window.top !== window.self) {
      window.top.location = window.location.href;
      document.documentElement.innerHTML = "";
      return;
    }
  } catch(e) {
    document.documentElement.innerHTML = "";
    return;
  }

  // 2. CONSOLE SELF-XSS WARNING
  function warn(){
    try {
      console.log("%cSTOP", "color:#e21b2a;font-size:48px;font-weight:900;");
      console.log("%cThis is a browser feature for developers. Do not paste or type anything here — it could give an attacker access to your account and funds.",
        "color:#D93025;font-size:14px;");
    } catch(e){}
  }
  warn();

  // 3. BLOCK CONTEXT MENU (right-click / long-press save)
  document.addEventListener("contextmenu", function(e){ e.preventDefault(); }, { capture:true });

  // 4. BLOCK DEV / SOURCE SHORTCUTS
  document.addEventListener("keydown", function(e){
    var k = (e.key || "").toLowerCase();
    var block =
      e.key === "F12" ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c")) ||
      ((e.ctrlKey || e.metaKey) && (k === "u" || k === "s"));
    if (block) { e.preventDefault(); e.stopPropagation(); return false; }
  }, { capture:true });

  // 5. BLOCK SELECTION / COPY / DRAG OUTSIDE INPUTS (keep forms usable)
  function inForm(t){
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
      (t.isContentEditable === true));
  }
  ["selectstart","copy","cut","dragstart"].forEach(function(ev){
    document.addEventListener(ev, function(e){
      if (!inForm(e.target)) { e.preventDefault(); }
    }, { capture:true });
  });

  // 6. DEVTOOLS-OPEN DETECTION (dimension heuristic) → cover screen
  // Skip on touch/mobile — keyboard open triggers false positives there.
  var isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!isMobile) {
    var shield = null;
    function showShield(){
      if (shield) return;
      shield = document.createElement("div");
      shield.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#FCFBF9;color:#111111;display:flex;align-items:center;justify-content:center;text-align:center;font-family:sans-serif;font-size:18px;padding:24px;";
      shield.textContent = "Developer tools detected. Close them to continue.";
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
