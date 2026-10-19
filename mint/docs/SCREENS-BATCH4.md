# Mint screens, batch 4 (owner's screenshots, 2026-10-19) -- BUILT

Pictures: `design-ref/batch4/` (numbered in the order sent). With batches 2 and 3 these are the whole signed-in Mint app; all of it is built.
Measurements below are CSS px (the pictures are 720 wide = 360 px at 2x). Fonts: Roboto for figures/labels, Noto Serif for titles.

## What the pictures show
- **Home** (07, 04-06, 08): white top strip with the **message icon at the left** (green unread count) and the **site name in monospace** (`brandName()`, admin "App name"), the admin banner with
  the slide dots (active = green pill), four gradient buttons **Deposit, Withdraw, Channel, Service** (Channel = Telegram group, Service = customer service link), then the product cards.
  Card = picture column 130 wide (grey **Coming Soon** band across the top while not buyable; green **owned/limit** band across the bottom), name in gold, rows PRICE / DAYS / DAILY (green) / TOTAL,
  a thin bar with the **purchase-limit percentage** (owned / limit), and **Buy Now** (mint **Coming Soon** while closed). The floating **bouncing treasure chest** sits at the bottom right and opens the Treasure Chest page.
- **Welcome dialog** (08): X circle top right, serif title, the admin picture, tick lines of text, **Join Channel**. Title and lines are set in the admin panel (Welcome announcement).
- **Orders** (03): Total Earnings card (gold amount) and "No Orders" (owned products use the same card as Home, with Purchase / Expire dates).
- **Treasure Chest win card** (09): Congratulations!, You won, amount, New Balance, COLLECT.
- **Withdraw** (01-02): balance card, amount box, Withdrawal Wallet (card + Bind Wallet, or a dashed Add Wallet box), Trade Password, Fee, Confirm Withdraw, instructions.

## Decisions made while building (all of batches 2-4)
- Money is written **"UGX 23,000.00"** (space after the currency), never "k"/"M".
- **Salary** is new (the old Soda Mission Center is gone). Server: `GET /salary/status`, `POST /salary/claim`; tiers `settings.salaryTiers` (defaults 500,000 -> 2,000 ... 50,000,000 -> 14,000, from the pictures),
  edited in the admin panel under Settings > Daily Salary. The figure that puts a member on a tier is the **team's total deposits (levels 1-3)** -- the same number Team shows as "Purchase".
  Each calendar day (Uganda clock) on a reached tier is one day of wages; unclaimed days keep accruing; a claim pays the earliest day at the reward recorded for it. Money-safe like a deposit credit
  (in-process lock + one atomic update with a per-day "already paid" token + a ledger row keyed by the day). Rows are `mission_salary` ("Daily Salary" tab in Balance Record).
  Days between two looks at the screen are paid at the reward recorded at the last look (a tier reached today applies from today), so a member who never opens Salary still accrues nothing extra for a tier they did not know about.
- **Task Center removed** (not in the pictures): screen, `/team/task/claim`, the admin editor and the default lists are gone; rows already paid keep their labels.
- Deposit has **no phone box**: the prompt goes to the registered number (the server falls back to it). PAY-A/E/B/C/G are labels for one gateway. Confirm shows the dim "Redirecting to payment..." overlay and "Processing...".
- Messages can carry a **picture** (admin Messages form); it is served from `/public/message-image/<id>` so polls never carry image bytes.
- New admin slot **Download App background** (`downloadbg`); the Download page copy (title, subtitle, note) is Mint's own wording because the picture's text is blurred.
- Promotion's "Invitation Reward" omits the picture's last sentence ("contact customer service to claim the team top-up reward"): Mint has no such reward.
- Password minimum is 6 everywhere (no weak-password list).
