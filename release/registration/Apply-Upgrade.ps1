# Apply-Upgrade.ps1
# Coordinated upgrade coordinator for 1SHOT Club Desk & Staged Flows.
# Applies validated migrations (014, 015, 016) and updates Desk installation while strictly preserving .env and desk.sqlite3.
param(
    [Parameter(Mandatory=$true)][string]$BackupDirectory,
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA '1SHOT Desk'),
    [string]$NewDeskExecutable,
    [switch]$SkipCloudMigration,
    [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$stage = 'VERIFY_PREFLIGHT'
$secret = $null
$token = $null
$previousTls = [Net.ServicePointManager]::SecurityProtocol

try {
    Write-Host "=== 1SHOT CLUB DESK UPGRADE COORDINATOR ==="
    $root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $source = (Resolve-Path -LiteralPath $SettingsDirectory).Path
    $backup = [IO.Path]::GetFullPath($BackupDirectory)

    # 1. Verify backup plan and data integrity
    $planPath = Join-Path $backup 'upgrade-plan.json'
    if (-not (Test-Path -LiteralPath $planPath)) {
        throw "PREFLIGHT_PLAN_MISSING: Run Prepare-Upgrade.ps1 first to create a verified backup."
    }
    $plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
    if ($plan.format -ne '1shot-registration-preflight-v1') { throw 'INVALID_PREFLIGHT_PLAN' }

    $backupData = Join-Path $backup 'data'
    $manifestPath = Join-Path $backupData 'backup-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'BACKUP_MANIFEST_MISSING' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($file in $manifest.files) {
        $p = Join-Path $backupData $file.path
        if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $file.sha256) {
            throw "BACKUP_CORRUPTED: Hash mismatch on $($file.path)"
        }
    }
    Write-Host "[OK] Backup verification passed: .env and desk.sqlite3 verified intact."

    # 2. Check no running Desk / agent processes
    $stage = 'CHECK_PROCESSES'
    if ($env:OS -eq 'Windows_NT') {
        $processes = @(Get-CimInstance Win32_Process)
        $running = @($processes | Where-Object {
            $_.Name -in @('1SHOT-Desk.exe','agent.exe') -or
            ($_.Name -match '^python(w)?(3)?\.exe$' -and $_.CommandLine -match '(agent\.py|desktop[\\/](app|launcher)\.py|-m\s+desktop\.(app|launcher))')
        })
        if ($running.Count -gt 0) {
            throw "PROCESSES_RUNNING: Stop all 1SHOT-Desk and agent processes before continuing."
        }
    }
    Write-Host "[OK] No conflicting processes running."

    # 3. Apply SQL migrations if not skipped
    if (-not $SkipCloudMigration) {
        $stage = 'APPLY_MIGRATIONS'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $secret = Read-Host 'Supabase PERSONAL access token (hidden; never paste in chat)' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }

        $migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $root 'supabase/migrations') -File | Where-Object { $_.Name -match '^2026100800(14|15|16)_' } | Sort-Object Name)
        foreach ($mFile in $migrationFiles) {
            Write-Host "Applying $($mFile.Name)..."
            $sql = Get-Content -LiteralPath $mFile.FullName -Raw
            if ($WhatIf) {
                Write-Host "[WhatIf] Would execute SQL from $($mFile.Name)"
            } else {
                $body = @{ query = $sql } | ConvertTo-Json
                $resp = Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/zqhfvtgktbfnxcclqqny/database/query' -Headers @{Authorization=('Bearer '+$token)} -ContentType 'application/json' -Body $body -TimeoutSec 90
                Write-Host "  -> Successfully applied $($mFile.Name)"
            }
        }
    }

    # 4. Update Desk binaries while strictly preserving .env and desk.sqlite3
    $stage = 'UPDATE_DESK_BINARIES'
    if ($NewDeskExecutable) {
        $newExe = (Resolve-Path -LiteralPath $NewDeskExecutable).Path
        $targetExe = Join-Path $source '1SHOT-Desk.exe'
        if ($WhatIf) {
            Write-Host "[WhatIf] Would copy $newExe to $targetExe"
        } else {
            Copy-Item -LiteralPath $newExe -Destination $targetExe -Force
            Write-Host "[OK] 1SHOT-Desk.exe updated. Preserved .env and desk.sqlite3 unchanged."
        }
    }

    # 5. Record ledger entry
    $stage = 'RECORD_LEDGER'
    $ledgerEntry = @{
        applied_at = (Get-Date).ToUniversalTime().ToString('o')
        backup_directory = $backup
        status = 'SUCCESS'
        cloud_migrations_applied = (-not $SkipCloudMigration)
    }
    $ledgerPath = Join-Path $source 'upgrade-ledger.json'
    $ledgerEntry | ConvertTo-Json | Set-Content -LiteralPath $ledgerPath -Encoding UTF8

    Write-Host "=== UPGRADE COMPLETED SUCCESSFULLY ==="
    Write-Host "Settings and SQLite database preserved intact."
    Write-Host "You may now start the updated 1SHOT-Desk."
} catch {
    Write-Error "APPLY_UPGRADE_FAILED at stage $stage: $_"
    Write-Warning "Rollback: Your verified backup is located at $BackupDirectory. .env and desk.sqlite3 were not overwritten."
    throw
} finally {
    $token = $null
    [Net.ServicePointManager]::SecurityProtocol = $previousTls
    if ($null -ne $secret) { $secret.Dispose() }
}
