# DSH Desktop

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
- Codex-style right-side preview for conversation Markdown reports and a sandboxed internal browser for HTTP/HTTPS links.
- Keychain-backed API-key encryption, endpoint/model settings, connection checks, and redacted diagnostics export.
- Light/dark appearance and reduced-motion support.

The upstream Web transport still lacks its own authentication layer. Renderer never receives its raw origin or the gateway credential; requests to the desktop gateway without the ephemeral capability receive `401`. The raw upstream loopback port remains reachable to other processes running as the same macOS user until Harness supports a token-aware or non-TCP carrier.

## Supported environment

The current source release intentionally targets one reproducible environment:

- Apple Silicon Mac (`arm64`), not Intel or Rosetta.
- macOS 14 or later.
- Native arm64 Node.js 24 or later and its bundled npm.
- Git and the Xcode Command Line Tools.
- A DeepSeek API key, or credentials for a gateway that implements `/models` and is compatible with DeepSeek's chat-completions request, streaming, reasoning, and tool-call behavior.

Check the environment before installing dependencies:

```bash
uname -m
node --version
node -p "process.arch"
npm --version
git --version
xcode-select -p
```

`uname -m` and `process.arch` must both print `arm64`, and Node must print `v24` or later. If `xcode-select -p` fails, run `xcode-select --install` and finish Apple's installer before continuing.

## Install from GitHub

```bash
git clone https://github.com/amosgh/dsh-desktop.git
cd dsh-desktop
npm ci
```

Use `npm ci`, not `npm install`: the lockfile pins the tested dependency graph and `npm ci` starts from a clean `node_modules` directory. No global DeepSeek Harness installation is required.

The root `postinstall` step downloads the pinned Electron runtime and verifies it against Electron's published checksums. If the Electron download is unreachable on your network, configure a trusted Electron mirror for that command and rerun `npm ci`; do not copy an unverified `Electron.app` into `node_modules`.

## Run in development

```bash
npm run dev
```

Keep the terminal open while using the development app. On first launch:

1. Open **Settings** with `Cmd+,`.
2. Enter the API key. The default endpoint is `https://api.deepseek.com`; enter a base URL, not a `/chat/completions` URL.
3. Select a model, run **Test connection**, then choose **Save and restart Harness**.
4. Add a repository with `Cmd+O`.

The selected project must be a writable Git worktree with at least one commit and a valid `HEAD`. New tasks create isolated worktrees, so keep at least 256 MB of free disk space. The connection test calls `<base URL>/models` and does not create a billable chat completion; a successful catalog response alone cannot prove full chat, streaming, reasoning, or tool-call compatibility.

Markdown reports linked from a conversation, including relative links, absolute worktree paths, and `file://` links, open read-only in a Codex-style right-side panel. The main process verifies that every file remains inside that task's managed worktree and accepts only `.md`/`.markdown` files up to 1 MB. HTTP/HTTPS links open in the same panel through a separate sandboxed web contents process. It denies permission requests, downloads, embedded credentials, `file:` navigation, and executable URL schemes. Other local file types continue to use Finder or the configured external editor.

## Verify the checkout

```bash
npm run verify
```

This runs TypeScript checks, all unit tests, the Harness protocol smoke test, and the crash-recovery smoke test. It uses temporary local data and does not require an API key or contact the DeepSeek API. The narrower `npm run smoke:harness` command is available when diagnosing Harness startup alone.

## Build the local application

```bash
npm run dist:mac
```

The unpacked app is written to `release/mac-arm64/DSH Desktop.app`. Packaging copies the currently running Node executable into the app, which is why the earlier `process.arch` check must report `arm64`.

The local app is unsigned and intended for testing on the machine that built it. Do not redistribute it as a public download. A public DMG/ZIP must be signed with a Developer ID Application certificate and notarized by Apple; see [the release runbook](./docs/RELEASE.md).

## Local data and reset

Application data is stored under `~/Library/Application Support/dsh-desktop`. API-key ciphertext is protected by the logged-in macOS user's Keychain. Removing the application does not remove this directory, its managed worktrees, or the Keychain item automatically; read [the privacy notes](./docs/PRIVACY.md) before deleting local data.

## Common setup problems

- **`npm ci` prints peer/deprecation warnings but exits successfully:** the current pinned Harness dependency graph includes older transitive packages. These warnings are expected for `0.0.2`; treat a non-zero exit code as the installation failure signal.
- **Electron cannot be downloaded:** confirm the machine can reach Electron release assets, or set `ELECTRON_MIRROR` to a trusted mirror and rerun `npm ci`. The installer still validates the downloaded archive against the package checksum list.
- **`npm ci` reports an engine error:** install native Node.js 24+ and confirm `node -p "process.arch"` is `arm64`.
- **A native dependency fails to build:** install or update the Xcode Command Line Tools, then rerun `npm ci`.
- **A project cannot be added or a task cannot start:** confirm the directory is inside a writable Git repository and `git rev-parse HEAD` succeeds.
- **Test connection returns 404:** configure the provider's base URL so `<base URL>/models` is valid; do not paste the full chat-completions path.
- **A third-party endpoint passes connection testing but a task fails:** confirm it implements DeepSeek-compatible streaming, reasoning fields, and tool calls. Passing `/models` is only a credential/catalog check, not a complete protocol certification.
- **The packaged app is blocked on another Mac:** the local build is not signed or notarized. Build it from source on that Mac, or distribute a properly signed and notarized release.

## Planning

See [the planning index](./docs/README.md) for the product specification, design system, security model, architecture decisions, and release plan.
