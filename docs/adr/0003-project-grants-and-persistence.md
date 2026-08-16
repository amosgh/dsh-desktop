# ADR-0003: project grants and desktop persistence

Status: accepted

## Context

The desktop app needs durable recent projects without allowing Renderer to submit arbitrary filesystem paths. Project identity must also remain stable when a user selects a subdirectory or a path containing symbolic links.

## Decision

- Project access begins only in Electron Main through the native macOS directory picker.
- A selected directory must be readable, writable, and inside a Git worktree.
- Main resolves the selection and Git top-level directory through `realpath` before persisting it.
- Renderer receives an opaque UUID and project metadata. Later operations accept only that UUID and resolve the authorized path in Main.
- Project records and the active-project setting live in `desktop.sqlite` beneath Electron's application data directory.
- The database uses WAL mode, foreign keys, a numbered schema migration, unique canonical paths, and transactional active-project changes.
- Selecting or activating a project restarts Harness with the authorized repository root as its working directory.
- Removing a record never deletes repository files. Removing the active record first returns Harness to the user's Documents directory.

## Consequences

Renderer cannot grant itself new filesystem scope by forging a path. Re-selecting a nested directory or alias deduplicates to the same repository grant. The initial database schema is intentionally small; task, worktree, and event tables will be added through forward migrations.
