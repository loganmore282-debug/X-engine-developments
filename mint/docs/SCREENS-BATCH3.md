# Mint screens, batch 3 (owner's screenshots, 2026-10-19) -- memorised, NOT built yet

Same rules as batch 2 (`docs/SCREENS-BATCH2.md`): Mint is **Uganda, +256, UGX** (the pictures show `₦` and Nigerian banks: never copy those), the owner will send more and
wants everything built in ONE go. Pictures: `design-ref/batch3/` (numbered in the order sent). Shared look (cream page, pink serif header, green back square, 6-tab bar with
mint pill, red-OK notice, green gradient buttons, green scroll bar) is in batch 2.

## 01-02. Promotion (the "Share" tab)
Top: the admin's banner picture (rounded 22, dark green, soft shadow). Card "Share URL" (serif, letter-spaced, grey): a mint box (`#e9f6ee`, border `#c4e6d1`, radius 16) with the link in grey Roboto (wraps on two
lines) and a small mint **Copy** button at its right (yellow-green square icon above the word "Copy"). Under it five round share buttons with labels: **Telegram** (blue `#2aa3ea` paper plane), **WhatsApp** (green),
**Facebook** (blue), **X** (black), **TikTok** (black), each ~43px with a soft shadow. Card "Invitation Reward": a yellow bar `#ffd60a` before the serif bold title, then serif text (grey-green `#5f6f63`, line-height ~22):
"Strive to grow your team ... as soon as possible. / Level 1 = 30% / Level 2 = 2% / Level 3 = 1% / Once your team reaches 300k, you can contact online customer service to claim the team top-up reward."
(Mint takes the rates from settings; write amounts in full, no "300k" in Mint's own text.) The link keeps Mint's random-address/share logic as it is in Mint (Soda's).

## 03. Download App page (Account -> Download APP)
Full page: faint mint-leaf background picture (admin-uploadable, like Soda's downloadbg), a title and subtitle at the top (grey-green, blurred in the picture), a green gradient **Download Now** button in the middle (serif bold,
letter-spaced, radius 16, ~210x50), and a small paragraph at the bottom. Green scroll bar, 6-tab bar with Profile active.

## 04, 07. Wallet (Account -> Wallet)
Header "Wallet". A **card** (radius 24): diagonal gradient light green -> cream -> dark green (`#6fc487` / `#fff3c7` / `#0c7a47`), soft green glow; top-left the wallet provider name (serif bold capitals, e.g. `EVANGEL MFB`; empty state: "Wallet"
in grey), top-right a small green card-icon square; a gold chip (rounded, grid lines) at the left; the number (letter-spaced, `0769968158`; empty: `**** **** **** ****` grey); "ACCOUNT HOLDER" (small caps grey) and the holder name
(bold capitals; empty: a dash). Below the card a full-width green gradient button: **Edit Wallet** (one saved) or **Add Wallet** (none).

## 05, 06. Add / Edit Wallet (the card stays on top, a form card under it)
Form card (radius 18, soft pink-cream gradient, green border): green bar before the serif bold title "Add Wallet"; labels "Wallet Provider", "Wallet Account", "Account Holder Name" (grey Roboto); inputs white, border `#c9e6d3`, radius 14,
placeholders "Type wallet provider to search", "Enter wallet account number", "Enter account holder name". Focus on the provider box: green border, a white **drop-down list** under it (radius 14, shadow, rows with thin dividers, 5 rows visible,
searchable). Buttons: "Cancel" (mint `#e8f3ea`, grey-green text) and "Submit" (green gradient), side by side.

## 08-09. Withdraw
Header "Withdraw". Balance card: soft green-yellow gradient, small yellow glow top right, "AVAILABLE BALANCE" (serif capitals grey) and the amount huge serif bold black. Amount input: white pill (radius 16) with the currency mark and `0.00` (bold grey).
"Withdrawal Wallet" (green bar + serif bold) then a **dashed** mint box (`#b9e0cb` dashes) with "Add Wallet" (grey) -- shows the saved wallet when there is one. "Trade Password" (green bar + serif bold), white input "Enter trade password".
Grey line "Fee: 16%". Green button **Confirm Withdraw**. Card "Withdrawal Instructions" (serif bold title, divider, numbered grey lines): 1. Fee, 2. Withdrawal amounts between min and max, 3. No limit on the number of withdrawals,
4. Withdrawal time. (Mint's numbers come from settings.)

## 10-11. Profile (Account)
Top card (white, radius 28, soft shadow): round avatar with the **yellow ring** (the same circle as on Login: admin-uploadable) at the left, at the right `ID: 13828` (serif bold) and the phone number (grey); a thin line; the balance huge serif
bold dark green `#0c6a3a`. Two buttons side by side: **Deposit** (green gradient, serif bold, letter-spaced, white) and **Withdraw** (white, yellow `#f6c93b` 2px border, yellow serif text). "Settings" (green bar + serif bold + a fading green line).
One white card (radius 24) with six rows, each: a large gradient rounded-square tile (see batch 2 #9), serif bold title, grey subtitle, a small yellow chevron at the right:
Download APP / Get the mobile app, Wallet / Manage your wallet, Balance Record / Transaction history, Messages / Notifications & mail (dark green round badge with the unread count on the tile), Login Password / Change login PIN,
Trade Password / Change trade PIN. Last: a full-width green gradient **Log Out** button (yellow door icon + serif bold letter-spaced text).

## 12-14. Deposit
Header "Deposit". "Select Amount" (green bar + serif bold): three chips in a row (selected = green gradient with white serif bold `3,700`; others white with grey-green serif bold `7,400`, `18,500`), radius 14; under them a white input with the typed number.
"Select Payment Method": a stack of white cards (radius 16, border `#d3e8dc`), each with the method name centred in serif bold capitals (`PAY-A`, `PAY-E`, `PAY-B`, `PAY-C`, `PAY-G`) and a round radio at the right (grey ring; selected = dark green `#0b5d3a` ring with a white dot,
card tinted pink-cream `#fdf3f1` with a dark-green border). Green button **Confirm Deposit**. Card "Deposit Instructions" (serif bold, divider, grey numbered lines: recharge time, contact customer service, minimum deposit amount, do not save old account recharge).
**Tapping Confirm**: the page dims (dark mauve overlay), a thin green spinner with the words "Redirecting to payment..." (serif, white, letter-spaced) in the middle and the button reads **Processing...** (greyed). That is the "redirect feel" the owner asked for on Cookie.
(Mint keeps its own methods and its own pay flow; Cookie's payment page is NOT part of Mint unless the owner asks.)

## 15. Home product list (as batch 2 #8, scrolled to the end) with the floating chest.

## 16. The treasure-chest artwork
`design-ref/batch3/16-59016610.jpg`: the open chest with gold coins (660x675, grey `#e5e5e8` background in the file). It is the picture used on the Treasure Chest page and for the floating chest on Home; the app needs it with a **transparent**
background (cut the grey out when building), as in the screenshots.

## Notes for the build
- New Account menu = Download APP, Wallet, Balance Record, Messages, Login Password, Trade Password, Log Out (+ Deposit / Withdraw buttons on top).
- Bottom bar is 6 tabs (Home, Orders, Promotion, Team, Salary, Profile).
- Everything money/auth stays Soda's; new look only. After the owner's last batch: ONE build, tests, cache bump, push.
