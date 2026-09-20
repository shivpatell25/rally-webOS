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

No Rally backend is required. Sports schedules and highlights come from ESPN’s public APIs. IPTV/Stremio discovery first uses the TV browser and, in the packaged IPK, retries blocked metadata requests through Rally’s local webOS service.

## Provider configuration

- **IPTV / Stalker:** enter the provider’s portal URL and the MAC address of a device/account you own or are authorized to use. Optional serial/device IDs support portals that require them. Rally keeps the handshake token in memory only; it is not written to local storage.
- **Stremio:** enter one addon manifest URL per line. The addon must return a direct browser-playable media URL. The packaged service can fetch blocked manifest/catalog metadata, but media still plays directly under LG’s codec, CORS, header, and DRM constraints.
- Rally never invents channels, scores, subscriptions, or credentials. A source appears only after a configured provider returns it and the event matcher finds evidence.

## LG webOS limits

LG’s web runtime cannot make every provider stream playable. CORS, cookies, custom headers, cleartext restrictions, codec support, expiring URLs, geo-rights, DRM, and provider authorization can stop discovery or playback. Rally surfaces the concrete failure and does not proxy media, bypass DRM, or redistribute content.

HLS uses LG’s native playback where available and loads `hls.js` through Media Source Extensions only when needed. The packaged service is limited to provider metadata and link resolution.

## Architecture

- `src/domain/`: event/source matching, personalized home ordering, quality ranking, recovery selection, and playback diagnostics.
- `src/data/`: ESPN normalization, Stalker/Ministra sessions and EPG, and Stremio manifest/catalog/stream discovery.
- `src/storage.ts`: versioned preferences, local provider configuration, and short-lived route-safe playback candidates. Provider tokens are not persisted.
- `src/components/`: remote-first home, league/team/event, IPTV, highlights, shared player, Game View, and capability-scaled Multi-View surfaces.
- `src/platform.ts`: deterministic LG remote focus zones, Back/media keys, resume handling, and capability detection.
- `src/App.tsx`: onboarding and Android-aligned durable routes for Home, Live TV, leagues, highlights, teams, settings, events, playback, and Multi-View.
- `public/appinfo.json`: LG webOS application identity, 1920×1080 resolution, icons, and Back handling.
