# PesaJet Pay — API contract

**Provenance.** `pay.pesajet.com` is not reachable from the build environment
(the egress proxy refuses it), so this was extracted from the **official SDK**,
`@pesajet/sdk@1.0.2` on npm (`npm pack @pesajet/sdk`, then its `dist/`). That
is the same contract the SDK itself speaks, so it is authoritative for
endpoints, headers, field names and status values — but it is NOT the docs
site, and anything the SDK does not exercise is listed under "Not answered
here" at the bottom. Do not invent those; confirm them with PesaJet.

SDK repo: `https://github.com/pesajet/pesajet-pay-demo` (`sdks/nodejs`).
Also published: `pesajet` on PyPI. Chipz has no need of either package —
`server.js` calls the REST API directly, as it does for MarzPay and LipaPay.

## Base URL and authentication

| | |
|---|---|
| Base URL | `https://payments.pesajet.com/api/v1` (the SDK's default; it accepts a `baseUrl` override, so a sandbox host probably exists — ask) |
| Auth header | `X-API-Key: <api key>` |
| Key shape | `pk_live_…` (the landing page's example) |
| Content type | `application/json` |
| Client timeout | SDK default 30000 ms |

Env vars for Chipz: `PESAJET_API_KEY`, `PESAJET_WEBHOOK_SECRET`, optionally
`PESAJET_BASE_URL`. **Render env vars only — never in this repo.**

## Endpoints

### `POST /payments` — collection AND disbursement

One endpoint for both directions; `type` decides which.

```json
{
  "type": "COLLECTION",
  "amount": 25000,
  "currency": "UGX",
  "phoneNumber": "+256771234567",
  "provider": "mtn",
  "reference": "INV-2026-001",
  "description": "E-Commerce Checkout",
  "metadata": {}
}
```

- `type`: `"COLLECTION"` (money in, the default) | `"DISBURSEMENT"` (money out)
- `amount`: **whole shillings** in every example (`25000` = UGX 25,000,
  `850000` = UGX 850,000). Not minor units. Worth confirming.
- `currency`: defaults to `"UGX"` in the SDK
- `phoneNumber`: **E.164 with a leading `+`** — `+256771234567`
- `provider`: `"mtn"` | `"airtel"`, **lowercase**
- `reference`: our own reference; required
- `description`, `metadata`: optional
- Optional request header **`Idempotency-Key`** — the SDK sends it when
  `idempotencyKey` is passed. Use it.

Returns a `Transaction` (below), with `status: "PENDING"` initially.

### `GET /payments/{transactionId}` — read one transaction

**This is the endpoint Chipz's money safety depends on.** A webhook is only
ever a hint here; the credit decision comes from re-reading the transaction
through this call.

### `GET /payments/preview?amount=&provider=&type=` — fee preview

```json
{ "amount": 0, "provider": "mtn", "type": "COLLECTION",
  "platformFee": 0, "providerFee": 0, "totalFee": 0,
  "netAmount": 0, "totalCost": 0 }
```

Note `netAmount` and `totalCost`: PesaJet charges a fee, so for a
**DISBURSEMENT** the cost to us is not the same as the amount the member
receives. Whichever of the two Chipz's 15% cash-out fee is reconciled against
must be decided deliberately.

## The `Transaction` object

```
transactionId       string      PesaJet's own id — this is what to store and poll
providerReference   string?     the operator's reference (MTN/Airtel)
type                COLLECTION | DISBURSEMENT
amount              number
currency            string
status              PENDING | PROCESSING | COMPLETED | FAILED | EXPIRED
provider            mtn | airtel
phoneNumber         string
reference           string      ours, as sent
description         string?
failureReason       string?     shown to nobody raw — map it
metadata            object?
createdAt           string
updatedAt           string?
expiresAt           string?     a prompt can EXPIRE, which is its own outcome
```

**Terminal statuses are `COMPLETED`, `FAILED` and `EXPIRED`** (the SDK's own
`pollUntilComplete` stops on exactly those three; its default poll is 2500 ms
× 24 ≈ one minute). `PENDING` and `PROCESSING` are both still in flight.

`EXPIRED` matters: it is not the same as `FAILED`. It means the member never
approved the prompt, which is the commonest real outcome on mobile money and
deserves its own wording.

## Webhooks

- Delivered as `POST` with JSON.
- Signature in the header **`x-webhook-signature`**, and also (sometimes) as a
  `signature` field inside the body.
- **HMAC-SHA256, hex**, keyed with the webhook secret, computed over
  `JSON.stringify(payload)` **with the `signature` field removed**.
- Compared with `crypto.timingSafeEqual` after a length check.

```json
{ "event": "payment.completed", "transactionId": "...", "providerReference": "...",
  "amount": 25000, "currency": "UGX", "status": "COMPLETED", "provider": "mtn",
  "reference": "...", "failureReason": null, "metadata": {},
  "timestamp": "...", "signature": "..." }
```

Events: `payment.completed` | `payment.failed` | `payment.expired` | `ping`.
`ping` is a delivery test and must be answered 200 without touching money.

**A fragility to know about:** the HMAC is over a *re-serialised* object, not
over the raw request body, so it depends on JSON key order surviving
`parse → stringify`. Node preserves insertion order for string keys, so it
normally matches — but it can break on a proxy that reorders or re-encodes.
This is a further reason the signature is a filter and **never** the authority:
verify it, refuse on mismatch, and still re-read `GET /payments/{id}` before
crediting.

**There is no `callbackUrl` / `notifyUrl` field in the create payload.** Unlike
MarzPay and LipaPay, the webhook URL is *not* passed per request — it is
configured once in the PesaJet dashboard. The owner has to set it there.

## Errors

Non-2xx returns JSON carrying `message` (or `error`) and `errorCode`. The SDK
raises `PesaJetError` with `statusCode`, `errorCode`, `details`. Map these to
member-facing wording the way `marzUserMsg()` / `lipaUserMsg()` already do;
never show a raw provider string to a member.

## Phone numbers and networks (from the SDK's own `utils`)

```
formatPhoneNumber:  "0…" -> "+256…",  "256…" -> "+256…",  else prefix "+"
detectProvider:     77, 78, 76, 79, 39  -> mtn
                    70, 75, 74          -> airtel
                    everything else     -> null
```

The SDK's own comment: **`079` is MTN, and `073` cuts across both networks**
(shared/ported), so it returns `null` and the caller must state the provider.
Chipz already collects the network explicitly on the manual-payment path and
has its own `UGANDA_MOBILE_PREFIXES`; the two lists must be reconciled rather
than one silently overriding the other. Note PesaJet lists `39`, which Chipz's
own prefix list does not.

## Not answered here — confirm with PesaJet before relying on it

1. **Sandbox base URL** (the SDK only says `baseUrl` is overridable).
2. **Amount units** — every example is whole shillings; confirm there is no
   minor-unit mode.
3. **Minimum and maximum per transaction.**
4. **Whether disbursements draw on a pre-funded float**, and if so whether
   there is a balance endpoint. The SDK exposes none, so the admin dashboard's
   "available balance" card has no PesaJet equivalent yet.
5. **Whether `reference` must be globally unique**, and what happens on a
   repeat (this decides whether `Idempotency-Key` or `reference` is the
   idempotency anchor).
6. **Retry policy for webhooks** — how many times, over how long.
7. Any **IP allowlist** for webhook senders.
