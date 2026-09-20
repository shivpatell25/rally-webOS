# Rally web UI parity

## Source of truth

The Android TV Compose surface remains the visual source of truth. The web surface adapts its input model for mouse, keyboard, touch, and browser sizing; it does not create a second brand system.

## Android TV structure inspected

`MainActivity` composes `RallyAmbientSurface` around the navigation graph. When the route is not onboarding or playback, `RallyTopBar` stays at the top and contains:

- the Rally color wordmark at left;
- a centered segmented nav: `HOME`, `LIVE`, `LEAGUES`, `HIGHLIGHTS`, `MY TEAMS`;
- search and settings icon actions at right.

`HomeScreen` uses this hierarchy:

1. full-screen ambient Rally background;
2. featured matchup hero (`HomeDashboardHero`), with sport artwork, dark scrims, live/featured pill, teams, scores/status, venue/context, and primary/secondary actions;
3. compact `LIVE / UPCOMING` shelf, with four-item TV pages and 86dp editorial game cards;
4. compact `BY SPORT` shelf, with 94dp editorial league cards and league marks;
5. focus-driven card borders/scale and D-pad transitions between hero and shelves.

Android source files reviewed:

- `app/src/main/java/com/shiv/rally/MainActivity.kt`
- `presentation/common/RallyChrome.kt`
- `presentation/home/HomeScreen.kt`
- `presentation/theme/AppleTvTheme.kt`
- `presentation/theme/Theme.kt`
- `presentation/theme/RallyLayout.kt`
- `presentation/league/LeaguesScreen.kt`
- `presentation/highlights/HighlightsScreen.kt`

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
| Ambient | `rally_ambient_background_v5.png` with navy vertical/horizontal scrims |
| Hero radius | 12dp |
| Card radius | 10dp |
| Control radius | 8dp |
| TV safe horizontal padding | 46dp |
| Home content padding | 22dp horizontal, 4dp top, 7dp bottom |
| Home hero | 202dp high |
| Live shelf | 112dp high; cards 86dp high; 13dp spacing |
| Sport shelf | 119dp high; cards 94dp high; 13dp spacing |
| Focus | cyan 2dp border, 1.025 card scale / 1.02 button scale, 150ms easing |
| Display font | Sora variable |
| Body font | Inter variable |

## Assets reused by web

Copied from the existing Android resources and Rally_Brand_Kit into `web/public/rally-assets/`:

- approved gradient mark and wordmark SVGs from `Rally_Brand_Kit/08_Vector_SVG`;
- `rally_ambient_background_v5.png`;
- `hero_editorial_{football,basketball,soccer,hockey,baseball}_v4.png`;
- `card_editorial_{football,basketball,soccer,hockey,baseball}_tv.jpg`;
- Android league marks (`league_mark_{nfl,nba,mlb,nhl,epl,ucl,laliga,seriea,mls}.png`);
- Android `sora_variable.ttf` and `inter_variable.ttf`.

The prior hand-authored web mark was replaced by the approved Rally mark SVG. No replacement logo or unrelated imagery is used.

## Laptop adaptation decisions

- Keep the Android top bar hierarchy; use horizontal pointer/keyboard navigation instead of D-pad focus routing.
- Keep the full-screen ambient surface, editorial hero, live/upcoming shelf, and by-sport shelf. Web cards can scroll horizontally rather than page four items at a time.
- Preserve the Android focus language for `:focus-visible`, hover, and active navigation: cyan/luminous border, subtle lift, dark glass surface.
- Keep search and settings as compact top-bar actions; keep the existing browser source/settings flows because they are web-only provider affordances.
- Preserve existing hash routes and add only the Android-aligned league/highlights destinations where the web data model can represent a real state. Highlights uses the same honest empty state when ESPN supplies no clips.
- Keep the web source/player boundary unchanged: direct browser playback, CORS checks, and provider diagnostics remain browser-specific.

## Verification evidence

- Baseline web screenshot: `docs/web-ui-before.png`.
- Final desktop screenshot: `docs/web-ui-after.png`.
- Final mobile screenshot: `docs/web-ui-after-mobile.png`.
- Comparison result: the web now uses the Android top-bar hierarchy, approved Rally wordmark/mark, ambient backdrop, sport hero artwork, 202dp-scale editorial hero treatment, compact `LIVE / UPCOMING` shelf, and `BY SPORT` shelf. Desktop horizontal scrolling replaces TV four-item paging; mobile uses a bottom nav and touch-sized controls.
- Android runtime screenshot was attempted but is blocked on this workstation: `adb devices` returned no connected emulator or physical device, and the SDK has no emulator binary/AVD. Android source and resource inspection are the available reference evidence until a device is supplied.
