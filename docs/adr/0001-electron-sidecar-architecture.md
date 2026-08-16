# ADR-0001: Electron renderer with an isolated DeepSeek Harness sidecar

- Status: Accepted for MVP
- Date: 2026-08-15
- Decision owners: DSH Desktop maintainers

## Phase 0 finding

Harness `0.1.0-rc.6` exposes its browser API through a loopback/browser-trust fence, not an authentication layer. Phase 0 may open that Web UI in a separate sandboxed window to prove runtime integration, but this direct carrier is not approved for public release. Before the desktop renderer consumes session APIs, the adapter must provide the authenticated IPC or token-bearing proxy boundary required by this ADR.

## Context

DeepSeek Harness is a rapidly evolving Node/TypeScript system with a plugin architecture, durable session events, guarded tools, terminal support, approval policy, and an existing web client. DSH Desktop needs a macOS-quality user experience while preserving Harness as the owner of agent execution.

The upstream project is in developer preview and warns that compatibility-breaking changes will occur. The desktop app must therefore minimize assumptions about Harness internals and make version coupling explicit.

## Decision

Build the desktop application with Electron, React, and TypeScript. Package a pinned Node runtime and DeepSeek Harness distribution as a supervised sidecar process. Communicate through a versioned local protocol adapter over loopback using an ephemeral port and per-launch bearer token.

The app is split into four trust and ownership boundaries:

```text
Untrusted content boundary
┌─────────────────────────────────────────────────────────┐
│ Electron Renderer                                      │
│ React UI · normalized view models · no Node integration │
└───────────────────────────┬─────────────────────────────┘
                            │ narrow typed IPC
Trusted desktop boundary    ▼
┌─────────────────────────────────────────────────────────┐
│ Electron Main                                           │
│ windows · menus · Keychain · notifications · lifecycle  │
└───────────────┬───────────────────────────┬─────────────┘
                │                           │
                ▼                           ▼
┌───────────────────────────┐   ┌─────────────────────────┐
│ Harness Adapter/Sidecar   │   │ Desktop Git Service     │
│ pinned dsh · session API  │   │ worktrees · diff · refs │
│ tools · approvals · PTY   │   │ serialized mutations    │
└───────────────────────────┘   └─────────────────────────┘
```

## Responsibilities

### Renderer

- Renders projects, timelines, approvals, diffs, settings, and task state.
- Consumes normalized, versioned view models rather than raw upstream objects.
- Sends intent-based commands such as `task.stop` or `approval.resolve`.
- Has `nodeIntegration: false`, `contextIsolation: true`, and no raw shell/filesystem bridge.

### Preload/IPC contract

- Exposes a small allowlisted API with runtime validation on both sides.
- Uses request IDs, typed error codes, and cancellation where applicable.
- Does not expose generic `invoke(channel, payload)`, arbitrary paths, or arbitrary commands.

### Electron Main

- Owns app/window lifecycle, native menus, deep links, dialogs, Keychain, and notifications.
- Starts and monitors the sidecar and holds its ephemeral credential.
- Enforces project grants before forwarding paths.
- Coordinates updates and diagnostic export.

### Harness adapter and sidecar

- Owns model configuration references, sessions, agent events, tools, approvals, terminal execution, and cancellation.
- Converts upstream Harness events into a stable desktop protocol.
- Advertises protocol and capability versions during handshake.
- Rejects non-loopback connections and requests without the launch token.

### Desktop Git service

- Owns task worktree lifecycle and review-oriented Git queries.
- Pins a task's base SHA and records its generated branch/worktree identifiers.
- Serializes mutations per repository while allowing read-only queries concurrently.
- Never deletes changed worktrees without an explicit confirmed desktop intent.

The Git service should be implemented as a Harness plugin where execution-context coupling is required, with Main retaining native confirmation and lifecycle authority.

## Protocol boundary

The adapter exposes stable desktop concepts:

- `runtime`: handshake, health, capabilities, shutdown, diagnostics.
- `projects`: validate and grant workspace references.
- `sessions`: list, create, resume, fork, archive, subscribe.
- `agents`: submit input, stop, status.
- `approvals`: list pending and resolve.
- `terminals`: subscribe, resize, write, terminate.
- `models`: list routes and test a credential reference.
- `git`: status, diff, worktree lifecycle, commit/apply preparation.

Each streamed event includes `sessionId`, a monotonic cursor, upstream event identity when available, timestamp, and schema version. Reconnection starts after the last committed cursor. Unknown event types are retained for diagnostics and rendered as a safe generic activity item rather than crashing the timeline.

## Persistence

- Harness remains authoritative for session/event history.
- The desktop app uses SQLite for project bookmarks, task projections, window state, worktree metadata, notification state, and protocol cursors.
- Credentials live in Keychain. SQLite stores only opaque credential IDs.
- Task projections are rebuildable from Harness events plus worktree metadata.

## Packaging and runtime

- Ship universal packaging only when both architectures pass native-module tests; Apple Silicon is the first required target.
- Bundle an exact Node version compatible with the pinned Harness release.
- Package native dependencies such as PTY per architecture and verify code signatures after assembly.
- Sidecar listens on `127.0.0.1` with an OS-assigned port and never on all interfaces.
- App shutdown first requests graceful sidecar termination, then escalates after a bounded timeout while preserving recoverable session state.

## Security decisions

- Treat repository files, model output, Markdown, diffs, ANSI output, and plugin-rendered content as untrusted.
- Disable renderer navigation and arbitrary window creation; open approved external URLs through the OS.
- Apply a restrictive Content Security Policy and sanitize rendered Markdown/HTML.
- Keep Harness approval enforcement authoritative; UI controls cannot bypass it.
- Require explicit grants for paths outside the selected workspace.
- Redact secrets before logs cross into the renderer or diagnostic bundle.
- Sign, harden, notarize, and verify update artifacts before public beta.

## Alternatives considered

### Wrap the existing Web UI unchanged

Fastest prototype, but it does not provide a durable native process boundary, Keychain integration, worktree lifecycle, review workflow, or macOS navigation model. Rejected as the product architecture; acceptable only for an integration spike.

### SwiftUI client with a Node sidecar

Offers the strongest native UI but requires reimplementing the client protocol, timeline components, web-oriented plugin views, and cross-platform UI logic. Deferred until product-market fit or a stable public Harness protocol justifies the cost.

### Import Harness directly into Electron Main

Reduces one transport hop but couples app stability and privileges to plugin execution and upstream dependency churn. A plugin or agent crash could take down the desktop host. Rejected.

### Tauri with a Node sidecar

Produces a smaller shell but retains the Node sidecar and adds Rust/WebView integration work without reducing the largest runtime cost. It may be revisited if distribution size becomes a measured adoption problem.

## Consequences

Positive:

- Maximum reuse of upstream TypeScript and React assets.
- Harness crashes and upgrades are isolated behind one adapter.
- Security boundary is reviewable and testable.
- Native desktop capabilities stay separate from agent/plugin authority.

Negative:

- Electron plus bundled Node increases application size and idle memory.
- The local protocol and process supervisor require dedicated testing.
- Some functionality may temporarily lag a new Harness release until the adapter is updated.

## Compatibility policy

- Each desktop release supports one exact Harness version unless a tested compatibility range is declared.
- Startup fails closed on an incompatible protocol and offers repair/update guidance.
- Contract fixtures replay representative upstream event logs in CI.
- Upgrading Harness requires adapter tests, migration tests, packaged runtime smoke tests, and an updated compatibility manifest.
