AutoPoke 1.1.2 — false-positive pause fix, Android 8.0 or newer.

Update directly from 1.1.1. Uninstall 1.0.0/1.1.0 before installing because the signing key changed in 1.1.1.

- Sign in to Facebook inside the app, tap **Open Pokes**, then **Start loop**.
- Auto-clicks eligible **Poke back** controls and refreshes to find new ones.
- Native controls stay above the page through reloads.
- Change the refresh delay and minimum click interval in **Settings**.
- **Stop loop** cancels future scans and automatic refreshes.
- Idle refresh backoff, offline waiting, and bounded recovery for stalled Pokes loads.
- Durable pre-click reservations reduce duplicate attempts after interruptions.
- Full-page restriction detection and persistent temporary-error backoff.
- Detect empty/invisible pages, reload, and replace the browser if needed.
- Automatically recover a crashed or unresponsive renderer with a bounded retry budget.
- Keep Facebook cookies during browser replacement, and reduce repeated injection/history growth during long sessions.
- Generic retry messages and unrelated request errors no longer create permanent poke-restriction holds.
- Real block notices and attributable poke rejections still pause with a recorded reason/source.
- Repeated background errors cannot continually extend an active cooldown.

Validated with 54 offline browser tests, 8 JVM recovery-policy tests, Android compilation/lint, and APK signature verification. The fix still needs confirmation on the reporting phone.

This is a debug-signed development APK. The loop runs while the app is open and resumes when you return. Android can stop the app. Facebook may reject an automated click or disallow embedded sign-in; click counts are attempts, not server-confirmed pokes. If Facebook reports a restriction, the app stops until you check manually.

APK builds from different machines may use different debug certificates. If Android reports an incompatible update, uninstall the old development build before installing this one; uninstalling clears its local sign-in and settings.
