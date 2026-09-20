# Rally web architecture

## Goal

Provide a laptop/browser surface that preserves Rally's Android TV visual language: the same ambient broadcast desk, matchup hero, compact sports shelves, navigation hierarchy, and brand assets. It adapts only input, sizing, and browser source/playback boundaries.

## Boundary

The web app is a static client under `web/`. It has no Rally backend and no provider proxy. This keeps the first slice deployable as static assets and prevents Rally from becoming a credential or content relay.

### Domain core

`web/src/domain/core.ts` contains deterministic policies:

- normalize and validate IPTV/Stremio configuration;
- match channel/addon metadata to an ESPN event;
- parse and rank quality evidence;
- preserve direct-vs-external playback distinctions;
- toggle local team favorites;
- turn browser/network failures into actionable diagnostics.

These functions have no React, browser storage, Android, or provider transport dependency and are the first candidates for later cross-platform extraction if the product needs it.

### Data edge

- `espn.ts` normalizes public scoreboard and summary responses into `SportEvent` records.
- `stalker.ts` performs a browser-side handshake, channel lookup, and stream resolution with an in-memory token.
- `stremio.ts` reads addon manifests/catalogs/streams and rejects external links that cannot represent direct browser media.
- `sources.ts` runs configured adapters and performs an optional browser CORS/HTTP preflight.

Unknown provider fields are handled at the network boundary. Diagnostics redact query credentials and do not include provider secrets in logs or local storage.

### UI and routing

Hash routes keep the static deployment simple:

- `#home`
- `#live`
- `#search`
- `#favorites`
- `#sources`
- `#event/<event-id>`
- `#play/<event-id>/<candidate-id>`

The shell uses the Android-aligned top bar on desktop and a bottom navigation adaptation on narrow screens. The visual system is grounded in the Rally brand kit: deep navy, slate, graphite, off-white, Rally lime, mint, and cyan. Team marks and scores come from live ESPN responses; there are no seeded fake games.

## Android coexistence

The existing `:app` module remains the Android TV product. This MVP does not rewrite its Room, Hilt, encrypted preferences, Media3, or Leanback behavior. A future shared module should start from pure models/matching/ranking/validation, then add platform adapters; it should not pull browser fetch, localStorage, or HLS.js into the Android source set.

## Verification

Web verification is package-local:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Manual smoke verification must load the dev server in a real browser, inspect the desktop and mobile shell, navigate through `#home`, `#live`, `#search`, `#sources`, and an event detail route, and exercise the empty/error states. Authorized provider playback remains environment-dependent and must be reported as unverified unless a real provider account and playable URL are supplied.
