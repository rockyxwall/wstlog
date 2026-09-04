# Implementation Plan: Standalone In-Browser Activity Logger (v0.0.1)

**Branch**: `001-chrome-extension` | **Date**: 2026-09-04 | **Spec**: [spec.md](file:///e:/lazyman/rockyxwall/02_Codeing/01_Github/actlog/specs/001-chrome-extension/spec.md)

## Summary
Upgrade the Chrome extension to v0.0.1 as a 100% standalone in-browser activity tracker and logger. Employs event-driven architecture (`tabs`, `webNavigation`, `windows`, `idle`) to record every website visit into clean, aggregated session intervals. All data lives in `chrome.storage.local` with full search, daily stats, and JSON export.

## Technical Architecture

### 1. Event Tracking Engine (`background.js`)
- State machine tracking `currentActiveSession`: `{ domain, url, title, start_utc, tabId, windowId }`.
- Transition triggers that flush & record the active session:
  - `chrome.tabs.onActivated`: Active tab switches within the focused window.
  - `chrome.tabs.onUpdated`: URL changed or title loaded.
  - `chrome.windows.onFocusChanged`: Window focus shifts away from Chrome (pause) or returns to Chrome (resume).
  - `chrome.idle.onStateChanged`: System idle (idle/locked) pauses tracking; active resumes.
- Flushed sessions are committed to `chrome.storage.local.sessions`.
- Periodic alarm (every 1m) commits elapsed time for open tab so sudden browser kills don't lose the active session.

### 2. Standalone Dashboard & Log Viewer (`popup.html`, `popup.js`, `popup.css`)
- Cold load directly from `chrome.storage.local`.
- Live ticker calculating real-time elapsed duration for current active tab.
- Filterable & searchable full log table.
- Summary bar charts for top domains today.
- Export as JSON utility.

## Constitution & Ponytail Check
- [x] Zero build dependencies, zero framework runtime.
- [x] Clean sessions: one row per continuous visit interval, zero database bloat.
- [x] 100% standalone: zero requirement for desktop app.
