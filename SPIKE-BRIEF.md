# Route spike — brief

Throwaway spike for the TEKO *Mobile Apps I* Transferarbeit (idea: **PawTrack**, a dog-walk companion). The code is **not** part of the submission. Chat with the user in English; any German text follows Swiss orthography (no ß).

## Question to answer

Can PawTrack record a walking route on the user's **iPhone while the screen is locked**, using an Expo **development/release build installed inside LiveContainer** (sideloaded via SideStore), built **unsigned on a GitHub Actions macOS runner**? And as fallback: how usable is **foreground-only** recording in Expo Go with a "pocket mode"?

The user's machine is Fedora Linux (no Mac, no paid Apple Developer account). Development happens locally, not in Codespaces.

## Verified facts (05.11.2026, sources: Expo SDK 58 docs, LiveContainer repo)

- `watchPositionAsync` only delivers updates while the app is in the foreground.
- Background location on iOS needs `UIBackgroundModes: location` in Info.plist. expo-location config plugin: `isIosBackgroundLocationEnabled: true` sets it, but config-plugin properties only take effect in a **new native build**, never in Expo Go.
- Background updates use `Location.startLocationUpdatesAsync(taskName, options)` + `TaskManager.defineTask` at top level; iOS needs the **Always** permission (`requestBackgroundPermissionsAsync`). `LocationTaskOptions.showsBackgroundLocationIndicator` (iOS) shows the blue indicator. `Location.isBackgroundLocationAvailableAsync()` exists.
- `LocationOptions`: `accuracy` (`High` ≈ 10 m, `Balanced` ≈ 100 m), `distanceInterval` (m), `timeInterval` is Android-only.
- In Expo Go: `expo-keep-awake`, `expo-brightness`, `react-native-svg`, `react-native-maps` are included. `Brightness.setBrightnessAsync` on iOS persists until the device locks, then reverts.
- LiveContainer's host `LiveContainer/Info.plist` (main branch) declares `UIBackgroundModes` including `location`, all `NSLocation*UsageDescription` keys, `NSLocalNetworkUsageDescription`, `NSAllowsArbitraryLoads`, **and `NSLocationDefaultAccuracyReduced = true`** (approximate location by default → user must enable *Precise Location* for LiveContainer in iOS Settings). README: guest entitlements are not applied; permissions are global for all guest apps; without JIT, guests are signed with LiveContainer's certificate.
- GitHub-hosted standard runners are free in **public** repositories.
- Reference project for versions: `../teko-mobile-pitch-spike/` (Expo `~58.0.23`, React Native `0.88.1`, TypeScript `~6.0.3`). Read its `AGENTS.md` and match its conventions.

## Deliverables

1. **Expo app (TypeScript, SDK 58)** in this folder, one or two screens, minimal UI:
   - Start / Stop walk. Status line shows the active **level**: `Hintergrund` (background available + Always granted) or `Vordergrund` (fallback), with the reason when falling back (Expo Go, permission only "While Using", denied).
   - Level 2 (background): `startLocationUpdatesAsync` with `accuracy: High` (or `BestForNavigation`), `distanceInterval: 10`, `activityType: Fitness`, `pausesUpdatesAutomatically: false`, `showsBackgroundLocationIndicator: true`. The task writes points to persistent storage (the UI may be suspended).
   - Level 1 (foreground): `watchPositionAsync` with the same accuracy/distance, `AppState` marks gaps when the app leaves the foreground.
   - **Pocket mode**: black screen, brightness 0, keep-awake, long-press to leave; restore brightness on exit.
   - Live counters: points, gaps (> 60 s between points), median accuracy, battery level at start/end (use an Expo module available in Expo Go; verify in the docs before choosing).
   - Result view: route as an SVG polyline (no map tiles), distance (haversine over recorded segments only), duration, gaps, median accuracy, battery delta, and a reduced-accuracy warning when accuracy is consistently coarse.
   - Export the session as JSON via the share sheet for later analysis.
   - `app.json`: expo-location plugin with `isIosBackgroundLocationEnabled: true` and German permission texts.
2. **GitHub Actions workflow** (`.github/workflows/ios-unsigned.yml`): macOS runner, Node setup, `npm ci`, `npx expo prebuild -p ios --clean`, CocoaPods install, `xcodebuild` **Release** for `iphoneos` with `CODE_SIGNING_ALLOWED=NO` (JS bundle embedded, so it runs without Metro), package `Payload/<App>.app` into an `.ipa`, upload as artifact. Manual trigger (`workflow_dispatch`) plus push to main. A dev-client build is optional and only after the Release IPA works.
3. **Local checks before CI**: `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform ios` (bundle builds). Do not claim the CI or device test passed unless you observed it.
4. **README.md** (German, short): what the spike tests, how to start it in Expo Go (level 1), how to get the IPA from Actions, install it in LiveContainer, enable *Precise Location* and *Always*, and the test protocol below.

## Test protocol (the user runs it on the device)

| Test | Setup | Pass |
|---|---|---|
| A — background | IPA in LiveContainer, Precise Location on, Always granted, phone locked, 15-minute walk | No gap > 60 s, median accuracy ≤ 20 m, battery delta noted |
| B — foreground | Expo Go, pocket mode, 20-minute walk | Gaps only where the app was left; battery delta noted |
| C — fallbacks | Deny location; grant only "While Using" | Defined status text, no crash, level shown correctly |

## Rules

- **Ask the user before** creating any GitHub repository (public is needed for free macOS minutes; ask public vs private), before pushing, and before anything that costs money. Use `gh` only after approval.
- Do not edit the `teko-hf` repository. When done, report results and **draft** (do not write) a German KI-log entry for `teko-hf/sem5/mobile-apps-and-cross-platform/project/ai-usage-log.md` in the existing format (Unterstützung durch KI / Übernommen / Angepasst / Entscheidung des Benutzers / Auswirkung).
- No secrets in the repository. Mark anything not verified as an assumption.
