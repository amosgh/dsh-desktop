# DSH Desktop — implementation plan

## Delivery assumptions

- One primary macOS product, Apple Silicon first.
- Electron, React, TypeScript, a bundled Node runtime, and a pinned DeepSeek Harness sidecar.
- BYOK only; no user account backend.
- Worktree isolation and code review are MVP requirements.
- The app directory starts as a greenfield project.

## Phase 0 — integration proof (complete)

Goal: retire the highest-risk Harness and packaging assumptions before building UI.

- Pin a Harness release and record its Node/native requirements.
- Start Harness as a child process on an ephemeral loopback port.
- Confirm the current Web transport boundary and record authentication limitations.
- Exercise the upstream workspace through the packaged sidecar.
- Package the spike as an unsigned local `.app` on Apple Silicon.

Exit gate:

- All flows run from the packaged app, not only the development server.
- Missing event cursor/reconnect, approval, and terminal contracts are recorded as Phase 1 adapter requirements.
- Unknowns are recorded as ADR amendments before Phase 1.

## Phase 1 — secure desktop foundation (complete)

Completed foundation slice:

- Added a desktop-owned authenticated loopback gateway for HTTP and WebSocket traffic.
- Added a 256-bit ephemeral capability in an isolated HttpOnly Electron session.
- Added protocol v1 health handshake, fail-closed workspace opening, and unauthorized-request tests.
- Removed the raw Harness origin and gateway credential from Renderer IPC.
- Validated the boundary from the packaged `.app`; an external credential-free request returns `401`.
- Added native Git repository authorization with canonical-path validation and opaque project IDs.
- Added migrated SQLite persistence for recent and active projects.
- Added project activation, Finder reveal, safe record removal, and Harness workspace switching.
- Added official `session.*` RPC calls and dual `events.mux` / `events.host` WebSocket consumption.
- Added desktop-owned task summaries, task creation/cancellation, event sequence deduplication, and reconnect baselines.
- Added paginated `session.history`, live task-detail timelines, stream/final-message merging, and concise tool/context rows.
- Added bounded Sidecar crash restart and verified recovery after a forced `SIGKILL`.

- Configure Electron Main, sandboxed renderer, narrow preload API, CSP, permissions, and navigation guards. ✓
- Add structured logging and diagnostics with synthetic-secret redaction tests. ✓
- Add SQLite migrations and Keychain-backed credential encryption. ✓
- Implement sidecar supervisor, startup diagnostics, bounded crash recovery, and version handshake. ✓
- Add typecheck, unit, integration smoke, recovery, and packaged verification commands. ✓

Exit gate:

- Renderer cannot access Node or arbitrary IPC.
- Invalid sidecar version/token fails closed with an actionable UI error.
- A synthetic secret never appears in persisted logs or exported diagnostics.

## Phase 2 — projects and session loop (complete)

- Implement first-run setup, runtime checks, credential flow, and connection test. ✓
- Add native project picker and persistent recent-project list.
- Implement task list, new task composer, create/resume/stop/retry/archive/fork.
- Build normalized event timeline for messages, plan, tools, errors, and completion. (Messages, tools, context, and terminal states complete; plan projection pending.)
- Add reliable subscription cursor and restart recovery.
- Add native navigation shortcuts, semantic controls, visible focus, Chinese product copy, and reduced-motion support. ✓

Exit gate:

- A user can complete a non-worktree task without the terminal.
- Restarting the app rebuilds the same task timeline without duplicates.
- Timeline remains responsive under a replay fixture with at least 10,000 events.

## Phase 3 — approvals and operational UI (complete)

- Build approval cards with exact action, scope, risk, and decision choices.
- Add waiting states, Inbox projections, native notifications, and focus behavior.
- Add collapsible command/tool output and Activity inspector.
- Implement runtime diagnostics route and redacted export.
- Cover denied, timed-out, stale, and superseded approval cases.

Exit gate:

- Filesystem, command, and network approvals pass end-to-end tests.
- No approval can be resolved twice or against the wrong session.
- VoiceOver announces actionable state changes without narrating every stream chunk.

## Phase 4 — Git worktrees and review (complete)

- Detect repository shape and preflight hazards.
- Pin base SHA and create collision-resistant branch/worktree records.
- Add per-repository mutation queue and stale-worktree recovery.
- Implement Git status, file list, binary/rename handling, unified and split diff.
- Add external editor/Finder/Terminal actions.
- Implement explicit commit, apply-result preparation, and safe discard workflows.
- Test two concurrent tasks from the same base commit.

Exit gate:

- Concurrent sessions cannot write into one another's worktrees.
- Dirty, committed, conflicted, detached, submodule, and sparse-checkout cases have defined outcomes.
- Destructive removal requires confirmation and clearly reports recoverability.

## Phase 5 — beta hardening and distribution (implementation complete; release credentials pending)

- Measure launch, stream rendering, memory, and long-session behavior against PRD targets.
- Add crash recovery, offline endpoint behavior, sleep/wake, network changes, and low-disk handling.
- Complete light/dark appearance, keyboard audit, reduced-motion audit, contrast audit, and Chinese copy review.
- Generate the real `DESIGN.md` from implemented tokens/components and run a UI consistency review.
- Configure Hardened Runtime and entitlements; execute Developer ID signing and Apple notarization when release credentials are supplied.
- Produce privacy, third-party notice, trademark disclaimer, security reporting, and contributor documentation.

Exit gate:

- The full MVP acceptance scenario passes on a clean macOS user account.
- No P0/P1 security, data-loss, isolation, or accessibility defects remain.
- Rollback to the prior release is documented and tested for desktop-owned data.

## Suggested repository shape

```text
.
├── apps/
│   └── desktop/
│       ├── main/
│       ├── preload/
│       └── renderer/
├── packages/
│   ├── protocol/
│   ├── harness-adapter/
│   ├── git-service/
│   ├── persistence/
│   ├── ui/
│   └── test-fixtures/
├── docs/
│   └── adr/
├── PRODUCT.md
└── package.json
```

Use package boundaries as trust boundaries. `renderer` must not depend on implementation packages for Git, persistence, Electron Main, or Harness.

## Testing strategy

### Contract tests

- Replay recorded/synthetic Harness event streams.
- Validate protocol compatibility, unknown events, reconnect cursors, ordering, and cancellation.
- Keep fixtures free of source code and secrets that cannot be published.

### Unit tests

- State projection and lifecycle transitions.
- IPC validation and authorization.
- Path canonicalization and project grants.
- Git command construction and worktree safety predicates.
- Secret redaction and diagnostics filtering.

### Integration tests

- Sidecar startup/crash/restart.
- Keychain round trip.
- Real temporary Git repositories covering worktree edge cases.
- Approval resolution against a controllable fake model/runtime.

### End-to-end tests

- First run through review/discard.
- Two parallel tasks.
- Relaunch/recovery.
- Keyboard-only critical path.
- Packaged `.app`, not just Electron development mode.

## Release controls

- Never auto-update Harness independently of the desktop app.
- Use feature flags only for incomplete post-MVP surfaces; security behavior is not remotely switchable.
- Migrations are forward-only, transactional, and backed up before execution.
- Release artifacts include pinned dependency versions and third-party notices.
- Public beta crash reporting and telemetry remain opt-in.

## Remaining release operations

The implementation is feature-complete for the local MVP. Public distribution still requires external operations that cannot be completed from source alone: Apple Developer ID signing/notarization, update-channel hosting/signing, and a clean-user-account acceptance run. Follow [the release runbook](./RELEASE.md); do not call an unsigned artifact a public beta.
