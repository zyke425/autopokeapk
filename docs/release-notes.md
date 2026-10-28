AutoPoke 1.1.9 — keep Basic-mode loop refreshes on Pokes.

Install over the locally signed 1.1.1–1.1.8 APK. Confirm the title says AutoPoke 1.1.9.

- Fix 1.1.8's normal refresh path, which deliberately reloaded Home and could reopen the carrier offer. Refresh the current/learned Pokes navigation address instead.
- Preserve the mobile host and carrier/referral parameters. Learn the site's Pokes address even if its client-side view leaves the document URL at Home.
- Keep inspecting the refreshed page until Pokes is actually ready, then resume scanning with saved attempts and duplicate guards. Follow Facebook's Pokes control again if the document redirects to its menu.
- Keep initial Home bootstrap and bounded blank-page recovery. Open Pokes no longer reloads Home when Pokes is already visible; native reload also preserves the Pokes target.
- Leave sign-in and carrier consent manual.

107 offline browser tests and 32 JVM tests passed; Android compilation, lint and the APK signature were checked locally. Repeated click/idle fixtures stay on Pokes without another Home load. Actual carrier behavior still needs validation on the reporting phone.
