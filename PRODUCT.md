# Product

## Register

product

## Users

DSH Desktop serves developers who want to run DeepSeek Harness against real local repositories without living in a terminal. They may work alone or supervise several coding tasks in parallel. Their primary job is to start an agent task, understand what it is doing, intervene safely, and review the resulting code without losing the state of their main checkout.

The first release is macOS-first, Simplified-Chinese-first, and designed for bring-your-own-key users of the DeepSeek API or another OpenAI-compatible endpoint.

## Product Purpose

DSH Desktop is a local-first macOS control plane for DeepSeek Harness. It turns Harness sessions, tools, approvals, terminals, Git changes, and isolated worktrees into one coherent desktop workflow.

The product is not an IDE and is not a generic chatbot. It succeeds when a developer can delegate a repository task, leave it running, safely resolve interruptions, inspect every material change, and either apply or discard the result with confidence.

The first public form is an open-source community client and must not imply that it is an official DeepSeek application.

## Brand Personality

Restrained, trustworthy, focused.

The product should feel calm under load and precise around consequential actions. Its voice is direct and professional, with enough explanation to keep the user oriented. It borrows the clarity and task orchestration of Codex without copying OpenAI's brand expression.

## Anti-references

- Do not copy Codex's brand identity, visual assets, or distinctive trade dress.
- Do not use the generic “futuristic AI” look: large gradients, neon glow, decorative glassmorphism, or animated noise.
- Do not turn the product into a dense IDE clone with permanently visible panels and controls competing for attention.
- Do not hide agent activity behind vague loading states or anthropomorphic theatre.
- Do not make destructive Git, filesystem, command, or network actions visually equivalent to ordinary conversation.

## Design Principles

1. **Supervision before spectacle.** Always show what is running, blocked, changed, and ready for review.
2. **Progressive operational detail.** Keep the task narrative readable; reveal raw commands, logs, and payloads on demand.
3. **Consequences are explicit.** Permission requests and Git actions must name the target, scope, and lasting effect.
4. **Parallel work stays legible.** Project, task, session, and worktree identities remain visible and unambiguous.
5. **Use platform conventions.** Standard macOS navigation, menus, keyboard behavior, notifications, and security affordances take precedence over novelty.

## Accessibility & Inclusion

Target WCAG 2.2 AA. All core flows must support keyboard-only operation, visible focus, VoiceOver-readable labels and status changes, non-color state cues, and reduced motion. Both light and dark appearances are required. Simplified Chinese ships first, while all user-facing strings are internationalization-ready for English.
