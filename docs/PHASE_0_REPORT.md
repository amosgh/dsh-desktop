# Phase 0 integration report

Status: complete for runtime and packaging proof; protocol work is intentionally deferred.

## Verified

- Pinned `@deepseek-ai/dsh` to `0.1.0-rc.6`.
- Starts Harness with `web --host 127.0.0.1 --port 0` and discovers the assigned port from its startup output.
- Supervises startup, ready, stop, restart, crash, timeout, and application shutdown states.
- Keeps Electron Renderer sandboxed behind a narrow preload API.
- Stores Harness state beneath the application support directory and redacts sidecar logs before exposing them to the UI.
- Opens the upstream Harness workspace in a separate sandboxed window.
- Packages and launches an unsigned Apple Silicon `.app` with a dedicated universal Node runtime.
- Confirmed from the packaged process tree that Harness runs from `Contents/Resources/runtime/node` rather than the user's shell.

## Important findings

1. Electron's embedded Node runtime cannot reliably resolve the dynamic nested plugins in this Harness release. The desktop app therefore owns and bundles a dedicated Node executable.
2. The upstream Harness Web transport has a browser trust fence but no authentication layer. Directly embedding that Web workspace is acceptable for this local integration proof only.
3. Later Phase 1 inspection found a typed RPC contract plus dual WebSocket event streams. Its v1 `since` cursor is reserved but ignored, so reconnect still requires reopening both streams and rebuilding from unary baselines/history.
4. The current unpacked application is approximately 763 MB because it includes Electron, an uncompressed application tree, native dependencies, and a universal Node binary. Size optimization belongs in the distribution phase.

## Phase 1 decision

Keep the sidecar supervisor, but place a desktop-owned authenticated adapter between Renderer and Harness. The next spike must choose one of these paths:

- a thin Harness plugin that exposes versioned task, event, approval, and terminal contracts; or
- a localhost proxy owned by Electron Main that adds an unguessable session token and normalizes upstream events.

The direct upstream workspace window remains a developer-only fallback until that boundary exists.

## Verification commands

```bash
npm run typecheck
npm test
npm run build
npm run smoke:harness
npm run dist:mac
```

Packaged-app acceptance additionally starts `release/mac-arm64/DSH Desktop.app` with automatic runtime capture and verifies the runtime process path and workspace load.
