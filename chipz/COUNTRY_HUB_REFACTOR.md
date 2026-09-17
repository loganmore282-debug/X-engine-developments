# Chipz country-hub refactor

This file records the owner's requirements for the multi-country refactor so they are not lost during implementation.

## Core routing rule

- Chipz uses ONE public entry/domain for every country.
- Country is selected on Login / Sign Up, not inferred from the hostname.
- Existing country subdomains become **neutral**. They may still resolve to the app for compatibility, but they MUST NOT select, lock, or imply a country.
- Opening an old subdomain shows the same neutral country-selection experience as the main entry.
- Once a member is authenticated, the account's stored `regionKey` is authoritative for all money, products, limits, currency, payment settings and number validation.
- Existing members keep their current stored country. This refactor must not rewrite old accounts into another country.

## Registration / login / referrals

- Login and Sign Up must expose a country selector with country name and dial code.
- Selecting a country loads that country's dial code, currency, phone-number rules, enabled languages and public settings.
- Registration stamps the selected country into the new account exactly once.
- Login must resolve the correct Firebase identity from the selected country + phone number.
- Referral URLs use the single public domain and carry referral code + country context in the URL. The host itself carries no country meaning.
- Opening a referral URL preselects the referral country, but the backend still validates the referral/country/currency rules before creating an account.

## Country-specific networks

- Remove the global assumption that every country uses MTN Mobile Money / Airtel Money.
- Every country owns an editable list of account/payment networks.
- Networks can be named freely (examples: MTN Mobile Money, Airtel Money, M-Pesa, Moov Money, Orange Money, Telecel Cash, Wave).
- Wallet binding, manual deposits, withdrawal destination validation and admin payment-number configuration must use the selected member country's configured network list.
- Manual collection numbers are isolated by both country and network.

## Admin country isolation

When an admin selects one country, that country view must only expose that country's:

- dashboard totals
- users
- deposits
- withdrawals
- transactions
- products and regional prices/returns/schedules
- settings and limits
- payment gateways
- manual payment numbers
- wallet/account networks
- promo/gift codes
- messages
- analytics
- provider summaries/balances where applicable
- notifications

No country A data may appear while country B is selected.

## Payment provider dashboard

- Provider cards only appear for providers configured/used by the selected country.
- MarzPay/PesaJet/LipaPay information must not leak into another country's dashboard.
- Global provider credentials can remain backend environment secrets, but dashboard presentation and transaction aggregation are country-scoped.

## Admin push notifications

- Admin push subscriptions must be country-aware.
- A device subscribed while viewing country A must not receive country B deposit/withdrawal alerts.
- The owner may deliberately subscribe the same device to multiple countries if the UI explicitly allows it.

## Languages

- Enabled languages are configured per country.
- Every enabled language must have complete user-app and admin-facing UI coverage for all visible strings in that language scope.
- No silent English fallback is allowed for an enabled production language.
- Build/test tooling must fail when a visible UI string is untranslated for an enabled language.

## Admin cleanup

- Remove long instructional/explanatory paragraphs from the admin UI.
- Keep concise labels, field names, values, essential warnings, validation messages and confirmation dialogs.
- Do not remove safety-critical warnings where an action can move/refund/delete money or permanently alter data.

## Money-safety invariants

- Existing user balances, investments, deposits, withdrawals and ledgers are never migrated by guessing country.
- Authenticated account `regionKey` always wins over client-selected country for money operations.
- Provider callbacks/webhooks must resolve the original transaction's stored region, not the browser's current selection.
- Pending withdrawals remain pending until the configured approval mode processes them.
- Existing duplicate-credit/double-payout protections remain intact.
- Country selection is never trusted as authority for an already-authenticated member's money.

## Compatibility rule for old subdomains

**Neutral means neutral:** an old subdomain may continue resolving for compatibility, but it has zero country-routing authority. It must behave like the single main entry before login. After login, the member's stored account country controls the session.

## Required verification before production merge

Test at minimum: new registration in multiple countries, existing-member login, wrong-country login attempt, referral registration, neutral old subdomain behavior, per-country networks, manual deposits, automatic deposits, wallet binding, pending/manual withdrawals, automatic-provider withdrawals, provider callbacks, admin country isolation, admin push isolation, provider dashboard isolation, products/settings isolation, language completeness, and existing-account regression.
