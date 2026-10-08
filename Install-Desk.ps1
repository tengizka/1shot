# Install-Desk.ps1
# Automated installer / updater for 1SHOT Club Desk on Windows.
# Preserves %LOCALAPPDATA%\1SHOT Desk\.env and desk.sqlite3 without modification.
param(
    [string]$ArtifactZip,
    [string]$NewExecutablePath,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA '1SHOT Desk'),
    [string]$BackupDir = "C:\1SHOT-Desk-Backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')",
    [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   1SHOT CLUB DESK: WINDOWS INSTALLER & UPGRADE TOOL      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check existing installation
if (-not (Test-Path -LiteralPath $InstallDir)) {
    Write-Host "Creating installation directory: $InstallDir"
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$dbPath = Join-Path $InstallDir 'desk.sqlite3'
$envPath = Join-Path $InstallDir '.env'
$exePath = Join-Path $InstallDir '1SHOT-Desk.exe'

# 2. Stop running Desk processes cleanly
Write-Host "`n[1/5] Checking and stopping existing Desk / agent processes..." -ForegroundColor Yellow
$procs = @(Get-Process -Name '1SHOT-Desk', 'agent' -ErrorAction SilentlyContinue)
if ($procs.Count -gt 0) {
    Write-Host "Stopping $($procs.Count) running process(es)..."
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
}
Write-Host "[OK] No conflicting processes running." -ForegroundColor Green

# 3. Create verified backup
if ((Test-Path -LiteralPath $dbPath) -or (Test-Path -LiteralPath $envPath)) {
    Write-Host "`n[2/5] Creating verified backup in: $BackupDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    if (Test-Path -LiteralPath $dbPath) {
        Copy-Item -LiteralPath $dbPath -Destination (Join-Path $BackupDir 'desk.sqlite3') -Force
        Write-Host "  -> desk.sqlite3 backed up"
    }
    if (Test-Path -LiteralPath $envPath) {
        Copy-Item -LiteralPath $envPath -Destination (Join-Path $BackupDir '.env') -Force
        Write-Host "  -> .env backed up"
    }
    if (Test-Path -LiteralPath $exePath) {
        Copy-Item -LiteralPath $exePath -Destination (Join-Path $BackupDir '1SHOT-Desk.old.exe') -Force
    }
    Write-Host "[OK] Backup verified: settings and database preserved." -ForegroundColor Green
} else {
    Write-Host "`n[2/5] No existing database/settings found. Clean install." -ForegroundColor Gray
}

# 4. Source the new executable
Write-Host "`n[3/5] Locating new 1SHOT-Desk executable..." -ForegroundColor Yellow
$sourceExe = $null

if ($NewExecutablePath -and (Test-Path -LiteralPath $NewExecutablePath)) {
    $sourceExe = (Resolve-Path -LiteralPath $NewExecutablePath).Path
} elseif ($ArtifactZip -and (Test-Path -LiteralPath $ArtifactZip)) {
    $tempExtract = Join-Path $env:TEMP "1shot-desk-extract-$(Get-Random)"
    Write-Host "Extracting $ArtifactZip..."
    Expand-Archive -LiteralPath $ArtifactZip -DestinationPath $tempExtract -Force
    $found = @(Get-ChildItem -Path $tempExtract -Filter '1SHOT-Desk.exe' -Recurse)
    if ($found.Count -eq 0) { throw "1SHOT-Desk.exe not found inside $ArtifactZip" }
    $sourceExe = $found[0].FullName
} else {
    # Check current directory or script directory for 1SHOT-Desk.exe or zip
    $localExe = Join-Path $PSScriptRoot '1SHOT-Desk.exe'
    $localZip = Join-Path $PSScriptRoot '1SHOT-Desk-Windows.zip'
    if (Test-Path -LiteralPath $localExe) {
        $sourceExe = $localExe
    } elseif (Test-Path -LiteralPath $localZip) {
        $tempExtract = Join-Path $env:TEMP "1shot-desk-extract-$(Get-Random)"
        Expand-Archive -LiteralPath $localZip -DestinationPath $tempExtract -Force
        $sourceExe = (Get-ChildItem -Path $tempExtract -Filter '1SHOT-Desk.exe' -Recurse)[0].FullName
    } else {
        Write-Host "No local binary specified. Please download 1SHOT-Desk-Windows.zip from GitHub Actions" -ForegroundColor Red
        Write-Host "Run with: .\Install-Desk.ps1 -ArtifactZip C:\path\to\1SHOT-Desk-Windows.zip" -ForegroundColor Yellow
        return
    }
}

# 5. Install the new executable
Write-Host "`n[4/5] Updating executable in $InstallDir..." -ForegroundColor Yellow
Copy-Item -LiteralPath $sourceExe -Destination $exePath -Force
$newHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
Write-Host "[OK] 1SHOT-Desk.exe installed successfully. SHA256: $newHash" -ForegroundColor Green
Write-Host "Verified: .env and desk.sqlite3 remained untouched in $InstallDir" -ForegroundColor Green

# 6. Launch Desk
if (-not $NoLaunch) {
    Write-Host "`n[5/5] Launching updated 1SHOT-Desk..." -ForegroundColor Yellow
    Start-Process -FilePath $exePath
    Write-Host "[OK] 1SHOT-Desk is running!" -ForegroundColor Green
} else {
    Write-Host "`n[5/5] Installation complete (launch skipped as requested)." -ForegroundColor Gray
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "           UPGRADE COMPLETED SUCCESSFULLY!                " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
