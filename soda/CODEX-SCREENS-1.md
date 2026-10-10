# Codex task 2: build the signed-in screens exactly as the owner's screenshots

Use together with `soda/CODEX-PROMPT.md` (the standing rules). Pull first: `git pull --rebase origin claude/soda-build`.
The owner's 19 screenshots come from another platform's app and are the source of truth for LOOK, LAYOUT, SVG icons and WORDING. Build exactly what you see; do not add, keep or "improve" anything the screenshots do not show, and do not carry over old Petro screens or wording the owner has not mentioned. Where this file says "from admin", the picture/text is set by the admin panel (see "Admin-uploaded images").

## What changed since your last push (already done by Claude, keep it)
- `/withdraw/request` now REQUIRES the 6-digit Trade Password (`pin` in the body), verified server-side by `pinCheck()` (scrypt hash, 5 wrong tries lock 15 minutes). Your sign-up already saves it. The Trade Password is entered on the Withdraw screen, nowhere else. Your restyled Withdraw screen must keep an input with id `witPin` (6 digits, hidden dots, eye toggle) and `submitWithdraw()` must keep sending `pin`. Tests: `test-trade-pin.js`, `test-withdraw-rules.js`.
- A temporary plain `witPin` field was added to the current withdraw sheet in `user-src/original_module.js`; restyle it to the screenshot.

## Global look
- **Colour: replace every red with blue.** Suggested tokens (adjust by eye): primary gradient `#2F7BFF -> #0B3FD1`, primary solid `#1457E8`, border `#1457E8`, page background very pale blue `#F3F7FF`, soft card tint `#EAF1FF`, muted text navy-grey `#4A5878`, grey label `#8A94A8`. **Keep yellow, orange (pending chips), green (paid chip, +amounts) and the gold/orange gradient tile icons exactly as they appear**: only red becomes blue.
- Light theme, white cards, 2px primary border, large radii (cards ~22px, buttons ~16-18px, big buttons pill-ish), soft blue shadow, bold labels, letter-spaced section titles.
- Section titles: short primary-coloured vertical bar, bold letter-spaced title, thin fading line to the right ("Account", "Security", "Select Amount", "Select Payment Method", "Withdrawal Wallet", "Trade Password").
- **Bottom navigation, 4 tabs only: Home, Income, Team, My.** Icons: bottle (Home), tall bottle/cell (Income), two people (Team), person (My), thin-line SVG. Active tab: bold primary label, primary icon, short primary bar on top of the tab, faint blue tinted tab background. Inactive: grey.
- Use the exact SVGs you see (bottle, headset, megaphone, paper-plane, clipboard, download, logout, copy, people, person, error circle). Draw them as inline SVG, no emoji, no icon fonts.
- Money text is written as in the screenshots: `UGX11,000`, balances `UGX2,200.00`, dates `26/09/2026 00:00`. (This replaces the older "UGX 23,000" spacing rule for these screens.)
- Notify messages and dialogs: see "Dialogs".

## Screens

### Home
1. Banner picture (rounded, full width) = admin-uploaded.
2. 2x2 buttons, white with primary border, bold primary text, icon left: **Deposit** (bottle), **Withdraw** (bottle), **Help Me** (headset), **Gift Code** (bottle).
3. Announcement strip: pale tinted pill with megaphone icon and a single-line **scrolling** (marquee) text, text from admin.
4. Product cards, one per asset, top to bottom: header bar (primary gradient, centred white bold name); body = left picture tile (rounded, tinted, admin-uploaded per asset) with a small badge top-right `bought/limit` (e.g. `0/1`); right = four rows, label left (small caps grey-navy) value right (bold primary): **PRICE `UGX11,000`, DAYS `30`, DAILY `UGX2,200`, TOTAL `UGX66,000`**; below, full-width **BUY NOW** button (white, primary border).
5. **BUY NOW animation:** the text glows in a gentle loop that shifts between **yellow and blue** (the screenshots' yellow-to-red flame becomes yellow-to-blue). Simple CSS animation (text-shadow / gradient shift), not fire art. Respect `prefers-reduced-motion`.
6. Tapping BUY NOW with too little money: notify dialog "Insufficient balance, redirecting to deposit..." then open the Deposit page by itself after about 1.5 seconds.

### Income
1. Same admin banner at top.
2. "Total Earnings" card: white, primary border, grey label, big gold/yellow `UGX6,600.00`.
3. One card per OWNED asset: header bar with name and a diagonal corner ribbon **GIFT** (only for gifted/free assets); picture tile with an **Earning** badge; rows PRICE / DAYS / DAILY / TOTAL (a gifted asset shows PRICE `UGX0`); footer box (tinted, rounded) with two columns **PURCHASE** date-time and **EXPIRE** date-time, divider between.

### Team
1. Gradient card: people icon + "Total Team" and a very large member count on the same row; a divider; `UGX0.00` with caption "Purchase". Faint concentric arcs decoration top-right.
2. "Share URL" card: label, link in a tinted field with a square copy button at its right, then full-width primary **Copy Invite Link** button. (Keep Soda's own invite link format; only the look follows the screenshot.)
3. Level cards: **Level 1** filled with the primary gradient (white text), **Level 2 and Level 3** white with primary border. Each: "Level N" bold + "X Members" under it on the left; on the right "Rate" over a big bold % and a thin divider, then "Commission" over `UGX0.00`. Rates and counts come from the real settings/data, not from the screenshot.
4. Member list: tinted rounded cards, masked phone (`706****1455`) grey left, amount `UGX0.00` bold primary right, "Joined 26/09/2026 10:27" grey below.

### My
1. Gradient profile card: round avatar with white ring (picture = "Profile logo", from admin, see below), phone number in white bold, a pill "VIP 0", divider, small letter-spaced "TOTAL BALANCE", very large `UGX2,200.00`, then two buttons side by side: **Deposit** (transparent with white border) and **Withdraw** (white fill, primary text), each with the bottle icon.
2. Section "Account": 2x2 tiles (white, primary border, big rounded-square icon on top, bold label below): **Wallet** (primary icon), **Messages** (gold/orange gradient icon), **Details** (gold/orange gradient clipboard icon), **APP** (primary download icon).
3. Section "Security": tiles **Login Password**, **Trade Password** (both primary icons).
4. Wide outlined **Help Me** button (headset) and wide filled primary gradient **Log Out** button (logout icon).
5. Wallet tile opens "Balance Record" (below). Trade Password tile opens the existing change-Trade-Password page (old + new, 6 digits), restyled to match. Login Password tile opens the existing change-password page, restyled.

### Balance Record (Wallet tile)
Back arrow + centred title "Balance Record". Big centred `CURRENT BALANCE` (letter-spaced grey) and the amount, with soft blue blurred blobs in the corners. Underlined tabs: **All, Deposit, Withdraw, Turntable, Fruit** (active = bold primary text + primary underline). Rows: white rounded card; left a round avatar with the first letter (D = deposit, tinted green-grey gradient; W = withdraw, primary); centre: bold title, grey date-time, then either a coloured status chip (orange "Pending Deposit" / "Processing Payment", green "Paid") or a primary-coloured description line ("Daily Earnings", "Admin Balance Credit:"); right: amount, green `+UGX2,200.00` for credits, primary `-UGX17,850.00` for debits. Bottom: outlined **Load More** button.

### Deposit page
Back arrow + centred title "Deposit". "Select Amount": six chips in 3 columns x 2 rows (white, primary border, bold primary text); a big centred amount under them with a thin primary-tinted underline (typing or tapping a chip fills it). "Select Payment Method": buttons **PAY-A, PAY-B, PAY-C**, selected one filled with the primary gradient, two per row. Full-width primary gradient **Confirm Deposit**. "Deposit Instructions" card (tinted, rounded, title, thin divider, numbered grey lines): 1. Recharge time: 7*24 hours. 2. If deposit is not received, please contact TG customer service. 3. Minimum deposit amount: UGX10000 4. Please do not save old account recharge. (The minimum comes from the real setting.)

### Withdraw page
Back arrow + centred title "Withdraw". Card with tinted frosted gradient and a soft glow top-right: letter-spaced "AVAILABLE BALANCE" and the big `UGX2,200.00`. Amount input row `UGX 0.00` (white, rounded, grey border). "Withdrawal Wallet": a **bank-card style** block (primary gradient with a diagonal sheen): network name top-left (e.g. MTN), bottle icon top-right, a card-chip drawing, number letter-spaced, small "ACCOUNT HOLDER" and the NAME in capitals; under it an outlined **Bind Wallet** button. "Trade Password": input "Enter trade password" (6 digits) with an eye show/hide button at its right (id `witPin`). Grey "Fee: 15%". Full-width **Confirm Withdraw** (faded until an amount is entered, then solid). "Withdrawal Instructions" card: 1. Fee: 15% 2. Withdrawal amounts should be between 2000 and 2000000. 3. There is no limit to the number of withdrawals. 4. Withdrawal time: 08:00:00 - 17:00:00. (All four values come from the real settings, not from the screenshot.)

## Dialogs
- **Help** (Home: title "Help"; My: title "Help Me"): centred white dialog, dark thin border, large radius, backdrop blurred. Pale-blue circle with headset icon, title, two outlined buttons **Channel** and **Service** (paper-plane icon above label) = the Telegram Group and Telegram Customer Service links already in Soda's settings, then a full-width primary gradient pill **Close**; a round dark-grey outlined X button below the dialog also closes it.
- **Notify**: same dialog frame; a pale blue circle with an outlined circled-X icon (error) or matching tick (success), then one centred muted-navy line, e.g. "Insufficient balance, redirecting to deposit...". Backdrop blurred. Used for every error/info message in the app.

## Admin-uploaded images (admin panel changes)
The member app must show these from admin settings (upload in the admin panel, stored the same way other admin images already are, resized/compressed, never hard-coded):
1. **Banner** (Home and Income top picture).
2. **Asset pictures** (one per asset card; check whether admin already has this field and reuse it).
3. **Profile logo**: one default avatar picture for the My page (same for all members unless the owner asks for per-member pictures).
Keep these frames/areas in the layout even when no picture is uploaded (neutral tinted placeholder), so the page never collapses.

## Do NOT change
Money rules, calculations, settings, locks, login/session code, `/k7x2` single-host routing, nginx files. The numbers in the screenshots (11,000 / 30 days / 2,200 / 66,000, rates 26% / 2% / 1%, min 10000, 2000-2000000, 08:00-17:00, fee 15%) are only examples from the other platform: show Soda's own values from its settings and data. If a screenshot needs a rule Soda does not have (for example a different daily-earnings schedule, VIP levels, Turntable/Fruit rows), list it for the owner instead of inventing it.

## Report back
After each screen group: files changed, what was removed, tests run, what could not be tested. Bump `soda-shell-vN` in `user/sw.js` and `soda-admin-shell-vN` in `admin/sw.js`; run `npm run test:audit`; commit; push.
