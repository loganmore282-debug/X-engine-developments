# Budweiser — Admin Console

A LayUI admin panel matching the **budweiser user panel** style (red→navy
brand, LayUI + jQuery, `.ashx` JSON backend). Drop-in front end — you wire the
backend handlers to your existing data.

## Files
```
budweiser-admin/
├── login.html          ← admin login (mobile + password)
├── index.html          ← dashboard + all sections (single page)
├── images/bui/logo.png ← your logo (copied from the user panel)
└── README.md
```

Deploy it under a protected path on the same domain as the user panel, e.g.
`/admin/`, so the relative `/ashx/...` calls hit your backend.

## How it talks to the backend
Same convention as your user panel. Every call is:

```
GET /ashx/AdminServer.ashx?action=<name>&token=<adminToken>&...params
```
…and expects JSON:
```json
{ "State": "200", "JsonResult": "ok", "Data": <object|array> }
```
- `State 200` = success (read `Data`)
- `State 300` = error (panel shows `JsonResult` as a toast)
- `State 500` = session expired (panel redirects to `login.html`)

Login uses your existing `LoginServer.ashx` with `action=adminlogin`
(`moblie_qu`, `moblie`, `password`). On success return `State:200` and
optionally `Token` (stored in localStorage and sent as `token` on every call).

## Backend actions to implement (`AdminServer.ashx`)

| action | params | returns in `Data` |
|---|---|---|
| `whoami` | — | `{ name, phone }` of the logged-in admin |
| `logout` | — | — (clears server session) |
| `stats` | — | `{ totalUsers, activeToday, depositsToday, depositsTotal, withdrawalsTotal, pendingWithdrawals, totalInvested, platformBalance }` |
| `users` | `q, limit` | array of `{ id, phone, name, walletBalance, totalDeposited, totalWithdrawn, referralCode, status }` |
| `user` | `id` | `{ id, phone, name, joined, walletBalance, depositBalance, cumulativeBalance, referralBalance, totalInvested, totalWithdrawn, status }` |
| `addfunds` | `userId, amount` | — |
| `resetpass` | `userId, newPassword` | — |
| `resetpin` | `userId` | — |
| `ban` | `userId, action(ban/unban)` | — |
| `message` | `userId` **or** `phone`, `title?`, `message` | — |
| `broadcast` | `title, message` | — |
| `deposits` | `status, limit` | array of `{ id, userPhone, userId, amount, method, reference, status, date, time }` |
| `deposit_approve` / `deposit_reject` | `id` | — |
| `withdrawals` | `status, limit` | array of `{ id, userPhone, userId, amount, fee, netAmount, withdrawalPhone, refPortion, status, date, time }` |
| `withdraw_approve` | `withdrawalId` | — |
| `withdraw_decline` | `withdrawalId, reason` | — (refund the user) |
| `products` | — | array of `{ id, name, price, dailyReturn, cycle, totalReturn, active }` |
| `product` | `id` | single product |
| `product_save` | `id?, name, price, dailyReturn, cycle, active` | — |
| `product_delete` | `id` | — |
| `settings_get` | — | `{ withdrawalFee, minWithdrawReferral, minWithdrawCashback, minDeposit, refL1, refL2, refL3, maintenanceMode }` |
| `settings_save` | (those fields) | — |

> The `withdraw_decline` handler should **refund** the user's balance, and
> `withdraw_approve` should release the payout — mirror whatever your payment
> flow does.

## Security notes
- Gate `AdminServer.ashx` behind the admin session/token on **every** action —
  the panel is just a UI, the backend must enforce who is an admin.
- Serve `budweiser-admin/` only to admins (IP allow-list / separate subdomain /
  basic-auth in front of it is a good extra layer).

## Sections in the panel
Dashboard (live stats + pending withdrawals) · Users (search, view, add funds,
reset password/PIN, ban, message) · Deposits (approve/reject) · Withdrawals
(approve/decline+refund) · Products (CRUD) · Messages (single + broadcast) ·
Settings (fees, minimums, referral bonuses, maintenance).
