# Windows CI only. All values are synthetic; no cloud requests.
param([string]$BackupExecutable)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$folder=Join-Path ([IO.Path]::GetTempPath()) ('1shot-preflight-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
try {
    $settings=Join-Path $folder 'settings';New-Item -ItemType Directory -Path $settings | Out-Null
    [IO.File]::WriteAllText((Join-Path $settings '.env'),'SECRET=synthetic-fixture')
    & python -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("create table state(key text,value text)"); c.execute("insert into state values (?,?)",("pending","keep")); c.commit(); c.close()' (Join-Path $settings 'desk.sqlite3')
    if ($LASTEXITCODE -ne 0) { throw 'fixture failed' }
    $backup=Join-Path $folder 'backup'
    $invokeArgs=@{ SettingsDirectory=$settings; BackupDirectory=$backup }
    if ($BackupExecutable) { $invokeArgs.BackupExecutable=$BackupExecutable }
    & (Join-Path $root 'release/registration/Prepare-Upgrade.ps1') @invokeArgs
    $plan=Get-Content -LiteralPath (Join-Path $backup 'upgrade-plan.json') -Raw | ConvertFrom-Json
    if ($plan.apply_allowed -or $plan.cloud_checked -or $plan.migrations.Count -ne 2) { throw 'unsafe plan' }
    if ((Get-Content -LiteralPath (Join-Path $backup 'data/.env') -Raw) -ne 'SECRET=synthetic-fixture') { throw 'config not preserved' }
    if (@((Get-Acl -LiteralPath $backup).Access | Where-Object { $_.IsInherited }).Count -ne 0) { throw 'backup ACL inherits access' }
    $refused=$false
    try { & (Join-Path $root 'release/registration/Prepare-Upgrade.ps1') @invokeArgs } catch { $refused=$true }
    if (-not $refused) { throw 'existing backup overwritten' }
    Write-Host 'LOCAL_PREFLIGHT_TEST_OK'
} finally {
    # Only delete the unique synthetic fixture created by this test.
    if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
}
