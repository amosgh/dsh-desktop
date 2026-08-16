# Release runbook

## Local acceptance

1. Install from the lockfile with `npm ci` on Apple Silicon macOS.
2. Run `npm run verify` and `npm run dist:mac`.
3. Launch `release/mac-arm64/DSH Desktop.app` from a clean test user.
4. Verify first-run credential setup, project grant, task creation, approval/question resolution, crash recovery, review/commit, confirmed discard, relaunch recovery, dark mode, reduced motion, and keyboard-only navigation.
5. Export diagnostics and confirm it contains no synthetic API key, endpoint URL, absolute project path, prompt, or diff.

## Signed public artifact

The repository enables Hardened Runtime and supplies Electron child-process entitlements. Use an Apple Developer ID Application identity in the build keychain, configure electron-builder's Apple notarization credentials in the release environment, then run `npm run dist:release`. Never commit certificates, app-specific passwords, API keys, or notary credentials.

After building:

1. Verify signatures with `codesign --verify --deep --strict --verbose=2 <app>`.
2. Submit and wait for notarization with `xcrun notarytool submit <dmg> --wait` using a Keychain profile, then staple with `xcrun stapler staple <dmg>`.
3. Assess with `spctl --assess --type execute --verbose=4 <app>` and test the downloaded artifact on a clean macOS account.
4. Publish SHA-256 checksums, the exact source tag, lockfile, Harness version, release notes, privacy/security links, and third-party notices.

`dist:release` alone is not proof of signing or notarization. The release is blocked until all commands above pass.

## Rollback

Stop distribution of the bad artifact, publish the last known-good signed version and checksum, and explain whether the issue affects credentials, repositories, or worktrees. Desktop migrations are forward-only: back up the app-data directory before installing a release with a new migration. Rolling back the binary must not remove worktrees; mark unresolvable records as missing and let users recover branches/reflogs manually.
