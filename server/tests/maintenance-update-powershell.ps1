$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\Update-Desk-Maintenance.ps1') -FunctionsOnly
$originalToken = $env:SUPABASE_ACCESS_TOKEN
$env:SUPABASE_ACCESS_TOKEN = 'previous-synthetic-token'
$script:mode = 'online'
$script:created = @()
$script:readCount = 0
function Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
    if ($Uri -notmatch '^https://(github.com/supabase/cli/releases/download/v2\.119\.0/|raw.githubusercontent.com/tengizka/1shot/[a-f0-9]{40}/supabase/)') { throw 'unpinned source' }
    [IO.File]::WriteAllText($OutFile, 'synthetic-download')
    if ($OutFile.EndsWith('cli.zip')) { $script:created += Split-Path $OutFile }
}
function Get-FileHash {
    param($Algorithm, $LiteralPath)
    if ($script:mode -eq 'bad-hash') { return @{Hash='bad'} }
    return @{Hash='db4a6ec26d182408ca605efc0d0d938720bd2d8d39541e79c7d69043897affb9'}
}
function Expand-Archive {
    param($LiteralPath, $DestinationPath)
    New-Item -ItemType Directory $DestinationPath | Out-Null
    [IO.File]::WriteAllText((Join-Path $DestinationPath 'supabase.exe'), 'not-executed')
}
function Read-Host {
    param($Prompt, [switch]$AsSecureString)
    if (-not $AsSecureString) { throw 'visible credential input' }
    $script:readCount++
    return ConvertTo-SecureString 'sbp_synthetic-secret' -AsPlainText -Force
}
function Invoke-DeskFunctionDeploy {
    param($Executable, $Folder)
    if ($env:SUPABASE_ACCESS_TOKEN -ne 'sbp_synthetic-secret') { throw 'missing process token' }
    if (-not (Test-Path (Join-Path $Folder 'supabase/functions/club-bookings/index.ts'))) { throw 'missing function' }
    if (-not (Test-Path (Join-Path $Folder 'supabase/functions/_shared/club.ts'))) { throw 'missing dependency' }
    if ((Get-Content (Join-Path $Folder 'supabase/config.toml') -Raw) -notmatch 'verify_jwt = false') { throw 'gateway configuration' }
    if ($script:mode -eq 'cli-fails') { throw 'sbp_synthetic-secret should not leak' }
}
function Invoke-RestMethod {
    param($Method, $TimeoutSec, $Uri, $ContentType, $Body)
    if ($Body -ne '{"action":"capabilities"}' -or $Uri -ne 'https://zqhfvtgktbfnxcclqqny.supabase.co/functions/v1/club-bookings') { throw 'unsafe probe' }
    switch ($script:mode) {
        'old-backend' { return @{enabled=$true} }
        'offline' { return @{desk=@{online=$false;valid_for_ms=0}} }
        default { return @{desk=@{online=$true;valid_for_ms=25000}} }
    }
}
function Start-Sleep { param($Seconds) }
try {
    foreach ($case in @('online','offline','old-backend','bad-hash','cli-fails')) {
        $script:mode=$case
        $beforeReads=$script:readCount
        $failed=$false
        try { $output = (Invoke-DeskMaintenanceUpdate *>&1 | Out-String) }
        catch { $failed=$true; $output=$_.Exception.Message }
        if ($output.Contains('sbp_synthetic-secret') -or $output.Contains('previous-synthetic-token')) { throw 'secret leaked' }
        if ($env:SUPABASE_ACCESS_TOKEN -ne 'previous-synthetic-token') { throw 'previous environment not restored' }
        foreach ($folder in $script:created) { if (Test-Path $folder) { throw 'temporary source not removed' } }
        if ($case -in @('online','offline')) {
            if ($failed -or -not $output.Contains('DESK_MAINTENANCE_BACKEND_READY')) { throw "Unexpected success result: $case" }
        } elseif (-not $failed -or -not $output.Contains('UPDATE_FAILED:')) { throw "Failure accepted: $case" }
        if ($case -eq 'bad-hash' -and $script:readCount -ne $beforeReads) { throw 'token asked before integrity check' }
    }
    Write-Host 'Maintenance deploy helper: pinned downloads, hidden token, online/offline success, failure sanitization, cleanup and environment restore PASS'
} finally { $env:SUPABASE_ACCESS_TOKEN=$originalToken }
