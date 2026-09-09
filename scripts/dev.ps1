<#
.SYNOPSIS
ACTLog Instant Dev & Test Workflow
.DESCRIPTION
Single command to test any changes without manual intervention:
1. Stops existing actlog process
2. Builds latest release binary
3. Launches background daemon
4. Validates port 5566 health
5. Runs extension test suite
6. Options: -Live (opens interactive Chrome) or -Test (runs full suite)
#>
param (
    [switch]$Live,
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
    Write-Host "`nRunning Full Rust & Chrome CDP Verification..." -ForegroundColor Cyan
    cargo test
    node scripts/test_extension_runtime.mjs
}

$reportPort = if ($activePort) { $activePort } else { 5566 }
if ($Live) {
    Write-Host "`nLaunching Live Chrome with ACTLog Extension..." -ForegroundColor Green
    $chrome = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($chrome) {
        $extPath = (Resolve-Path (Join-Path $PSScriptRoot "..\extension")).Path
        $tempProfile = Join-Path $env:TEMP "actlog-chrome-dev"
        Start-Process -FilePath $chrome -ArgumentList @(
            "--load-extension=`"$extPath`"",
            "--disable-extensions-except=`"$extPath`"",
            "--user-data-dir=`"$tempProfile`"",
            "--no-first-run",
            "--no-default-browser-check",
            "chrome://extensions"
        )
        Write-Host "  ✅ Chrome launched with ACTLog extension loaded!" -ForegroundColor Green
        Write-Host "  • Extension: $extPath" -ForegroundColor Gray
        Write-Host "  • Dev Profile: $tempProfile" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠️ Chrome not found in standard paths. Load extension from: $extPath" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n🚀 ACTLog is running and ready for testing!" -ForegroundColor Green
    Write-Host "• Desktop REST: http://127.0.0.1:$reportPort/api/sessions" -ForegroundColor Gray
    Write-Host "• Extension: Open Chrome popup to test dual-scope view" -ForegroundColor Gray
    Write-Host "• Tip: Run '.\scripts\dev.ps1 -Live' to launch interactive Chrome" -ForegroundColor Gray
}
