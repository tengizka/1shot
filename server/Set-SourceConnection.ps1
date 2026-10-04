# Run from the installed server directory. Never accepts a password as a CLI argument.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try {
    if (-not (Test-Path '.\compose.yaml') -or -not (Test-Path '.\.env')) {
        Write-Host 'Put Set-SourceConnection.ps1 in the existing server folder containing compose.yaml and .env.'
        exit 1
    }
    $directory = Join-Path $PSScriptRoot 'private'
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    Write-Host 'Updates only private/transfer.env. No database changes, export or import.'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    icacls $directory /inheritance:r /grant:r "${identity}:(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host 'Cannot restrict private folder permissions. Stopping.'; exit 1 }
    $secure = Read-Host 'Paste the CURRENT database password set in Supabase (hidden), then press Enter' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ([string]::IsNullOrEmpty($password) -or $password.Contains("`r") -or $password.Contains("`n")) {
            Write-Host 'Password is empty or contains a line break. Stopping.'
            exit 1
        }
        $encoded = [Uri]::EscapeDataString($password)
        $line = 'SOURCE_DATABASE_URL=postgresql://postgres.zqhfvtgktbfnxcclqqny:' + $encoded + '@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full'
        [IO.File]::WriteAllText((Join-Path $directory 'transfer.env'), $line + "`n", (New-Object Text.UTF8Encoding($false)))
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $password = $null; $encoded = $null; $line = $null
        $secure.Dispose()
    }
    icacls (Join-Path $directory 'transfer.env') /inheritance:r /grant:r "${identity}:(F)" '*S-1-5-18:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host 'Cannot restrict connection file permissions. Stopping.'; exit 1 }
    Write-Host 'Connection file saved. Run Diagnose-Export.ps1 next. Do not send transfer.env.'
} catch {
    Write-Host 'Connection setup failed. Raw errors are hidden to protect secrets.'
    exit 1
}
