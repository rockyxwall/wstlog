// Autonomous Chrome Extension Runtime & Error Checker
// Ponytail: native Node 22 (fetch, WebSocket, child_process), zero npm packages

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execSync } from 'node:child_process';

function findChrome() {
  if (process.platform === 'win32') {
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    return paths.find(p => fs.existsSync(p)) || 'chrome';
  } else if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
    for (const c of candidates) {
      try {
        const p = execSync(`which ${c} 2>/dev/null`).toString().trim();
        if (p && fs.existsSync(p)) return p;
      } catch {}
    }
    return 'google-chrome';
  }
}

const CHROME_PATH = process.argv[2] || findChrome();
const EXTENSION_PATH = path.resolve('extension');
const TEMP_PROFILE = path.join(os.tmpdir(), `actlog-chrome-test-${Date.now()}`);
const DEBUG_PORT = 9222;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForCdpReady(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return true;
    } catch {
      await sleep(300);
    }
  }
  return false;
}

async function run() {
  console.log('=== Launching Chrome with ACTLog Extension ===');
  console.log(`Extension Path: ${EXTENSION_PATH}`);
  console.log(`Temp User Profile: ${TEMP_PROFILE}`);

  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${TEMP_PROFILE}`,
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--enable-logging=stderr',
    '--v=1'
  ];

  const chromeProc = spawn(CHROME_PATH, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeLogs = '';
  chromeProc.stderr.on('data', (d) => { chromeLogs += d.toString(); });
  chromeProc.stdout.on('data', (d) => { chromeLogs += d.toString(); });

  const errors = [];
  const warnings = [];

  try {
    const ready = await waitForCdpReady();
    if (!ready) {
      throw new Error('Chrome failed to start DevTools on port ' + DEBUG_PORT);
    }
    console.log('Chrome CDP ready.');

    // Find targets to discover Extension ID
    const targetsRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
    const targets = await targetsRes.json();
    console.log(`Found ${targets.length} initial target(s).`);

    let extId = null;
    for (const t of targets) {
      const match = t.url && t.url.match(/chrome-extension:\/\/([a-z0-9]+)/i);
      if (match) {
        extId = match[1];
        break;
      }
    }

    if (!extId) {
      // Create target for popup by querying extensions list or direct URL
      console.log('Searching extension ID via service worker target...');
      const swTarget = targets.find(t => t.type === 'service_worker');
      if (swTarget && swTarget.url) {
        const m = swTarget.url.match(/chrome-extension:\/\/([a-z0-9]+)/i);
        if (m) extId = m[1];
      }
    }

    if (!extId) {
      // Query chrome://extensions page to get extension id from preferences
      const prefPath = path.join(TEMP_PROFILE, 'Default', 'Preferences');
      if (fs.existsSync(prefPath)) {
        try {
          const pref = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
          const installed = pref.extensions?.settings || {};
          for (const [id, data] of Object.entries(installed)) {
            if (data.path && path.resolve(data.path) === EXTENSION_PATH) {
              extId = id;
              break;
            }
          }
        } catch (e) {
          console.debug(e);
        }
      }
    }

    console.log(`Detected Extension ID: ${extId || 'unknown'}`);

    if (!extId) {
      // Fallback: list all targets
      console.log('All targets:', targets);
      throw new Error('Could not identify extension ID in Chrome');
    }

    // Open popup page as a new target
    const popupUrl = `chrome-extension://${extId}/popup.html`;
    console.log(`Navigating to: ${popupUrl}`);
    const newTargetRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(popupUrl)}`, { method: 'PUT' });
    const popupTarget = await newTargetRes.json();

    if (!popupTarget || !popupTarget.webSocketDebuggerUrl) {
      throw new Error('Failed to create target for popup.html');
    }

    console.log(`Connecting CDP WebSocket to popup...`);
    const ws = new WebSocket(popupTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    function send(method, params = {}) {
      const id = msgId++;
      ws.send(JSON.stringify({ id, method, params }));
      return id;
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.method === 'Runtime.exceptionThrown') {
        const details = msg.params.exceptionDetails;
        errors.push(`[Runtime.exceptionThrown] ${details.text} ${details.exception?.description || ''} at ${details.url}:${details.lineNumber}`);
      }
      if (msg.method === 'Log.entryAdded') {
        const entry = msg.params.entry;
        if (entry.level === 'error') {
          errors.push(`[Log.error] [${entry.source}] ${entry.text} (${entry.url || ''})`);
        } else if (entry.level === 'warning') {
          warnings.push(`[Log.warn] [${entry.source}] ${entry.text}`);
        }
      }
      if (msg.method === 'Console.messageAdded') {
        const cmsg = msg.params.message;
        if (cmsg.level === 'error') {
          errors.push(`[Console.error] ${cmsg.text} (${cmsg.url}:${cmsg.line})`);
        }
      }
    };

    // Enable listeners
    send('Runtime.enable');
    send('Log.enable');
    send('Console.enable');

    await sleep(1000);

    // Simulate clicking through UI elements
    console.log('Simulating UI interactions...');
    const actions = [
      "document.getElementById('tab-categories')?.click()",
      "document.getElementById('tab-overview')?.click()",
      "document.getElementById('btn-settings')?.click()",
      "document.getElementById('btn-prev-day')?.click()",
      "document.getElementById('btn-next-day')?.click()",
      "document.querySelectorAll('.btn-pages-toggle').forEach(b => b.click())"
    ];

    for (const act of actions) {
      send('Runtime.evaluate', { expression: act });
      await sleep(200);
    }

    await sleep(800);
    ws.close();

    // Check Chrome's internal extension errors stored in Preferences
    const prefFile = path.join(TEMP_PROFILE, 'Default', 'Preferences');
    if (fs.existsSync(prefFile)) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefFile, 'utf8'));
        const extErrors = prefs.extensions?.errors?.[extId];
        if (Array.isArray(extErrors) && extErrors.length > 0) {
          for (const err of extErrors) {
            errors.push(`[Chrome Internal Extension Error] ${err.message || JSON.stringify(err)} (source: ${err.source || 'unknown'})`);
          }
        }
      } catch (err) {
        console.debug('Error reading prefs:', err);
      }
    }

  } finally {
    console.log('Stopping Chrome process...');
    chromeProc.kill('SIGTERM');
    await sleep(500);

    // Cleanup temp directory
    try {
      fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
    } catch {
      // Ignore if Windows file lock delay
    }
  }

  console.log('\n=== Runtime Verification Results ===');
  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    warnings.forEach(w => console.log('  ⚠️ ' + w));
  }

  if (errors.length === 0) {
    console.log('✅ ZERO runtime errors, ZERO CSP violations, ZERO console errors detected in live Chrome!');
    process.exit(0);
  } else {
    console.error(`❌ Errors Found (${errors.length}):`);
    errors.forEach(e => console.error('  ❌ ' + e));
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
