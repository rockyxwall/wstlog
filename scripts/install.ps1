<#
.SYNOPSIS
ACTLog One-Click Install & Update Script
.DESCRIPTION
Installs or updates ACTLog directly on your machine without external tools (Inno Setup / admin rights):
1. Stops any running ACTLog instance
2. Builds optimized release binary
3. Copies to $env:LOCALAPPDATA\Programs\actlog\
4. Configures auto-start on Windows boot via Startup shortcut
5. Starts the updated app
#>

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  ACTLog Quick Installer / Updater (v0.0.4)   " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Stop existing instance
Write-Host "`n[1/5] Stopping existing actlog..." -ForegroundColor Gray
Stop-Process -Name actlog -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

# 2. Build release binary
Write-Host "[2/5] Compiling release binary..." -ForegroundColor Gray
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 3. Target install directory: %LOCALAPPDATA%\Programs\actlog\
$installDir = Join-Path $env:LOCALAPPDATA "Programs\actlog"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$sourceExe = Join-Path $repoRoot "target\release\actlog.exe"
$targetExe = Join-Path $installDir "actlog.exe"

Write-Host "[3/5] Installing binary to $targetExe..." -ForegroundColor Gray
Copy-Item -Path $sourceExe -Destination $targetExe -Force

# 4. Create / Update Windows Startup shortcut
Write-Host "[4/5] Updating Startup shortcut..." -ForegroundColor Gray
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "actlog.lnk"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetExe
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = "ACTLog Background Time Tracker"
$shortcut.Save()

# 5. Launch installed app
Write-Host "[5/5] Launching updated ACTLog..." -ForegroundColor Gray
Start-Process -FilePath $targetExe -WorkingDirectory $installDir

Write-Host "`n✅ ACTLog successfully installed/updated!" -ForegroundColor Green
Write-Host "• Location: $targetExe" -ForegroundColor Gray
Write-Host "• Auto-start: $shortcutPath" -ForegroundColor Gray
Write-Host "• Logs: $env:APPDATA\actlog\actlog.log" -ForegroundColor Gray
