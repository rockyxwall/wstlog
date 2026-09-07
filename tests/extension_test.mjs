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
assert.ok(manifest.version, 'Must have version');
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
console.log('  PASS: manifest.json is valid and all assets exist');

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
console.log('  PASS: classifyDomain covers all domain categories');

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

// 3. Script syntax validation
console.log('\n[3/4] Validating all scripts syntax...');
const scripts = ['extension/background.js', 'extension/digest.js', 'extension/popup.js'];
for (const file of scripts) {
  const code = fs.readFileSync(file, 'utf8');
  assert.doesNotThrow(() => new vm.Script(code), `Syntax error in ${file}`);
  console.log(`  PASS: ${file} parsed successfully`);
}

// 4. Content Security Policy (CSP) Check
console.log('\n[4/4] Verifying CSP compliance (no inline on* event handlers)...');
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
