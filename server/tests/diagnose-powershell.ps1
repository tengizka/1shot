$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\Diagnose-Export.ps1'
$folder = Join-Path ([IO.Path]::GetTempPath()) ('oneshot-diagnose-test-' + [guid]::NewGuid())
$before = Get-Location
New-Item -ItemType Directory $folder | Out-Null
try {
    Copy-Item $source (Join-Path $folder 'Diagnose-Export.ps1')
    New-Item -ItemType Directory (Join-Path $folder 'private') | Out-Null
    Set-Content (Join-Path $folder 'compose.yaml') 'test-only'
    Set-Content (Join-Path $folder 'private\transfer.env') 'SOURCE_DATABASE_URL=test-only'
    $initial = (Get-FileHash (Join-Path $folder 'private\transfer.env')).Hash
    function global:docker {
        Write-Output 'Invalid URL: postgresql://test:SYNTHETIC_SECRET@example.invalid/db'
        Write-Output 'ONESHOT_DIAG START AUTH_DETAILS'
        Write-Output 'ONESHOT_DIAG CONNECT POOLER_TENANT_OR_USER_NOT_FOUND'
        Write-Output 'ONESHOT_DIAG CONFIG OK'
        Write-Output 'ONESHOT_DIAG CERTIFICATE OK'
        Write-Output 'ONESHOT_DIAG CONNECT TLS_ERROR'
        Write-Output 'ONESHOT_DIAG CONFIG SYNTHETIC_SECRET'
        Write-Output 'ONESHOT_DIAG SYNTHETIC_SECRET OK'
        $global:LASTEXITCODE = 1
    }
    $result = (& (Join-Path $folder 'Diagnose-Export.ps1') *>&1 | Out-String)
    if ($result.Contains('SYNTHETIC_SECRET') -or $result.Contains('postgresql://') -or -not $result.Contains('ONESHOT_DIAG CONNECT TLS_ERROR') -or -not $result.Contains('ONESHOT_DIAG CERTIFICATE OK') -or -not $result.Contains('ONESHOT_DIAG CONNECT POOLER_TENANT_OR_USER_NOT_FOUND')) { throw 'Diagnostic redaction failed' }
    if ((Get-FileHash (Join-Path $folder 'private\transfer.env')).Hash -ne $initial) { throw 'Connection file changed' }
    if (@(Get-ChildItem (Join-Path $folder 'private') -Filter 'diagnostic-*').Count) { throw 'Temporary script was not cleaned up' }
    Write-Host 'Diagnostic allowlist, secret redaction and cleanup PASS'
} finally {
    Set-Location $before
    Remove-Item $folder -Recurse -Force
    Remove-Item Function:\docker -ErrorAction SilentlyContinue
}
exit 0
