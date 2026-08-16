# ADR-0004: Harness RPC, event normalization, and recovery

Status: accepted for Harness `0.1.0-rc.6`

## Context

The pinned Harness exposes unary RPC at `/api/<method>` and two downlink-only WebSocket streams: `events.mux` for session events/interactions and `events.host` for host-level lifecycle changes. Its v1 `since` seat is documented but ignored; reconnect must refetch a baseline.

## Decision

Electron Main owns the Harness protocol client.

- Unary calls use the official four-quadrant RPC envelope and verify the echoed `rpcId`.
- Session list, create, prompt, and cancel use the official `session.*` methods.
- Main opens both WebSocket streams and considers the protocol connected only after the unary baseline and both sockets succeed.
- Wire values are normalized into a small desktop-owned `ProtocolSnapshot`; raw events and arbitrary RPC methods never cross preload IPC.
- On socket loss, the client closes both streams, applies bounded exponential backoff, reopens both, and refetches `session.list` before publishing a new connection generation.
- Event sequence numbers suppress duplicate or stale session events within the current baseline.
- Pending approval counts are projected now; approval decisions remain a later, separately reviewed IPC surface.
- Unexpected Harness process exit triggers up to five delayed Sidecar restart attempts. A successful restart creates a new protocol baseline and generation.

## Consequences

The desktop task list survives WebSocket loss and Harness process crashes without treating stale in-memory state as authoritative. Full conversation reconstruction still requires `session.history` pagination and projection folding; this decision deliberately covers task-list and lifecycle state first.

The client connects from Main directly to the loopback Harness API. The authenticated browser gateway remains the isolated Renderer-window boundary, not an authentication layer for the upstream listener.
