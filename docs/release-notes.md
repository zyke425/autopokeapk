AutoPoke 1.1.0 — standalone Android app, Android 8.0 or newer.

- Sign in to Facebook inside the app, tap **Open Pokes**, then **Start loop**.
- Auto-clicks eligible **Poke back** controls and refreshes to find new ones.
- Native controls stay above the page through reloads.
- Change the refresh delay and minimum click interval in **Settings**.
- **Stop loop** cancels future scans and automatic refreshes.
- Idle refresh backoff, offline waiting, and bounded recovery for stalled Pokes loads.
- Durable pre-click reservations reduce duplicate attempts after interruptions.
- Full-page restriction detection and persistent temporary-error backoff.

Validated with 30 offline browser tests, 3 JVM retry-policy tests, Android compilation/lint, and APK signature verification. Live Facebook sign-in/poking and physical-device behavior remain untested.

This is a debug-signed development APK. The loop runs while the app is open and resumes when you return. Android can stop the app. Facebook may reject an automated click or disallow embedded sign-in; click counts are attempts, not server-confirmed pokes. If Facebook reports a restriction, the app stops until you check manually.

APK builds from different machines may use different debug certificates. If Android reports an incompatible update, uninstall the old development build before installing this one; uninstalling clears its local sign-in and settings.
