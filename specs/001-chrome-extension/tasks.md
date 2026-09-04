# Tasks: Standalone In-Browser Activity Logger (v0.0.1)

**Input**: [spec.md](file:///e:/lazyman/rockyxwall/02_Codeing/01_Github/actlog/specs/001-chrome-extension/spec.md), [plan.md](file:///e:/lazyman/rockyxwall/02_Codeing/01_Github/actlog/specs/001-chrome-extension/plan.md)

## Phase 1: Manifest & Permissions (v0.0.1)
- [x] T001 Update `extension/manifest.json` to version `0.0.1`, add permissions: `tabs`, `storage`, `webNavigation`, `idle`, `alarms`

## Phase 2: Standalone Event Tracking & Clean Session Merging
- [x] T002 Implement active tab state machine in `extension/background.js`
- [x] T003 Implement event listeners: `tabs.onActivated`, `tabs.onUpdated`, `windows.onFocusChanged`, `idle.onStateChanged`
- [x] T004 Implement clean session flushing & non-bloat merging into `chrome.storage.local`
- [x] T005 Implement periodic alarm commit (1m) to preserve ongoing active session across crashes

## Phase 3: Standalone Popup UI & Full Logs Viewer
- [x] T006 Update `extension/popup.html` with tabs/views: Dashboard (Live + Domain Breakdown) and Full Logs (Searchable table, Export JSON, Clear)
- [x] T007 Update `extension/popup.css` with tab switcher, search bar, and full log table styles
- [x] T008 Update `extension/popup.js` to read directly from `chrome.storage.local`, render live stats, filter full logs, and export JSON

## Phase 4: Verification
- [x] T009 Validate manifest and extension syntax
- [x] T010 Test clean session merge logic and non-bloat behavior
