# DSH Desktop planning index

This directory is the source of truth for the first macOS release.

- [Product specification](./PRODUCT_SPEC.md): scope, workflows, requirements, and acceptance criteria.
- [Information architecture](./INFORMATION_ARCHITECTURE.md): navigation, screen anatomy, interaction model, and UI states.
- [ADR-0001](./adr/0001-electron-sidecar-architecture.md): desktop architecture and the Harness integration boundary.
- [ADR-0002](./adr/0002-authenticated-loopback-gateway.md): capability-token gateway and fail-closed browser boundary.
- [ADR-0003](./adr/0003-project-grants-and-persistence.md): native project authorization, canonical paths, and SQLite ownership.
- [ADR-0004](./adr/0004-harness-rpc-event-recovery.md): official RPC/event transport, normalization, and crash recovery.
- [Implementation plan](./IMPLEMENTATION_PLAN.md): milestones, dependency order, quality gates, and release definition.
- [Phase 0 report](./PHASE_0_REPORT.md): packaged-app evidence, integration findings, and the Phase 1 boundary decision.
- [Implemented design system](./DESIGN.md): real tokens, components, interaction rules, and accessibility behavior.
- [Security](./SECURITY.md): trust boundaries, reporting, and known residual risks.
- [Privacy](./PRIVACY.md): local data, model traffic, diagnostics, and deletion behavior.
- [Release runbook](./RELEASE.md): verification, signing, notarization, rollback, and clean-account acceptance.
- [Third-party notices](./THIRD_PARTY_NOTICES.md): key runtime dependencies and license sources.
- [Contributing](../CONTRIBUTING.md): development and review expectations.

Strategic product and design principles live in [`PRODUCT.md`](../PRODUCT.md).
