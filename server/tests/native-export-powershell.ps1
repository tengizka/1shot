$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\Export-Native.ps1'
$folder = Join-Path ([IO.Path]::GetTempPath()) ('oneshot-export-native-test-' + [guid]::NewGuid())
$before = Get-Location
$oldPassword = $env:PGPASSWORD
New-Item -ItemType Directory $folder | Out-Null
try {
    Copy-Item $source (Join-Path $folder 'Export-Native.ps1')
    New-Item -ItemType Directory (Join-Path $folder 'private') | Out-Null
    $global:fixturePassword = 'SYNTHETIC+fake#pw@reserved'
    Set-Content (Join-Path $folder 'private\transfer.env') ('SOURCE_DATABASE_URL=postgresql://postgres.zqhfvtgktbfnxcclqqny:' + [Uri]::EscapeDataString($global:fixturePassword) + '@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full')
    Set-Content (Join-Path $folder 'private\supabase-ca.crt') 'test-only'
    $env:PGPASSWORD = 'previous-value'
    function global:Read-Host { param([string]$Prompt); return 'YES' }
    $global:nativeFail = $true
    function global:docker {
        if ($env:PGPASSWORD -cne $global:fixturePassword -or $env:PGSSLMODE -ne 'verify-full' -or ($args -join ' ').Contains($global:fixturePassword)) { throw 'Unsafe options' }
        Write-Output ('Hidden: ' + $global:fixturePassword)
        if ($global:nativeFail) {
            Write-Output 'ONESHOT_PHASE CONNECTED'
            Write-Output 'ONESHOT_PENDING_OPERATIONS'
            Write-Output ('psql: error: mock failure ' + $global:fixturePassword + ' ' + [Uri]::EscapeDataString($global:fixturePassword) + ' postgresql://user:OTHER_FAKE_SECRET@example.invalid/db')
            Write-Output 'CONTEXT: hidden customer data'
            $global:LASTEXITCODE=1; return
        }
        $out = $args[[Array]::IndexOf($args,'-o')+1]
        $path = Join-Path (Join-Path (Get-Location) 'private') ([IO.Path]::GetFileName($out))
        [IO.File]::WriteAllText($path,'{"format":"1shot-local-v1","tables":{"profiles":[{"telegram_id":123}],"hosts_cache":[],"reservations":[],"club_settings":[{"id":true}],"club_bookings":[],"club_events":[],"club_accounts":[],"club_commands":[],"club_auth_requests":[]}}')
        $global:LASTEXITCODE=0
    }
    $result = (& (Join-Path $folder 'Export-Native.ps1') *>&1 | Out-String)
    if ($result.Contains($global:fixturePassword) -or $result.Contains('OTHER_FAKE_SECRET') -or $result.Contains([Uri]::EscapeDataString($global:fixturePassword)) -or $result.Contains('hidden customer data') -or -not $result.Contains('ONESHOT_EXPORT DETAIL psql: error: mock failure [REDACTED]') -or -not $result.Contains('ONESHOT_PHASE CONNECTED') -or -not $result.Contains('PENDING_OPERATIONS') -or (Test-Path (Join-Path $folder 'private\club-export.json'))) { throw 'Failure must not publish export' }
    $global:nativeFail=$false
    $result = (& (Join-Path $folder 'Export-Native.ps1') *>&1 | Out-String)
    if ($result.Contains($global:fixturePassword) -or -not $result.Contains('Checksum verified') -or -not $result.Contains('Profiles exported: 1')) { throw 'Success validation failed' }
    if ($env:PGPASSWORD -ne 'previous-value') { throw 'Environment not restored' }
    $file = Join-Path $folder 'private\club-export.json'
    $hash = (Get-FileHash $file -Algorithm SHA256).Hash
    if ($hash -ine [IO.File]::ReadAllText($file+'.sha256')) { throw 'Checksum failed' }
    $result = (& (Join-Path $folder 'Export-Native.ps1') *>&1 | Out-String)
    if (-not $result.Contains('ALREADY_EXIST') -or (Get-FileHash $file -Algorithm SHA256).Hash -ne $hash) { throw 'Existing files overwritten' }
    if (@(Get-ChildItem (Join-Path $folder 'private') -Filter 'export-*').Count) { throw 'Temporary files not cleaned' }
    Write-Host 'Native export: safety guards, checksum, no overwrite, secret redaction and cleanup PASS'
} finally {
    Set-Location $before
    $env:PGPASSWORD = $oldPassword
    Remove-Item $folder -Recurse -Force
    Remove-Item Function:\docker,Function:\Read-Host -ErrorAction SilentlyContinue
    Remove-Variable fixturePassword,nativeFail -Scope Global -ErrorAction SilentlyContinue
}
exit 0
