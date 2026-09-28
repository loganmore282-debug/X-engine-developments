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
})();
