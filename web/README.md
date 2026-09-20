# Rally web

Rally’s laptop/browser surface is a Vite + React + TypeScript PWA in `web/`. It shares the same user-facing model as the Android TV app while keeping browser-specific networking, storage, and playback at the edge.

## Run locally

```bash
cd web
npm install
npm run dev
```

The dev server listens on `http://127.0.0.1:4173` by default. Production checks:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

No Rally backend is required for the first vertical slice. Sports schedules come from ESPN’s public scoreboard APIs. IPTV/Stremio discovery runs directly in the browser against URLs entered under **Sources & settings**.

## Provider configuration

- **IPTV / Stalker:** enter the provider’s portal URL and the MAC address of a device/account you own or are authorized to use. Rally keeps the handshake token in memory only; it is not written to local storage.
- **Stremio:** enter one addon manifest URL per line. The addon must allow browser cross-origin requests and return a direct media URL for browser playback.
- Rally never invents channels, scores, subscriptions, or credentials. A source appears only after a configured provider returns it and the event matcher finds evidence.

## Browser limits

A browser cannot make every TV-provider stream playable. CORS, cookies, custom headers, HTTPS mixed-content rules, codec support, expiring URLs, geo-rights, DRM, and provider authorization can each stop discovery or playback. Rally surfaces the concrete failure and does not proxy, bypass DRM, or redistribute content.

HLS uses native playback where available and `hls.js` through Media Source Extensions elsewhere. External/web-only Stremio links are shown as not browser-playable rather than silently treated as video.

## Architecture

- `src/domain/`: pure event/source matching, quality ranking, provider validation, favorites, and playback diagnostics.
- `src/data/`: ESPN normalization, direct Stalker/Ministra browser calls, and Stremio manifest/catalog/stream discovery.
- `src/storage.ts`: local provider settings and favorite team IDs. Provider tokens are not persisted.
- `src/components/`: authored UI primitives, event/source cards, and the browser player.
- `src/App.tsx`: hash routes and the first vertical slice: home → live game → source discovery → playback diagnostics.

The web core deliberately remains TypeScript-local for this MVP. The Android module currently owns Android-specific Room, EncryptedSharedPreferences, Hilt, and Media3 details; extracting a Kotlin Multiplatform module would be a larger migration, not a prerequisite for this browser surface.
