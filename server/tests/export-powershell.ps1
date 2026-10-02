$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\Export.ps1'
$folder = Join-Path ([IO.Path]::GetTempPath()) ('oneshot-export-test-' + [guid]::NewGuid())
$before = Get-Location
New-Item -ItemType Directory $folder | Out-Null
try {
    Copy-Item $source (Join-Path $folder 'Export.ps1')
    Set-Content (Join-Path $folder 'compose.yaml') 'test-only'
    Set-Content (Join-Path $folder '.env') 'test-only'
    $global:fixturePassword = 'SYNTHETIC+test#with@reserved:/%symbols'
    $global:exportShouldFail = $false
    function global:Read-Host {
        param([string]$Prompt,[switch]$AsSecureString)
        if ($AsSecureString) { return ConvertTo-SecureString $global:fixturePassword -AsPlainText -Force }
        return 'YES'
    }
    function global:docker {
        # Deliberately simulate a leaky OLD image; wrapper must suppress it.
        Write-Output ('Invalid URL: postgresql://test:' + $global:fixturePassword + '@example.invalid/test')
        if ($global:exportShouldFail) { $global:LASTEXITCODE = 1; return }
        $path = Join-Path (Get-Location) 'private\club-export.json'
        [IO.File]::WriteAllText($path,'{"format":"1shot-local-v1","tables":{}}')
        [IO.File]::WriteAllText(($path + '.sha256'),(Get-FileHash -Algorithm SHA256 $path).Hash)
        $global:LASTEXITCODE = 0
    }
    $result = (& (Join-Path $folder 'Export.ps1') *>&1 | Out-String)
    if ($result.Contains($global:fixturePassword) -or $result.Contains('postgresql://') -or -not $result.Contains('Checksum verified')) { throw 'Unsafe or failed success path' }
    $uri = [IO.File]::ReadAllText((Join-Path $folder 'private\transfer.env')).Trim().Substring('SOURCE_DATABASE_URL='.Length)
    $parsed = [Uri]$uri
    $actual = [Uri]::UnescapeDataString($parsed.UserInfo.Split(':',2)[1])
    if ($actual -cne $global:fixturePassword -or $parsed.Fragment -ne '' -or $parsed.Port -ne 5432) { throw 'Password encoding failed' }
    $saved = Get-FileHash (Join-Path $folder 'private\transfer.env')
    $result = (& (Join-Path $folder 'Export.ps1') *>&1 | Out-String)
    if (-not $result.Contains('already exist') -or (Get-FileHash (Join-Path $folder 'private\transfer.env')).Hash -ne $saved.Hash) { throw 'Existing export was overwritten' }
    Remove-Item (Join-Path $folder 'private\club-export.json*')
    $global:exportShouldFail = $true
    $result = (& (Join-Path $folder 'Export.ps1') *>&1 | Out-String)
    if ($result.Contains($global:fixturePassword) -or $result.Contains('postgresql://') -or -not $result.Contains('Export failed.')) { throw 'Unsafe failure output' }
    Write-Host 'PowerShell export: encoding, checksum, overwrite refusal and secret redaction PASS'
} finally {
    Set-Location $before
    Remove-Item $folder -Recurse -Force
    Remove-Item Function:\Read-Host,Function:\docker -ErrorAction SilentlyContinue
    Remove-Variable fixturePassword,exportShouldFail -Scope Global -ErrorAction SilentlyContinue
}
exit 0
