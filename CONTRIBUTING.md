# Contributing

DSH Desktop accepts focused changes that preserve its local-first trust boundaries and independent community identity.

Use native Apple Silicon Node.js 24+ and install the pinned dependency graph with `npm ci`. Before submitting a change, run `npm run verify`; use `npm run smoke:harness` as an additional focused Harness-startup diagnostic when relevant. UI changes must be checked in light/dark appearance, reduced motion, keyboard-only use, and at the 960 px minimum width. Security-sensitive changes require tests for invalid IPC input, path escape, duplicate approval resolution, and secret redaction as applicable.

Do not weaken Renderer sandboxing, expose Harness origins or credentials over IPC, execute shell strings, remove native confirmation from destructive Git actions, or silently add telemetry. Pin dependency changes and update third-party notices. Keep user-facing copy in Simplified Chinese until localization infrastructure is introduced.

Report vulnerabilities privately as described in [docs/SECURITY.md](./docs/SECURITY.md).
