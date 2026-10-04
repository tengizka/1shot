$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\Diagnose-Native.ps1'
$folder = Join-Path ([IO.Path]::GetTempPath()) ('oneshot-native-test-' + [guid]::NewGuid())
$before = Get-Location
$oldPassword = $env:PGPASSWORD
New-Item -ItemType Directory $folder | Out-Null
try {
    Copy-Item $source (Join-Path $folder 'Diagnose-Native.ps1')
    New-Item -ItemType Directory (Join-Path $folder 'private') | Out-Null
    $global:fixturePassword = 'SYNTHETIC+fake#pw@reserved'
    $url = 'SOURCE_DATABASE_URL=postgresql://postgres.zqhfvtgktbfnxcclqqny:' + [Uri]::EscapeDataString($global:fixturePassword) + '@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full'
    Set-Content (Join-Path $folder 'private\transfer.env') $url
    Set-Content (Join-Path $folder 'private\supabase-ca.crt') 'test-only'
    $env:PGPASSWORD = 'previous-value'
    function global:docker {
        if ($env:PGPASSWORD -cne $global:fixturePassword -or $env:PGSSLMODE -ne 'verify-full' -or ($args -join ' ').Contains($global:fixturePassword)) { throw 'Unsafe connection options' }
        if (-not ($args -contains 'SELECT 1;') -or $env:PGOPTIONS -notmatch 'default_transaction_read_only=on') { throw 'Read-only test required' }
        Write-Output ('Never expose: ' + $global:fixturePassword)
        Write-Output $global:nativeReply
        $global:LASTEXITCODE = $global:nativeCode
    }
    foreach ($case in @(@('1',0,'OK'),@('certificate verify failed',1,'TLS_UNTRUSTED_ISSUER'),@('FATAL: 28P01: password authentication failed',1,'PASSWORD_AUTH_FAILED'),@('Tenant or user not found',1,'POOLER_TENANT_OR_USER_NOT_FOUND'))) {
        $global:nativeReply = $case[0]; $global:nativeCode = $case[1]
        $result = (& (Join-Path $folder 'Diagnose-Native.ps1') *>&1 | Out-String)
        if ($result.Contains($global:fixturePassword) -or -not $result.Contains('ONESHOT_NATIVE CONNECT ' + $case[2])) { throw 'Redaction or classification failed' }
        if ($env:PGPASSWORD -ne 'previous-value') { throw 'Environment not restored' }
    }
    Write-Host 'Native diagnostic: safe arguments, SSL, read-only query, redaction and environment cleanup PASS'
} finally {
    Set-Location $before
    $env:PGPASSWORD = $oldPassword
    Remove-Item $folder -Recurse -Force
    Remove-Item Function:\docker -ErrorAction SilentlyContinue
    Remove-Variable fixturePassword,nativeReply,nativeCode -Scope Global -ErrorAction SilentlyContinue
}
exit 0
