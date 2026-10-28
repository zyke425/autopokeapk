AutoPoke 1.1.6 — remove the loading cover and recover stalled Basic/mobile Pokes views.

Install over locally signed 1.1.1, 1.1.2, 1.1.4 or 1.1.5. Confirm the title says AutoPoke 1.1.6.

- Keep Facebook visible while loading/checking, instead of hiding it behind AutoPoke's full-screen cover.
- Wait for a usable Pokes view, with a native deadline that survives redirects and loaded-but-empty documents.
- Leave sign-in and Facebook's Basic-mode consent screens available for manual completion.
- Retry a blank mobile page in a fresh WebView using the installed engine's mobile-browser presentation. Preserve cookies and guards; retain the software-rendering fallback for repeated blanks.
- Use the same Poke back and refresh loop for Basic and Data layouts. Offline fixtures cover text links, submit controls, full-page navigation and changing poke counts.
- Keep request-failed countdowns and restriction holds removed. Do not switch to Data mode or buy data automatically.

For carrier Basic mode: use mobile data with Wi-Fi off, open Basic mode setup, and tap Continue on Facebook's own offer if shown. Then use Open Pokes → Start loop.

82 offline browser tests, 21 JVM tests, Android build/lint and APK signature are checked. The reporting phone and live carrier access still need confirmation. Facebook/your carrier must provide Basic mode and expose Pokes; the app cannot grant free data or force acceptance of a poke.
