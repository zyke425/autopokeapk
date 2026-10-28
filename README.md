# AutoPoke for Android

Current APK: **1.1.6** (version code 8), Android 8.0 or newer.

A standalone Android app that opens Facebook in its own WebView, clicks rendered **Poke back** controls, and refreshes to find incoming pokes. Native Start/Stop and Settings controls stay above the page.

**[Download AutoPoke-debug.apk](https://github.com/zyke425/autopokeapk/raw/refs/heads/main/downloads/AutoPoke-debug.apk)** · **[Build workflow](https://github.com/zyke425/autopokeapk/actions/workflows/android.yml)**

## Changes in 1.1.6

- Keep Facebook visible during ordinary loading/blank-page checks. Remove the opaque in-app loading cover shown in the reported screenshot; progress stays in the native status area above Facebook. Full repair/error notices are reserved for actual recovery or failures.
- Use one native 45-second deadline for reaching a usable Pokes view. Redirects and document-completion callbacks no longer reset or cancel it. A loaded-but-empty page cannot remain in the checking state indefinitely.
- Acknowledge readiness from the rendered Pokes view, including eligible rows waiting for the minimum click gap. Manual sign-in and the real Basic-mode offer cancel the loading deadline so the user can finish them.
- Recreate a failed mobile view using a mobile-browser compatibility agent on the first blank retry, preserving Android, Mobile and the installed Chrome engine version. A repeated blank still enables the existing software-rendering fallback. This does not impersonate Facebook Lite or enable carrier eligibility.
- Keep the same guarded Poke back/refresh engine in Basic and Data modes. Validate text-only action links, submit controls, full-page navigation and a new incoming poke after reload. No automatic Data-mode switch, purchase action or response-error cooldown is added.

Actual free-data access and Pokes availability remain controlled by Facebook and the carrier. The new tests are offline fixtures, not a live zero-balance carrier test.

## Earlier changes in 1.1.5

- Add a visible **Basic mode** setup button for Facebook's current carrier Basic mode / Basic mode plus flow, as shown on the user's Smart connection.
- Open setup on `https://www.facebook.com/` and Pokes on the same host with the mobile layout. Replace the previous legacy `free.facebook.com` setting with a **Carrier Basic mode / Basic mode plus** profile, enabled by default. This selects the browsing profile; it does not opt in or certify free access.
- Read Facebook's own visible carrier UI and report **Basic mode banner detected**, **Facebook shows Data mode**, **Basic offer: tap Continue on Facebook**, or **Basic mode: not confirmed**. Inspection works while the loop is stopped. No synthetic Facebook banner or billing confirmation is created.
- Leave carrier consent, data purchases and mode switching to the user. An actual out-of-data offer defers poke clicks and refreshes until the user handles it; the loop then resumes. No request-error hold or saved cooldown is reintroduced.
- Use an available cellular network in the Basic profile even if Android does not advertise general Internet capability. Do not require Android's Internet-validation probe to succeed.
- Keep Data saver optional and retain 1.1.4's blank-screen recovery and duplicate guards. Desktop layout is disabled while the Basic profile is selected.

### Set up carrier Basic mode

1. Turn on mobile data for the supported SIM and switch Wi-Fi off.
2. In AutoPoke, tap **Basic mode → Open Facebook setup**. Sign in within AutoPoke if needed; its session is separate from Chrome and Facebook Lite.
3. If Facebook presents the **You're out of data, but can still use Facebook** offer, read it and tap Facebook's **Continue** yourself. If no offer appears, the app cannot force one or enroll the SIM. You may inspect Facebook's own menu/mobile-network settings manually.
4. Look for Facebook's **Basic mode plus** banner. The native app reports that the banner was detected, not that carrier charges have been independently verified.
5. Tap **Open Pokes → Start loop**. Pokes must be available in the carrier-provided mode for the automation to work.

Facebook and the carrier control eligibility, quota, available features and charges. AutoPoke cannot provide free data or guarantee that an embedded WebView receives the same offer as Chrome/Facebook Lite. A loaded page or selected Basic profile alone is not proof of zero-rated access.

## Earlier changes in 1.1.4

- Remove the **“A Facebook request failed. Retrying…”** check entirely. The engine no longer reads request responses, interprets GraphQL errors, or creates restriction holds. Failed chat/feed requests cannot delay the poke-back loop.
- Discard saved retry deadlines and restriction flags from previous versions while preserving attempt totals and duplicate guards. An already stopped loop still needs **Start loop**.
- Wait only for requests associated with the current poke attempt. A request that never settles eventually refreshes with its duplicate guard retained, instead of stopping the loop.
- Recognize mobile pages whose hidden SPA content, redirected root route, or unfinished document previously concealed a blank/loading screen. Interactive pages can work without waiting for unrelated resources to finish loading.
- Check persistent white output in mobile mode even when the DOM reports a ready page. The check samples a small browser-only image in memory; it is immediately discarded and never saved or transmitted.
- Recover mobile pages first using the main Facebook host with the mobile user agent, then a replacement WebView with software rendering if blank output recurs. Desktop mode is not enabled by recovery. Cookie storage and click guards are preserved.
- Include the data-saving settings previously added in source-only 1.1.3: block network images, use a minimum 15-second refresh in Data saver, and optionally try the carrier Free Facebook address. Free access is unverified and depends on your carrier; this app cannot provide free data. Automatic recovery never switches the carrier-free setting to a standard address.

## Install and use

1. Download the APK and open it on your Android phone. Its SHA-256 checksum is in `downloads/SHA256SUMS`.
2. Update directly from **1.1.1, 1.1.2, 1.1.4, or 1.1.5**; these builds use the same saved development signing key. Builds **1.0.0/1.1.0** require uninstalling first because their signing key was lost before 1.1.1. Uninstalling removes local sign-in and settings.
3. Open the app and confirm the title says **AutoPoke 1.1.6**.
4. Sign in to Facebook inside the app, tap **Open Pokes**, and tap **Start loop**. Keep the app open.
5. Tap **Stop loop** to stop scanning and automatic refreshes.

No Tampermonkey or accessibility service is needed. This app uses its own Facebook session; it does not control the separate Facebook app or Chrome.

## Behavior and settings

| Setting or behavior | Details |
| --- | --- |
| Poke back | Only rendered, enabled English **Poke back** controls on a recognized Pokes view are eligible. Suggested **Poke** controls are ignored. |
| Refresh | Base delay is 5 seconds on a new installation, editable from 1 to 300 seconds. Adaptive idle refresh increases up to the larger of 60 seconds or the base delay. Data saver imposes a 15-second minimum. Network/rendering time is additional. |
| Click spacing | Default minimum 7 seconds, editable from 5 to 300 seconds. |
| After a click | Wait for the current poke's observed request to settle and for the row to change. An unchanged row gets 12 seconds before refresh; an unresolved request gets at most 90 seconds. Neither response errors nor unrelated requests add a cooldown. |
| Duplicate guard | Save a reservation before clicking. The unchanged item waits 3 minutes before one retry; at most two reservations per unchanged signature. A new poke count creates a new signature. Guards and attempts survive reloads/restarts. |
| Request errors | No automatic restriction detection, response-body inspection, request-failed countdown, or **Review pause** hold. Facebook still decides whether to accept a poke. |
| Browser/load recovery | Blank or stuck pages and dead renderers get bounded recovery. Failed main-document loads still need connection recovery; TLS/sign-in problems require attention. The app waits while no Internet-capable network is present. Repeated unsuccessful repairs eventually pause with a visible recovery message. |
| Layout | Mobile by default. Desktop layout is available when the Basic profile is off. Basic setup and mobile recovery keep the mobile user agent. |
| Data saver | Blocks network images and reduces refresh frequency. It does not make access free, compress all traffic, or eliminate Facebook script downloads. Turn it off if sign-in requires images. |
| Carrier Basic mode | Uses the normal Facebook mobile website and its own carrier offer/banner. The profile is on by default; its selection is not consent, enrollment, or billing verification. Use the Basic mode button for setup. |
| App hidden / closed | Polling and WebView timers pause while hidden. The saved ON/OFF setting resumes when reopened. No closed-app or screen-off execution is promised. |
| Screen | Optional keep-awake setting while running; on by default. |

Click counts measure **attempts**, not Facebook-confirmed successful pokes. Facebook may change the page, reject clicks, or disallow embedded sign-in. The app does not bypass those restrictions.

## Privacy and permissions

- Internet and network-state access only. No accessibility access, overlays, contacts, notifications, or background service.
- Facebook sign-in goes directly to its HTTPS page. Cookies and website storage stay in the app's WebView sandbox. Android backups are disabled.
- Local preferences hold settings, attempt totals, and hashed row signatures. No analytics or developer server.
- The request observer only tracks completion of the current poke's requests. It does not read response bodies, store credentials or tokens, or construct/replay Facebook API requests.
- Mobile white-screen checking uses a temporary 64×64 memory sample of the browser area. No image is written to disk, uploaded, or logged.
- HTTPS Facebook pages can navigate inside the WebView. External HTTPS links require a gesture and a browser-opening confirmation. File/content access and mixed HTTP content are disabled; TLS errors are cancelled.
- No JavaScript-to-native interface is exposed. Native code polls a bounded JSON result from the top-level page.
- **Settings → Sign out / clear Facebook data** stops the loop and clears Facebook cookies, cache, and website storage.

## Build and validation

Requires JDK 17, Android SDK platform 35 and build tools 35.0.0. Gradle 8.11.1 and Android Gradle plugin 8.9.2 are pinned.

```sh
./gradlew --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
npm ci
npx playwright install chromium
npm test
```

APK output: `app/build/outputs/apk/debug/app-debug.apk`.

The 82 browser tests use intercepted offline fixtures: no Facebook login or live pokes. They cover clicking/refreshing across repeated failed responses, old-state migration, unrelated/hung requests, duplicate guards, mobile loading and blank-page states, sign-in exclusions, adaptive timing, carrier-banner detection, manual opt-in, false-label exclusion, and continuation after setup. Twenty-one JVM tests cover recovery budgets, mobile fallback/compatibility, redirect-proof readiness deadlines, and white-frame classification/deadlines. Device-specific rendering and a live signed-in Facebook session still need testing on the reporting phone.

The checked-in APK is built and signature-verified locally. GitHub Actions previously could not start because GitHub reported an account billing lock; the checked-in download is available independently of Actions. CI runs browser tests, Android compilation, unit tests and lint when runners are available. A passing `main` build publishes a development APK prerelease.

The private local signing backup is excluded from Git. CI uses its own debug key, so a CI-generated development APK may require uninstalling a locally signed build. Production signing and automatic updates are not configured.

## Source

- `app/src/main/java/io/github/zyke425/autopoke/MainActivity.java`: native UI, WebView, lifecycle, settings, persistence and recovery integration.
- `app/src/main/assets/autopoke.js`: visible-control detector and poke-back state machine.
- `app/src/main/assets/basic-mode.js`: read-only inspection of Facebook carrier banners/offers; no opt-in or purchase actions.
- `LoadRecovery.java`, `BrowserRecovery.java`, `PageReadyWatchdog.java`, `MobileRecovery.java`, `WhiteFrameWatchdog.java`: recovery policies and visual health checks.
- `tests/engine.test.cjs`: offline browser regression tests.

Adapted from the repository owner's **Facebook Autopoke GUI 2.12** userscript, which credited **augesrob (original); revised GUI and loop**. Unofficial; not affiliated with Facebook or Meta.
