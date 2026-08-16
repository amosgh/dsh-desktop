# DSH Desktop — information architecture

## 1. Navigation model

The app uses one window with progressive detail. It must remain usable at 1024 × 700 and support denser layouts on large displays.

```text
App
├── Inbox
│   ├── Needs approval
│   └── Ready for review
├── Projects
│   └── Project
│       ├── Tasks
│       └── Archived tasks
├── Plugins                         post-MVP
└── Settings
    ├── Models & credentials
    ├── Execution & permissions
    ├── Git & worktrees
    ├── Editors & terminal
    ├── Appearance & language
    └── Runtime & diagnostics
```

Inbox is a filtered operational view, not a separate copy of task data.

## 2. Primary app shell

### Sidebar

- Inbox counters appear only when action is required.
- Projects are collapsible and ordered by recent activity.
- Tasks show title, primary state, and optional worktree/branch label.
- Running, blocked, failed, and review states use both icon and text/tooltip.
- Sidebar supports keyboard navigation, context menus, rename, archive, and reveal in Finder.

### Task workspace

The central pane is a chronological task narrative:

- User instructions.
- Assistant updates and final responses.
- Plan state.
- Tool activity summaries.
- Approval and user-input cards.
- Errors and recovery actions.

The timeline does not render token-level internal reasoning. Streaming text is grouped into stable message blocks to avoid layout churn.

### Inspector

The inspector is contextual, resizable, and dismissible. It has three tabs:

1. **Changes** — repository summary, changed files, diff, tests.
2. **Task** — plan, model, permissions, worktree, run metadata.
3. **Activity** — terminal sessions and detailed tool/event log.

The inspector collapses into a sheet-like secondary view on narrow windows. It is never required for ordinary reading or approval.

### Composer

- Multiline prompt with file/image attachment affordance when supported.
- Model, execution mode, and workspace mode are visible but compact.
- Enter sends; Shift+Enter inserts a newline; shortcuts are configurable only after MVP.
- While running, the primary adjacent action becomes Stop without replacing the composer.

## 3. Screen specifications

### 3.1 First-run setup

Use a linear inline flow rather than a stack of modal dialogs:

1. Welcome and community-client disclosure.
2. Runtime check.
3. Model credential and endpoint.
4. Connection result.
5. Choose first project.

The user can return to any completed step. Credential errors remain next to the field; runtime logs are expandable under the failed check.

### 3.2 Project empty state

Teach the first action:

- Project name, path, repository/branch summary.
- Primary prompt composer.
- Two or three repository-aware starter prompts.
- Brief explanation of isolated worktrees with a link to settings.

Do not fill the empty state with feature marketing.

### 3.3 Running task

Persistent orientation header:

`Project / Task title · Running · worktree branch · model`

Current activity is a single plain-language line such as “Running tests” with elapsed time. Raw command output expands in place. New events do not steal scroll position when the user is reading history; a “Jump to latest” control appears instead.

### 3.4 Approval required

The decision card stays inside the event sequence and is mirrored in Inbox. Keyboard focus moves only if the user is currently following the latest event; otherwise a non-disruptive banner appears.

Risk vocabulary:

- **Read** — observes data without mutation.
- **Write** — changes files inside the approved workspace.
- **Execute** — launches a local command or process.
- **Connect** — accesses a named network destination.
- **Elevated** — escapes the active workspace or policy boundary.
- **Destructive** — may irreversibly remove or overwrite work.

Risk words are not replaced by color.

### 3.5 Review

Review opens Changes by default and keeps the final agent summary visible.

- Header: files changed, additions/deletions, test status, base and result refs.
- File list: status, path, unresolved binary/rename marker.
- Diff: unified by default, split optional, whitespace toggle, line wrapping.
- Actions: Continue task, Open in editor, Commit, Apply result, Discard worktree.

Consequential Git actions live in the review header, not beside individual chat messages.

### 3.6 Settings

Settings is a full route with search, not a modal.

- Changes save explicitly when they affect credentials or execution policy.
- Cosmetic preferences may save immediately.
- Each permission setting explains effective scope and storage location.
- Runtime page shows app version, pinned Harness version, process state, ports without tokens, log location, and restart/export actions.

## 4. Interaction hierarchy

1. Task narrative and required decisions.
2. Current operational state.
3. Code changes and evidence.
4. Raw logs and implementation detail.

This ordering determines default expansion. A successful repetitive read or search is summarized; a failed command, changed file, approval, or unexpected process exit remains prominent.

## 5. Command and menu model

Minimum macOS commands:

| Command | Shortcut |
| --- | --- |
| New task | Command–N |
| Open project | Command–O |
| Quick switcher | Command–K |
| Find in task | Command–F |
| Toggle inspector | Command–Option–I |
| Show changes | Command–Shift–D |
| Stop active run | Command–Period |
| Settings | Command–Comma |

Destructive actions do not receive single-stroke global shortcuts.

## 6. Feedback and motion

- Ordinary state transitions complete in 150–250 ms.
- Motion explains panel appearance, state change, and completion; it never decorates streamed output.
- Skeletons represent initial loading; determinate progress is used only when the runtime provides a real measure.
- Reduce Motion replaces movement with immediate state changes or a short crossfade.
- Native notifications are actionable but never the only place a state appears.

## 7. Empty, loading, and error states

Every major view defines all three:

| Surface | Empty | Loading | Error recovery |
| --- | --- | --- | --- |
| Projects | Choose a folder | Restore recent projects | Locate moved folder / remove reference |
| Tasks | Start a task | Replay session events | Retry load / inspect diagnostics |
| Timeline | Explain task input | Stable event skeleton | Reconnect / restart sidecar |
| Changes | “No tracked changes” | Compute Git status | Retry / open external Git tool |
| Models | Add provider | Test connection | Edit endpoint/key / view response code |
| Inbox | “Nothing needs you” | Derive task states | Rebuild from session events |

Errors use concrete language: what failed, what remains safe, and what the next action does.

## 8. Visual direction for implementation

The product defaults to a restrained system-native visual language. Use one UI sans stack, compact but breathable density, tonal surface separation, and one accent reserved for selection and primary action. Light and dark appearances are equal requirements.

Avoid decorative cards. Timeline groups use spacing and typography; borders and surfaces appear only when they communicate interaction, scope, or risk. Agent, terminal, plan, and approval events must share one coherent component vocabulary rather than looking like embedded mini-apps.

Detailed visual tokens intentionally remain unset until the first coded shell exists. At that point, generate `DESIGN.md` from implemented tokens and components so the specification reflects the real interface rather than invented values.
