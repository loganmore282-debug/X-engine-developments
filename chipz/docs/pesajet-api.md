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
7. Any **IP allowlist** for webhook senders — the dashboard mentions
   "control IP security", so the feature exists; its shape is not recorded here.
8. **What the `sk_` API secret is for.** It is issued and marked
   "Restricted / use only in secure server-side environments", yet neither the
   SDK nor PesaJet's own cURL sample sends it anywhere. If payouts or some
   other call need it, that is invisible from both sources — ask before
   assuming `pk_` alone is enough for a disbursement.
