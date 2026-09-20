# Rally for LG webOS

Rally’s LG TV application is a Vite + React + TypeScript webOS app in `web/`. The Android TV Compose surface is its UX and feature source of truth; LG remote input, lifecycle, packaging, storage, networking, and playback form the platform edge.

## Run locally

```bash
cd web
npm install
npm run dev
```

The dev server listens on `http://127.0.0.1:4173` by default. Build the installable LG webOS package with:

```bash
npm run package:webos
```

The command runs the production TypeScript/Vite build and creates `com.shiv.rally_1.0.0_all.ipk`. Other checks are `npm run typecheck`, `npm test`, and `npm run lint`.

No Rally backend is required. Sports schedules and highlights come from ESPN’s public APIs. IPTV/Stremio discovery runs directly on the TV against URLs entered under **Settings → Sources**.

## Provider configuration

- **IPTV / Stalker:** enter the provider’s portal URL and the MAC address of a device/account you own or are authorized to use. Rally keeps the handshake token in memory only; it is not written to local storage.
- **Stremio:** enter one addon manifest URL per line. The addon must allow browser cross-origin requests and return a direct media URL for browser playback.
- Rally never invents channels, scores, subscriptions, or credentials. A source appears only after a configured provider returns it and the event matcher finds evidence.

## LG webOS limits

LG’s web runtime cannot make every provider stream playable. CORS, cookies, custom headers, cleartext restrictions, codec support, expiring URLs, geo-rights, DRM, and provider authorization can stop discovery or playback. Rally surfaces the concrete failure and does not proxy, bypass DRM, or redistribute content.

HLS uses LG’s native playback where available and loads `hls.js` through Media Source Extensions only when needed.

## Architecture

- `src/domain/`: pure event/source matching, quality ranking, provider validation, favorites, and playback diagnostics.
- `src/data/`: ESPN normalization, direct Stalker/Ministra browser calls, and Stremio manifest/catalog/stream discovery.
- `src/storage.ts`: local provider settings and favorite team IDs. Provider tokens are not persisted.
- `src/components/`: TV UI primitives, home/event surfaces, IPTV browser, highlights, player, and four-slot Multi-View.
- `src/platform.ts`: LG remote spatial navigation, Back/media keys, resume handling, and initial focus.
- `src/App.tsx`: onboarding and Android-aligned hash routes for Home, Live TV, leagues, highlights, teams, settings, events, playback, and Multi-View.
- `public/appinfo.json`: LG webOS application identity, 1920×1080 resolution, icons, and Back handling.
