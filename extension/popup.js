// Standalone Browser Activity Tracker Popup Logic (v0.0.1)

let cachedSessions = [];
let currentActive = null;
let liveTicker = null;

// Tab switcher
const tabOverview = document.getElementById('tab-overview');
const tabLogs = document.getElementById('tab-logs');
const viewOverview = document.getElementById('view-overview');
const viewLogs = document.getElementById('view-logs');
const logCountBadge = document.getElementById('log-count-badge');

// Overview elements
const currentBadge = document.getElementById('current-badge');
const currentDomain = document.getElementById('current-domain');
const currentTitle = document.getElementById('current-title');
const currentTimer = document.getElementById('current-timer');

const metricTodayTime = document.getElementById('metric-today-time');
const metricDomainCount = document.getElementById('metric-domain-count');
const metricSessionCount = document.getElementById('metric-session-count');
const domainBreakdownList = document.getElementById('domain-breakdown-list');

// Logs elements
const logSearchInput = document.getElementById('log-search-input');
const btnExportJson = document.getElementById('btn-export-json');
const btnClearLogs = document.getElementById('btn-clear-logs');
const logsContainer = document.getElementById('logs-container');
const storageStatus = document.getElementById('storage-status');

// Format helpers
function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
}

function formatTickerTime(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getDomainAbbr(domain) {
  if (!domain) return 'ID';
  const clean = domain.replace(/^www\./i, '');
  return clean.slice(0, 2).toUpperCase();
}

// Navigation Tab Switcher
tabOverview.addEventListener('click', () => {
  tabOverview.classList.add('active');
  tabLogs.classList.remove('active');
  viewOverview.classList.remove('hidden');
  viewLogs.classList.add('hidden');
});

tabLogs.addEventListener('click', () => {
  tabLogs.classList.add('active');
  tabOverview.classList.remove('active');
  viewLogs.classList.remove('hidden');
  viewOverview.classList.add('hidden');
  renderLogs(logSearchInput.value.trim());
});

// Load and render data from chrome.storage.local
async function loadData() {
  const store = await chrome.storage.local.get(['current_active', 'sessions']);
  cachedSessions = Array.isArray(store.sessions) ? store.sessions : [];
  currentActive = store.current_active || null;

  logCountBadge.textContent = cachedSessions.length.toString();
  storageStatus.textContent = `${cachedSessions.length} sessions stored`;

  renderOverview();
  if (!viewLogs.classList.contains('hidden')) {
    renderLogs(logSearchInput.value.trim());
  }
}

function renderOverview() {
  // 1. Render Current Tab
  if (currentActive && currentActive.start_utc) {
    currentDomain.textContent = currentActive.domain;
    currentTitle.textContent = currentActive.title || currentActive.url;
    currentBadge.textContent = getDomainAbbr(currentActive.domain);
    updateTicker();
  } else {
    currentDomain.textContent = 'Browser Idle';
    currentTitle.textContent = 'No active webpage focused';
    currentBadge.textContent = 'ID';
    currentTimer.textContent = '00:00:00';
  }

  // 2. Today's Metrics & Domain Breakdown
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMidnight = startOfToday.getTime();

  const todaySessions = cachedSessions.filter(s => s.end_utc >= todayMidnight);
  const domainTotals = {};
  let totalTodayMs = 0;

  for (const s of todaySessions) {
    const dur = s.duration_ms || Math.max(0, s.end_utc - s.start_utc);
    totalTodayMs += dur;
    domainTotals[s.domain] = (domainTotals[s.domain] || 0) + dur;
  }

  // Include current active tab time if from today
  if (currentActive && currentActive.start_utc >= todayMidnight) {
    const activeElapsed = Math.max(0, Date.now() - currentActive.start_utc);
    totalTodayMs += activeElapsed;
    domainTotals[currentActive.domain] = (domainTotals[currentActive.domain] || 0) + activeElapsed;
  }

  metricTodayTime.textContent = formatDuration(totalTodayMs);
  const uniqueDomains = Object.keys(domainTotals);
  metricDomainCount.textContent = uniqueDomains.length.toString();
  metricSessionCount.textContent = todaySessions.length.toString();

  // Top domains list
  const sortedDomains = uniqueDomains
    .map(domain => ({ domain, duration: domainTotals[domain] }))
    .sort((a, b) => b.duration - a.duration);

  if (sortedDomains.length === 0) {
    domainBreakdownList.innerHTML = '<div class="empty-state">No browsing activity recorded today</div>';
  } else {
    domainBreakdownList.innerHTML = sortedDomains.slice(0, 5).map(item => {
      const pct = totalTodayMs > 0 ? Math.round((item.duration / totalTodayMs) * 100) : 0;
      return `
        <div class="domain-item">
          <div class="domain-item-top">
            <span class="domain-item-name" title="${item.domain}">${item.domain}</span>
            <span class="domain-item-time">${formatDuration(item.duration)} (${pct}%)</span>
          </div>
          <div class="domain-progress-bg">
            <div class="domain-progress-bar" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function renderLogs(filterText = '') {
  const query = filterText.toLowerCase();
  const filtered = cachedSessions.filter(s => {
    if (!query) return true;
    return (
      (s.domain && s.domain.toLowerCase().includes(query)) ||
      (s.title && s.title.toLowerCase().includes(query)) ||
      (s.url && s.url.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    logsContainer.innerHTML = '<div class="empty-state">No matching sessions found</div>';
    return;
  }

  // Show newest first
  const displayList = filtered.slice().reverse();

  logsContainer.innerHTML = displayList.map(s => {
    const dur = s.duration_ms || Math.max(0, s.end_utc - s.start_utc);
    return `
      <div class="log-entry">
        <div class="log-main">
          <div class="log-domain-row">
            <span class="log-domain">${s.domain}</span>
            <span class="log-time-stamp">${formatTimestamp(s.start_utc)} - ${formatTimestamp(s.end_utc)}</span>
          </div>
          <div class="log-title" title="${s.title || s.url}">${s.title || s.url}</div>
        </div>
        <span class="log-dur">${formatDuration(dur)}</span>
      </div>
    `;
  }).join('');
}

function updateTicker() {
  if (currentActive && currentActive.start_utc) {
    const elapsed = Math.max(0, Date.now() - currentActive.start_utc);
    currentTimer.textContent = formatTickerTime(elapsed);
  } else {
    currentTimer.textContent = '00:00:00';
  }
}

// Search input listener
logSearchInput.addEventListener('input', (e) => {
  renderLogs(e.target.value.trim());
});

// Export JSON
btnExportJson.addEventListener('click', () => {
  if (cachedSessions.length === 0) {
    alert('No sessions to export.');
    return;
  }
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cachedSessions, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `actlog-browser-logs-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
});

// Clear Logs
btnClearLogs.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all stored browser activity logs?')) {
    await chrome.storage.local.set({ sessions: [] });
    cachedSessions = [];
    logCountBadge.textContent = '0';
    storageStatus.textContent = '0 sessions stored';
    renderOverview();
    renderLogs();
  }
});

// Auto refresh on load and storage updates
window.addEventListener('DOMContentLoaded', () => {
  loadData();
  liveTicker = setInterval(() => {
    updateTicker();
    // Also periodically reload to catch new sessions
    loadData();
  }, 1000);
});

window.addEventListener('unload', () => {
  if (liveTicker) clearInterval(liveTicker);
});
