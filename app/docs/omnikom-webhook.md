# Omnikom inquiry webhook, version 1

A note for Omnikom's developers. Every inquiry a visitor sends on matterofplace.com is delivered to Omnikom as one
signed JSON request. This page is a proposal: please confirm it, or tell us what to change, before we switch it on.

## The request

- `POST <OMNIKOM_WEBHOOK_URL>` with `content-type: application/json`. The body is at most 64 KB. We wait 10 seconds for
  an answer and do not follow redirects.
- Headers:

| Header              | Value                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `X-MOP-Event`       | `inquiry.received`                                                                        |
| `X-MOP-Delivery-Id` | A UUID, the same for every attempt at one inquiry, including a manual re-send             |
| `X-MOP-Timestamp`   | Unix seconds at the moment of the attempt                                                 |
| `X-MOP-Signature`   | `sha256=` and the hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed by the shared secret |
| `User-Agent`        | `MatterOfPlace-Webhook/1`                                                                 |

The shared secret is exchanged once, outside this page, and never sent in a request.

## What the receiver does

1. Verify the signature over the raw bytes of the body, before parsing it. Compare in constant time.
2. Refuse a timestamp more than 300 seconds old.
3. Keep the delivery id and ignore a second request with an id you already hold.
4. Answer:

| Answer                         | Meaning                  | What we do                                |
| ------------------------------ | ------------------------ | ----------------------------------------- |
| `200` or `202`                 | Accepted                 | Mark the inquiry as forwarded             |
| `409`                          | You already hold this id | Treat it as delivered                     |
| `408`, `425`, `429`, any `5xx` | Unavailable              | Try again later, honouring `Retry-After`  |
| No answer within 10 seconds    | Unavailable              | Try again later                           |
| Any other status               | The payload is refused   | Stop, and show the refusal to our editors |

When unavailable we try again after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours, or at
`Retry-After` when that is later. After the seventh failure we stop and an editor can send it again by hand, with the
same delivery id. Each attempt carries a new timestamp and signature over the same body bytes.

## The body

```json
{
  "id": "<delivery id, equal to X-MOP-Delivery-Id>",
  "version": 1,
  "type": "inquiry.received",
  "occurred_at": "<ISO 8601, when the visitor sent the inquiry>",
  "source": "matterofplace.com",
  "data": {
    "inquiry": {
      "id": "<inquiry uuid>",
      "intent": "showing | ask | similar | sell | invest | agent | general",
      "topic": "<contact form topic>",
      "name": "<name>",
      "email": "<email>",
      "phone": "<phone>",
      "location": "<where the visitor is>",
      "message": "<message>",
      "details": {},
      "source_path": "<page the visitor wrote from>",
      "received_at": "<ISO 8601>"
    },
    "subject": {
      "kind": "property",
      "slug": "<property slug>",
      "title": "<property title>",
      "market": "california | florida | new-york",
      "city": "<city>",
      "tier": "Editorial | Feature | Reach | Campaign",
      "presented_by": "agent | owner",
      "representation": { "name": "<agent name>", "brokerage": "<brokerage>" }
    },
    "attribution": {
      "first_touch": {
        "landing_path": "<first page of the session>",
        "referrer_host": "<host of the referring site>",
        "utm_source": "<utm_source>",
        "utm_medium": "<utm_medium>",
        "utm_campaign": "<utm_campaign>",
        "utm_content": "<utm_content>",
        "at": "<ISO 8601>"
      },
      "last_touch": {
        "landing_path": "<page of the latest campaign link or outside referrer>",
        "referrer_host": "<host>",
        "utm_source": "<utm_source>",
        "utm_medium": "<utm_medium>",
        "utm_campaign": "<utm_campaign>",
        "utm_content": "<utm_content>",
        "at": "<ISO 8601>"
      },
      "pages_viewed": 0
    }
  }
}
```

- A value we do not have is left out. We never send `null` or an empty string.
- `subject` is present only when the inquiry is about a property. When the property is no longer on file it carries
  only `kind`, `slug` and `title`. `representation` is left out for a home its owner presents.
- `details` holds the answers to the questions of the chosen intent, for example preferred timing.
- `attribution` is what the visitor's browser noted in that session: the first page and referrer, the latest
  campaign link, and how many pages they read. No cookie, IP address or device detail is sent.
- `"test": true` appears only in requests we send by hand to check the connection. Do not record those as inquiries.

## Try it

`tests/unit/omnikom/vector.json` is a fixed request: secret, timestamp, body and the signature it must give, with the
`openssl` command that produced the signature. `docs/verify-example.mjs` checks it in Node:

```sh
node docs/verify-example.mjs   # prints: signature ok
```

A request like ours, signed by hand (replace the URL and the secret):

```sh
BODY='{"id":"73b49cbb-58d6-5523-ac41-4f6669fef9d5","version":1,"type":"inquiry.received","occurred_at":"2026-10-04T09:30:00.000+00:00","source":"matterofplace.com","test":true,"data":{"inquiry":{"id":"2aad04a4-3848-43fc-b90e-1db79b89f5ac","intent":"general","name":"Ada Reyes","email":"ada@example.com","message":"A test from Matter of Place.","details":{},"source_path":"/contact","received_at":"2026-10-04T09:30:00.000+00:00"},"attribution":{}}}'
TS=$(date +%s)
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$OMNIKOM_WEBHOOK_SECRET" | sed 's/^.*= //')
curl -sS -X POST "$OMNIKOM_WEBHOOK_URL" \
  -H 'content-type: application/json' \
  -H 'X-MOP-Event: inquiry.received' \
  -H 'X-MOP-Delivery-Id: 73b49cbb-58d6-5523-ac41-4f6669fef9d5' \
  -H "X-MOP-Timestamp: $TS" \
  -H "X-MOP-Signature: sha256=$SIG" \
  -H 'User-Agent: MatterOfPlace-Webhook/1' \
  --data-binary "$BODY"
```

If you prefer another way to authenticate, such as a bearer token or mutual TLS, say so: only our sending module
changes.
