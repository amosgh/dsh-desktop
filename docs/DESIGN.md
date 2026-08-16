# DSH Desktop implemented design system

This file describes the interface that exists in `src/renderer`, not an aspirational mockup.

## Product expression

DSH Desktop is calm, operational, and explicit about consequences. It uses a compact macOS sidebar and one primary workspace instead of an IDE-style wall of panels. Color communicates state but is always paired with text. The product name and community-preview disclaimer remain visible so the client cannot be mistaken for an official DeepSeek application.

## Foundations

- System typography: San Francisco through `-apple-system`; monospace content uses SF Mono/Menlo.
- Surfaces: `--background`, `--surface`, and `--surface-subtle` form three restrained levels.
- Text: `--text`, `--muted`, and `--faint` preserve a clear hierarchy in light and dark appearance.
- Semantic color: accent for selection/action, success for complete/review-ready, warning for waiting, and danger for errors or destructive actions.
- Borders and shadows remain subtle; glow, glassmorphism, decorative gradients, and infinite motion are intentionally absent.
- Spacing is based on a 4 px rhythm, with 8–12 px control gaps and 18–28 px section gaps.

The actual values live at the top of `src/renderer/styles.css`; changing a token requires checking both appearance modes.

## Components and patterns

- Sidebar: five stable destinations—Runtime, Projects, Tasks, Inbox, Settings—with count badges only when actionable.
- Workspace header: context line, one page title, and at most one primary page-level action.
- Task timeline: narrative first; tool payloads and operational detail are progressively disclosed. Assistant streaming is merged into stable rows.
- Inbox card: names the requesting task, operation, exact arguments, risk, and one-time decision. A resolving state prevents double submission.
- Review browser: file list and unified diff share the workspace; commit and discard remain explicit actions. Discard always crosses a native confirmation boundary.
- Settings: grouped form fields, credential status without secret echo, connection test, and redacted diagnostics.
- Empty/error states: explain what happened and the next useful action; errors use `role="alert"`.

## Interaction and accessibility

- Native menu commands: `⌘N` new task, `⌘O` add project, `⇧⌘H` Harness, `⇧⌘R` restart.
- Navigation shortcuts: `⌘1` Runtime, `⌘2` Projects, `⌘3` Tasks, `⌘4` Inbox, `⌘,` Settings.
- All actions use native buttons/inputs; focus is visible and keyboard order follows visual order.
- Live Inbox changes use a polite live region. Streaming text itself is not repeatedly announced.
- `prefers-reduced-motion` removes nonessential transition and animation duration.
- State is never conveyed by color alone. Light/dark themes use the same information hierarchy.

## Copy rules

Use direct Simplified Chinese, name the object being changed, and state lasting consequences before destructive work. Avoid anthropomorphic claims, vague “AI magic,” and success language before a command actually completes.
