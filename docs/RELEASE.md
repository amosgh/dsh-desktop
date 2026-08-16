# Release runbook

## Local acceptance

1. Use macOS 14+ on Apple Silicon with native arm64 Node.js 24+, Git, and the Xcode Command Line Tools. Confirm both `uname -m` and `node -p "process.arch"` report `arm64`.
2. Install from the lockfile with `npm ci`.
3. Run `npm run verify` and `npm run dist:mac`.
4. Confirm the packaged `Info.plist` declares macOS 14.0 or later, Electron is arm64, and the bundled Node executable contains an arm64 slice.
5. Launch `release/mac-arm64/DSH Desktop.app` from a clean test user.
6. Verify first-run credential setup, project grant, failed-task worktree rollback, approval/question resolution, crash recovery, relaunch visibility for discarded/missing task workspaces, review/commit, confirmed discard, Markdown preview, internal HTTP/HTTPS browsing, dark mode, reduced motion, and keyboard-only navigation.
7. Export diagnostics and confirm it contains no synthetic API key, endpoint URL, absolute project path, prompt, or diff.

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
