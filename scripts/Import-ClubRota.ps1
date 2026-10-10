# Import-ClubRota.ps1
# Imports admin shifts for a specified month into 1SHOT Desk SQLite store.
param(
    [int]$Month = 10,
    [int]$Year = 2026,
    [string]$InputText,
    [string]$InputFile,
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA '1SHOT Desk'),
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Month -lt 1 -or $Month -gt 12) { throw "Month must be 1..12" }
if ($Year -lt 2024 -or $Year -gt 2030) { throw "Year out of range" }

$dbPath = Join-Path $SettingsDirectory 'desk.sqlite3'
if (-not $DryRun -and -not (Test-Path -LiteralPath $dbPath)) {
    throw "Desk database not found at: $dbPath"
}

$rawLines = @()
if ($InputFile) {
    if (-not (Test-Path -LiteralPath $InputFile)) { throw "File not found: $InputFile" }
    $rawLines = Get-Content -LiteralPath $InputFile
} elseif ($InputText) {
    $rawLines = $InputText -split "`r?`n"
} else {
    Write-Host "Enter shift lines (DD.MM.YYYY;DayAdmin;NightAdmin). Empty line to finish:"
    while ($true) {
        $line = Read-Host
        if ([string]::IsNullOrWhiteSpace($line)) { break }
        $rawLines += $line
    }
}

$rota = @{}
$daysInMonth = [DateTime]::DaysInMonth($Year, $Month)
for ($d = 1; $d -leq $daysInMonth; $d++) {
    $key = ("{0:D4}-{1:D2}-{2:D2}" -f $Year, $Month, $d)
    $rota[$key] = @{ day=''; night='' }
}

$parsedCount = 0
foreach ($line in $rawLines) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) { continue }
    $parts = $trimmed -split '[;,]' | ForEach-Object { $_.Trim() }
    if ($parts.Count -lt 2) { continue }

    $dateRaw = $parts[0]
    $m = [regex]::Match($dateRaw, '^(\d{1,2})\.(\d{1,2})\.(\d{4})$')
    if (-not $m.Success) {
        Write-Warning "Skipping invalid date: $dateRaw"
        continue
    }

    $d = [int]$m.Groups[1].Value
    $mo = [int]$m.Groups[2].Value
    $y = [int]$m.Groups[3].Value
    if ($mo -ne $Month -or $y -ne $Year) {
        Write-Warning "Skipping date outside target month ($Month/$Year): $dateRaw"
        continue
    }

    $key = ("{0:D4}-{1:D2}-{2:D2}" -f $y, $mo, $d)
    $dayShift = $parts[1]
    $nightShift = if ($parts.Count -ge 3) { $parts[2] } else { '' }

    $rota[$key] = @{ day=$dayShift; night=$nightShift }
    $parsedCount++
}

Write-Host "Parsed $parsedCount entries for month $Month/$Year."
if ($DryRun) {
    Write-Host "[DryRun] Schedule preview:"
    $rota.GetEnumerator() | Sort-Object Name | ForEach-Object {
        Write-Host "  $($_.Name): День='$($_.Value.day)' | Ночь='$($_.Value.night)'"
    }
    Write-Host "[DryRun] Completed without saving."
    return
}

# Save into SQLite store key 'rota.config' via python helper
$json = $rota | ConvertTo-Json -Compress
$pyScript = @"
import sqlite3, json, sys
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, val TEXT)")
cur.execute("INSERT INTO store (key, val) VALUES ('rota.config', ?) ON CONFLICT(key) DO UPDATE SET val=excluded.val", (sys.argv[2],))
conn.commit()
conn.close()
print("Saved rota.config to SQLite store.")
"@

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = 'python3' }
& $python -c $pyScript $dbPath $json
Write-Host "ROTA_IMPORTED: Shifts for $Month/$Year successfully saved."
