<#
.SYNOPSIS
ACTLog Quick Dev & Test Runner
.DESCRIPTION
Rebuilds and restarts the desktop daemon, verifies port, and runs extension tests.
In Chrome, test by clicking the 🔄 Reload button on the ACTLog card in chrome://extensions.
#>
param (
    [switch]$Test
)

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  ACTLog Quick Dev Runner (v0.0.4)           " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Kill running instance if any
Write-Host "`n[1/4] Stopping running instance..." -ForegroundColor Gray
Stop-Process -Name actlog -ErrorAction SilentlyContinue

# 2. Build release binary
Write-Host "[2/4] Building Rust release binary..." -ForegroundColor Gray
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 3. Start daemon in background
Write-Host "[3/4] Starting background daemon..." -ForegroundColor Gray
$binPath = Join-Path $PSScriptRoot "..\target\release\actlog.exe"
Start-Process -FilePath $binPath -WorkingDirectory (Split-Path $binPath)

# Health-check ports 5566, 5567, 5568
$activePort = $null
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 200
    foreach ($p in 5566, 5567, 5568) {
        try {
            $res = Invoke-RestMethod -Uri "http://127.0.0.1:$p/api/sessions" -TimeoutSec 1 -ErrorAction Stop
            if ($res -ne $null) { $activePort = $p; break }
        } catch { }
    }
    if ($activePort) { break }
}

if ($activePort) {
    Write-Host "  ✅ Desktop Daemon active on http://127.0.0.1:$activePort" -ForegroundColor Green
} else {
    Write-Host "  ⚠️ Daemon spawned (waiting for first poll cycle)" -ForegroundColor Yellow
}

# 4. Verify Extension
Write-Host "[4/4] Validating extension..." -ForegroundColor Gray
node tests/extension_test.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Extension tests failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

if ($Test) {
    Write-Host "`nRunning Cargo Tests..." -ForegroundColor Cyan
    cargo test --locked
}

$reportPort = if ($activePort) { $activePort } else { 5566 }
Write-Host "`n🚀 ACTLog is running and ready!" -ForegroundColor Green
Write-Host "• Desktop REST: http://127.0.0.1:$reportPort/api/sessions" -ForegroundColor Gray
Write-Host "• Extension UI: Click 🔄 (Reload) in chrome://extensions to test latest JS/CSS" -ForegroundColor Gray
