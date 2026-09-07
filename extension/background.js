// ACTLog Standalone Browser Activity Tracker (v0.0.1)
// Ponytail: native Chrome APIs, sequential async lock, AFK audio bypass, crash recovery

const HEARTBEAT_ALARM = 'actlog_heartbeat_alarm';
const DESKTOP_SYNC_ALARM = 'actlog_desktop_sync_alarm';
const DESKTOP_API_URL = 'http://127.0.0.1:5566/api/sessions';
const MAX_DESKTOP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days sliding window
const MAX_DESKTOP_RECORDS = 30000;
const IDLE_DETECTION_SECONDS = 120; // 2 minutes
const MAX_UNATTENDED_MEDIA_MS = 4 * 60 * 60 * 1000; // 4 hours cap on unattended audio
const MIN_SESSION_DURATION_MS = 1000; // Ignore micro-glitches under 1s

// Sequential Promise Queue: guarantees atomic storage read-modify-write without race conditions
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch(err => console.debug('[ACTLog background] Queue task error:', err));
  return queue;
}

// Strip noisy tracking params from URLs to save storage space and protect privacy
function sanitizeUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
      return `${url.protocol}//${url.hostname || url.pathname}`;
    }
    const trackingPrefixes = ['utm_', 'fbclid', 'gclid', 'ref', 'source', 'token', 'session'];
    const searchParams = new URLSearchParams(url.search);
    const toDelete = [];
    for (const key of searchParams.keys()) {
      if (trackingPrefixes.some(prefix => key.toLowerCase().startsWith(prefix))) {
        toDelete.push(key);
      }
    }
    toDelete.forEach(k => searchParams.delete(k));
    url.search = searchParams.toString();
    return url.toString();
  } catch {
    return rawUrl.slice(0, 120);
  }
}

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

// Finalize active tab session into persistent store
async function finalizeActiveSession(reason = 'switch') {
  const store = await chrome.storage.local.get(['current_active', 'sessions']);
  const active = store.current_active;
  if (!active || !active.start_utc) return;

  const now = Date.now();
  const duration = Math.max(0, now - active.start_utc);

  if (duration >= MIN_SESSION_DURATION_MS) {
    const sessionRecord = {
      id: crypto.randomUUID(),
      type: 'active',
      domain: active.domain,
      url: active.url,
      title: active.title || active.domain,
      start_utc: active.start_utc,
      end_utc: now,
      duration_ms: duration,
      favIconUrl: active.favIconUrl || '',
      is_audible: !!active.is_audible,
      reason: reason
    };

    const sessions = Array.isArray(store.sessions) ? store.sessions : [];
    sessions.push(sessionRecord);

    if (sessions.length > 50000) {
      sessions.splice(0, sessions.length - 50000);
    }

    await chrome.storage.local.set({
      sessions: sessions,
      current_active: null
    });
  } else {
    await chrome.storage.local.set({ current_active: null });
  }
}

// Finalize idle / AFK session into persistent store
async function finalizeIdleSession() {
  const store = await chrome.storage.local.get(['current_idle', 'sessions']);
  const idle = store.current_idle;
  if (!idle || !idle.start_utc) return;

  const now = Date.now();
  const duration = Math.max(0, now - idle.start_utc);

  if (duration >= 5000) { // Keep idle sessions > 5s
    const idleRecord = {
      id: crypto.randomUUID(),
      type: 'idle',
      domain: 'Idle / Away',
      url: '',
      title: 'User inactive (AFK)',
      start_utc: idle.start_utc,
      end_utc: now,
      duration_ms: duration,
      reason: idle.reason || 'idle'
    };

    const sessions = Array.isArray(store.sessions) ? store.sessions : [];
    sessions.push(idleRecord);

    if (sessions.length > 50000) {
      sessions.splice(0, sessions.length - 50000);
    }

    await chrome.storage.local.set({
      sessions: sessions,
      current_idle: null
    });
  } else {
    await chrome.storage.local.set({ current_idle: null });
  }
}

// Start tracking idle session
async function startIdleSession(reason = 'idle') {
  await finalizeActiveSession(reason);
  const now = Date.now();
  const newIdle = {
    start_utc: now,
    last_tick_utc: now,
    reason: reason
  };
  await chrome.storage.local.set({ current_idle: newIdle });
}

// Start tracking active tab session
async function startActiveSession(tab) {
  if (!tab || !tab.id || !tab.url) return;

  await finalizeIdleSession();
  await finalizeActiveSession('tab_change');

  const domain = extractDomain(tab.url);
  const cleanUrl = sanitizeUrl(tab.url);
  const now = Date.now();

  const newActive = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: cleanUrl,
    domain: domain,
    title: tab.title || domain,
    start_utc: now,
    last_tick_utc: now,
    last_active_input_utc: now,
    is_audible: !!tab.audible,
    favIconUrl: tab.favIconUrl || ''
  };

  await chrome.storage.local.set({ current_active: newActive });
}

// Check and transition active tab state
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
    const cleanUrl = sanitizeUrl(tab.url);

    // If still on the same tab and URL, update heartbeat tick and audio state
    if (active && active.tabId === tab.id && active.url === cleanUrl) {
      active.last_tick_utc = Date.now();
      active.is_audible = !!tab.audible;
      if (tab.title && tab.title !== active.title) {
        active.title = tab.title;
      }
      await chrome.storage.local.set({ current_active: active });
      return;
    }

    await startActiveSession(tab);
  } catch (err) {
    console.debug('[ACTLog background] checkActiveTab error:', err);
  }
}

// Crash Recovery: commit orphaned sessions from sudden close or crash
async function recoverDanglingSessions() {
  try {
    const store = await chrome.storage.local.get(['current_active', 'current_idle', 'sessions']);
    const sessions = Array.isArray(store.sessions) ? store.sessions : [];
    let modified = false;

    if (store.current_active && store.current_active.start_utc) {
      const active = store.current_active;
      const end = active.last_tick_utc || active.start_utc;
      const dur = Math.max(0, end - active.start_utc);
      if (dur >= MIN_SESSION_DURATION_MS) {
        sessions.push({
          id: crypto.randomUUID(),
          type: 'active',
          domain: active.domain,
          url: active.url,
          title: active.title || active.domain,
          start_utc: active.start_utc,
          end_utc: end,
          duration_ms: dur,
          favIconUrl: active.favIconUrl || '',
          reason: 'recovered_on_startup'
        });
      }
      modified = true;
    }

    if (store.current_idle && store.current_idle.start_utc) {
      const idle = store.current_idle;
      const end = idle.last_tick_utc || idle.start_utc;
      const dur = Math.max(0, end - idle.start_utc);
      if (dur >= 5000) {
        sessions.push({
          id: crypto.randomUUID(),
          type: 'idle',
          domain: 'Idle / Away',
          url: '',
          title: 'User inactive (AFK)',
          start_utc: idle.start_utc,
          end_utc: end,
          duration_ms: dur,
          reason: 'recovered_on_startup'
        });
      }
      modified = true;
    }

    if (modified) {
      await chrome.storage.local.set({
        sessions: sessions,
        current_active: null,
        current_idle: null
      });
    }
  } catch (err) {
    console.debug('[ACTLog background] recoverDanglingSessions error:', err);
  }
}

// Chrome Event Listeners
chrome.tabs.onActivated.addListener((activeInfo) => {
  enqueue(async () => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await startActiveSession(tab);
    } catch (err) {
      console.debug(err);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || (changeInfo.title && changeInfo.status === 'complete') || changeInfo.audible !== undefined) {
    enqueue(async () => {
      await startActiveSession(tab);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const store = await chrome.storage.local.get(['current_active']);
    if (store.current_active && store.current_active.tabId === tabId) {
      await finalizeActiveSession('tab_closed');
    }
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  enqueue(async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await finalizeActiveSession('window_blur');
    } else {
      await checkActiveTab();
    }
  });
});

chrome.idle.onStateChanged.addListener((newState) => {
  enqueue(async () => {
    if (newState === 'idle' || newState === 'locked') {
      const store = await chrome.storage.local.get(['current_active']);
      const active = store.current_active;

      // Check for active media bypass (audio playing)
      if (active && active.tabId && newState === 'idle') {
        try {
          const tab = await chrome.tabs.get(active.tabId);
          const now = Date.now();
          const timeSinceInput = now - (active.last_active_input_utc || active.start_utc);

          // If playing audio and under 4 hours cap, keep active
          if (tab && tab.audible && timeSinceInput < MAX_UNATTENDED_MEDIA_MS) {
            active.is_audible = true;
            active.last_tick_utc = now;
            await chrome.storage.local.set({ current_active: active });
            return;
          }
        } catch (err) {
          // Tab may be gone
        }
      }

      // Transition to idle
      await startIdleSession(`idle_${newState}`);
    } else if (newState === 'active') {
      await finalizeIdleSession();
      await checkActiveTab();
    }
  });
});

// Sync Desktop Sessions from local Rust daemon (127.0.0.1:5566)
async function syncDesktopSessions() {
  try {
    const store = await chrome.storage.local.get(['desktop_sessions', 'desktop_last_sync_utc']);
    const lastSync = store.desktop_last_sync_utc;
    const since = lastSync ? Math.max(0, lastSync - 60000) : (Date.now() - 86400000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);

    const res = await fetch(`${DESKTOP_API_URL}?since=${since}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      await chrome.storage.local.set({ desktop_daemon_active: false });
      return;
    }

    const fetched = await res.json();
    if (!Array.isArray(fetched)) {
      await chrome.storage.local.set({ desktop_daemon_active: false });
      return;
    }

    const existing = Array.isArray(store.desktop_sessions) ? store.desktop_sessions : [];
    const seen = new Set();
    for (const s of existing) {
      seen.add(s.id || `${s.start_utc}_${s.app}_${s.source}`);
    }

    for (const item of fetched) {
      const key = item.id || `${item.start_utc}_${item.app}_${item.source}`;
      if (!seen.has(key)) {
        seen.add(key);
        existing.push(item);
      }
    }

    // Sliding window retention: drop records older than 14 days
    const cutoff = Date.now() - MAX_DESKTOP_RETENTION_MS;
    const pruned = existing.filter(s => (s.end_utc || s.start_utc) >= cutoff);
    if (pruned.length > MAX_DESKTOP_RECORDS) {
      pruned.splice(0, pruned.length - MAX_DESKTOP_RECORDS);
    }

    await chrome.storage.local.set({
      desktop_sessions: pruned,
      desktop_last_sync_utc: Date.now(),
      desktop_daemon_active: true
    });
  } catch (_err) {
    // Daemon offline or unreachable: fall back silently to standalone browser mode
    await chrome.storage.local.set({ desktop_daemon_active: false });
  }
}

// Periodic alarms (heartbeat + desktop sync)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    enqueue(async () => {
      const now = Date.now();
      const store = await chrome.storage.local.get(['current_active', 'current_idle']);
      if (store.current_active) {
        store.current_active.last_tick_utc = now;
        await chrome.storage.local.set({ current_active: store.current_active });
      }
      if (store.current_idle) {
        store.current_idle.last_tick_utc = now;
        await chrome.storage.local.set({ current_idle: store.current_idle });
      }
    });
  } else if (alarm.name === DESKTOP_SYNC_ALARM) {
    enqueue(syncDesktopSessions);
  }
});

// Runtime messages (immediate sync trigger from popup)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'TRIGGER_DESKTOP_SYNC') {
    syncDesktopSessions().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Init & Startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(DESKTOP_SYNC_ALARM, { periodInMinutes: 5 });
  enqueue(async () => {
    await recoverDanglingSessions();
    await checkActiveTab();
    await syncDesktopSessions();
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(DESKTOP_SYNC_ALARM, { periodInMinutes: 5 });
  enqueue(async () => {
    await recoverDanglingSessions();
    await checkActiveTab();
    await syncDesktopSessions();
  });
});
