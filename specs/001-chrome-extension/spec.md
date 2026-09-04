# Feature Specification: Standalone In-Browser Activity Logger (Chrome Extension v0.0.1)

**Feature Branch**: `001-chrome-extension`  
**Created**: 2026-09-04  
**Status**: Specified (v0.0.1 Standalone)  
**Input**: Extension must track everything inside browser, create clean non-bloated session logs, function 100% standalone without desktop daemon, and provide full log inspection.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Standalone Active Tab Tracking (Priority: P1)
As a browser user, I want the extension to automatically track my active tab, URL, domain, and title in real time, completely standalone without needing any desktop software running.

**Independent Test**:
- Install extension in Chrome.
- Browse 3 websites (`github.com`, `wikipedia.org`, `news.ycombinator.com`).
- Open extension popup.
- Verify active tab live timer and clean session recording.

**Acceptance Scenarios**:
1. **Given** standalone extension, **When** navigating or switching tabs, **Then** track active tab duration cleanly.
2. **Given** browser window unfocused or minimized, **When** focus lost, **Then** pause tracking until focus resumes.

---

### User Story 2 - Clean Non-Bloated Session Merge (Priority: P1)
As a user, I want full activity logs without database bloat (merging continuous visits into clean session intervals with start/end timestamps and duration).

**Independent Test**:
- Stay on a single tab for 2 minutes.
- Check logs: exactly ONE clean session entry with `duration_ms: 120000`, NOT 40 periodic heartbeat entries.
- Navigate to new page on same site: previous session closes cleanly; new session starts.

**Acceptance Scenarios**:
1. **Given** active session on URL A, **When** user switches to URL B, **Then** close URL A session with exact `end_time` and `duration_ms`, insert URL B session.
2. **Given** brief rapid tab switches (<2s), **When** reviewing logs, **Then** still record exact visits without data loss or corruption.

---

### User Story 3 - Full Logs & Domain Analytics in Popup (Priority: P2)
As a user, I want to view full activity logs, filter by domain/search, and view time spent per domain today directly in the popup.

**Independent Test**:
- Open popup dashboard.
- See:
  - Current Active Tab & Live timer
  - Today's Domain Breakdown with visual progress bars
  - Full Activity Logs table (time, domain, page title, duration)
  - Search filter input to search past visits
  - One-click JSON export for offline backup

---

### User Story 4 - Optional Desktop Collector Bridge (Priority: P3)
As a user who *also* runs the desktop ACTLog daemon, the extension can detect the local daemon on `127.0.0.1:5566` and optionally offer bidirectional sync, but operates 100% reliably even if the daemon is never installed.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: Version MUST be `0.0.1` in `manifest.json`.
- **FR-002**: Extension MUST operate completely standalone with zero external process dependency.
- **FR-003**: Manifest MUST request permissions: `tabs`, `storage`, `webNavigation`, `idle`, `alarms`.
- **FR-004**: Background worker (`background.js`) MUST listen to:
  - `chrome.tabs.onActivated` (tab switch)
  - `chrome.tabs.onUpdated` / `chrome.webNavigation.onCommitted` (URL/title changes)
  - `chrome.windows.onFocusChanged` (browser minimize/unfocus)
  - `chrome.idle.onStateChanged` (idle / lock detection)
- **FR-005**: Storage schema in `chrome.storage.local`:
  ```json
  {
    "sessions": [
      {
        "id": "uuid",
        "domain": "github.com",
        "url": "https://github.com/...",
        "title": "Page Title",
        "start_utc": 1725450000000,
        "end_utc": 1725450060000,
        "duration_ms": 60000,
        "favIconUrl": "..."
      }
    ],
    "settings": { "idle_threshold_secs": 60 }
  }
  ```
- **FR-006**: Session merge logic MUST prevent duplicate rows and bloat: only finalize and commit a session row on tab switch, navigation, idle, or window blur.
- **FR-007**: Popup MUST display:
  - Live active tab & duration ticker
  - Today's domain breakdown (time per domain + %)
  - Full searchable activity log list
  - Export logs button (downloads `.json`)
  - Clear logs button with confirmation
- **FR-008**: Pure Vanilla JS, HTML, CSS. Zero npm/build dependencies.
