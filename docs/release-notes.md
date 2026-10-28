AutoPoke 1.1.4 — remove request-failed countdowns and improve mobile blank-screen recovery.

Update directly from 1.1.1/1.1.2. Confirm the app title says AutoPoke 1.1.4. Uninstall 1.0.0/1.1.0 before installing because the signing key changed in 1.1.1.

- Remove the “A Facebook request failed. Retrying…” check and automatic restriction holds.
- Clear old saved retry/hold fields while preserving attempts and duplicate guards.
- Continue normal scanning/refreshing after failed responses. Unrelated background requests cannot stall the loop.
- Wait only for the current poke's request completion; preserve guards when a hung request times out and refreshes.
- Detect hidden mobile page content, stalled document loading, and redirected shells.
- Check sustained white browser output using a temporary memory-only sample.
- Retry using the main host with mobile layout, then recreate with software rendering if blank output recurs.
- Preserve cookies during browser replacement. Recovery remains bounded if Facebook cannot be restored.
- Include Data saver and optional carrier Free Facebook settings. Carrier access is unverified; the app cannot provide free data.

64 offline browser tests and 14 JVM tests cover these behaviors. Android compilation, lint and APK signature are checked before publication. Physical-phone rendering and live Facebook behavior still need confirmation.

The loop runs while the app is open. Click counts are attempts; Facebook decides whether to accept them. This build does not inspect request error responses or bypass Facebook limits. Sign-in/TLS errors and repeated failed browser repairs still require attention.
