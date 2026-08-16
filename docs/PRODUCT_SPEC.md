# DSH Desktop — MVP product specification

Status: Proposed baseline<br>
Target: macOS 14+, Apple Silicon first<br>
Distribution: open-source community application<br>
Authentication: bring your own API key

## 1. Product statement

DSH Desktop is a local-first macOS application for directing and supervising DeepSeek Harness across local repositories. It provides a durable task workspace around Harness rather than replacing its agent loop, plugin model, or session log.

## 2. MVP outcome

A developer can install the app, configure a model, open a repository, delegate work in an isolated worktree, respond to approvals, follow progress, inspect the final diff, and either keep or discard the result without using a terminal.

## 3. Scope

### Required for MVP

- First-run setup and runtime health check.
- DeepSeek API key plus a configurable gateway compatible with DeepSeek's OpenAI-style chat, streaming, reasoning, and tool-call behavior.
- Add, remove, rename, and reopen local projects.
- Create, resume, stop, retry, archive, and fork sessions.
- Stream messages, plans, tool calls, terminal activity, and errors.
- Show permission requests for filesystem, command, and network actions.
- Support task execution in the current checkout or an isolated Git worktree.
- Run multiple sessions concurrently without blocking the UI.
- Show repository status and per-file unified or split diff.
- Open a project or changed file in Finder, Terminal, and a configured editor.
- Preserve app state across restart and reconnect to recoverable Harness sessions.
- Native notifications for approval required, task failed, and task ready for review.
- Diagnostics bundle with secrets redacted.

### Deferred

- Scheduled automations and unattended recurring jobs.
- Cloud-hosted execution and cross-device sync.
- Plugin marketplace and third-party account connections.
- Team policy distribution and enterprise administration.
- Built-in code editor, debugger, or language-server UI.
- Automatic merging into a protected or remote branch.
- Usage billing, organization accounts, and subscription management.

## 4. Product model

| Object | Meaning | Owner |
| --- | --- | --- |
| Project | A user-approved local directory and its display metadata | Desktop app |
| Session | Durable Harness event log and agent state | Harness |
| Task | User-facing unit of work represented by one primary session | Desktop app projection |
| Worktree | Optional isolated Git checkout associated with a task | Desktop worktree plugin |
| Run | One active or completed execution interval inside a session | Harness events |
| Approval | A pending decision that blocks or constrains a tool action | Harness policy |
| Review | Projection of Git changes and run outcome for user acceptance | Desktop app |

The desktop database must not duplicate the authoritative Harness event log. It stores presentation state and references, then rebuilds task state from durable session events.

## 5. Task lifecycle

```text
Draft → Starting → Running ───────────────→ Ready for review → Completed
                     │                            │
                     ├→ Waiting for approval ────┤
                     ├→ Waiting for user ────────┤
                     ├→ Paused                    ├→ Continue task
                     └→ Failed → Retry/Continue   └→ Discard worktree
```

Only one primary state is shown at a time. Secondary activity such as “running tests” is displayed separately. “Completed” means the user accepted the outcome; an agent finishing a turn produces “Ready for review,” not automatic completion.

## 6. Primary workflows

### 6.1 First run

1. App verifies bundled Harness, Node runtime, Git, filesystem access, and localhost transport.
2. User enters an API key and optionally changes endpoint/model.
3. Secret is stored in macOS Keychain; only a credential reference is persisted elsewhere.
4. App performs a cancellable, low-cost model connectivity test.
5. User chooses a repository and arrives at its empty task view.

Failure states must distinguish invalid credential, unreachable endpoint, unsupported model, missing Git, and failed Harness startup.

### 6.2 Start a task

1. User selects a project and enters a prompt.
2. Composer shows model, execution mode, and workspace mode.
3. Default workspace mode is isolated worktree for Git repositories and current directory for non-Git folders.
4. Preflight resolves the base commit, verifies the working tree, creates the worktree if needed, and starts the Harness session.
5. The task appears immediately with a deterministic starting state; startup logs remain expandable.

If a worktree cannot be created, the app must explain why and require an explicit choice before falling back to the current checkout.

### 6.3 Supervise a running task

- The timeline prioritizes user/assistant messages and concise tool summaries.
- Command output, structured arguments, and long logs are collapsed by default.
- Stop is always visible while work is active.
- A pending approval raises the task in navigation, focuses a decision card, and may emit a native notification.
- The user may send corrective guidance while the session is running if Harness admits queued input.

### 6.4 Resolve an approval

Every approval card shows:

- Requested action in plain language.
- Exact command, path, or network destination.
- Working directory and affected scope.
- Whether the action writes, executes, connects, or may be destructive.
- Choices: allow once, deny, and allow matching actions when supported by Harness policy.

Persistent permission changes require a separate confirmation and show where the rule will be stored.

### 6.5 Review work

1. When the agent stops with no pending input, the task enters Ready for review.
2. Review shows summary, test evidence, changed files, additions/deletions, and diff.
3. User can continue the task, open files externally, commit the worktree, or discard it.
4. Applying work to another branch is not automatic in MVP; the app presents an explicit Git action and conflict outcome.

Discard must identify uncommitted changes and commits that will become unreachable. It requires destructive confirmation and should use recoverable handling where technically possible.

## 7. Functional requirements

### Runtime and sessions

- Pin one supported Harness version in each app release.
- Generate and require an ephemeral authentication token on the local transport.
- Detect sidecar exit, surface logs, and offer restart without losing desktop state.
- Reconnect event streams without duplicating rendered events.
- Preserve session ordering and raw event fidelity.
- Cancel an active run within two seconds of the user's request, excluding an uninterruptible OS call.

### Projects and filesystem

- Obtain project access through a native folder picker.
- Resolve canonical paths and detect moved or unavailable projects.
- Never broaden access from one project to its parent directory implicitly.
- Display symlink and repository-root mismatches before starting a task.

### Git and worktrees

- Pin task base to a commit SHA.
- Use collision-resistant internal identifiers independent of editable task titles.
- Never remove a worktree containing changes without explicit confirmation.
- Detect submodules, sparse checkout, detached HEAD, ongoing rebase/merge, and missing default branch.
- Serialize repository-level mutations while allowing independent agents to run concurrently.

### Credentials and privacy

- Store API keys only in Keychain.
- Redact credentials, authorization headers, and known secret patterns from app logs and diagnostics.
- Bind local runtime transport to loopback only.
- Renderer process has no direct Node, shell, filesystem, Git, or Keychain access.
- Telemetry is off by default for the first release; crash reporting requires opt-in.

### Internationalization and accessibility

- No user-facing string literals outside the localization layer.
- Core actions have menu items and documented keyboard shortcuts.
- Status is conveyed with text/icon as well as color.
- Timeline announces new approval and completion states to assistive technology without reading every streamed token.
- Respect system appearance, text scaling, contrast, and Reduce Motion settings.

## 8. Non-functional targets

| Measure | Target |
| --- | --- |
| Cold launch to usable project list | ≤ 2.5 s on supported Apple Silicon hardware |
| Task creation feedback | ≤ 150 ms |
| Stream-to-screen latency after receipt | ≤ 100 ms at p95 |
| Idle memory | ≤ 350 MB for app plus sidecar |
| Renderer responsiveness | No input task over 100 ms during normal streaming |
| Crash-free local sessions | ≥ 99.5% during public beta |
| Secret leakage in diagnostics | Zero known occurrences |

These targets are release gates to measure, not claims about the initial scaffold.

## 9. MVP acceptance scenario

The release candidate passes when a clean macOS account can:

1. Install and launch a signed/notarized build.
2. Configure a valid DeepSeek credential and complete connection testing.
3. Add a Git repository and start two isolated tasks from the same base commit.
4. Approve one safe command and deny one network request.
5. Quit and relaunch while a recoverable session exists.
6. Review independent diffs without edits crossing worktrees.
7. Continue one task, commit its result, and safely discard the other.
8. Export a redacted diagnostic bundle that contains no API key.

## 10. Product success signals

- At least 80% of first-time users who add a project successfully reach Ready for review.
- Median time from launch to first submitted task is under five minutes.
- Fewer than 2% of tasks require users to open raw Harness logs to understand why they stopped.
- No confirmed case of one task modifying another task's worktree.
- Approval decisions can be completed without opening an external terminal.

## 11. Open decisions after MVP baseline

- Final product name, icon, and repository name.
- Whether x86_64 macOS ships with the first public beta.
- Default editor discovery order.
- Exact Git integration for applying a worktree result: merge, cherry-pick, patch, or guided choice.
- Whether plugin management enters the beta or the first post-beta release.
