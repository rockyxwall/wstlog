// Automated test runner for ACTLog Chrome Extension
// Ponytail: native node assert runner, zero npm dependencies

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log('=== Running ACTLog Extension Test Suite ===');

// 1. Manifest Validation
console.log('\n[1/3] Validating manifest.json...');
const manifestRaw = fs.readFileSync('extension/manifest.json', 'utf8');
const manifest = JSON.parse(manifestRaw);

assert.equal(manifest.manifest_version, 3, 'Must be MV3');
assert.ok(manifest.name, 'Must have name');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'Version must follow semver format');
assert.ok(manifest.permissions.includes('tabs'), 'Must have tabs permission');
assert.ok(manifest.permissions.includes('storage'), 'Must have storage permission');
assert.ok(manifest.permissions.includes('idle'), 'Must have idle permission');
assert.ok(manifest.permissions.includes('alarms'), 'Must have alarms permission');
assert.ok(manifest.permissions.includes('unlimitedStorage'), 'Must have unlimitedStorage permission');

// Check referenced files exist
assert.ok(fs.existsSync(path.join('extension', manifest.background.service_worker)), 'Background worker must exist');
assert.ok(fs.existsSync(path.join('extension', manifest.action.default_popup)), 'Popup HTML must exist');
for (const [size, iconPath] of Object.entries(manifest.icons)) {
  assert.ok(fs.existsSync(path.join('extension', iconPath)), `Icon ${size} must exist`);
}
console.log(`  PASS: manifest.json is valid (v${manifest.version}) and all assets exist`);

// 2. Digest Engine & Classifier Testing
console.log('\n[2/3] Validating digest.js logic...');
const digestCode = fs.readFileSync('extension/digest.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(digestCode, context);

// Test classification
assert.equal(context.classifyDomain('github.com'), 'Development');
assert.equal(context.classifyDomain('gitlab.com'), 'Development');
assert.equal(context.classifyDomain('docs.rs'), 'Docs & Learning');
assert.equal(context.classifyDomain('slack.com'), 'Work & Comms');
assert.equal(context.classifyDomain('youtube.com'), 'Media & Streaming');
assert.equal(context.classifyDomain('reddit.com'), 'Social Media');
assert.equal(context.classifyDomain('google.com'), 'AI & Search');
assert.equal(context.classifyDomain('chatgpt.com'), 'AI & Search');
assert.equal(context.classifyDomain('randomsite.org'), 'General');

// Test manual domain override
assert.equal(
  context.classifyDomain('reddit.com', { 'reddit.com': 'Docs & Learning' }),
  'Docs & Learning',
  'Manual override must take precedence'
);
assert.equal(
  context.classifyDomain('myintranet.corp', { 'myintranet.corp': 'Work & Comms' }),
  'Work & Comms'
);

// Test deleted category fallback (if Development deleted, falls back to General)
assert.equal(
  context.classifyDomain('github.com', {}, ['Docs & Learning', 'General']),
  'General',
  'Deleted category must fall back cleanly'
);

// Test AI domain sort prompt
const prompt = context.generateAISortPrompt(['news.ycombinator.com', 'internal.dev'], ['Development', 'General']);
assert.ok(prompt.includes('news.ycombinator.com'), 'Prompt should include domain');
assert.ok(prompt.includes('STRICT CONSTRAINTS'), 'Prompt should have strict constraints');
console.log('  PASS: classifyDomain covers default, manual overrides, deleted categories, and AI sort prompt');

// Test aggregation with cross-hour slicing
const today = new Date();
today.setHours(0, 0, 0, 0);
const startMs = today.getTime();

const sampleSessions = [
  // 10:30 to 11:30 (crosses 11:00 boundary)
  {
    type: 'active',
    domain: 'github.com',
    title: 'PR Review',
    start_utc: startMs + 10.5 * 3600000,
    end_utc: startMs + 11.5 * 3600000
  },
  // 12:00 to 12:30 (idle)
  {
    type: 'idle',
    domain: 'Idle / Away',
    start_utc: startMs + 12 * 3600000,
    end_utc: startMs + 12.5 * 3600000
  },
  // Legacy record without 'type'
  {
    domain: 'docs.rs',
    title: 'rusqlite',
    start_utc: startMs + 14 * 3600000,
    end_utc: startMs + 15 * 3600000
  }
];

const stats = context.aggregateDayStats(sampleSessions, startMs);
assert.equal(stats.totalActiveMs, 2 * 3600000, 'Total active time should be 2 hours');
assert.equal(stats.totalIdleMs, 0.5 * 3600000, 'Total idle time should be 30 minutes');
assert.equal(stats.hourlyBuckets[10].activeMs, 0.5 * 3600000, 'Hour 10 should receive 30m');
assert.equal(stats.hourlyBuckets[11].activeMs, 0.5 * 3600000, 'Hour 11 should receive 30m');
assert.equal(stats.hourlyBuckets[12].idleMs, 0.5 * 3600000, 'Hour 12 should receive 30m idle');
console.log('  PASS: aggregateDayStats handles cross-hour slicing and legacy records');

// Test AI Digest generator
const digest = context.generateAIDigest(stats);
assert.ok(digest.structured, 'Should have structured payload');
assert.ok(digest.promptText, 'Should have promptText');
assert.ok(digest.promptText.includes('Active Time: 2h 0m'), 'Prompt should format active time');
assert.ok(digest.promptText.includes('Focus: 80%'), 'Prompt should calculate 80% focus');
assert.ok(digest.promptText.includes('github.com'), 'Prompt should list top domain');
console.log('  PASS: generateAIDigest produces expected LLM prompt format');

// Test browser executable detection
assert.equal(context.isBrowserExecutable('chrome.exe'), true);
assert.equal(context.isBrowserExecutable('msedge.exe'), true);
assert.equal(context.isBrowserExecutable('Code.exe'), false);
assert.equal(context.isBrowserExecutable('Slack.exe'), false);
console.log('  PASS: isBrowserExecutable correctly identifies browser processes');

// Test desktop day aggregation & nested browser domain linkage
const sampleDesktopSessions = [
  {
    app: 'Code.exe',
    title: 'main.rs',
    start_utc: startMs + 9 * 3600000,
    end_utc: startMs + 11 * 3600000,
    source: 'foreground'
  },
  {
    app: 'chrome.exe',
    title: 'GitHub',
    start_utc: startMs + 11 * 3600000,
    end_utc: startMs + 12 * 3600000,
    source: 'foreground'
  },
  {
    app: 'idle',
    title: 'AFK',
    start_utc: startMs + 12 * 3600000,
    end_utc: startMs + 12.5 * 3600000,
    source: 'afk'
  }
];

const desktopStats = context.aggregateDesktopDayStats(sampleDesktopSessions, startMs, stats);
assert.equal(desktopStats.totalDesktopActiveMs, 3 * 3600000, 'Total desktop active time must be 3h');
assert.equal(desktopStats.totalDesktopIdleMs, 0.5 * 3600000, 'Total desktop idle time must be 30m');
assert.equal(desktopStats.sortedApps.length, 2, 'Must have 2 non-idle apps');
assert.equal(desktopStats.sortedApps[0].app, 'Code.exe', 'Top app must be Code.exe');
assert.equal(desktopStats.sortedApps[1].app, 'chrome.exe', 'Second app must be chrome.exe');
assert.equal(desktopStats.sortedApps[1].isBrowser, true, 'chrome.exe must be flagged isBrowser');
assert.equal(desktopStats.sortedApps[1].nestedDomains.length, 2, 'chrome.exe must link nested web domains');
console.log('  PASS: aggregateDesktopDayStats correctly calculates PC active/idle and links nested domains');

// Test Unified Envelope & Legacy Import Deduplication
const initialBrowser = [
  { domain: 'github.com', start_utc: 1000, end_utc: 2000 }
];
const initialDesktop = [
  { id: 'uuid-1', app: 'Code.exe', start_utc: 1000, end_utc: 2000, source: 'foreground' }
];

// Test A: Legacy flat array import
const legacyIncoming = [
  { domain: 'github.com', start_utc: 1000, end_utc: 2000 }, // Duplicate
  { domain: 'docs.rs', start_utc: 3000, end_utc: 4000 } // New
];
const legacyResult = context.mergeImportEnvelope(initialBrowser, initialDesktop, legacyIncoming);
assert.equal(legacyResult.browserSessions.length, 2, 'Must deduplicate and have 2 browser sessions');
assert.equal(legacyResult.importedBrowserCount, 1, 'Must report exactly 1 imported browser session');
assert.equal(legacyResult.desktopSessions.length, 1, 'Desktop sessions must remain untouched');

// Test B: Modern envelope import
const envelopeIncoming = {
  actlog_version: '0.0.4',
  browser_sessions: [
    { domain: 'stackoverflow.com', start_utc: 5000, end_utc: 6000 }
  ],
  desktop_sessions: [
    { id: 'uuid-1', app: 'Code.exe', start_utc: 1000, end_utc: 2000, source: 'foreground' }, // Duplicate
    { id: 'uuid-2', app: 'slack.exe', start_utc: 7000, end_utc: 8000, source: 'foreground' } // New
  ]
};
const envelopeResult = context.mergeImportEnvelope(legacyResult.browserSessions, legacyResult.desktopSessions, envelopeIncoming);
assert.equal(envelopeResult.browserSessions.length, 3, 'Must have 3 browser sessions');
assert.equal(envelopeResult.desktopSessions.length, 2, 'Must deduplicate and have 2 desktop sessions');
assert.equal(envelopeResult.importedBrowserCount, 1);
assert.equal(envelopeResult.importedDesktopCount, 1);
console.log('  PASS: mergeImportEnvelope handles legacy arrays and envelopes with idempotent deduplication');

// 3. Script syntax validation
console.log('\n[3/4] Validating all scripts syntax...');
const scripts = ['extension/background.js', 'extension/digest.js', 'extension/popup.js'];
for (const file of scripts) {
  const code = fs.readFileSync(file, 'utf8');
  assert.doesNotThrow(() => new vm.Script(code), `Syntax error in ${file}`);
  console.log(`  PASS: ${file} parsed successfully`);
}

// 4. Content Security Policy (CSP) & Layout Integrity Check
console.log('\n[4/4] Verifying CSP compliance and 2-tab layout integrity...');
const popupHtml = fs.readFileSync('extension/popup.html', 'utf8');

// Ensure 2 tabs, settings popover, scope selector, daemon badge, and zero AI prompt bloat
assert.ok(popupHtml.includes('id="tab-overview"'), 'Overview tab must exist');
assert.ok(popupHtml.includes('id="tab-categories"'), 'Categories tab must exist');
assert.ok(popupHtml.includes('id="daemon-status-badge"'), 'Daemon status badge must exist in header');
assert.ok(popupHtml.includes('id="scope-selector"'), 'Scope selector must exist');
assert.ok(popupHtml.includes('id="btn-import-json"'), 'Import JSON button must exist');
assert.ok(popupHtml.includes('id="input-import-json"'), 'Import file input must exist');
assert.ok(popupHtml.includes('id="drilldown-app-list"'), 'Desktop apps breakdown list must exist');
assert.equal(popupHtml.includes('id="tab-ai"'), false, 'AI tab must be removed');
assert.ok(popupHtml.includes('id="btn-settings"'), 'Settings button must exist in header');
assert.ok(popupHtml.includes('id="settings-popover"'), 'Settings popover must exist');
assert.equal(popupHtml.includes('id="ai-sort-preview"'), false, 'AI sort prompt must be removed');
assert.equal(popupHtml.includes('id="ai-prompt-preview"'), false, 'AI digest prompt must be removed');
console.log('  PASS: DOM layout verified (2 primary tabs, scope selector, daemon status, zero prompt bloat)');

const allExtensionFiles = [
  'extension/popup.html',
  'extension/popup.js',
  'extension/background.js',
  'extension/digest.js'
];
const inlineHandlerRegex = /\son\w+\s*=/i;
for (const file of allExtensionFiles) {
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(
    inlineHandlerRegex.test(content),
    false,
    `CSP violation: inline event handler found in ${file}`
  );
  console.log(`  PASS: ${file} contains 0 inline event handlers`);
}

console.log('\nAll ACTLog Extension tests passed cleanly!\n');
