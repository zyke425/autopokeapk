# AutoPoke for Android

A standalone Android version of the supplied **Facebook Autopoke GUI 2.12** userscript. Opens Facebook in an in-app WebView and keeps the controls in Android's own UI, above the page.

**[Download the newest APK from Releases](https://github.com/zyke425/autopokeapk/releases)** · **[Build status and APK artifacts](https://github.com/zyke425/autopokeapk/actions/workflows/android.yml)**

## Install and use

1. Open **Releases**, open the newest development build, and download **AutoPoke-debug.apk** under Assets. The first release appears after the build checks pass.
2. Open the APK on your Android phone. Allow installation from the browser/file manager when Android asks. Requires **Android 8.0 or newer**.
3. Open **AutoPoke** and sign in to your Facebook account on Facebook's page inside the app.
4. Tap **Open Pokes**, then **Start loop**. Keep the app open.
5. Tap **Stop loop** any time to stop scanning and automatic refreshes.

No Tampermonkey or accessibility service is needed. This app uses its own sign-in session; it does not control the separate Facebook app or Chrome.

## Behavior and settings

| Feature | Behavior |
| --- | --- |
| Poke back | Clicks only rendered, enabled **Poke back** controls on a recognized Pokes view. Suggested **Poke** controls are ignored. English labels are currently required. |
| Refresh | Default **1 second after the Pokes view is ready**, in addition to network/rendering time. Editable from 1 to 300 seconds. |
| After a click | Waits at least the refresh delay and for the clicked row to change; gives an unchanged row up to 12 seconds before refreshing. |
| Click spacing | Default minimum **7 seconds**, editable from 5 to 300 seconds. No human-behavior disguise or rate-limit bypass. |
| Duplicate guard | Same unchanged item waits 3 minutes before one retry; at most two attempts per unchanged signature. A new poke count is a new signature. Guards and attempts survive reloads and restarts. |
| Restriction | A visible Facebook restriction, GraphQL rate-limit error, or HTTP 429 stops the loop. Check Facebook manually before using **Review pause**. |
| Temporary failure | A failed page request after a click backs off for 30 seconds before a fresh load. Main-page loading errors wait for a manual reload. |
| Login / other routes | No automatic clicks or refreshes. Tap **Open Pokes** after finishing sign-in. |
| Screen | Optional keep-awake setting while running; enabled by default. |
| Layout | Mobile by default; **Desktop Facebook layout** is available in Settings. |
| App hidden / closed | Native polling and WebView timers pause while hidden. Returns to the saved ON/OFF setting when reopened. No closed-app or screen-off execution is promised. |

Click counts measure **attempts**, not Facebook-confirmed successful pokes. The app has not been tested against a signed-in Facebook account. Facebook can change its page, reject automated actions, or block sign-in from an embedded browser. If the login page says the browser is unsupported, this build cannot bypass that restriction.

## Privacy and permissions

- Requests only **Internet** permission. No accessibility access, overlays, notification access, contacts, or background service.
- Facebook receives your sign-in through its HTTPS page. Cookies and website storage remain in the app's WebView sandbox. The app does not collect or log passwords, cookies, tokens, or page contents.
- Local preferences hold settings, attempt totals, restriction status, and hashed row signatures. Android app backups are disabled.
- No analytics or developer server. Only HTTPS Facebook pages can navigate inside the WebView. Other HTTPS links require a user gesture and a browser-opening confirmation. File/content access and mixed HTTP content are disabled; TLS certificate errors are cancelled.
- There is no JavaScript-to-native interface. Native code polls a bounded JSON result from the top-level page.
- Use **Settings → Sign out / clear Facebook data** to stop the loop and remove the app's Facebook data.

## Build

Requires JDK 17, Android SDK platform 35 and build tools 35.0.0. The Gradle wrapper pins Gradle 8.11.1; the Android Gradle plugin is pinned to 8.9.2.

```sh
./gradlew :app:assembleDebug :app:lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.

```sh
npm ci
npx playwright install chromium
npm test
```

Browser tests intercept every navigation with offline fixture HTML. They do not contact Facebook or send pokes. They cover mobile routes, reload persistence, new poke counts, duplicate retries, suggested-button exclusion, disabled/hidden controls, login and restriction pauses, request recovery, and timing.

GitHub Actions runs browser checks and Android compile/lint. A passing push to `main` publishes a debug-signed APK as a development prerelease, with an artifact copy kept for 30 days. Different machines/runners have different debug certificates: uninstall the previous development APK first if an update reports a signature conflict. Production signing and automatic app updates are not configured.

## Source

- `app/src/main/java/io/github/zyke425/autopoke/MainActivity.java`: native UI, WebView navigation, lifecycle, settings, and persistence.
- `app/src/main/assets/autopoke.js`: visible-control detector and poke-back state machine.
- `tests/engine.test.cjs`: offline browser regression tests.

The interaction flow is adapted from the userscript supplied by the repository owner, which credited **augesrob (original); revised GUI and loop**. This project is unofficial and is not affiliated with Facebook or Meta.
