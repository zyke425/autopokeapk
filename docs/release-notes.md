AutoPoke 1.1.10 — refresh Basic-mode Pokes within its existing Facebook document.

Install over the locally signed 1.1.1–1.1.9 APK. Confirm the title says AutoPoke 1.1.10.

- Remove normal Basic-mode document reloads. Prefer the site's Refresh control or Back → Pokes navigation while keeping its working document and client router.
- Cancel plain-anchor default GETs during client refresh and add a native automatic-navigation guard. Do not guess/replay a Facebook API request or fall back to a new document load when a refresh control is missing.
- Wait for a real view/content transition. Allow slow navigation up to 30 seconds, with no repeated clicks in that attempt.
- Keep scanning a visible Pokes view when refresh controls are unavailable; retry control discovery after 30 seconds. A new incoming Poke back can still be attempted. If Pokes is no longer visible and its client navigation is unavailable, ask for manual navigation.
- Preserve duplicate guards, manual sign-in/consent, initial entry and bounded recovery for actual failures. The native reload button uses the same client refresh on Pokes.
- Add refresh strategy/phase metadata to the existing private load report.

119 offline browser tests and 32 JVM tests passed; Android compilation, lint, APK contents and signature were checked locally. A new fixture reproduces a blank Pokes GET followed by Home's carrier offer, then completes eight poke-back and five idle refresh cycles without another document request. Slow client navigation can also finish after twenty seconds without repeated clicks. Actual carrier behavior still needs validation on the reporting phone.
