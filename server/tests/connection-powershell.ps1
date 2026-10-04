$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\Set-SourceConnection.ps1'
$folder = Join-Path ([IO.Path]::GetTempPath()) ('oneshot-connection-test-' + [guid]::NewGuid())
$before = Get-Location
New-Item -ItemType Directory $folder | Out-Null
try {
    Copy-Item $source (Join-Path $folder 'Set-SourceConnection.ps1')
    Set-Content (Join-Path $folder 'compose.yaml') 'test-only'
    Set-Content (Join-Path $folder '.env') 'test-only'
    New-Item -ItemType Directory (Join-Path $folder 'private') | Out-Null
    Set-Content (Join-Path $folder 'private\transfer.env') 'malformed old value'
    Set-Content (Join-Path $folder 'private\supabase-ca.crt') 'test certificate sentinel'
    $global:fixturePassword = 'SYNTHETIC+test#with@reserved:/%symbols'
    function global:Read-Host {
        param([string]$Prompt,[switch]$AsSecureString)
        return ConvertTo-SecureString $global:fixturePassword -AsPlainText -Force
    }
    $result = (& (Join-Path $folder 'Set-SourceConnection.ps1') *>&1 | Out-String)
    if ($result.Contains($global:fixturePassword) -or $result.Contains('postgresql://') -or -not $result.Contains('Connection file saved')) { throw 'Unsafe output or save failed' }
    $line = [IO.File]::ReadAllText((Join-Path $folder 'private\transfer.env')).Trim()
    $parsed = [Uri]$line.Substring('SOURCE_DATABASE_URL='.Length)
    if ([Uri]::UnescapeDataString($parsed.UserInfo.Split(':',2)[1]) -cne $global:fixturePassword -or $parsed.Fragment -ne '' -or $parsed.Port -ne 5432 -or $parsed.Query -ne '?sslmode=verify-full') { throw 'Encoding failed' }
    if ((Get-Content (Join-Path $folder 'private\supabase-ca.crt')) -ne 'test certificate sentinel' -or (Get-Content (Join-Path $folder '.env')) -ne 'test-only') { throw 'Unrelated files changed' }
    Write-Host 'Connection writer: encoding, redaction and unrelated file preservation PASS'
} finally {
    Set-Location $before
    Remove-Item $folder -Recurse -Force
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
    Remove-Variable fixturePassword -Scope Global -ErrorAction SilentlyContinue
}
exit 0
