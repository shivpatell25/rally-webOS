
<img src="Rally_Brand_Kit/02_Wordmark/rally_wordmark_color_transparent_1024.png" alt="Rally wordmark" width="320">

Rally is a sports-first TV application for **Android TV / Google TV** and **LG webOS**. It combines ESPN schedules and live data with the user’s authorized Stalker/Ministra IPTV subscription and configured Stremio addons, then presents matched streams in the same cinematic, remote-first interface on both platforms.

## Features

- Live and upcoming NFL, NBA, MLB, NHL, soccer, and college events
- Automatic matching between events, IPTV channels, and Stremio streams
- Searchable IPTV browser with categories, channel artwork, and guide information
- Event details, league centers, team hubs, favorites, and ESPN highlights
- Full-screen HLS playback, source switching, diagnostics, and up to four-stream Multi-View
- Onboarding and six-section settings for sources, sports, teams, alerts, viewing, and support
- D-pad and media-key navigation designed for ten-foot TV interfaces
- Local provider configuration; Rally ships no subscriptions, credentials, or streams

## Supported platforms

| Platform | Implementation | Package |
| --- | --- | --- |
| Android TV / Google TV | Kotlin, Jetpack Compose for TV, Media3, Room, Hilt | APK |
| LG webOS TV | React, TypeScript, Vite, native webOS web runtime | IPK |

The Android Compose application remains the product and UX source of truth. The LG application in [`web/`](web/) ports that hierarchy to webOS with 1920×1080 TV-safe layout, LG remote focus handling, Back/media keys, lifecycle refresh, native HLS playback, and webOS packaging.

## LG webOS

### Requirements

- Node.js 18 or newer
- npm
- An LG webOS TV in Developer Mode, or the LG webOS TV emulator
- The TV and workstation on the same network for device installation

Install dependencies and run the development surface:

```shell
cd web
npm install
npm run dev
```

The development server listens on `http://127.0.0.1:4173`.

### Build the IPK

```shell
cd web
npm run package:webos
```

This runs the TypeScript/Vite production build and LG’s `ares-package`, producing:

```text
web/com.shiv.rally_1.0.0_all.ipk
```

The webOS application ID is `com.shiv.rally`.

### Install on an LG TV

Configure a Developer Mode TV once:

```shell
cd web
npx ares-setup-device
```

Then install and launch Rally, replacing `<device>` with the name configured above:

```shell
npx ares-install --device <device> com.shiv.rally_1.0.0_all.ipk
npx ares-launch --device <device> com.shiv.rally
```

Inspect configured devices or remove the package with:

```shell
npx ares-setup-device --list
npx ares-install --device <device> --remove com.shiv.rally
```

### webOS checks

```shell
cd web
npm run typecheck
npm test
npm run lint
npm run build
```

See [`web/README.md`](web/README.md) for provider behavior, web-runtime constraints, and code layout.

## Android TV

### Requirements

- Android Studio
- JDK 17
- Android SDK 34

Build and verify from the repository root:

```shell
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Build the shrunk release package:

```shell
./gradlew assembleRelease
```

Release signing uses `RALLY_KEYSTORE_PATH`, `RALLY_KEYSTORE_PASSWORD`, `RALLY_KEY_ALIAS`, and `RALLY_KEY_PASSWORD`. Private signing material is not stored in Git. See [`RELEASE.md`](RELEASE.md).

## Provider setup

Open **Settings → Sources** and enter the portal URL and MAC address supplied by an IPTV provider you are authorized to use. Add one Stremio addon manifest URL per line.

Prefer HTTPS portals. Android supports legacy HTTP providers, but cleartext traffic can expose credentials and viewing activity. LG webOS additionally applies web-runtime CORS, cookie, mixed-content, codec, DRM, geo-rights, and authorization policies. A stream that works through Android Media3 is not automatically playable in the LG web runtime.

Rally does not proxy streams, bypass DRM, or redistribute content. Provider tokens remain in memory; provider configuration and favorites are stored locally on the device.

## Architecture

### Android

- Presentation: Jetpack Compose for TV, MVVM, lifecycle-aware `StateFlow`
- Domain: sports, stream, channel, quality, and matching models/use cases
- Data: ESPN, Stalker/Ministra, Stremio, Room, encrypted preferences
- Playback: AndroidX Media3 ExoPlayer with bounded single-player and Multi-View resources
- Dependency injection: Hilt

### LG webOS

- Presentation: React TV surfaces aligned with the Android navigation and layout hierarchy
- Domain: deterministic TypeScript validation, matching, quality ranking, favorites, and diagnostics
- Data: ESPN normalization plus direct Stalker/Ministra and Stremio adapters
- Platform: LG remote spatial navigation, Back/media keys, resume handling, and initial focus
- Playback: native LG HLS where available; lazy-loaded `hls.js` fallback through Media Source Extensions
- Packaging: `public/appinfo.json` and `@webos-tools/cli`

## Repository layout

```text
app/                 Android TV application
web/                 LG webOS application and packaging
Rally_Brand_Kit/     Shared approved brand assets
docs/                Architecture and UI parity references
```

## Performance

- Sports content appears without waiting for the IPTV catalog
- Duplicate requests are coalesced and short-lived caches reduce repeated network work
- Bundled backdrops avoid unnecessary image-pipeline work
- Playback buffers and Android Multi-View tracks are bounded for TV hardware
- The LG initial bundle excludes `hls.js`; it loads only when native HLS is unavailable
- Android release builds enable code and resource shrinking

## Privacy and content

Rally does not ship IPTV credentials or content subscriptions. Tokens are not written to logs, release HTTP logging is disabled, and third-party playback headers are allowlisted. Users are responsible for using providers and addons they are authorized to access.

See the full [privacy policy](PRIVACY.md) and [content/provider disclosure](CONTENT_SOURCES.md).

Credit to Jacob Halladay for testing the alpha tvOS `.ipa`.
