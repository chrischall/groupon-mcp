# Changelog

## [1.1.1](https://github.com/chrischall/groupon-mcp/compare/v1.1.0...v1.1.1) (2026-09-24)


### Bug Fixes

* **deps:** bump dotenv in the production-majors group ([#113](https://github.com/chrischall/groupon-mcp/issues/113)) ([a60f046](https://github.com/chrischall/groupon-mcp/commit/a60f046c1d66fcf2d6d9b1b044c955b04e63a5aa))

## [1.1.0](https://github.com/chrischall/groupon-mcp/compare/v1.0.2...v1.1.0) (2026-09-24)


### Features

* confirm writes with a preview token instead of confirm: true ([#107](https://github.com/chrischall/groupon-mcp/issues/107)) ([63de30c](https://github.com/chrischall/groupon-mcp/commit/63de30cda2cd336114388f5cd23f130e8593d549))

## [1.0.2](https://github.com/chrischall/groupon-mcp/compare/v1.0.1...v1.0.2) (2026-09-23)


### Bug Fixes

* **cart:** report which lines were already removed when clear_cart fails partway ([#106](https://github.com/chrischall/groupon-mcp/issues/106)) ([d57bce4](https://github.com/chrischall/groupon-mcp/commit/d57bce4142a49057d2f25d81cbcfa456e50ecd3d)), closes [#104](https://github.com/chrischall/groupon-mcp/issues/104)
* stop false cart-add success, show option ids in get_deal, and give rate-limit retries a fresh timeout ([#103](https://github.com/chrischall/groupon-mcp/issues/103)) ([8c8fc6c](https://github.com/chrischall/groupon-mcp/commit/8c8fc6c510f72e030d77a5dc2b2da7ed14a889b5))

## [1.0.1](https://github.com/chrischall/groupon-mcp/compare/v1.0.0...v1.0.1) (2026-09-23)


### Bug Fixes

* **deps:** require zod ^4.6.5 to match @chrischall/mcp-utils 2.4.0 ([#102](https://github.com/chrischall/groupon-mcp/issues/102)) ([e80d786](https://github.com/chrischall/groupon-mcp/commit/e80d78619e572eb9e1a228b1c10d3b50ed2357de))
* **deps:** upgrade @chrischall/mcp-utils to 2.4.0 and @fetchproxy/* to 3.2.0 ([#100](https://github.com/chrischall/groupon-mcp/issues/100)) ([20ff2a0](https://github.com/chrischall/groupon-mcp/commit/20ff2a0468d4a3a85c7ed838283cf3c5249c348d))

## [1.0.0](https://github.com/chrischall/groupon-mcp/compare/v0.4.0...v1.0.0) (2026-09-20)


### Bug Fixes

* **deps:** raise the manifest node floor to match mcp-utils 1.0.0 ([#97](https://github.com/chrischall/groupon-mcp/issues/97)) ([334fc83](https://github.com/chrischall/groupon-mcp/commit/334fc832938e670d88c8bee9b290312bc3690ff8))
* **release:** cut the major the SDK v2 migration owed ([#99](https://github.com/chrischall/groupon-mcp/issues/99)) ([05a04a7](https://github.com/chrischall/groupon-mcp/commit/05a04a704057f3a951b099a374e8ef02d693f9a6))

## [0.4.0](https://github.com/chrischall/groupon-mcp/compare/v0.3.3...v0.4.0) (2026-09-17)


### ⚠ BREAKING CHANGES

* **mcp:** migrate server to SDK v2 ([#90](https://github.com/chrischall/groupon-mcp/issues/90))

### Features

* **mcp:** migrate server to SDK v2 ([#90](https://github.com/chrischall/groupon-mcp/issues/90)) ([b25511e](https://github.com/chrischall/groupon-mcp/commit/b25511e2712fa68a82eb13dde8f5e9cf8778cfd2))


### Bug Fixes

* **build:** resolve and verify Zod bundle alias ([#93](https://github.com/chrischall/groupon-mcp/issues/93)) ([d9b1371](https://github.com/chrischall/groupon-mcp/commit/d9b1371c2700a002861baeab1a6053ae47cfc78e))

## [0.3.3](https://github.com/chrischall/groupon-mcp/compare/v0.3.2...v0.3.3) (2026-09-15)


### Bug Fixes

* **deps:** @fetchproxy/server 3.0.1 — capped peer frames, logged load drops, atomic identity writes ([#87](https://github.com/chrischall/groupon-mcp/issues/87)) ([bff5b5a](https://github.com/chrischall/groupon-mcp/commit/bff5b5aaee878ec3b7125d37e500e81317782aba))

## [0.3.2](https://github.com/chrischall/groupon-mcp/compare/v0.3.1...v0.3.2) (2026-09-14)


### Bug Fixes

* **deps:** @fetchproxy/server 2.11.3, so the hosted extension pin persists ([#82](https://github.com/chrischall/groupon-mcp/issues/82)) ([ab25db0](https://github.com/chrischall/groupon-mcp/commit/ab25db0efbd2d46db607db686d886a1c7f9372b8))
* **deps:** @fetchproxy/server 3.0.0 — protocol v4 (forward secrecy, AAD over the frame) ([#86](https://github.com/chrischall/groupon-mcp/issues/86)) ([8ad94cd](https://github.com/chrischall/groupon-mcp/commit/8ad94cd88f9af9015695dd486e11daa3c71247d8))
* **deps:** bump @fetchproxy/bootstrap ([#85](https://github.com/chrischall/groupon-mcp/issues/85)) ([86b9b2f](https://github.com/chrischall/groupon-mcp/commit/86b9b2f6eade15c96f64d02a9d67d75771ba4636))

## [0.3.1](https://github.com/chrischall/groupon-mcp/compare/v0.3.0...v0.3.1) (2026-09-10)


### Bug Fixes

* **deps:** @fetchproxy/server 2.10.0 and @chrischall/mcp-utils 0.26.1 ([#79](https://github.com/chrischall/groupon-mcp/issues/79)) ([3b8bbbb](https://github.com/chrischall/groupon-mcp/commit/3b8bbbb97c7c873b5cc60272635d0c67da5d2a85))
* **deps:** bump hono from 4.13.0 to 4.13.7 ([#77](https://github.com/chrischall/groupon-mcp/issues/77)) ([152adec](https://github.com/chrischall/groupon-mcp/commit/152adecac058f86135aeb621534305d9b4a3783b))
* **deps:** declare the peer floors mcp-utils 0.26.1 requires ([#80](https://github.com/chrischall/groupon-mcp/issues/80)) ([a6e807f](https://github.com/chrischall/groupon-mcp/commit/a6e807f6c89b9afc61495a7b77a7185af90ea649))

## [0.3.0](https://github.com/chrischall/groupon-mcp/compare/v0.2.0...v0.3.0) (2026-09-04)


### Features

* **tools:** compact by default, on the projection this repo already had ([#63](https://github.com/chrischall/groupon-mcp/issues/63)) ([46ba43b](https://github.com/chrischall/groupon-mcp/commit/46ba43ba112930eccb3d6842d685fba4f85fa59f))


### Bug Fixes

* **build:** restore the literal em dash in the package description ([#66](https://github.com/chrischall/groupon-mcp/issues/66)) ([70326bd](https://github.com/chrischall/groupon-mcp/commit/70326bd58373df4c686583ba902e988bae8ddfd7))
* **deps:** pick up @chrischall/mcp-utils 0.23.2 ([#68](https://github.com/chrischall/groupon-mcp/issues/68)) ([62ee38c](https://github.com/chrischall/groupon-mcp/commit/62ee38c7a99e455ef013e126f9fe7ce2e281943e))
* **tools:** stop advertising a compact=true parameter that no longer exists ([#69](https://github.com/chrischall/groupon-mcp/issues/69)) ([bb92c24](https://github.com/chrischall/groupon-mcp/commit/bb92c246806f29924fdb4d466a522fcb76f1b274))


### Documentation

* **mint:** declare GROUPON_CACHE_TTL in mint.yaml ([#57](https://github.com/chrischall/groupon-mcp/issues/57)) ([7325212](https://github.com/chrischall/groupon-mcp/commit/7325212c3ae5b26dc43f16623bfe7d4ce208ba41))

## [0.2.0](https://github.com/chrischall/groupon-mcp/compare/v0.1.7...v0.2.0) (2026-08-29)


### Features

* **deps:** take @fetchproxy/server 2.2.0 so the concentrator can bind its sandbox address ([#47](https://github.com/chrischall/groupon-mcp/issues/47)) ([e3e9b8a](https://github.com/chrischall/groupon-mcp/commit/e3e9b8a7ac8f403249d8ef17bd552c0daf0d0dbd))

## [0.1.7](https://github.com/chrischall/groupon-mcp/compare/v0.1.6...v0.1.7) (2026-08-28)


### Bug Fixes

* **egress:** declare only the hosts the server process dials in mint.yaml ([#45](https://github.com/chrischall/groupon-mcp/issues/45)) ([d209a1a](https://github.com/chrischall/groupon-mcp/commit/d209a1a422afb240e94d683c46487ee1ddcb8258))

## [0.1.6](https://github.com/chrischall/groupon-mcp/compare/v0.1.5...v0.1.6) (2026-08-27)


### Documentation

* npm test now typechecks before running vitest ([#42](https://github.com/chrischall/groupon-mcp/issues/42)) ([8f6b6c9](https://github.com/chrischall/groupon-mcp/commit/8f6b6c95fcbbb41e2b55598ba89f8aefd8551ef0))
* **readme:** npm test now typechecks before running vitest ([#44](https://github.com/chrischall/groupon-mcp/issues/44)) ([0c0c22d](https://github.com/chrischall/groupon-mcp/commit/0c0c22de9e4500cd6efc27e173bc44619b4b6c51))

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
