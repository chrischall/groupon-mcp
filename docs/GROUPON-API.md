# Groupon consumer API — captured request shapes

Reverse-engineered from the live www.groupon.com PWA (2026-07-24). All read
operations hit **one endpoint** and work from plain server-side `fetch` with **no
cookies / no auth / no bot wall**:

```
POST https://www.groupon.com/mobilenextapi/graphql
headers:
  content-type: application/json
  apollographql-client-name: mobilenextapi
body: a BATCHED JSON ARRAY of Apollo Automatic-Persisted-Query operations
```

Each array element:
```json
{ "operationName": "<Op>",
  "variables": { ... },
  "extensions": { "persistedQuery": { "version": 1, "sha256Hash": "<hash>" } } }
```

The response is a top-level **array**; `element[0].data.<field>` holds the payload.

> **The `sha256Hash` values below are PUBLIC persisted-query fingerprints** — a
> sha256 of the query string, transmitted by every anonymous visitor and present
> in any HAR capture. They are **not credentials/secrets**. They can go stale
> when Groupon redeploys its frontend queries; a stale hash returns
> `{ "errors": [{ "message": "PersistedQueryNotFound" }] }`. Recovery = re-capture
> from a browser DevTools → Network `/mobilenextapi/graphql` request (see the
> skill's re-capture recipe). Introspection is disabled and the server masks all
> GraphQL errors as opaque `400` HTML, so DO NOT hand-author queries.

## Verified read operations

### `BrowseDealFeed` — search / browse a city feed  ✅ verified (55 KB deals)
- `sha256Hash`: `b035b25dceb8a84a64c618345cc21a14897b7328506a39b2e27fc7ca4ec2f429`
- variables:
  ```json
  { "dealFeedParams": { "limit": 24, "division": "new-york", "locationFromUrl": false,
      "filters": [{ "key": "query", "subKey": null, "value": { "static": "massage" } }],
      "offset": 0, "feedToken": null, "includeLocationsCount": true },
    "browseParams": { "pathName": "/search", "isFetchMore": false },
    "allLocations": false }
  ```
  - Omit the `query` filter entirely for a plain city/category browse.
  - `division` is a Groupon city slug (`new-york`, `chicago`, `syracuse`, …).
  - `filters[]` also carries category/price/sort facets — the response's
    `browseDealFeed.facets[]` is the live filter vocabulary.
- response: `data.browseDealFeed = { cards[], facets[], pagination, browseProps.breadcrumbs }`.
  card fields: `id, uuid, optionId, url, title, categoryGuid, prices{price{amount,currencyCode,formatted[]},strikeThroughPrice}, options, merchant{name,rating,logoUrl}, rating{value,count}, imageUrls, badges, discountPercentage, locationsSummary{total,closest{lat,lng,address,name}}, promotion, flags`.

### `getDeal` — deal detail  ✅ verified (59 KB; works even though the /deals/<slug> PAGE 403s server-side)
- `sha256Hash`: `d60360371251da4c5ce1f753d3e55a77e80d538c6c57fd4fc20dc894cd121236`
- variables:
  ```json
  { "dealId": "enset-productions-and-ventures-3", "optionId": null, "adSafe": false,
    "includeGeoBreadcrumbs": true, "useFinePrintV3": true }
  ```
  - `dealId` = the deal permalink slug = last path segment of a card's `url`
    (`https://www.groupon.com/deals/<dealId>`).
- response: `data.getDeal = { id, uuid, title, subtitle, dealUrl, options, price, merchant,
    division, images, videos, reels, aiReviewSummary, representativeReview, badges, status,
    showQuantitySelector, seodata, ... }`.

### `GetMainNavigation` — category taxonomy  ✅ (hash captured)
- `sha256Hash`: `da722d6e5ae1b4e336bbda8d2d07f31925aa709acf9843c67c5a65d0827aeb01`
- variables: `{ "includeChildren": true, "maxDepthLevel": 3 }`

### `dealFeeds` — related-deal carousels (hash captured)
- `sha256Hash`: `27a2be89964adb17b2f766634d1e4e90859671d8a4bec982cc5d75341a4b8caf`
- variables: `{ "params": [ { "filters": [...] } ] }`

### Autocomplete (hash captured; lower priority)
- ops seen: `SearchAutocomplete`, `Autocomplete`, `SuggestedSearchQueries`.

## Cart (purchase-path) operations — ✅ verified (live-captured 2026-07-25)

Cart ops hit the **same** endpoint as the reads (`POST /mobilenextapi/graphql`,
batched APQ array, `content-type` + `apollographql-client-name: mobilenextapi`),
but require the user's **authenticated session** — plus an `x-operation-name: <Op>`
header the web client sends.

> **Auth finding: the session COOKIE ALONE authorizes cart ops.** Verified
> `GetCart` returned data with just the `Cookie` header + the minimal headers
> above — **NO `x-sig-fraud-check`, NO CSRF header.** So the write client sends
> `Cookie` + `content-type` + `apollographql-client-name` + `x-operation-name`
> and nothing else. The cookie is resolved via the fetchproxy cookie-bootstrap
> trio (`GROUPON_SESSION_COOKIE` env → captured `Cookie` header from the signed-in
> browser tab → deferred error). This path needs a signed-in browser on the
> same machine, so it is available only where that holds.

The mutation hashes below are PUBLIC persisted-query fingerprints (same as the
reads) — not credentials, and they can go stale on a Groupon frontend redeploy.

### `GetCart` — read the signed-in cart  ✅
- `sha256Hash`: `1471251c7f45dfecdc4625c22e1422f877140e6648e0662d0834b3a92553b45b`
- variables: `{}`   ·   response: `element[0].data.getCart`
- A logged-out session comes back with a **null/absent `getCart`** (rather than an
  empty-but-present cart) → the client maps that (and a 401/403) to a distinct
  `SessionExpiredError`.

### `createOrUpdateCartItem` — ADD / update a line item  ✅
- `sha256Hash`: `d0aeb632be4f1316c0b83c5b0d1fe556363f9e149ce7fd590728bfe4d41b782d`
- variables: `{ optionId, dealUuid, optionUuid, quantity, isGift }`
- **Resolving the ids from a `getDeal` read** (verified against a live call): the
  deal's `uuid` is `dealUuid`; each `deal.options[]` entry carries `id` (→
  `optionId`) and `uuid` (→ `optionUuid`). For the observed deal `id` and `uuid`
  were the same value, but they are read independently. Option price for previews
  is `option.unformattedPrice` (`{ amount, currencyCode, currencyExponent, … }`);
  strike-through is `option.unformattedStrikeThroughPrice`; `option.discount` is a
  formatted string (e.g. `"-38%"`); `option.isSoldOut` guards a sold-out add.

### `deleteCartItem` — REMOVE a line item  ✅
- `sha256Hash`: `914b02bbaaaef8523256314f64b6939a55635e7757a350646ea788fdcde8326a`
- variables: `{ optionId }`   ·   response: `element[0].data.deleteCartItem`

### Checkout is HAND-OFF ONLY — there is **no** place-order mutation
Payment is native Apple/Google Pay / card / PayPal SDKs; there is **no replayable
place-order op**. After adding to cart, the tool returns the ready-to-pay URL
**`https://www.groupon.com/checkout/cart`** for the USER to complete payment. The
server NEVER attempts to place an order.

Also seen firing on an authenticated deal page (not implemented): `getUser`,
`Layout_GetCartSize`, `GetNotifications`, `GetInAppMessagesV2`, `getCustomerPhotos`,
`GetCustomerVideos`.
