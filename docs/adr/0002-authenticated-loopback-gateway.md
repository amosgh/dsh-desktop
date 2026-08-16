# ADR-0002: authenticated loopback gateway

Status: accepted

## Context

DeepSeek Harness `0.1.0-rc.6` serves a loopback Web workspace but does not provide an authentication layer suitable for a public desktop application. Opening that endpoint directly would let any local process that discovers the port exercise the same transport.

Electron Renderer must also remain unable to read reusable credentials or discover the raw upstream endpoint.

## Decision

Electron Main owns an ephemeral reverse gateway between the isolated Harness window and the Harness sidecar.

- Both upstream and gateway bind only to `127.0.0.1` on operating-system-assigned ports.
- Each gateway start generates a cryptographically random 256-bit capability token.
- The token is stored as an HttpOnly, SameSite=Strict cookie in a new in-memory Electron session partition.
- Renderer IPC exposes only the protected gateway origin, protocol version, and authentication state. It never exposes the token or raw Harness origin.
- Every HTTP and WebSocket request fails with `401` unless it carries the capability.
- Gateway startup includes a versioned authenticated health handshake. The workspace fails closed when that handshake fails.
- Hop-by-hop headers, upstream cookies, gateway credentials, and upstream `Set-Cookie` headers are not forwarded across the boundary.

## Consequences

This closes the credential gap between the sandboxed Renderer and the desktop-owned workspace window, and gives the desktop app a versioned browser boundary.

It cannot make the upstream Harness listener authenticated: a different local process that discovers the raw upstream port can still reach Harness directly. Eliminating that residual same-user risk requires an upstream token-aware transport, a desktop-only Harness plugin, or a non-TCP carrier. The gateway is defense-in-depth for app components, not a complete same-user or remote multi-user security boundary.
