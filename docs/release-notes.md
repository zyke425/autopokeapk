AutoPoke 1.1.8 — use Facebook's own client-side Pokes navigation and add load diagnostics.

Install over the locally signed 1.1.1–1.1.7 APK. Confirm the title says AutoPoke 1.1.8.

- Basic mode opens Home first, then clicks Facebook's visible Pokes link/control, preserving its client-side handler.
- Use the same entry path after Basic-mode refresh, browser repair and activity recreation. Avoid reloading the same empty deep link.
- Try the visible Menu once if necessary. If Pokes is not available, ask the user to navigate inside Facebook rather than guessing another endpoint.
- Leave sign-in, Basic consent, Buy data and Poke back untouched during navigation. The existing poke loop starts only when enabled and the actual Pokes view is ready.
- Add Settings → Copy load report: error codes, failed resource counts, software versions/network type and DOM counts only. Never include URLs, text, cookies, tokens or request/response bodies; no automatic upload.

103 offline browser tests include a reproduction where direct GET /pokes is blank but Facebook's client router works. 29 JVM tests plus Android build/lint and APK signature are checked.

This does not establish live Smart Basic-mode support. If it is still blank, compare Pokes in Chrome on the same connection and paste the new load report. Facebook/carrier access cannot be granted by the APK.
