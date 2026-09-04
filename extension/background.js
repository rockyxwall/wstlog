// ACTLog Standalone Browser Activity Tracker (v0.0.1)
const HEARTBEAT_ALARM = 'actlog_heartbeat_alarm';
const MIN_SESSION_DURATION_MS = 1000; // Ignore under 1s to prevent bounce bloat

function extractDomain(rawUrl) {
  if (!rawUrl) return 'Internal';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'chrome:' || parsed.protocol === 'chrome-extension:') {
      return `${parsed.protocol}//${parsed.hostname || parsed.pathname}`;
    }
    return parsed.hostname || rawUrl;
  } catch {
    return rawUrl.slice(0, 30);
  }
}

// Flush currently active session into stored sessions array
async function finalizeActiveSession(reason = 'switch') {
  const store = await chrome.storage.local.get(['current_active', 'sessions']);
  const active = store.current_active;
  if (!active || !active.start_utc) return;

  const now = Date.now();
  const duration = Math.max(0, now - active.start_utc);

  // Commit if greater than minimal threshold
  if (duration >= MIN_SESSION_DURATION_MS) {
    const sessionRecord = {
      id: crypto.randomUUID(),
      domain: active.domain,
      url: active.url,
      title: active.title || active.domain,
      start_utc: active.start_utc,
      end_utc: now,
      duration_ms: duration,
      favIconUrl: active.favIconUrl || '',
      reason: reason
    };

    const sessions = Array.isArray(store.sessions) ? store.sessions : [];
    sessions.push(sessionRecord);

    // Keep up to 50,000 clean session records locally
    if (sessions.length > 50000) {
      sessions.splice(0, sessions.length - 50000);
    }

    await chrome.storage.local.set({
      sessions: sessions,
      current_active: null
    });
  } else {
    // Transient switch < 1s, discard active without bloat
    await chrome.storage.local.set({ current_active: null });
  }
}

// Start tracking a new active tab session
async function startActiveSession(tab) {
  if (!tab || !tab.id || !tab.url) return;

  // Finalize any previous session before starting new one
  await finalizeActiveSession('tab_change');

  const domain = extractDomain(tab.url);
  const now = Date.now();

  const newActive = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    domain: domain,
    title: tab.title || domain,
    start_utc: now,
    last_tick_utc: now,
    favIconUrl: tab.favIconUrl || ''
  };

  await chrome.storage.local.set({ current_active: newActive });
}

// Refresh current active tab from Chrome query
async function checkActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) {
      // Browser minimized or focused outside Chrome
      await finalizeActiveSession('window_unfocused');
      return;
    }

    const store = await chrome.storage.local.get(['current_active']);
    const active = store.current_active;

    // If still on the same tab and URL, just update heartbeat tick
    if (active && active.tabId === tab.id && active.url === tab.url) {
      active.last_tick_utc = Date.now();
      if (tab.title && tab.title !== active.title) {
        active.title = tab.title;
      }
      await chrome.storage.local.set({ current_active: active });
      return;
    }

    // Otherwise transition to new active tab
    await startActiveSession(tab);
  } catch (err) {
    console.debug('[ACTLog background] checkActiveTab error:', err);
  }
}

// Chrome Event Listeners
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await startActiveSession(tab);
  } catch (err) {
    console.debug(err);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only trigger when URL or title changes on the active tab
  if (!tab.active) return;
  if (changeInfo.url || (changeInfo.title && changeInfo.status === 'complete')) {
    await startActiveSession(tab);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const store = await chrome.storage.local.get(['current_active']);
  if (store.current_active && store.current_active.tabId === tabId) {
    await finalizeActiveSession('tab_closed');
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome lost OS focus
    await finalizeActiveSession('window_blur');
  } else {
    await checkActiveTab();
  }
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === 'idle' || newState === 'locked') {
    await finalizeActiveSession(`idle_${newState}`);
  } else if (newState === 'active') {
    await checkActiveTab();
  }
});

// Periodic alarm (1 min) to update current active session heartbeat
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  await checkActiveTab();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  await checkActiveTab();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    const store = await chrome.storage.local.get(['current_active']);
    if (store.current_active) {
      store.current_active.last_tick_utc = Date.now();
      await chrome.storage.local.set({ current_active: store.current_active });
    }
  }
});
