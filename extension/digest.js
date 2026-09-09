// ACTLog Standalone Activity Digest & Domain Classifier
// Ponytail: pure native logic, zero dependencies, dynamic category handling

const INITIAL_DEFAULT_CATEGORIES = [
  'Development',
  'Docs & Learning',
  'Work & Comms',
  'Media & Streaming',
  'Social Media',
  'AI & Search',
  'General'
];

const DOMAIN_CATEGORY_RULES = [
  {
    category: 'Development',
    color: '#3b82f6',
    match: /(github|gitlab|bitbucket|stackoverflow|stackexchange|localhost|127\.0\.0\.1|npmjs|crates\.io|codepen|replit|vercel|supabase|firebase|aws\.amazon|cloud\.google|console\.azure)/i
  },
  {
    category: 'Docs & Learning',
    color: '#8b5cf6',
    match: /(docs\.rs|developer\.mozilla|rust-lang|wikipedia|medium|dev\.to|substack|coursera|udemy|edx|arxiv|w3schools|learn|tutorial)/i
  },
  {
    category: 'Work & Comms',
    color: '#10b981',
    match: /(slack|discord|notion|mail\.google|gmail|outlook|teams\.microsoft|zoom\.us|meet\.google|docs\.google|sheets\.google|linear\.app|atlassian|trello|asana|figma)/i
  },
  {
    category: 'Media & Streaming',
    color: '#f59e0b',
    match: /(youtube|netflix|spotify|twitch|primevideo|soundcloud|vimeo|hulu|disneyplus)/i
  },
  {
    category: 'Social Media',
    color: '#ec4899',
    match: /(reddit|twitter|x\.com|facebook|instagram|linkedin|tiktok|threads\.net)/i
  },
  {
    category: 'AI & Search',
    color: '#06b6d4',
    match: /(google|bing|duckduckgo|kagi|chatgpt|openai|claude\.ai|gemini\.google|perplexity\.ai)/i
  }
];

const DYNAMIC_PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#f43f5e', '#6366f1', '#14b8a6', '#f97316', '#a855f7'];

function classifyDomain(domain, domainMappings = {}, activeCategories = null) {
  if (!domain || domain === 'Internal' || domain === 'Idle / Away') return 'Other';

  const isAllowed = (cat) => !activeCategories || activeCategories.includes(cat);

  // 1. Manual user override takes precedence
  if (domainMappings && domainMappings[domain] && isAllowed(domainMappings[domain])) {
    return domainMappings[domain];
  }

  // 2. Built-in regex rule (only if category hasn't been deleted by user)
  for (const rule of DOMAIN_CATEGORY_RULES) {
    if (rule.match.test(domain) && isAllowed(rule.category)) {
      return rule.category;
    }
  }

  // 3. Fallback
  if (activeCategories && activeCategories.length > 0) {
    return activeCategories.includes('General') ? 'General' : activeCategories[0];
  }
  return 'General';
}

function getCategoryColor(category, allCategories = []) {
  const found = DOMAIN_CATEGORY_RULES.find(r => r.category === category);
  if (found) return found.color;
  if (category === 'General') return '#94a3b8';
  if (category === 'Other') return '#64748b';

  const idx = allCategories.indexOf(category);
  if (idx >= 0) {
    return DYNAMIC_PALETTE[idx % DYNAMIC_PALETTE.length];
  }
  return '#94a3b8';
}

// Aggregate session entries for a specific calendar day (midnight to midnight)
function aggregateDayStats(sessions, targetDateMs, domainMappings = {}, activeCategories = null) {
  const dayStart = new Date(targetDateMs);
  dayStart.setHours(0, 0, 0, 0);
  const startMs = dayStart.getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;

  let totalActiveMs = 0;
  let totalIdleMs = 0;
  const categories = {};
  const domainTotals = {};
  const hourlyBuckets = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    activeMs: 0,
    idleMs: 0,
    categories: {}
  }));

  for (const s of sessions) {
    const isIdle = s.type === 'idle' || s.domain === 'Idle / Away';
    const sStart = s.start_utc;
    const sEnd = s.end_utc || sStart;

    if (sEnd <= startMs || sStart >= endMs) continue;

    const clampedStart = Math.max(sStart, startMs);
    const clampedEnd = Math.min(sEnd, endMs);
    const clampedDuration = Math.max(0, clampedEnd - clampedStart);

    if (clampedDuration <= 0) continue;

    if (isIdle) {
      totalIdleMs += clampedDuration;
    } else {
      totalActiveMs += clampedDuration;

      const domain = s.domain || 'Internal';
      const category = classifyDomain(domain, domainMappings, activeCategories);

      categories[category] = (categories[category] || 0) + clampedDuration;

      if (!domainTotals[domain]) {
        domainTotals[domain] = {
          domain: domain,
          category: category,
          durationMs: 0,
          pageTitles: new Set()
        };
      }
      domainTotals[domain].durationMs += clampedDuration;
      if (s.title && s.title !== domain) {
        domainTotals[domain].pageTitles.add(s.title);
      }
    }

    // Clip into 24-hour buckets
    for (let h = 0; h < 24; h++) {
      const hStart = startMs + h * 3600000;
      const hEnd = hStart + 3600000;
      const hOverlap = Math.max(0, Math.min(clampedEnd, hEnd) - Math.max(clampedStart, hStart));

      if (hOverlap > 0) {
        if (isIdle) {
          hourlyBuckets[h].idleMs += hOverlap;
        } else {
          hourlyBuckets[h].activeMs += hOverlap;
          const cat = classifyDomain(s.domain, domainMappings, activeCategories);
          hourlyBuckets[h].categories[cat] = (hourlyBuckets[h].categories[cat] || 0) + hOverlap;
        }
      }
    }
  }

  const sortedDomains = Object.values(domainTotals)
    .map(d => ({
      domain: d.domain,
      category: d.category,
      durationMs: d.durationMs,
      pageTitles: Array.from(d.pageTitles).slice(0, 5)
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  return {
    dateMs: startMs,
    totalActiveMs,
    totalIdleMs,
    categories,
    sortedDomains,
    hourlyBuckets
  };
}

// Generate token-efficient AI prompt and structured JSON summary
function generateAIDigest(dayStats) {
  const dateStr = new Date(dayStats.dateMs).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  const activeMins = Math.round(dayStats.totalActiveMs / 60000);
  const idleMins = Math.round(dayStats.totalIdleMs / 60000);
  const totalMins = activeMins + idleMins;
  const focusScore = totalMins > 0 ? Math.round((activeMins / totalMins) * 100) : 0;

  const topCategories = Object.entries(dayStats.categories)
    .map(([name, ms]) => ({
      category: name,
      mins: Math.round(ms / 60000),
      percentage: activeMins > 0 ? Math.round((ms / dayStats.totalActiveMs) * 100) : 0
    }))
    .sort((a, b) => b.mins - a.mins);

  const topSites = dayStats.sortedDomains.slice(0, 6).map(d => ({
    domain: d.domain,
    mins: Math.round(d.durationMs / 60000),
    category: d.category,
    highlights: d.pageTitles.slice(0, 3)
  }));

  const structuredData = {
    date: dateStr,
    active_minutes: activeMins,
    idle_minutes: idleMins,
    focus_percentage: focusScore,
    categories: topCategories,
    top_activities: topSites
  };

  let promptText = `### ACTLog Activity Digest (${dateStr})\n`;
  promptText += `- Active Time: ${Math.floor(activeMins / 60)}h ${activeMins % 60}m | Idle: ${Math.floor(idleMins / 60)}h ${idleMins % 60}m (Focus: ${focusScore}%)\n`;

  promptText += `\n**Category Breakdown:**\n`;
  topCategories.forEach(c => {
    promptText += `- ${c.category}: ${c.mins}m (${c.percentage}%)\n`;
  });

  promptText += `\n**Top Focus Areas & Sites:**\n`;
  topSites.forEach(s => {
    promptText += `- ${s.domain} (${s.mins}m, ${s.category})`;
    if (s.highlights.length > 0) {
      promptText += ` — ${s.highlights.join('; ')}`;
    }
    promptText += `\n`;
  });

  promptText += `\n*Task for AI: Provide a 3-bullet concise productivity executive summary highlighting primary accomplishments, deep focus blocks, and areas of distraction.*`;

  return {
    structured: structuredData,
    promptText: promptText
  };
}

// Strict AI Domain Classifier Prompt for Paid/Pro Users
function generateAISortPrompt(domains, allCategories) {
  const allowedList = allCategories.map(c => `  - "${c}"`).join('\n');
  const domainList = JSON.stringify(domains, null, 2);

  return `You are an expert web activity classification assistant.
Task: Classify each domain in the provided list into EXACTLY ONE of the allowed categories.

ALLOWED CATEGORIES:
${allowedList}

STRICT CONSTRAINTS:
1. Return ONLY a valid, raw JSON object.
2. DO NOT include markdown code blocks (\`\`\`json or \`\`\`).
3. DO NOT include any introductory or concluding text, explanations, or notes.
4. Every domain in the input list must appear as a key in the output object.
5. The value for each key must be one of the ALLOWED CATEGORIES above.

DOMAINS TO CLASSIFY:
${domainList}`;
}

function isBrowserExecutable(appName) {
  if (!appName) return false;
  return /(chrome|msedge|firefox|brave|opera|vivaldi|arc)(\.exe)?$/i.test(appName);
}

// Aggregate Desktop Sessions for target date with browser domain linkage
function aggregateDesktopDayStats(desktopSessions = [], targetDateMs, browserDayStats = null) {
  const dayStart = new Date(targetDateMs);
  dayStart.setHours(0, 0, 0, 0);
  const startMs = dayStart.getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;

  let totalDesktopActiveMs = 0;
  let totalDesktopIdleMs = 0;
  const appTotals = {};
  const hourlyBuckets = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    activeMs: 0,
    idleMs: 0,
    apps: {}
  }));

  for (const s of desktopSessions) {
    const sStart = s.start_utc;
    const sEnd = s.end_utc || sStart;

    if (sEnd <= startMs || sStart >= endMs) continue;

    const clampedStart = Math.max(sStart, startMs);
    const clampedEnd = Math.min(sEnd, endMs);
    const clampedDuration = Math.max(0, clampedEnd - clampedStart);

    // Downtime: PC was off, asleep, or tracker wasn't running (skip active/idle and buckets)
    const isDowntime = s.source === 'crash_gap' || s.app === '<System Gap>' || s.app === '<System Crash>';
    if (isDowntime) continue;

    const isIdle = s.source === 'afk' || s.app === 'idle' || s.app === 'locked';

    if (isIdle) {
      totalDesktopIdleMs += clampedDuration;
    } else {
      totalDesktopActiveMs += clampedDuration;

      const appName = s.app || 'Unknown.exe';
      if (!appTotals[appName]) {
        appTotals[appName] = {
          app: appName,
          durationMs: 0,
          windowTitles: new Set(),
          isBrowser: isBrowserExecutable(appName)
        };
      }
      appTotals[appName].durationMs += clampedDuration;
      if (s.title && s.title !== appName) {
        appTotals[appName].windowTitles.add(s.title);
      }
    }

    // Clip into 24-hour buckets
    for (let h = 0; h < 24; h++) {
      const hStart = startMs + h * 3600000;
      const hEnd = hStart + 3600000;
      const hOverlap = Math.max(0, Math.min(clampedEnd, hEnd) - Math.max(clampedStart, hStart));

      if (hOverlap > 0) {
        if (isIdle) {
          hourlyBuckets[h].idleMs += hOverlap;
        } else {
          hourlyBuckets[h].activeMs += hOverlap;
          const app = s.app || 'Unknown.exe';
          hourlyBuckets[h].apps[app] = (hourlyBuckets[h].apps[app] || 0) + hOverlap;
        }
      }
    }
  }

  const sortedApps = Object.values(appTotals)
    .map(a => {
      const res = {
        app: a.app,
        durationMs: a.durationMs,
        isBrowser: a.isBrowser,
        windowTitles: Array.from(a.windowTitles).slice(0, 5),
        nestedDomains: []
      };
      if (a.isBrowser && browserDayStats && Array.isArray(browserDayStats.sortedDomains)) {
        res.nestedDomains = browserDayStats.sortedDomains;
      }
      return res;
    })
    .sort((a, b) => b.durationMs - a.durationMs);

  return {
    dateMs: startMs,
    totalDesktopActiveMs,
    totalDesktopIdleMs,
    sortedApps,
    hourlyBuckets
  };
}

// Unified Envelope Import & Deduplication Merger
function mergeImportEnvelope(existingBrowserSessions = [], existingDesktopSessions = [], incomingData = null) {
  let importedBrowserCount = 0;
  let importedDesktopCount = 0;

  const mergedBrowser = [...existingBrowserSessions];
  const mergedDesktop = [...existingDesktopSessions];

  const seenBrowser = new Set();
  for (const s of existingBrowserSessions) {
    seenBrowser.add(`${s.start_utc}_${s.domain || s.url || ''}`);
  }

  const seenDesktop = new Set();
  for (const s of existingDesktopSessions) {
    seenDesktop.add(s.id || `${s.start_utc}_${s.app || ''}_${s.source || ''}`);
  }

  let incomingBrowser = [];
  let incomingDesktop = [];

  if (Array.isArray(incomingData)) {
    // Legacy flat array format: treat directly as browser sessions
    incomingBrowser = incomingData;
  } else if (incomingData && typeof incomingData === 'object') {
    if (Array.isArray(incomingData.browser_sessions)) {
      incomingBrowser = incomingData.browser_sessions;
    }
    if (Array.isArray(incomingData.desktop_sessions)) {
      incomingDesktop = incomingData.desktop_sessions;
    }
  }

  for (const b of incomingBrowser) {
    if (!b || !b.start_utc) continue;
    const key = `${b.start_utc}_${b.domain || b.url || ''}`;
    if (!seenBrowser.has(key)) {
      seenBrowser.add(key);
      mergedBrowser.push(b);
      importedBrowserCount++;
    }
  }

  for (const d of incomingDesktop) {
    if (!d || !d.start_utc) continue;
    const key = d.id || `${d.start_utc}_${d.app || ''}_${d.source || ''}`;
    if (!seenDesktop.has(key)) {
      seenDesktop.add(key);
      mergedDesktop.push(d);
      importedDesktopCount++;
    }
  }

  return {
    browserSessions: mergedBrowser,
    desktopSessions: mergedDesktop,
    importedBrowserCount,
    importedDesktopCount
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    INITIAL_DEFAULT_CATEGORIES,
    DOMAIN_CATEGORY_RULES,
    classifyDomain,
    getCategoryColor,
    aggregateDayStats,
    aggregateDesktopDayStats,
    isBrowserExecutable,
    mergeImportEnvelope,
    generateAIDigest,
    generateAISortPrompt
  };
}
