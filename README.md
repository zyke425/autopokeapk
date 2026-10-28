# AutoPoke for Android

Current APK: **1.1.2** (version code 4).

A standalone Android version of the supplied **Facebook Autopoke GUI 2.12** userscript. Opens Facebook in an in-app WebView and keeps the controls in Android's own UI, above the page.

**[Download AutoPoke-debug.apk](https://github.com/zyke425/autopokeapk/raw/refs/heads/main/downloads/AutoPoke-debug.apk)** · **[Build workflow](https://github.com/zyke425/autopokeapk/actions/workflows/android.yml)**

The checked-in APK was compiled and signature-verified locally. Android lint passed with no errors and the offline browser checks passed. GitHub Actions could not start its jobs because GitHub reported that the account is locked due to a billing issue. The APK above is available independently of Actions; automatic prereleases require a working runner.

## Changes in 1.1.2

- Narrow restriction detection: a generic **Try again later** message or a casual mention in a heading/dialog no longer permanently pauses poking.
- Attribute observed request errors using the available friendly operation name, a poke-specific error path, or an unlabelled request synchronously emitted by the app's click. Unrelated and unattributed request errors use temporary backoff instead of claiming a confirmed poke restriction. No requests are constructed or replayed.
- Record and display a pause reason/source. Genuine poke-request restrictions, explicit Facebook block notices, and main-page HTTP 429 responses remain held until manual review. Old pauses with no recorded cause stay labelled as an earlier pause; they are not silently cleared.
- Keep one retry deadline during a cooldown so repeated background errors cannot extend it forever, and let an in-flight poke finish before processing unrelated failures.
- Preserve a page-level restriction if an older asynchronous script result arrives after it.

This APK uses the same signing certificate as 1.1.1 and can update it in place. The supplied screenshot shows the older **AutoPoke 1.1** header; installs from 1.0.0/1.1.0 still require uninstalling first because the signing key changed in 1.1.1.

## Changes in 1.1.1

- Detect a completed Pokes document that stays empty or invisible for 10 seconds, including an empty root URL reached while opening Pokes. Reload it once, then recreate the WebView if the problem repeats. Three failed repairs require a manual restart; a minute of healthy operation restores the repair budget.
- Automatically replace a crashed renderer. On Android 10 and newer, also handle the renderer's unresponsive callback. A missing script callback or repeated empty results trigger browser recovery.
- Preserve Facebook cookies and website storage during browser replacement, along with the native click-attempt total and duplicate-click reservations. Restrictions remain paused.
- Display a recovery message over the browser area while it is blank. Keep loading checks active when page-finished callbacks are delayed, and request a redraw after resuming or first rendering Pokes.
- Inject the engine once per document and avoid resending saved records on every poll. Trim oversized Pokes navigation history to reduce long-session work and retained history.

**Installation change:** the temporary signing key used for 1.0.0/1.1.0 is no longer available. Version 1.1.1 uses a new signing key, so uninstall the older APK first and sign in again. The new private key has been backed up separately for future local updates. It is never committed to this repository.

## Changes in 1.1.0

- Save a duplicate-click reservation to disk **before** executing a poke. If navigation, Stop, or a restart interrupts preparation, the reserved row stays deferred instead of being clicked again immediately.
- Increase idle refresh delays across reloads. New installs start at 5 seconds, then 10, 20, 40 and 60 seconds while no eligible poke appears. Finding an eligible poke resets the idle delay. Existing custom delays remain unchanged; adaptive mode can be disabled in Settings. This reduces idle reloads and may make detecting a new poke slower.
- Recover from stalled Pokes loads and temporary page/server failures, with delays of 30, 60, 120, 240 and 300 seconds, then stop after the retry budget is exhausted. No reloads are attempted while no Internet-capable network is available. Login, TLS errors, and access-denied pages require manual attention.
- Persist temporary GraphQL request backoff across reloads and increase it after repeated errors. Stop for manual review if an attempted poke still has an unknown result after 90 seconds.
- Detect restriction headings even when Facebook replaces the Pokes view, and keep restriction state writes ordered with click reservations.
- Preserve row identity when a relative timestamp changes in text-only layouts.

Versions 1.0.0 and 1.1.0 shared a signing certificate. None of these releases prevent Facebook from rejecting actions or enforcing its limits.

## Install and use

1. Download **AutoPoke-debug.apk** using the link above. Its SHA-256 checksum is in `downloads/SHA256SUMS`.
2. If using 1.0.0 or 1.1.0, uninstall it first; Android will clear its local sign-in and settings. Then open the new APK. Allow installation from the browser/file manager when Android asks. Requires **Android 8.0 or newer**.
3. Open **AutoPoke** and sign in to your Facebook account on Facebook's page inside the app.
4. Tap **Open Pokes**, then **Start loop**. Keep the app open.
5. Tap **Stop loop** any time to stop scanning and automatic refreshes.

No Tampermonkey or accessibility service is needed. This app uses its own sign-in session; it does not control the separate Facebook app or Chrome.

## Behavior and settings

| Feature | Behavior |
| --- | --- |
| Poke back | Clicks only rendered, enabled **Poke back** controls on a recognized Pokes view. Suggested **Poke** controls are ignored. English labels are currently required. |
| Refresh | New-install base delay **5 seconds after the Pokes view is ready**, plus network/rendering time. Editable from 1 to 300 seconds. Adaptive idle refresh is on by default and increases up to the larger of 60 seconds or your chosen base delay. |
| After a click | Waits at least the refresh delay and for observed Facebook requests to finish. Gives an unchanged row 12 seconds before refreshing once requests settle. |
| Click spacing | Default minimum **7 seconds**, editable from 5 to 300 seconds. No human-behavior disguise or rate-limit bypass. |
| Duplicate guard | Android durably saves a reservation before clicking. Same unchanged item waits 3 minutes before one retry; at most two reservations per unchanged signature. An interrupted reservation can defer a row even if its click was never sent. A new poke count is a new signature. Guards and attempts survive reloads and restarts. |
| Restriction | An explicit Facebook block notice, an attributable poke-request restriction, or a main-page HTTP 429 holds the loop. The recorded reason appears on screen and in **Review pause**. Generic retry messages do not create a hold; unrelated/unattributed request errors use temporary backoff. |
| Temporary failure | Observed request errors back off for 30 seconds, increasing to 5 minutes after repeated failures. Pokes-page load/server errors use bounded retries. A 45-second loading/rendering watchdog starts recovery; an unknown poke result after 90 seconds pauses for manual review. |
| Blank / crashed browser | A completed empty or invisible document gets 10 seconds to render, followed by a 1-second reload delay. Repeated failures recreate the browser after 3 and 10 seconds. A crashed or unresponsive browser skips directly to replacement. Recovery keeps cookies, native state, and the ON setting; repeated failures eventually pause. |
| Login / other routes | No automatic clicks or refreshes on login, checkpoint, email, password, or verification-code entry pages. An empty root redirect from an explicitly opened Pokes page can be repaired. Tap **Open Pokes** after finishing sign-in. |
| Screen | Optional keep-awake setting while running; enabled by default. |
| Layout | Mobile by default; **Desktop Facebook layout** is available in Settings. |
| App hidden / closed | Native polling and WebView timers pause while hidden. Returns to the saved ON/OFF setting when reopened. No closed-app or screen-off execution is promised. |

Click counts measure **attempts**, not Facebook-confirmed successful pokes. The app has not been tested against a signed-in Facebook account. Facebook can change its page, reject automated actions, or block sign-in from an embedded browser. If the login page says the browser is unsupported, this build cannot bypass that restriction.

## Privacy and permissions

- Requests **Internet** and **network-state access** permissions. Network state is used to wait while offline. No accessibility access, overlays, notification access, contacts, or background service.
- Facebook receives your sign-in through its HTTPS page. Cookies and website storage remain in the app's WebView sandbox. The app does not collect or log passwords, cookies, tokens, or page contents.
- Local preferences hold settings, attempt totals, restriction status/reason/source, and hashed row signatures. Request scoping reads only the friendly operation-name field; raw request/response data and tokens are not stored. Android app backups are disabled.
- No analytics or developer server. Only HTTPS Facebook pages can navigate inside the WebView. Other HTTPS links require a user gesture and a browser-opening confirmation. File/content access and mixed HTTP content are disabled; TLS certificate errors are cancelled.
- There is no JavaScript-to-native interface. Native code polls a bounded JSON result from the top-level page.
- Use **Settings → Sign out / clear Facebook data** to stop the loop and remove the app's Facebook data.

## Build

Requires JDK 17, Android SDK platform 35 and build tools 35.0.0. The Gradle wrapper pins Gradle 8.11.1; the Android Gradle plugin is pinned to 8.9.2.

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.

For consistent local update signatures, restore the private signing backup to the ignored path `.local-signing/autopoke-debug.keystore` before building. The build uses this key when it exists. CI runners without the private key use their own development certificate.

```sh
npm ci
npx playwright install chromium
npm test
```

54 browser tests intercept every navigation with offline fixture HTML. They do not contact Facebook or send pokes. They cover mobile routes, reload persistence, duplicate guards, suggested-button exclusion, login and restriction pauses, timing, idle backoff, blank pages, false-positive notices, request attribution for fetch/XHR, pause reasons, repeated errors during cooldown, and concurrent poke/background requests. Eight JVM unit tests check page recovery, blank-browser escalation, stable recovery, and retry budgets. The Android fix has not been verified on the reporting phone or a live signed-in Facebook session.

GitHub Actions runs browser checks and Android compile/lint. A passing push to `main` publishes a debug-signed APK as a development prerelease, with an artifact copy kept for 30 days. Different machines/runners have different debug certificates: uninstall the previous development APK first if an update reports a signature conflict. Production signing and automatic app updates are not configured.

## Source

- `app/src/main/java/io/github/zyke425/autopoke/MainActivity.java`: native UI, WebView navigation, lifecycle, settings, and persistence.
- `app/src/main/assets/autopoke.js`: visible-control detector and poke-back state machine.
- `app/src/main/java/io/github/zyke425/autopoke/LoadRecovery.java`: bounded page-recovery delays.
- `app/src/main/java/io/github/zyke425/autopoke/BrowserRecovery.java`: blank/crashed browser repair escalation and budget.
- `tests/engine.test.cjs`: offline browser regression tests.

The interaction flow is adapted from the userscript supplied by the repository owner, which credited **augesrob (original); revised GUI and loop**. This project is unofficial and is not affiliated with Facebook or Meta.
