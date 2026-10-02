# Run from the installed server directory. Never accepts a password as a CLI argument.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try {
    if (-not (Test-Path '.\compose.yaml') -or -not (Test-Path '.\.env')) {
        Write-Host 'Put Export.ps1 in the existing server folder containing compose.yaml and .env.'
        exit 1
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host 'Docker is not installed or not in PATH.'
        exit 1
    }
    $directory = Join-Path $PSScriptRoot 'private'
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $file = Join-Path $directory 'club-export.json'
    if ((Test-Path $file) -or (Test-Path ($file + '.sha256'))) {
        Write-Host 'Export files already exist. Keep them; do not overwrite or delete them. Ask for verification first.'
        exit 1
    }
    Write-Host 'This reads Supabase only. It does NOT import data, change Desk or start the tunnel.'
    Write-Host 'Keep the old Desk and mini-app closed. The previously disclosed database password must be replaced in Supabase first.'
    $confirm = Read-Host 'Have you reset the database password in Supabase? Type YES to continue'
    if ($confirm -cne 'YES') { Write-Host 'Cancelled. No connection file was changed.'; exit 1 }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    icacls $directory /inheritance:r /grant:r "${identity}:(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host 'Cannot restrict private folder permissions. Stopping.'; exit 1 }
    $secure = Read-Host 'Paste the NEW database password (hidden input), then press Enter' -AsSecureString
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
    Write-Host 'Connection file saved. Exporting; please wait...'
    # Older images print the entire URL if parsing fails. Capture BOTH streams,
    # including native stderr in Windows PowerShell 5.1. Never echo raw output.
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(docker compose run --rm --no-deps -v "${directory}:/transfer" api run --env-file=/transfer/transfer.env --allow-net --allow-env --allow-read --allow-write=/transfer tools/transfer.ts export /transfer/club-export.json 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    $output = $null
    if ($code -ne 0) {
        Write-Host 'Export failed. Raw logs were hidden because older images may print passwords. Do not send transfer.env. Report only this message.'
        exit 1
    }
    if (-not (Test-Path $file) -or -not (Test-Path ($file + '.sha256'))) {
        Write-Host 'Export did not produce both files. Stop here; do not import.'
        exit 1
    }
    $expected = ([IO.File]::ReadAllText($file + '.sha256')).Trim()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or $expected -ine $actual) {
        Write-Host 'Export checksum mismatch. Keep the files for local verification; do not import.'
        exit 1
    }
    Write-Host 'Export complete. Checksum verified. Files are in server/private. Do not send the files or password in chat.'
} catch {
    # Exception messages from external tools and URL parsers may contain secrets.
    Write-Host 'Export stopped safely. Do not send raw logs or the connection file. Report this message and the last step you saw.'
    exit 1
}
