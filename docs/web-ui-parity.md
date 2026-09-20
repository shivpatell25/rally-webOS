# Rally webOS parity contract

## Sources of truth

- Behavior and data semantics: the Android source under `app/src/main/java/com/shiv/rally/`.
- Visual hierarchy and focus treatment: the 3840×2160 emulator captures in `docs/android-reference/`.
- Capture metadata and known conflicts: `docs/android-reference/catalog.json`.
- Platform substitutions: native LG webOS lifecycle, media, pointer, packaging, and store behavior.

When source and an installed Android capture disagree, repository source wins for behavior. The capture remains the appearance reference and the conflict must stay recorded.

## Television invariants

- Logical stage is always 1920×1080 and scales uniformly as one 16:9 unit.
- No responsive reflow, mobile navigation, browser page scrolling, or viewport-specific content substitution.
- Every operation is reachable by D-pad and Magic Remote pointer.
- Pointer activation focuses the same control used by D-pad navigation.
- Focus movement is deterministic: explicit targets, ordered rows, ordered columns, and fixed grids. Screen geometry never decides the next target.
- Focus uses a cyan outline. Primary focused actions retain the Android white-fill treatment.
- Horizontal shelves page by stable item counts rather than free browser scrolling.
- Real provider and public sports states are shown honestly; no seeded scores, channels, or playable fallbacks.

## Route contract

| Route | Required surface | Required states and transitions |
| --- | --- | --- |
| Onboarding | Wordmark, promise, three numbered cards, setup action, service disclaimer | Continue opens Sources; Back returns Home |
| Home | Fixed hero, combined Live/Upcoming shelf, By Sport shelf | Hero action opens Event Center; shelf cards page four at a time; sport cards page five at a time |
| Live TV | Category rail, channel count, channel search, channel grid | Loading, populated, no channels, provider error; channel opens Player |
| Event Center | Score hero, broadcast action, saved-team action, matchup stats, leaders, analytics | Summary loading merges official data; Choose Broadcast opens picker; empty picker links to Sources |
| Leagues | Five-card league directory | Card opens League Center; paging preserves focus |
| League Center | Header, Games, Standings, Playoffs, date navigation | Tabs retain league context; event cards open Event Center |
| Highlights | Five-card editorial row | Empty state when no official clips; clip opens Player |
| My Teams | Following cards and Games for You | Empty state links to team selection; team card opens Team Center |
| Team Center | Team header, Overview, Games, Roster, Remove | Removal returns My Teams; event cards open Event Center |
| Search | Global query, TV keyboard, grouped games/teams/leagues/channels/addons | Empty query, searching, grouped results, zero results |
| Settings | Sources, Sports, Teams, Alerts, Viewing, Support sidebar | Down changes section; Select opens section; configuration persists locally |
| Player | Video, score bug, HUD, source picker, Game View | Loading, playing, stalled, recovery, error, ended; Back closes overlays before leaving playback |
| Multi-View | Capability-limited 1–4 slots, active audio slot, source picker, layouts and slot actions | Add, replace, swap, promote, mute, remove, full screen; unsupported slot counts are never offered |
| Score saver | Moving brand and live/upcoming score grid | Five-minute idle activation; any key or pointer action dismisses |

## Android tokens

| Token | Value / behavior |
| --- | --- |
| Deep background | `#05080F` |
| Slate | `#0F1724` |
| Graphite | `#202834` |
| Primary text | `#F5F7FA` |
| Rally lime | `#EAFB78` |
| Rally mint | `#B8F3C7` |
| Rally cyan | `#6FCFF6` |
| Live red | `#FF453A` |
| Ambient | `rally_ambient_background_v5.png` with navy scrims |
| Hero radius | 12 logical pixels |
| Card radius | 10 logical pixels |
| Control radius | 8 logical pixels |
| Safe horizontal padding | 46 logical pixels |
| Focus | cyan 2px border, 1.025 card scale, 150ms easing |
| Display font | Sora variable |
| Body font | Inter variable |

## Platform substitutions

- Android Media3 becomes native webOS video playback where supported, with HLS.js only when Media Source support is present and native HLS is unavailable.
- Android lifecycle callbacks become `visibilitychange`, `pageshow`, and webOS application lifecycle handling.
- Android TV remote input becomes LG key codes plus standard keyboard events.
- Android touch behavior becomes Magic Remote pointer focus and activation.
- Android self-update UI does not transfer to the Content Store build. Support exposes installed release information; LG manages store updates.
- Provider network requests use direct access first and the packaged Luna service only when webOS browser restrictions require it.

## Acceptance evidence

A route is complete only when:

1. its 1920×1080 capture matches the corresponding Android composition;
2. its D-pad trace reaches every action without geometry-based focus selection;
3. pointer activation produces the same state transition;
4. loading, empty, populated, and error states are exercised where applicable;
5. Back and lifecycle resume preserve a valid route and focus target.
