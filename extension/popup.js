// ACTLog Standalone Activity Tracker — Popup Logic
// Ponytail: pure vanilla JS, zero libraries, backward-compatible, decluttered UI

let cachedSessions = [];
let cachedDesktopSessions = [];
let currentActive = null;
let currentScope = 'pc';
let isDaemonActive = false;
let liveTicker = null;
let selectedDateMs = getMidnight(new Date());

let categories = [];
let domainMappings = {};
const expandedDomains = new Set();
const expandedDesktopApps = new Set();

function getMidnight(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// Universal Version Loader
function initVersion() {
  const el = document.getElementById('app-version');
  if (el) {
    const v = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
      ? chrome.runtime.getManifest().version
      : '0.0.4';
    el.textContent = `v${v}`;
  }
}

// DOM Elements
const tabOverview = document.getElementById('tab-overview');
const tabCategories = document.getElementById('tab-categories');

const viewOverview = document.getElementById('view-overview');
const viewCategories = document.getElementById('view-categories');

// Header & Daemon Status
const daemonStatusBadge = document.getElementById('daemon-status-badge');
const scopeBtnPc = document.getElementById('scope-btn-pc');
const scopeBtnBrowser = document.getElementById('scope-btn-browser');

// Header & Settings Elements
const btnSettings = document.getElementById('btn-settings');
const settingsPopover = document.getElementById('settings-popover');
const popoverStorageCount = document.getElementById('popover-storage-count');

// Date Nav
const btnPrevDay = document.getElementById('btn-prev-day');
const btnNextDay = document.getElementById('btn-next-day');
const currentDateLabel = document.getElementById('current-date-label');

// Focus Summary Hero Elements
const focusHighlightBadge = document.getElementById('focus-highlight-badge');
const heroPeakHour = document.getElementById('hero-peak-hour');
const heroTopSite = document.getElementById('hero-top-site');

const metricActiveTime = document.getElementById('metric-active-time');
const metricIdleTime = document.getElementById('metric-idle-time');
const metricFocusScore = document.getElementById('metric-focus-score');
const timelineContainer = document.getElementById('timeline-container');
const overviewDomainList = document.getElementById('overview-domain-list');

// Breakdown & Desktop Elements
const sectionDesktopApps = document.getElementById('section-desktop-apps');
const drilldownAppList = document.getElementById('drilldown-app-list');
const sectionCategoriesManage = document.getElementById('section-categories-manage');
const sectionCategoryDist = document.getElementById('section-category-dist');
const sectionDomainBreakdown = document.getElementById('section-domain-breakdown');

const categoryChipsList = document.getElementById('category-chips-list');
const categoryBarsList = document.getElementById('category-bars-list');
const drilldownDomainList = document.getElementById('drilldown-domain-list');
const inputNewCat = document.getElementById('input-new-cat');
const btnAddCat = document.getElementById('btn-add-cat');

// Settings & Storage Actions
const btnExportJson = document.getElementById('btn-export-json');
const btnImportJson = document.getElementById('btn-import-json');
const inputImportJson = document.getElementById('input-import-json');
const btnClearLogs = document.getElementById('btn-clear-logs');
const storageStatus = document.getElementById('storage-status');

// Helper formatters
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatTickerTime(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getDomainAbbr(domain) {
  if (!domain) return 'ID';
  const clean = domain.replace(/^www\./i, '');
  return clean.slice(0, 2).toUpperCase();
}

function updateDateLabel() {
  const today = getMidnight(new Date());
  const yesterday = today - 86400000;

  if (selectedDateMs === today) {
    currentDateLabel.textContent = 'Today';
    btnNextDay.disabled = true;
  } else if (selectedDateMs === yesterday) {
    currentDateLabel.textContent = 'Yesterday';
    btnNextDay.disabled = false;
  } else {
    currentDateLabel.textContent = new Date(selectedDateMs).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
    btnNextDay.disabled = false;
  }
}

// Tab Switching (2 primary tabs)
function switchTab(targetViewId, activeTabBtn) {
  [viewOverview, viewCategories].forEach(view => {
    view.classList.toggle('hidden', view.id !== targetViewId);
  });
  [tabOverview, tabCategories].forEach(tab => {
    tab.classList.toggle('active', tab === activeTabBtn);
  });
  renderAllViews();
}

tabOverview.addEventListener('click', () => switchTab('view-overview', tabOverview));
tabCategories.addEventListener('click', () => switchTab('view-categories', tabCategories));

// Settings Popover Handlers
btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPopover.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!settingsPopover.contains(e.target) && e.target !== btnSettings) {
    settingsPopover.classList.add('hidden');
  }
});

// Date Nav Listeners
btnPrevDay.addEventListener('click', () => {
  selectedDateMs -= 86400000;
  updateDateLabel();
  renderAllViews();
});

btnNextDay.addEventListener('click', () => {
  const today = getMidnight(new Date());
  if (selectedDateMs < today) {
    selectedDateMs += 86400000;
    updateDateLabel();
    renderAllViews();
  }
});

// Scope Selector Handlers
function updateScopeButtons() {
  if (!scopeBtnPc || !scopeBtnBrowser) return;
  if (currentScope === 'pc') {
    scopeBtnPc.classList.add('active');
    scopeBtnBrowser.classList.remove('active');
  } else {
    scopeBtnPc.classList.remove('active');
    scopeBtnBrowser.classList.add('active');
  }
}

if (scopeBtnPc) {
  scopeBtnPc.addEventListener('click', () => {
    currentScope = 'pc';
    updateScopeButtons();
    renderAllViews();
  });
}

if (scopeBtnBrowser) {
  scopeBtnBrowser.addEventListener('click', () => {
    currentScope = 'browser';
    updateScopeButtons();
    renderAllViews();
  });
}

// Load storage data
async function loadData() {
  const store = await chrome.storage.local.get([
    'current_active',
    'sessions',
    'desktop_sessions',
    'desktop_daemon_active',
    'desktop_port',
    'categories',
    'domain_mappings'
  ]);
  cachedSessions = Array.isArray(store.sessions) ? store.sessions : [];
  cachedDesktopSessions = Array.isArray(store.desktop_sessions) ? store.desktop_sessions : [];
  currentActive = store.current_active || null;
  isDaemonActive = !!store.desktop_daemon_active;
  const currentPort = store.desktop_port || 5566;

  // Update daemon badge
  if (daemonStatusBadge) {
    if (isDaemonActive) {
      daemonStatusBadge.className = 'daemon-status-badge online';
      daemonStatusBadge.textContent = '🟢 Desktop';
      daemonStatusBadge.title = `Connected to ACTLog Windows Daemon (127.0.0.1:${currentPort})`;
    } else {
      daemonStatusBadge.className = 'daemon-status-badge offline';
      daemonStatusBadge.textContent = '⚪ Browser';
      daemonStatusBadge.title = 'Standalone browser mode (desktop daemon offline)';
    }
  }

  // If no desktop sessions and daemon offline, default scope to browser
  if (cachedDesktopSessions.length === 0 && !isDaemonActive && currentScope === 'pc') {
    currentScope = 'browser';
    updateScopeButtons();
  } else {
    updateScopeButtons();
  }

  // Defaults CAN be deleted now; seeded on initial run only
  if (Array.isArray(store.categories) && store.categories.length > 0) {
    categories = store.categories;
  } else if (!store.categories) {
    categories = [...INITIAL_DEFAULT_CATEGORIES];
    await chrome.storage.local.set({ categories });
  } else {
    categories = [];
  }

  domainMappings = (typeof store.domain_mappings === 'object' && store.domain_mappings !== null)
    ? store.domain_mappings
    : {};

  const totalCount = cachedSessions.length + cachedDesktopSessions.length;
  storageStatus.textContent = `${totalCount} total sessions`;
  if (popoverStorageCount) {
    popoverStorageCount.textContent = `${cachedSessions.length} web / ${cachedDesktopSessions.length} pc`;
  }

  renderAllViews();

  // Trigger non-blocking background sync
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'TRIGGER_DESKTOP_SYNC' }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  }
}

function renderAllViews() {
  const todayMidnight = getMidnight(new Date());
  const isSelectedToday = selectedDateMs === todayMidnight;

  const daySessions = [...cachedSessions];
  if (isSelectedToday && currentActive && currentActive.start_utc) {
    daySessions.push({
      id: 'current_active_temp',
      type: 'active',
      domain: currentActive.domain,
      url: currentActive.url,
      title: currentActive.title,
      start_utc: currentActive.start_utc,
      end_utc: Date.now(),
      duration_ms: Math.max(0, Date.now() - currentActive.start_utc),
      is_audible: currentActive.is_audible
    });
  }

  // 1. Browser stats
  const browserStats = aggregateDayStats(daySessions, selectedDateMs, domainMappings, categories);

  // 2. Desktop stats (with nested browser domains linked)
  const desktopStats = aggregateDesktopDayStats(cachedDesktopSessions, selectedDateMs, browserStats);

  renderOverview(browserStats, desktopStats);
  renderCategoryChips();
  renderCategories(browserStats, desktopStats);
}

function renderOverview(browserStats, desktopStats) {
  const isPcScope = currentScope === 'pc' && (desktopStats.sortedApps.length > 0 || isDaemonActive);

  const activeMs = isPcScope ? desktopStats.totalDesktopActiveMs : browserStats.totalActiveMs;
  const idleMs = isPcScope ? desktopStats.totalDesktopIdleMs : browserStats.totalIdleMs;
  const totalTracked = activeMs + idleMs;
  const focusPct = totalTracked > 0 ? Math.round((activeMs / totalTracked) * 100) : 100;

  // 1. Focus Metrics
  metricActiveTime.textContent = formatDuration(activeMs);
  metricIdleTime.textContent = formatDuration(idleMs);
  metricFocusScore.textContent = `${focusPct}%`;

  // 2. Peak Hour & Top Highlights
  const buckets = isPcScope ? desktopStats.hourlyBuckets : browserStats.hourlyBuckets;
  let peakHour = -1;
  let maxHourActive = 0;
  for (const b of buckets) {
    if (b.activeMs > maxHourActive) {
      maxHourActive = b.activeMs;
      peakHour = b.hour;
    }
  }

  if (peakHour >= 0 && maxHourActive > 0) {
    const nextHour = (peakHour + 1) % 24;
    heroPeakHour.textContent = `⚡ Peak: ${peakHour.toString().padStart(2, '0')}:00–${nextHour.toString().padStart(2, '0')}:00 (${formatDuration(maxHourActive)})`;
  } else {
    heroPeakHour.textContent = '⚡ Peak: No activity yet';
  }

  if (isPcScope) {
    const topApp = desktopStats.sortedApps[0];
    const topDomain = browserStats.sortedDomains[0];
    if (topApp) {
      let topText = `🖥️ Top: ${topApp.app} (${formatDuration(topApp.durationMs)})`;
      if (topDomain) {
        topText += ` · 🌐 ${topDomain.domain}`;
      }
      heroTopSite.textContent = topText;
      focusHighlightBadge.textContent = `${focusPct}% Focus`;
    } else {
      heroTopSite.textContent = '🖥️ Top: No PC apps logged';
      focusHighlightBadge.textContent = 'Rest Day';
    }
  } else {
    if (browserStats.sortedDomains.length > 0) {
      const topD = browserStats.sortedDomains[0];
      heroTopSite.textContent = `🌐 Top: ${topD.domain} (${formatDuration(topD.durationMs)})`;
      focusHighlightBadge.textContent = `${focusPct}% Focus`;
    } else {
      heroTopSite.textContent = '🌐 Top: No sites logged';
      focusHighlightBadge.textContent = 'Rest Day';
    }
  }

  // 3. 24-Hour Timeline Bar
  timelineContainer.innerHTML = buckets.map(b => {
    const totalSlotMs = b.activeMs + b.idleMs;
    const heightPct = Math.min(100, Math.round((totalSlotMs / 3600000) * 100));

    let slotColor = 'var(--accent-base)';
    let tooltip = '';

    if (isPcScope) {
      const topAppName = Object.keys(b.apps || {})[0] || 'App';
      tooltip = `${b.hour.toString().padStart(2, '0')}:00 — Active: ${formatDuration(b.activeMs)}, Idle: ${formatDuration(b.idleMs)} (${topAppName})`;
    } else {
      let topCat = 'General';
      let maxCatMs = 0;
      for (const [cat, ms] of Object.entries(b.categories || {})) {
        if (ms > maxCatMs) {
          maxCatMs = ms;
          topCat = cat;
        }
      }
      slotColor = getCategoryColor(topCat, categories);
      tooltip = `${b.hour.toString().padStart(2, '0')}:00 — Active: ${formatDuration(b.activeMs)}, Idle: ${formatDuration(b.idleMs)} (${topCat})`;
    }

    return `
      <div class="timeline-slot" title="${escapeHtml(tooltip)}">
        <div class="timeline-bar-fill" style="
          height: ${Math.max(4, heightPct)}%;
          background: ${heightPct === 0 ? 'transparent' : slotColor};
          opacity: ${heightPct === 0 ? 0.2 : 0.85};
        "></div>
      </div>
    `;
  }).join('');

  // 4. Top Activity Quick List on Overview
  if (isPcScope) {
    if (desktopStats.sortedApps.length === 0) {
      overviewDomainList.innerHTML = '<div class="empty-state">No desktop activity recorded for this day</div>';
    } else {
      const top4 = desktopStats.sortedApps.slice(0, 4);
      overviewDomainList.innerHTML = top4.map(item => {
        const pct = desktopStats.totalDesktopActiveMs > 0 ? Math.round((item.durationMs / desktopStats.totalDesktopActiveMs) * 100) : 0;
        const safeApp = escapeHtml(item.app);
        const icon = item.isBrowser ? '🌐' : '🖥️';
        return `
          <div class="domain-item">
            <div class="domain-item-top">
              <div class="domain-name-pill">
                <span class="domain-item-name" title="${safeApp}">${icon} ${safeApp}</span>
              </div>
              <span class="domain-item-time">${formatDuration(item.durationMs)} (${pct}%)</span>
            </div>
            <div class="domain-progress-bg">
              <div class="domain-progress-bar" style="width: ${pct}%; background: var(--accent-base);"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  } else {
    if (browserStats.sortedDomains.length === 0) {
      overviewDomainList.innerHTML = '<div class="empty-state">No browsing recorded for this day</div>';
    } else {
      const top4 = browserStats.sortedDomains.slice(0, 4);
      overviewDomainList.innerHTML = top4.map(item => {
        const pct = browserStats.totalActiveMs > 0 ? Math.round((item.durationMs / browserStats.totalActiveMs) * 100) : 0;
        const catColor = getCategoryColor(item.category, categories);
        const safeDomain = escapeHtml(item.domain);
        const safeCat = escapeHtml(item.category);
        return `
          <div class="domain-item">
            <div class="domain-item-top">
              <div class="domain-name-pill">
                <span class="domain-item-name" title="${safeDomain}">${safeDomain}</span>
                <span class="category-tag" style="background: ${catColor}20; color: ${catColor}; border: 1px solid ${catColor}40;">
                  ${safeCat}
                </span>
              </div>
              <span class="domain-item-time">${formatDuration(item.durationMs)} (${pct}%)</span>
            </div>
            <div class="domain-progress-bg">
              <div class="domain-progress-bar" style="width: ${pct}%; background: ${catColor};"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Render Manageable Category Chips
function renderCategoryChips() {
  if (categories.length === 0) {
    categoryChipsList.innerHTML = '<span class="text-muted" style="font-size:10px;">No categories defined. Add one above.</span>';
    return;
  }
  categoryChipsList.innerHTML = categories.map(cat => {
    const color = getCategoryColor(cat, categories);
    const safeCat = escapeHtml(cat);
    return `
      <span class="cat-chip" style="border-color: ${color}40;">
        <span class="cat-chip-name" style="color: ${color};">${safeCat}</span>
        <span class="cat-chip-delete" data-category="${safeCat}" title="Delete category">✕</span>
      </span>
    `;
  }).join('');
}

function renderCategories(browserStats, desktopStats) {
  const isPcScope = currentScope === 'pc' && (desktopStats.sortedApps.length > 0 || isDaemonActive);

  // 1. Desktop Apps Section (Toggle visibility based on scope)
  if (sectionDesktopApps) {
    sectionDesktopApps.classList.toggle('hidden', !isPcScope);
    if (isPcScope) {
      if (desktopStats.sortedApps.length === 0) {
        drilldownAppList.innerHTML = '<div class="empty-state">No desktop app logs recorded</div>';
      } else {
        drilldownAppList.innerHTML = desktopStats.sortedApps.map(app => {
          const safeApp = escapeHtml(app.app);
          const icon = app.isBrowser ? '🌐' : '🖥️';
          const isExpanded = expandedDesktopApps.has(app.app);
          const domainCount = app.nestedDomains?.length || 0;

          let drawerHtml = '';
          if (app.isBrowser && domainCount > 0) {
            drawerHtml = `
              <div class="nested-domains-drawer ${isExpanded ? '' : 'hidden'}">
                ${app.nestedDomains.map(nd => `
                  <div class="nested-domain-row">
                    <span class="nested-domain-name" title="${escapeHtml(nd.domain)}">&bull; ${escapeHtml(nd.domain)}</span>
                    <span class="nested-domain-time">${formatDuration(nd.durationMs)}</span>
                  </div>
                `).join('')}
              </div>
            `;
          }

          return `
            <div class="desktop-app-card">
              <div class="desktop-app-header">
                <div class="desktop-app-title-group">
                  <span class="desktop-app-icon">${icon}</span>
                  <span class="desktop-app-name" title="${safeApp}">${safeApp}</span>
                </div>
                <span class="desktop-app-duration">${formatDuration(app.durationMs)}</span>
              </div>
              <div class="desktop-app-controls">
                <span class="desktop-app-hint">${app.isBrowser ? 'Web Browser' : 'Windows Application'}</span>
                ${app.isBrowser && domainCount > 0
                  ? `<button class="btn-nested-domains" data-app="${safeApp}">${domainCount} domains ${isExpanded ? '▴' : '▾'}</button>`
                  : ''}
              </div>
              ${drawerHtml}
            </div>
          `;
        }).join('');
      }
    }
  }

  // 2. Category Distribution Bars
  const catEntries = Object.entries(browserStats.categories).sort((a, b) => b[1] - a[1]);
  if (catEntries.length === 0) {
    categoryBarsList.innerHTML = '<div class="empty-state">No category activity recorded</div>';
  } else {
    categoryBarsList.innerHTML = catEntries.map(([name, ms]) => {
      const pct = browserStats.totalActiveMs > 0 ? Math.round((ms / browserStats.totalActiveMs) * 100) : 0;
      const color = getCategoryColor(name, categories);
      const safeName = escapeHtml(name);
      return `
        <div class="category-row">
          <div class="category-row-top">
            <span class="category-name" style="color: ${color};">${safeName}</span>
            <span class="category-time">${formatDuration(ms)} (${pct}%)</span>
          </div>
          <div class="domain-progress-bg">
            <div class="domain-progress-bar" style="width: ${pct}%; background: ${color};"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 3. Decluttered Domain Cards with Clear Category Override Dropdown
  if (browserStats.sortedDomains.length === 0) {
    drilldownDomainList.innerHTML = '<div class="empty-state">No domain logs available</div>';
  } else {
    drilldownDomainList.innerHTML = browserStats.sortedDomains.map((d) => {
      const safeDomain = escapeHtml(d.domain);
      const pageCount = d.pageTitles.length;
      const isExpanded = expandedDomains.has(d.domain);
      const pagesHtml = pageCount > 0
        ? d.pageTitles.map(p => `<div class="page-title-entry" title="${escapeHtml(p)}">&bull; ${escapeHtml(p)}</div>`).join('')
        : '<div class="page-title-entry">&bull; Active page visits</div>';

      const optionsHtml = categories.map(cat => {
        const isSel = cat === d.category ? 'selected' : '';
        return `<option value="${escapeHtml(cat)}" ${isSel}>${escapeHtml(cat)}</option>`;
      }).join('');

      return `
        <div class="domain-card">
          <div class="domain-card-main">
            <span class="domain-title" title="${safeDomain}">${safeDomain}</span>
            <span class="domain-duration">${formatDuration(d.durationMs)}</span>
          </div>
          <div class="domain-card-controls">
            <div class="domain-select-wrap">
              <span class="domain-control-label">Category:</span>
              <select class="domain-cat-select" data-domain="${safeDomain}" title="Assign category to this domain">
                ${optionsHtml}
              </select>
            </div>
            ${pageCount > 0 ? `<button class="btn-pages-toggle" data-domain="${safeDomain}">${pageCount} pages ${isExpanded ? '▴' : '▾'}</button>` : ''}
          </div>
          <div class="domain-pages-list ${isExpanded ? '' : 'hidden'}">
            ${pagesHtml}
          </div>
        </div>
      `;
    }).join('');
  }
}

// Category Creation (Add)
btnAddCat.addEventListener('click', async () => {
  const val = inputNewCat.value.trim();
  if (!val) return;
  if (categories.some(c => c.toLowerCase() === val.toLowerCase())) {
    alert('Category already exists.');
    return;
  }
  categories.push(val);
  await chrome.storage.local.set({ categories });
  inputNewCat.value = '';
  renderAllViews();
});

// Category Deletion (Any category can be deleted via ✕)
categoryChipsList.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('.cat-chip-delete');
  if (!deleteBtn) return;
  const catToDelete = deleteBtn.dataset.category;
  if (confirm(`Delete category "${catToDelete}"?`)) {
    categories = categories.filter(c => c !== catToDelete);
    await chrome.storage.local.set({ categories });
    renderAllViews();
  }
});

// Domain Category Override Dropdown
drilldownDomainList.addEventListener('change', async (e) => {
  if (e.target.classList.contains('domain-cat-select')) {
    const domain = e.target.dataset.domain;
    const newCategory = e.target.value;
    domainMappings[domain] = newCategory;
    await chrome.storage.local.set({ domain_mappings: domainMappings });
    renderAllViews();
  }
});

// Domain Pages Toggle (preserves state in expandedDomains Set)
drilldownDomainList.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('.btn-pages-toggle');
  if (!toggleBtn) return;
  const domain = toggleBtn.dataset.domain;
  const card = toggleBtn.closest('.domain-card');
  const pagesBox = card?.querySelector('.domain-pages-list');

  if (expandedDomains.has(domain)) {
    expandedDomains.delete(domain);
    if (pagesBox) pagesBox.classList.add('hidden');
    toggleBtn.textContent = toggleBtn.textContent.replace('▴', '▾');
  } else {
    expandedDomains.add(domain);
    if (pagesBox) pagesBox.classList.remove('hidden');
    toggleBtn.textContent = toggleBtn.textContent.replace('▾', '▴');
  }
});

// Desktop Apps Nested Domains Toggle
if (drilldownAppList) {
  drilldownAppList.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.btn-nested-domains');
    if (!toggleBtn) return;
    const app = toggleBtn.dataset.app;
    const card = toggleBtn.closest('.desktop-app-card');
    const drawer = card?.querySelector('.nested-domains-drawer');

    if (expandedDesktopApps.has(app)) {
      expandedDesktopApps.delete(app);
      if (drawer) drawer.classList.add('hidden');
      toggleBtn.textContent = toggleBtn.textContent.replace('▴', '▾');
    } else {
      expandedDesktopApps.add(app);
      if (drawer) drawer.classList.remove('hidden');
      toggleBtn.textContent = toggleBtn.textContent.replace('▾', '▴');
    }
  });
}

// Export Unified Envelope JSON
btnExportJson.addEventListener('click', () => {
  if (cachedSessions.length === 0 && cachedDesktopSessions.length === 0) {
    alert('No sessions to export.');
    return;
  }
  const envelope = {
    actlog_version: '0.0.4',
    exported_at: Date.now(),
    browser_sessions: cachedSessions,
    desktop_sessions: cachedDesktopSessions
  };
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(envelope, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `actlog-activity-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
});

// Import Unified Envelope or Legacy JSON
if (btnImportJson && inputImportJson) {
  btnImportJson.addEventListener('click', () => {
    inputImportJson.click();
  });

  inputImportJson.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const merged = mergeImportEnvelope(cachedSessions, cachedDesktopSessions, parsed);

        cachedSessions = merged.browserSessions;
        cachedDesktopSessions = merged.desktopSessions;

        await chrome.storage.local.set({
          sessions: cachedSessions,
          desktop_sessions: cachedDesktopSessions
        });

        // If desktop daemon is online, forward desktop sessions to Rust SQLite
        if (isDaemonActive && merged.importedDesktopCount > 0) {
          try {
            const currentPort = store.desktop_port || 5566;
            await fetch(`http://127.0.0.1:${currentPort}/api/import`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ desktop_sessions: cachedDesktopSessions })
            });
          } catch (_err) {
            // Silently ignore forwarding errors
          }
        }

        alert(`Imported ${merged.importedBrowserCount} web sessions and ${merged.importedDesktopCount} desktop sessions.`);
        inputImportJson.value = '';
        loadData();
      } catch (err) {
        alert(`Import failed: Invalid JSON file (${err.message}).`);
      }
    };
    reader.readAsText(file);
  });
}

// Clear Selected Day's Logs
btnClearLogs.addEventListener('click', async () => {
  const dateStr = new Date(selectedDateMs).toLocaleDateString();
  if (confirm(`Clear all activity logs recorded for ${dateStr}?`)) {
    const dayStart = selectedDateMs;
    const dayEnd = dayStart + 86400000;

    const remainingBrowser = cachedSessions.filter(s => {
      const sStart = s.start_utc;
      const sEnd = s.end_utc || sStart;
      return sEnd <= dayStart || sStart >= dayEnd;
    });

    const remainingDesktop = cachedDesktopSessions.filter(s => {
      const sStart = s.start_utc;
      const sEnd = s.end_utc || sStart;
      return sEnd <= dayStart || sStart >= dayEnd;
    });

    await chrome.storage.local.set({
      sessions: remainingBrowser,
      desktop_sessions: remainingDesktop
    });
    cachedSessions = remainingBrowser;
    cachedDesktopSessions = remainingDesktop;
    renderAllViews();
  }
});

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  initVersion();
  updateDateLabel();
  loadData();
});

// Reactively update when background worker records new sessions or syncs desktop
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.sessions || changes.current_active || changes.desktop_sessions || changes.desktop_daemon_active)) {
      loadData();
    }
  });
}
