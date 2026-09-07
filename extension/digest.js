// ACTLog Standalone Activity Digest & Domain Classifier (v0.0.1)
// Ponytail: pure native logic, zero dependencies, token-efficient AI digest generation

const DOMAIN_CATEGORY_RULES = [
  {
    category: 'Development',
    color: '#3b82f6', // blue
    match: /(github|gitlab|bitbucket|stackoverflow|stackexchange|localhost|127\.0\.0\.1|npmjs|crates\.io|codepen|replit|vercel|supabase|firebase|aws\.amazon|cloud\.google|console\.azure)/i
  },
  {
    category: 'Docs & Learning',
    color: '#8b5cf6', // purple
    match: /(docs\.rs|developer\.mozilla|rust-lang|wikipedia|medium|dev\.to|substack|coursera|udemy|edx|arxiv|w3schools|learn|tutorial)/i
  },
  {
    category: 'Work & Comms',
    color: '#10b981', // green
    match: /(slack|discord|notion|mail\.google|gmail|outlook|teams\.microsoft|zoom\.us|meet\.google|docs\.google|sheets\.google|linear\.app|atlassian|trello|asana|figma)/i
  },
  {
    category: 'Media & Streaming',
    color: '#f59e0b', // amber
    match: /(youtube|netflix|spotify|twitch|primevideo|soundcloud|vimeo|hulu|disneyplus)/i
  },
  {
    category: 'Social Media',
    color: '#ec4899', // pink
    match: /(reddit|twitter|x\.com|facebook|instagram|linkedin|tiktok|threads\.net)/i
  },
  {
    category: 'AI & Search',
    color: '#06b6d4', // cyan
    match: /(google|bing|duckduckgo|kagi|chatgpt|openai|claude\.ai|gemini\.google|perplexity\.ai)/i
  }
];

function classifyDomain(domain) {
  if (!domain || domain === 'Internal' || domain === 'Idle / Away') return 'Other';
  for (const rule of DOMAIN_CATEGORY_RULES) {
    if (rule.match.test(domain)) {
      return rule.category;
    }
  }
  return 'General';
}

function getCategoryColor(category) {
  const found = DOMAIN_CATEGORY_RULES.find(r => r.category === category);
  return found ? found.color : '#94a3b8';
}

// Aggregate session entries for a specific calendar day (midnight to midnight)
function aggregateDayStats(sessions, targetDateMs) {
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
    // Backward compatibility: handle old records lacking 'type'
    const isIdle = s.type === 'idle' || s.domain === 'Idle / Away';
    const sStart = s.start_utc;
    const sEnd = s.end_utc || sStart;

    // Check if overlaps with target day
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
      const category = s.category || classifyDomain(domain);

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
          const cat = s.category || classifyDomain(s.domain);
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

  // Structured Payload for future API
  const structuredData = {
    date: dateStr,
    active_minutes: activeMins,
    idle_minutes: idleMins,
    focus_percentage: focusScore,
    categories: topCategories,
    top_activities: topSites
  };

  // Human/LLM prompt text
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
