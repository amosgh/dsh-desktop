# Security policy and model

## Reporting

Do not open a public issue for a suspected vulnerability that exposes credentials, local source, or a reliable exploit. Send a private report to the repository maintainer with the affected version, reproduction, impact, and any proposed mitigation. Maintainers should acknowledge within 3 business days and coordinate disclosure after a fix is available.

## Trust boundaries

- Renderer is sandboxed, has no Node integration, receives a narrow validated preload API, denies permission requests, and has a restrictive CSP/navigation policy.
- Main owns filesystem, Git, SQLite, credentials, native dialogs, child processes, and the Harness transport.
- API keys are encrypted with Electron `safeStorage` backed by the logged-in macOS user's Keychain and are never returned to Renderer after storage.
- Harness runs as a supervised child process on an ephemeral loopback port. The embedded upstream UI is exposed only through a desktop-owned gateway with a 256-bit ephemeral capability in an HttpOnly cookie.
- Every task created by the desktop receives a pinned Git worktree. Repository mutations are serialized per repository; worktree removal is limited to generated paths and requires confirmation.
- Diagnostics exclude API keys, gateway credentials, raw endpoint URLs, and absolute repository paths; the exported file is created with mode `0600`.
- In-app Markdown preview reads only `.md`/`.markdown` files contained by a desktop-managed task worktree, caps content at 1 MB, and never renders raw HTML. Its browser handoff accepts only credential-free HTTP/HTTPS URLs.

## Residual risks

The current Harness Web transport does not authenticate its own raw loopback listener. Another process running as the same macOS user could attempt to reach that ephemeral port while Harness is running. The Renderer never receives the raw origin, and the desktop gateway fails closed, but this cannot fully defend against an already-compromised user account. Replace the carrier with a token-aware or non-TCP transport when Harness supports one.

Runtime log redaction is defense in depth and necessarily heuristic. It removes authorization headers, common API-key/token/secret assignments, credential query parameters, and `sk-…` shaped values before logs cross into Renderer, but cannot recognize every provider-specific secret format. Harness and integrations must not intentionally write credentials, prompts, diffs, or sensitive file content to operational logs.

This client executes coding-agent tools against repositories. Review approvals and diffs before accepting changes, keep repository backups, and treat endpoint/model providers as recipients of task prompts and relevant context.

## Supported versions

Until the first signed public beta, only the latest source revision is supported. Security fixes may change stored data or require a Harness upgrade; migrations are forward-only.
