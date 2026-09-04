# ACTLog Constitution

## Core Principles

### I. Ponytail & Simplicity First
- Stop at the first rung that holds: reuse existing helpers, native platform features (Win32 APIs, browser DOM/CSS) over dependencies.
- No heavy frameworks: no tokio, no Tauri, no WebSockets, no frontend bundler/framework for the extension.
- Deletion over addition. Boring over clever. Fewest files possible.
- Minimum code that solves the problem. Nothing speculative.

### II. Chrome Extension as Primary UI (Vanilla MV3)
- Chrome MV3 extension is the primary user-facing UI.
- Pure Vanilla JS, HTML, and CSS. Zero npm/node build step or bundler dependencies.
- Dual-mode data fetching:
  - Background: `chrome.alarms` every 5–10 minutes in service worker (`background.js`) to withstand MV3 worker termination.
  - Active: 3s live polling loop in popup page context while popup/dashboard is open.
- Local cache in `chrome.storage.local`.

### III. Tray App as Silent Win32 Collector
- Background collector runs as lightweight Windows tray daemon (`actlog-tray.exe`).
- Win32 named mutex (`Local\ACTLog-Instance-Mutex`) prevents duplicate instances.
- Low overhead polling (~3s) via `GetForegroundWindow` and `QueryFullProcessImageNameW`.
- Handles `ApplicationFrameHost.exe` UWP unwrapping and elevated process permissions safely without crashes.
- AFK detection via `GetLastInputInfo` (180s threshold, sleep-resume delta capping).
- Local REST API on `127.0.0.1:5566` with thread pool, returning JSON with CORS `Access-Control-Allow-Origin: *`.

### IV. Zero-Loss Local Storage & Crash Resilience
- SQLite with WAL mode: dedicated single writer thread, concurrent read connections.
- Heartbeat-merge: consecutive samples for same app+title within gap limit (6–9s) extend `end_utc`; otherwise create a new UUID7 row. Max attribution error bounded by poll interval (~3s).
- Crash recovery on startup caps dangling sessions and records `source=crash_gap`.
- `device_id` recorded on every session for future multi-machine sync.

### V. Spec-Driven Development (SDD) Workflow
- Every non-trivial feature begins with a formal specification (`specs/<feature>/spec.md`).
- Architectural decisions documented in `plan.md`; execution structured via actionable `tasks.md`.
- Implementation follows the tasks; verification required before convergence.

## Additional Constraints & Security
- Local-only networking: REST server binds strictly to `127.0.0.1:5566`. Never expose public interfaces.
- No registry pollution: Startup persistence uses standard `.lnk` shortcut in Windows Startup folder.
- Path resolution: Paths resolved relative to executable or `%APPDATA%`, never CWD.

## Development Workflow
1. **Specify**: Define requirements, scope, and acceptance criteria in `specs/`.
2. **Plan**: Establish technical blueprint adhering to ponytail minimalism.
3. **Tasks**: Sequence bite-sized, verifiable tasks.
4. **Implement & Converge**: Write minimal code and verify against test cases.

## Governance
- Constitution supersedes ad-hoc implementation choices.
- Any architectural change or external dependency requires updating this document and justifying complexity.

**Version**: 1.0.0 | **Ratified**: 2026-09-04 | **Last Amended**: 2026-09-04
