# Privacy

DSH Desktop is local-first and has no product account service or analytics pipeline. Telemetry is disabled.

## Data stored on this Mac

- Authorized project metadata and the active project in the app's SQLite database.
- Task/worktree metadata, session identifiers, branches, and base commits.
- API key ciphertext encrypted through macOS Keychain-backed `safeStorage`.
- Harness-owned session history and desktop-managed Git worktrees under the app data directory.

## Data sent elsewhere

Prompts and any repository context selected by Harness are sent to the configured model endpoint. The endpoint operator's terms and privacy policy govern that traffic. Opening links or configured external editors invokes those local/system applications. DSH Desktop does not send product analytics or crash reports.

HTTP/HTTPS links opened in the right-side in-app browser are requested directly from that site in an isolated, in-memory browser session. The browser denies permission requests and downloads, but the destination still receives ordinary network metadata such as the IP address and request headers. Right-side Markdown preview, including `Produced` files opened from the embedded Harness window, is local and does not automatically load remote images or other embedded resources.

## Diagnostics

Diagnostic export is user-initiated. It contains app/runtime state, recent redacted logs, counts, non-path project names/IDs, and non-secret settings. It excludes the API key, gateway capability, raw endpoint URL, task content, diffs, and absolute repository paths.

## Deletion

Discarding a task removes its generated worktree and branch after confirmation; committed objects may remain recoverable through Git reflogs until Git expires them. Removing a project from Recents does not delete its repository. Uninstalling the app does not automatically remove its app-data directory or Keychain-backed ciphertext; delete those explicitly if full local removal is required.
