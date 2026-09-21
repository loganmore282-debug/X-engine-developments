# PesaJet Pay — API contract

**Provenance.** Two sources, and where they disagree the docs win.

1. **`pay.pesajet.com/docs` itself**, read on 2026-09-15 (the owner pasted the
   page; the host is refused by this environment's egress proxy). This is the
   authority for the endpoint list, the error shape, the webhook retry
   schedule, sandbox behaviour and the IP controls.
2. **The official SDK**, `@pesajet/sdk@1.0.2` on npm (`npm pack`, then its
   `dist/`), which is where everything here came from first. Still useful: it
   is executable and it pins field names the docs only summarise. Also
   published: `pesajet` on PyPI — same surface, checked with `pip download`.

SDK repo: `https://github.com/pesajet/pesajet-pay-demo` (`sdks/nodejs`).
Chipz has no need of either package — `server.js` calls the REST API directly,
as it does for MarzPay and LipaPay.

**Where the two disagreed, and what it cost.** The SDK's error type is FLAT;
the docs show the error NESTED under `error`. Chipz read it the flat way, so a
documented error body handed the error object straight to a member and printed
`[object Object]` on a failed recharge. Both shapes are accepted now. The SDK
also types `provider` as optional while the docs call it required-but-
auto-detected; Chipz omits it only when neither the stored network nor the
prefix resolves one, and lets their own detection answer.

## Base URL and authentication

| | |
|---|---|
| Base URL | `https://payments.pesajet.com/api/v1` (the SDK's default; it accepts a `baseUrl` override, so a sandbox host probably exists — ask) |
| Auth header | `X-API-Key: <api key>` |
| Key shape | `pk_…` (the landing page's example says `pk_live_…`; a real one from the dashboard is `pk_` + 48 hex) |
| Content type | `application/json` |
| Client timeout | SDK default 30000 ms |

Env vars for Chipz: `PESAJET_API_KEY`, `PESAJET_WEBHOOK_SECRET`, optionally
`PESAJET_BASE_URL`. **Render env vars only — never in this repo.**

The dashboard issues **three** credentials and only two have a documented use:

| shown as | shape | used by |
|---|---|---|
| **API key** — "public credential", *Active* | `pk_...` | `X-API-Key`. What the SDK's `apiKey` is, and what their own cURL sample sends. |
| **API secret** — "private credential", *Restricted* | `sk_...` | **Nothing in the SDK or their cURL sample uses it.** Open question below. |
| **Webhook signing secret** | `whsec_...` | verifying the webhook HMAC |

PesaJet call the `pk_` key "public", but it is the credential that
authenticates every API request, so treating it as publishable would be a
mistake — their own banner says to keep keys on the server and out of public
repositories. Rotate it (the dashboard has *Rotate API keys*) if it is ever
shown in a screenshot, a chat, or a commit.

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

Confirmed against the live merchant dashboard (screenshots, 2026-09-15), which
adds three things the SDK does not say.

- Delivered as `POST` with JSON, to **one** destination URL set in the
  dashboard ("Webhook Destination URL", with a *Test endpoint* button beside
  it). **There is only one field**, so a single endpoint must serve both
  directions -- two per-direction callbacks could not both be registered, and
  the unregistered half would fail invisibly because the reconciler covers
  for it. Chipz's endpoint is **`POST /pesajet/webhook`**.
- **`200 OK` is required within 30 seconds**, in the dashboard's own words. So
  acknowledge first and do the work after; the status re-read can outlast it.
- Signature in the header **`X-Webhook-Signature`** (matched
  case-insensitively), and also sometimes as a `signature` field in the body.
- **HMAC-SHA256, hex**, keyed with the webhook signing secret (`whsec_...`).

**THE TWO SOURCES DISAGREE ON WHAT IS SIGNED, and it matters.** The dashboard
says the digest is of the **raw request payload**. The SDK computes it over
`JSON.stringify(payload)` **with the `signature` field removed** -- different
bytes whenever spacing or key order differ, i.e. in general. Only one of them
is what PesaJet's servers actually do.

Chipz accepts **either**. That is not a weakening: both candidates are
HMAC-SHA256 over data derived from the same request under the same secret, so
forging either still needs the secret. What it buys is that the integration
works whichever one is real, instead of 401-ing every live webhook until
somebody reads the bytes off the wire. The raw form is tried first, because
that is what the dashboard states.

```json
{ "event": "payment.completed", "transactionId": "...", "providerReference": "...",
  "amount": 25000, "currency": "UGX", "status": "COMPLETED", "provider": "mtn",
  "reference": "...", "failureReason": null, "metadata": {},
  "timestamp": "...", "signature": "..." }
```

Events: `payment.completed` | `payment.failed` | `payment.expired` | `ping`.
`ping` is a delivery test and must be answered 200 without touching money.

**Either way the signature is a filter and never the authority.** Verify it,
refuse a mismatch, and still re-read `GET /payments/{id}` before crediting --
the re-read is what decides, so a signing scheme that turns out to be a third
thing again cannot cost money.

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

## Sandbox, and the KYC prerequisite

There is **no separate sandbox host**. Sandbox transactions run end to end
against the real MTN MoMo and Airtel Money networks, and before KYC approval
they may only use **the phone number registered on the merchant profile**.
Completing one successful sandbox transaction to that SIM is a **mandatory
prerequisite for submitting KYC**.

So `PESAJET_BASE_URL` needs no sandbox value, and the first real test has to be
a recharge from the registered number for its own amount.

## Merchant security controls — the IP allowlist

An administrator can restrict **disbursements** by client IP. With enforcement
on, a payout is accepted only from an allowed address; **collections and
read-only requests are not affected.**

**This is a live outage risk for Chipz and it would show up only as payouts
failing.** `chipz-server` runs on Render, whose outbound addresses are not
guaranteed stable on every plan. Leave enforcement OFF unless Render's
outbound IPs are pinned and entered first.

## Webhook delivery and retries

Headers on every delivery:

| header | |
|---|---|
| `X-Webhook-Signature` | HMAC-SHA256 hex digest of the payload |
| `X-Webhook-Id` | UUID, unique per delivery attempt — for audit and de-duplication |
| `Content-Type` | `application/json` |
| `User-Agent` | `PesaJet-Webhooks/1.0` |

If the endpoint does not answer 2xx within 30 seconds, PesaJet retry at
**1 minute, 5 minutes, 15 minutes, 1 hour, then every 4 hours up to 24 hours**.

So **a webhook will be delivered more than once** as a matter of routine, not
as an edge case. Chipz's handler is idempotent at every step and credits only
from an independent re-read, which is what makes that harmless.

**The signing question is settled**, and in Chipz's favour: the docs say to
take *"the raw body (or remove the `signature` key from the parsed JSON)"* —
both candidates, exactly what `pesajetVerifyWebhook` already tries.

## Errors

Documented shape, nested:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid phone number format",
             "details": { "phoneNumber": "Use +256 format" },
             "timestamp": "2026-07-26T10:30:00.000Z", "requestId": "req_123456" } }
```

| status | their instruction | what Chipz does |
|---|---|---|
| 400 | correct the fields | refuse the payment, show their message |
| 401 | check `X-API-Key` | refuse; logged |
| 404 | confirm it is your transaction | on a status read, "unknown to PesaJet" — an answer, not an outage |
| **409** | **"reuse the original response"** | **NOT a refusal** — recover the transaction by reference; if it cannot be found, treat as in flight |
| 429 | back off with jitter | treated as busy, left pending |
| 500 | retry with the same idempotency key | treated as busy, left pending |

`requestId` is logged on every non-2xx, because their own error table says to
quote it to support.

## Not answered here — confirm with PesaJet before relying on it

1. **Maximum per transaction.** The minimum is documented as 1; no maximum is.
2. **Whether disbursements draw on a pre-funded float.** The docs say
   "your merchant balance sends funds", so a balance exists — but **the
   complete endpoint reference lists no way to read it** (`POST /payments`,
   `GET /payments/preview`, `GET /payments/:id`, `GET /payments`). That is why
   the admin dashboard's PesaJet card reports Chipz's own records and says in
   as many words that it is not their float.
3. **What the `sk_` API secret is for.** Still nothing: not the SDK, not the
   cURL samples, not the endpoint reference. Ask before assuming `pk_` alone
   is enough for a disbursement.
4. **The list endpoint's response envelope.** Its *parameters* are documented
   (`page`, `limit`, `status`, `provider`, `startDate`, `endDate`) but the
   shape it returns is not. `pesajetFindByReference()` accepts four plausible
   envelopes and reports anything else as **unreadable** rather than as "no
   rows" — an unrecognised shape must never become evidence that a payment
   does not exist.
5. **Whether `reference` must be unique.** `idempotencyKey` is clearly the
   retry anchor; `reference` is documented only as "your payment or invoice
   reference, up to 255 characters".
