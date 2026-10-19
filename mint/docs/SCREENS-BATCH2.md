# Mint screens, batch 2 (owner's screenshots, 2026-10-19) -- memorised, NOT built yet

The owner will send more screens and then wants everything built **in one go**. The pictures are saved in `design-ref/batch2/` (numbered in the order sent).
Owner notes: Mint is **Uganda: +256 and UGX** (the pictures show another country's `₦` and `+234`; never copy those). Login/Sign Up is already built
(batch 1, see CLAUDE.md). Colours below were sampled from the pictures (JPEG, so within a few units).

## Shared look (every screen)
- **Page background**: warm cream `#f8f4e9`. **Cards**: off-white `#fefefc`, 1px light-green border `#d3e4da`, radius ~16-18, soft shadow.
- **Header bar**: pink-tinted `#fdf1f3` to `#fcf0f2`, 1px bottom line, centred **serif bold letter-spaced** title (Noto Serif, dark `#1a3d2b`/black, ~19px, letter-spacing
  ~.1em), **back button** at left = green rounded square `#02964c` (radius 8, ~34px) with a white chevron.
- **Bottom bar, 6 tabs**: Home, Orders, Promotion, Team, Salary, Profile. Each icon is a small rounded square: Home green with yellow roof, Orders green clipboard,
  Promotion yellow megaphone, Team green with three yellow heads, Salary yellow money bag with `$`, Profile green person. Labels Roboto ~13px, grey `#9aa0ad`.
  **Active tab** = a mint pill `#cbf2dd` (radius ~26) behind icon + label, label green bold `#0aa24f`, icon sits a little higher.
- **Scroll bar**: thin green (`#02a552`, 4px) at the right edge, as on Login.
- **Notice dialog** (every `notify`): frosted white `#f5f5f5` card, radius ~24, yellow warning-triangle picture, bold black message, one **red pill button** `#e40613`
  "OK" (white bold). Page behind is dimmed.
- **Buttons**: green gradient `#0ea659` -> `#046f3b` (left to right), radius 14, white bold.

## 1-2, 6. Treasure Chest (opened from the floating chest at the bottom right of Home)
Header "TREASURE CHEST" (capitals). Big open chest picture inside a thin dotted circle with a faint gold ring and a green glow; thin fading green lines above and below
the block. "Mystery Treasure" (serif bold, dark green, letter-spaced), "Enter your key to unlock the reward" (serif italic grey), input (off-white, green border, radius 12,
serif placeholder "Enter treasure chest key", centred, letter-spaced), button "OPEN CHEST" (serif capitals, letter-spaced). Empty key -> notice "Please enter the treasure chest key".
(Gift codes were removed from Cookie, not from Mint: Mint keeps the chest.)

## 3, 19. Team
Top card: yellow gradient (`#ebf2e0` -> `#fee89d`), rounded 22, concentric rings top right; green team icon + "Total Team" (serif) + a huge yellow `0`; thin line; money
(`UGX 0.00`, bold) and "Purchase" under it. "Commission Rate" (serif bold) with the currency mark at the right. Three level cards LV:1 / LV:2 / LV:3: white, big percent at the
right in yellow (30% / 2% / 1% -- Mint's own rates come from settings), three columns Commission | Purchase | Members (numbers bold, labels serif). The **selected** level is a green
gradient card (`#019e4d` -> `#046c39`) with a yellow strip (`#fbc831`) on its left edge and white text. Below: "Level N" (serif bold) and "0 Members" at the right; empty list "No Members" (grey, centred).

## 4, 17, 18. Salary (Daily Salary Standard)
Title "Daily Salary Standard" green bold; grey line "Invite Friends · Complete Tasks · Claim ... Rewards"; a mint pill "Team Total Consumption: UGX 0" (green bold). White card: "Accrued wages: **0** day(s)"
and "Need UGX 500,000 more to claim". Then one card per tier: coloured strip on the left (yellow `#ffc72a`, green `#00a650`, red `#e30711`, dark green `#046a38`, yellow `#ffd60a`, amber, green...),
"Reach UGX 500,000" bold + grey "claimable reward within", green badge "Reward UGX 2,000" (`#00a650`, white bold, radius 6), grey progress bar `#e6e7eb`, "Need UGX 500,000 more to claim" centred grey,
and a grey **Locked** button (`#e5e6eb`, radius 14) at the right. Bottom: "Daily wage rules:" (bold centred) and a numbered list (1. each calendar day ... 2. each accrued day ...).
Tapping Locked -> notice "Need UGX 1,000,000 more to claim". (This is Soda's Mission Center salary, re-skinned.)

## 5, 7, 15, 16. Balance Record (Account -> Balance record)
Header "Balance Record". Banner card: soft yellow-green-pink gradient, "CURRENT BALANCE" (serif capitals, letter-spaced, grey), the amount huge serif bold black. Tabs: All, Deposit, Withdraw, Turntable, Daily Salary
(Roboto, grey; the active one dark green bold with a 2px dark-green underline; "Daily Salary" wraps on two lines). Rows: white card radius 16; left a round avatar with a letter (W withdraw, D deposit, C commission),
pale green gradient circle with shadow; title serif bold (Withdraw / Deposit / Daily Earnings / Commission); date grey `16/10/2026 06:43`; a status chip (green "Paid", orange "Pending Deposit") or a green text line
("Daily Earnings", "Level 2 Commission"); amount at the right in serif bold (olive `+UGX 650.00`, dark green `-UGX 4,098.00` for withdrawals). Empty tab: "No Records".

## 8. Home product list (Orders/Home products)
Cards: product picture on the left (with a green strip showing `0/5`), name in gold, rows PRICE / DAYS / DAILY / TOTAL (label grey capitals, value gold or green bold), progress bar with `0%`, wide button
"Coming Soon" (letter-spaced, mint). Notice "Coming soon, please wait". The floating chest at the bottom right opens Treasure Chest.

## 9. Account menu icons (left column of the Account card)
Large rounded-square gradient tiles with a small white-framed icon: green (withdraw), yellow (bank card), pale green with wallet (wallet), cream with chat bubble (messages), green with lock (login password), gold with key (trade password); thin dividers between rows.

## 10. Bottom bar close-up (Salary active) -- see "Shared look".

## 11-12. Change Trade Password / Change Login Password
Header with the title; one big card (radius 18, soft green gradient) with labels grey ("Old Password", "New Password", "Confirm New Password") and three mint-filled inputs (`#e7f1e9`, border `#c9e6d3`, radius 14),
placeholders "Enter old password", "Enter new password (at least 6 characters)", "Confirm new password"; green gradient button "Change Password". (Password minimum is 6 in Mint.)

## 13-14. Messages
List: white card, dark-green strip on the left edge, round green gradient avatar, bold serif text, date/time grey at the right, a green "unread" dot. Tapping opens a bottom sheet over a blurred green page: X at the top right, avatar + serif bold title, date, divider,
then the message image (rounded) from the admin.

## Still to ask when building (do not guess)
Everything about money/auth stays Soda's. New screens go in one build after the owner has sent all of them; tests (`npm run test:audit`) and the Mint cache bump (`mint-shell-vN`, `mint-admin-shell-vN`) as usual.
