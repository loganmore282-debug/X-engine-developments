# X-Engine Android App

A lightweight native Android wrapper that runs **https://www.x-engine.site** as
an installed app. No external dependencies — it uses the platform WebView, so
the APK stays small (~4 MB) while behaving like a full app.

## Features
- Opens the X-Engine site full-screen with a branded icon and dark splash frame
- Keeps `x-engine.site` navigation inside the app
- Opens external links (WhatsApp, Telegram, email, phone, other sites) in their
  own apps
- File uploads (e.g. deposit screenshots) and downloads supported
- Hardware back button navigates page history
- Cookies + DOM storage enabled, so login sessions and the site's PWA features
  work normally

## Get the APK
- **Release (direct link):** the `android-app` release →
  `https://github.com/<owner>/<repo>/releases/download/android-app/x-engine.apk`
- Or **Actions** tab → latest "Build X-Engine App APK" run → Artifacts →
  `x-engine-app`.

Install: copy to the phone, open it, allow "install from unknown sources".

## Build locally (optional)
Open `xengine-app/` in Android Studio → **Build → Build APK(s)**.

## Notes
- The site's own domain lock allows the app because it loads `x-engine.site`.
- To change the URL, edit `START_URL` in `MainActivity.java`.
