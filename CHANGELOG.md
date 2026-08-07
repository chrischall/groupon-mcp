# Changelog

## [0.1.5](https://github.com/chrischall/groupon-mcp/compare/v0.1.4...v0.1.5) (2026-08-07)


### Bug Fixes

* **connector:** finish the retirement sweep ([#32](https://github.com/chrischall/groupon-mcp/issues/32)) ([f75021d](https://github.com/chrischall/groupon-mcp/commit/f75021d01d701791d7a46f75b7a53f86f29deb93))


### Refactor

* **connector:** retire the standalone Cloudflare Worker connector ([#29](https://github.com/chrischall/groupon-mcp/issues/29)) ([4782755](https://github.com/chrischall/groupon-mcp/commit/4782755ed3fae2e9b3378dfad85a90465d51d4b1))

## [0.1.4](https://github.com/chrischall/groupon-mcp/compare/v0.1.3...v0.1.4) (2026-08-06)


### Bug Fixes

* **deps:** move to @fetchproxy/server 2.0.0 for the v3 handshake ([#27](https://github.com/chrischall/groupon-mcp/issues/27)) ([0645f0c](https://github.com/chrischall/groupon-mcp/commit/0645f0cf361d2937cb3e6d12c499f2e685a9c96e))

## [0.1.3](https://github.com/chrischall/groupon-mcp/compare/v0.1.2...v0.1.3) (2026-08-03)


### Bug Fixes

* **web-client:** re-lift an expired browser session instead of wedging ([#18](https://github.com/chrischall/groupon-mcp/issues/18)) ([5b3a241](https://github.com/chrischall/groupon-mcp/commit/5b3a241d90188fe14d1e9754ca3b7d698f01d35a))
* **web-client:** re-lift on the post-429 401 and drop a dead cookie ([#21](https://github.com/chrischall/groupon-mcp/issues/21)) ([5f2977d](https://github.com/chrischall/groupon-mcp/commit/5f2977d4e3ed513d8dc046cc9b6b9acc0e6ea142)), closes [#19](https://github.com/chrischall/groupon-mcp/issues/19)


### Refactor

* **web-client:** drop the unused settleAuthFailure parameter ([#23](https://github.com/chrischall/groupon-mcp/issues/23)) ([9ddb138](https://github.com/chrischall/groupon-mcp/commit/9ddb138a66d71745c2a43b120b90a05c481bb765)), closes [#22](https://github.com/chrischall/groupon-mcp/issues/22)

## [0.1.2](https://github.com/chrischall/groupon-mcp/compare/v0.1.1...v0.1.2) (2026-07-30)


### Bug Fixes

* **deps:** bump @fetchproxy/* to 1.7.0 and @chrischall/mcp-utils to 0.14.0 ([#13](https://github.com/chrischall/groupon-mcp/issues/13)) ([ac97260](https://github.com/chrischall/groupon-mcp/commit/ac9726025a3891c24fcd43f95ee3e2aead618bf0))

## [0.1.1](https://github.com/chrischall/groupon-mcp/compare/v0.1.0...v0.1.1) (2026-07-27)


### Bug Fixes

* **cart:** match option ids by value, not by substring of the whole cart ([#9](https://github.com/chrischall/groupon-mcp/issues/9)) ([d53bd9f](https://github.com/chrischall/groupon-mcp/commit/d53bd9fe6c36a2cd0a2a61b9e62b49a1c769c305))

## 0.1.0 (2026-07-27)


### Features

* add groupon_get_deal and groupon_list_categories read tools ([7ddb41b](https://github.com/chrischall/groupon-mcp/commit/7ddb41b3f7d9da7ff453ebe238a490e5f770fbb5))
* add read-only Cloudflare Worker connector for claude.ai reach ([d2523a9](https://github.com/chrischall/groupon-mcp/commit/d2523a9cb8c43b1ee6b7afe48b79decdaea73747))
* confirm-gated cart/purchase tools (cart-prep + hand-off) with cookie-bootstrap auth ([#3](https://github.com/chrischall/groupon-mcp/issues/3)) ([c57da54](https://github.com/chrischall/groupon-mcp/commit/c57da549587e3a144f1fde7048568e9fec0da7fb))
* Groupon read-path MVP — groupon_search_deals via /mobilenextapi/graphql ([ea807a0](https://github.com/chrischall/groupon-mcp/commit/ea807a098103e8191a206356b3882e40b3dee2b2))


### Documentation

* add groupon curl skill (lightweight shell-out deliverable) ([3abd4ae](https://github.com/chrischall/groupon-mcp/commit/3abd4ae64307fa0b748c32c05c0b08a4bbffacca))
