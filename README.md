# DeepseekHarness Desktop

An experimental, local-first macOS desktop client for DeepSeek Harness. This is a community project and is not an official DeepSeek application.

## Current status

The local MVP implements the complete supervised task loop:

- Electron renderer with no Node or filesystem access.
- Independently supervised DeepSeek Harness `0.1.0-rc.6` process.
- A dedicated Node runtime copied into the packaged app so Harness does not depend on the user's shell environment.
- Random `127.0.0.1` port, lifecycle controls, redacted logs, and crash state.
- A desktop-owned authenticated loopback gateway in front of the upstream Harness Web UI.
- A random 256-bit capability stored only in an HttpOnly cookie inside an isolated, in-memory Electron session.
- Versioned authenticated health handshake and fail-closed workspace opening.
- Native macOS Git repository selection with canonical-path authorization.
- SQLite-backed recent projects and active-workspace persistence.
- Project activation restarts Harness inside the authorized repository root.
- Official Harness RPC plus dual WebSocket task/event transport.
- Task creation, correction, resume, cancellation, rename, fork, archive, live status, and Sidecar crash restart.
- Paginated history, plan projection, live timeline, reconnect recovery, and a 10,000-event replay fixture.
- Inbox approvals and questions with exact operation details, single-resolution semantics, and native notifications.
- Per-task Git worktrees pinned to a base commit, repository mutation serialization, review/diff, commit, external tools, and confirmed discard.
- Keychain-backed API-key encryption, endpoint/model settings, connection checks, and redacted diagnostics export.
- Light/dark appearance and reduced-motion support.

  <img width="1180" height="760" alt="image" src="https://github.com/user-attachments/assets/3773a434-5bf9-4715-acda-a9410daf3e9f" />

  <img width="1280" height="820" alt="image" src="https://github.com/user-attachments/assets/27385e8e-4fbc-44d8-ab36-0a5d0d9d3589" />


The upstream Web transport still lacks its own authentication layer. Renderer never receives its raw origin or the gateway credential; requests to the desktop gateway without the ephemeral capability receive `401`. The raw upstream loopback port remains reachable to other processes running as the same macOS user until Harness supports a token-aware or non-TCP carrier.

## Development

Requires Node.js 24+ on macOS.

```bash
npm install
npm run typecheck
npm test
npm run smoke:harness
npm run smoke:protocol
npm run smoke:recovery
npm run verify
npm run dev
```

Build an unpacked Apple Silicon application:

```bash
npm run dist:mac
```

The local build is unsigned. Producing a public DMG/ZIP and notarizing it requires an Apple Developer ID and notary credentials; see [the release runbook](./docs/RELEASE.md).

## Planning

See [the planning index](./docs/README.md) for the product specification, design system, security model, architecture decisions, and release plan.
