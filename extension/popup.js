// ACTLog Standalone Activity Tracker — Popup Logic
// Ponytail: pure vanilla JS, zero libraries, backward-compatible, decluttered UI

let cachedSessions = [];
let currentActive = null;
let liveTicker = null;
let selectedDateMs = getMidnight(new Date());

let categories = [];
let domainMappings = {};

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
      : '0.0.2';
    el.textContent = `v${v}`;
  }
}

// DOM Elements
const tabOverview = document.getElementById('tab-overview');
const tabCategories = document.getElementById('tab-categories');
const tabAi = document.getElementById('tab-ai');

const viewOverview = document.getElementById('view-overview');
const viewCategories = document.getElementById('view-categories');
const viewAi = document.getElementById('view-ai');

// Date Nav
const btnPrevDay = document.getElementById('btn-prev-day');
const btnNextDay = document.getElementById('btn-next-day');
const currentDateLabel = document.getElementById('current-date-label');

// Overview Elements
const currentBadge = document.getElementById('current-badge');
const currentDomain = document.getElementById('current-domain');
const currentTitle = document.getElementById('current-title');
const currentTimer = document.getElementById('current-timer');
const audioBadge = document.getElementById('audio-badge');

const metricActiveTime = document.getElementById('metric-active-time');
const metricIdleTime = document.getElementById('metric-idle-time');
const metricFocusScore = document.getElementById('metric-focus-score');
const timelineContainer = document.getElementById('timeline-container');
const overviewDomainList = document.getElementById('overview-domain-list');

// Categories Elements
const categoryChipsList = document.getElementById('category-chips-list');
const categoryBarsList = document.getElementById('category-bars-list');
const drilldownDomainList = document.getElementById('drilldown-domain-list');
const inputNewCat = document.getElementById('input-new-cat');
const btnAddCat = document.getElementById('btn-add-cat');
const aiSortPreview = document.getElementById('ai-sort-preview');
const btnCopySortPrompt = document.getElementById('btn-copy-sort-prompt');

// AI Digest Elements
const aiPromptPreview = document.getElementById('ai-prompt-preview');
const btnCopyAi = document.getElementById('btn-copy-ai');
const copyBtnText = document.getElementById('copy-btn-text');
const btnExportJson = document.getElementById('btn-export-json');
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

// Tab Switching
function switchTab(targetViewId, activeTabBtn) {
  [viewOverview, viewCategories, viewAi].forEach(view => {
    view.classList.toggle('hidden', view.id !== targetViewId);
  });
  [tabOverview, tabCategories, tabAi].forEach(tab => {
    tab.classList.toggle('active', tab === activeTabBtn);
  });
  renderAllViews();
}

tabOverview.addEventListener('click', () => switchTab('view-overview', tabOverview));
tabCategories.addEventListener('click', () => switchTab('view-categories', tabCategories));
tabAi.addEventListener('click', () => switchTab('view-ai', tabAi));

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

// Load storage data
async function loadData() {
  const store = await chrome.storage.local.get([
    'current_active',
    'sessions',
    'categories',
    'domain_mappings'
  ]);
  cachedSessions = Array.isArray(store.sessions) ? store.sessions : [];
  currentActive = store.current_active || null;

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

  storageStatus.textContent = `${cachedSessions.length} total sessions`;
  renderAllViews();
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

  // Aggregate day stats using custom domain mappings & active categories
  const stats = aggregateDayStats(daySessions, selectedDateMs, domainMappings, categories);

  renderOverview(stats);
  renderCategoryChips();
  renderCategories(stats);
  renderAIDigest(stats);
  renderAISortPrompt(stats);
}

function renderOverview(stats) {
  // 1. Current Active Card
  if (currentActive && currentActive.start_utc) {
    currentDomain.textContent = currentActive.domain;
    currentTitle.textContent = currentActive.title || currentActive.url;
    currentBadge.textContent = getDomainAbbr(currentActive.domain);
    audioBadge.classList.toggle('hidden', !currentActive.is_audible);
  } else {
    currentDomain.textContent = 'Browser Idle';
    currentTitle.textContent = 'No active page focused';
    currentBadge.textContent = 'ID';
    audioBadge.classList.add('hidden');
    currentTimer.textContent = '00:00:00';
  }

  // 2. Metrics
  metricActiveTime.textContent = formatDuration(stats.totalActiveMs);
  metricIdleTime.textContent = formatDuration(stats.totalIdleMs);

  const totalTracked = stats.totalActiveMs + stats.totalIdleMs;
  const focusPct = totalTracked > 0 ? Math.round((stats.totalActiveMs / totalTracked) * 100) : 100;
  metricFocusScore.textContent = `${focusPct}%`;

  // 3. 24-Hour Timeline Bar
  timelineContainer.innerHTML = stats.hourlyBuckets.map(b => {
    const totalSlotMs = b.activeMs + b.idleMs;
    const heightPct = Math.min(100, Math.round((totalSlotMs / 3600000) * 100));

    let topCat = 'General';
    let maxCatMs = 0;
    for (const [cat, ms] of Object.entries(b.categories)) {
      if (ms > maxCatMs) {
        maxCatMs = ms;
        topCat = cat;
      }
    }
    const catColor = getCategoryColor(topCat, categories);
    const tooltip = `${b.hour.toString().padStart(2, '0')}:00 — Active: ${formatDuration(b.activeMs)}, Idle: ${formatDuration(b.idleMs)} (${topCat})`;

    return `
      <div class="timeline-slot" title="${escapeHtml(tooltip)}">
        <div class="timeline-bar-fill" style="
          height: ${Math.max(4, heightPct)}%;
          background: ${heightPct === 0 ? 'transparent' : catColor};
          opacity: ${heightPct === 0 ? 0.2 : 0.85};
        "></div>
      </div>
    `;
  }).join('');

  // 4. Top Domains Quick List
  if (stats.sortedDomains.length === 0) {
    overviewDomainList.innerHTML = '<div class="empty-state">No browsing recorded for this day</div>';
  } else {
    const top4 = stats.sortedDomains.slice(0, 4);
    overviewDomainList.innerHTML = top4.map(item => {
      const pct = stats.totalActiveMs > 0 ? Math.round((item.durationMs / stats.totalActiveMs) * 100) : 0;
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

// Render Manageable Category Chips (All can be deleted via ✕)
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

function renderCategories(stats) {
  // Category Distribution Bars
  const catEntries = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);

  if (catEntries.length === 0) {
    categoryBarsList.innerHTML = '<div class="empty-state">No category activity recorded</div>';
  } else {
    categoryBarsList.innerHTML = catEntries.map(([name, ms]) => {
      const pct = stats.totalActiveMs > 0 ? Math.round((ms / stats.totalActiveMs) * 100) : 0;
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

  // Decluttered Domain Cards with Clear Category Override Dropdown
  if (stats.sortedDomains.length === 0) {
    drilldownDomainList.innerHTML = '<div class="empty-state">No domain logs available</div>';
  } else {
    drilldownDomainList.innerHTML = stats.sortedDomains.map((d, idx) => {
      const safeDomain = escapeHtml(d.domain);
      const pageCount = d.pageTitles.length;
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
            ${pageCount > 0 ? `<button class="btn-pages-toggle" data-target="pages-box-${idx}">${pageCount} pages ▾</button>` : ''}
          </div>
          <div class="domain-pages-list hidden" id="pages-box-${idx}">
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

// Domain Pages Toggle (Clean, isolated, non-colliding click)
drilldownDomainList.addEventListener('click', (e) => {
  const toggleBtn = e.target.closest('.btn-pages-toggle');
  if (!toggleBtn) return;
  const targetId = toggleBtn.dataset.target;
  const pagesBox = document.getElementById(targetId);
  if (pagesBox) {
    const isNowHidden = pagesBox.classList.toggle('hidden');
    toggleBtn.textContent = isNowHidden
      ? toggleBtn.textContent.replace('▴', '▾')
      : toggleBtn.textContent.replace('▾', '▴');
  }
});

// Render Strict AI Auto-Sort Prompt for Paid/Pro Users
function renderAISortPrompt(stats) {
  const visitedDomains = stats.sortedDomains.map(d => d.domain);
  const prompt = generateAISortPrompt(visitedDomains, categories);
  aiSortPreview.textContent = prompt;
}

btnCopySortPrompt.addEventListener('click', async () => {
  const text = aiSortPreview.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btnCopySortPrompt.textContent = 'Copied!';
    setTimeout(() => { btnCopySortPrompt.textContent = 'Copy Prompt'; }, 2000);
  } catch {
    alert('Failed to copy prompt.');
  }
});

function renderAIDigest(stats) {
  const digest = generateAIDigest(stats);
  aiPromptPreview.textContent = digest.promptText;
}

function updateTicker() {
  if (currentActive && currentActive.start_utc) {
    const elapsed = Math.max(0, Date.now() - currentActive.start_utc);
    currentTimer.textContent = formatTickerTime(elapsed);
  } else {
    currentTimer.textContent = '00:00:00';
  }
}

// Copy AI Digest Button
btnCopyAi.addEventListener('click', async () => {
  const text = aiPromptPreview.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btnCopyAi.classList.add('copied');
    copyBtnText.textContent = 'Copied!';
    setTimeout(() => {
      btnCopyAi.classList.remove('copied');
      copyBtnText.textContent = 'Copy for AI';
    }, 2000);
  } catch {
    alert('Failed to copy to clipboard.');
  }
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
  downloadAnchor.setAttribute('download', `actlog-activity-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
});

// Clear Selected Day's Logs
btnClearLogs.addEventListener('click', async () => {
  const dateStr = new Date(selectedDateMs).toLocaleDateString();
  if (confirm(`Clear all activity logs recorded for ${dateStr}?`)) {
    const dayStart = selectedDateMs;
    const dayEnd = dayStart + 86400000;

    const remaining = cachedSessions.filter(s => {
      const sStart = s.start_utc;
      const sEnd = s.end_utc || sStart;
      return sEnd <= dayStart || sStart >= dayEnd;
    });

    await chrome.storage.local.set({ sessions: remaining });
    cachedSessions = remaining;
    renderAllViews();
  }
});

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  initVersion();
  updateDateLabel();
  loadData();
  liveTicker = setInterval(() => {
    updateTicker();
    loadData();
  }, 1000);
});

window.addEventListener('unload', () => {
  if (liveTicker) clearInterval(liveTicker);
});
