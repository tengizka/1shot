# READ-ONLY cloud preflight + verified local backup. Does not apply migrations or install Desk.
param(
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA '1SHOT Desk'),
    [Parameter(Mandatory=$true)][string]$BackupDirectory,
    [string]$BackupExecutable,
    [switch]$CheckSupabase,
    [switch]$AllLegacyWorkersStopped
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$stage = 'PREFLIGHT'
$secret = $null
$token = $null
$previousTls = [Net.ServicePointManager]::SecurityProtocol
try {
    if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
    $root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
    $source = (Resolve-Path -LiteralPath $SettingsDirectory).Path
    $target = [IO.Path]::GetFullPath($BackupDirectory)
    if ($target -eq $root -or $target.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'BACKUP_MUST_BE_OUTSIDE_REPOSITORY' }
    if (Test-Path -LiteralPath $target) { throw 'BACKUP_PATH_EXISTS' }
    if (-not (Test-Path -LiteralPath (Split-Path $target) -PathType Container)) { throw 'BACKUP_PARENT_MISSING' }
    if (-not (Test-Path -LiteralPath (Join-Path $source 'desk.sqlite3') -PathType Leaf)) { throw 'DESK_DATABASE_MISSING' }
    if (-not (Test-Path -LiteralPath (Join-Path $source '.env') -PathType Leaf)) { throw 'DESK_CONFIG_MISSING' }
    $processes = @(Get-CimInstance Win32_Process)
    if (@($processes | Where-Object {
        $_.Name -in @('1SHOT-Desk.exe','agent.exe') -or
        ($_.Name -match '^python(w)?(3)?\.exe$' -and $_.CommandLine -match '(agent\.py|desktop[\\/](app|launcher)\.py|-m\s+desktop\.(app|launcher))')
    }).Count) { throw 'EXIT_DESK_AND_LEGACY_AGENT_FIRST' }
    # New directory protected BEFORE .env is copied; the utility creates its own data child.
    $stage = 'PROTECT_BACKUP'
    New-Item -ItemType Directory -Path $target | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($identity)
    foreach ($sid in @($identity, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    Set-Acl -LiteralPath $target -AclObject $acl
    $stage = 'BACKUP_LOCAL'
    $data = Join-Path $target 'data'
    if ($BackupExecutable) {
        # Use the new, staged build, not an already-running old executable.
        $exe = (Resolve-Path -LiteralPath $BackupExecutable).Path
        $capabilities = Get-Content -LiteralPath (Join-Path (Split-Path $exe) 'backup-capabilities.json') -Raw | ConvertFrom-Json
        if ($capabilities.format -ne '1shot-desk-tools-v1' -or $capabilities.backup_mode -ne 1 -or (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $capabilities.sha256) { throw 'UNVERIFIED_BACKUP_EXECUTABLE' }
        $p = Start-Process -FilePath $exe -ArgumentList @('--backup-local',('"'+$source+'"'),('"'+$data+'"')) -PassThru
        if (-not $p.WaitForExit(180000)) { Stop-Process -Id $p.Id -Force; throw 'BACKUP_TIMEOUT' }
        $p.Refresh()
        if ($p.ExitCode -ne 0) { throw 'BACKUP_FAILED' }
    } else {
        $python = (Get-Command python -ErrorAction Stop).Source
        & $python (Join-Path $root 'desktop/upgrade_backup.py') $source $data
        if ($LASTEXITCODE -ne 0) { throw 'BACKUP_FAILED' }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $data 'backup-manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.format -ne '1shot-desk-backup-v1') { throw 'BAD_BACKUP_FORMAT' }
    if ('.env' -notin @($manifest.files.path) -or 'desk.sqlite3' -notin @($manifest.files.path)) { throw 'REQUIRED_FILES_NOT_BACKED_UP' }
    foreach ($file in $manifest.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $data $file.path))
        if (-not $path.StartsWith($data + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'BAD_BACKUP_PATH' }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw 'BACKUP_HASH_MISMATCH' }
    }
    $stage = 'MIGRATION_PLAN'
    $migrations = @(Get-ChildItem -LiteralPath (Join-Path $root 'supabase/migrations') -File | Where-Object { $_.Name -match '^2026100800(14|15)_' } | Sort-Object Name | ForEach-Object {
        @{ name=$_.Name; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    if ($migrations.Count -ne 2) { throw 'MIGRATIONS_MISSING' }
    $cloud = $null
    if ($CheckSupabase) {
        $stage = 'CLOUD_READ_ONLY'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $secret = Read-Host 'Supabase PERSONAL access token (hidden; never paste it in chat)' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        # Fixed read-only query; no supplied SQL, credentials, accounts or registration data in the result.
        $query = @'
select to_regclass('public.club_registration_requests') is not null as has_014,
 exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='club_registration_reconcile') as has_015,
 exists(select 1 from public.club_worker where lease_until>now()) as worker_online,
 (select count(*) from public.club_auth_requests where status in ('pending','running') and created_at>now()-interval '3 minutes') as pending_auth;
'@
        $response = @(Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/zqhfvtgktbfnxcclqqny/database/query' -Headers @{Authorization=('Bearer '+$token)} -ContentType 'application/json' -Body (@{query=$query}|ConvertTo-Json) -TimeoutSec 60)
        if ($response.Count -ne 1) { throw 'UNEXPECTED_SCHEMA_RESPONSE' }
        $cloud = $response[0]
        if ($cloud.worker_online -or [int]$cloud.pending_auth -gt 0) { throw 'CLOUD_OPERATIONS_ACTIVE' }
        # Presence is not a checksum-verified migration history. Never guess or rerun SQL.
        if ($cloud.has_014 -or $cloud.has_015) { throw 'EXISTING_SCHEMA_NEEDS_VERIFIED_MIGRATION_HISTORY' }
    }
    $plan = @{ format='1shot-registration-preflight-v1'; migrations=$migrations; cloud_checked=[bool]$CheckSupabase; legacy_stop_confirmed=[bool]$AllLegacyWorkersStopped; apply_allowed=$false; reason='Preflight only. Database backup, migration ledger and coordinated deployment are required before application.' }
    $plan | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $target 'upgrade-plan.json') -Encoding UTF8
    Write-Host 'PREFLIGHT_SAVED. Local backup verified. No SQL, functions, Desk installation or Pages publication changed.'
} catch {
    throw "PREPARE_UPGRADE_FAILED: $stage. Stop here. Do not repeat migrations or delete the backup."
} finally {
    $token = $null
    [Net.ServicePointManager]::SecurityProtocol = $previousTls
    if ($null -ne $secret) { $secret.Dispose() }
}
