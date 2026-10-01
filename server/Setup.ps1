$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install Docker Desktop with WSL2 first, start it, then run Setup.ps1 again.' }
docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }
if (-not (Test-Path '.env')) {
    function Random-Hex {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        return -join ($bytes | ForEach-Object { $_.ToString('x2') })
    }
    function Read-Secret($label) {
        $secure = Read-Host $label -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    $secret = Read-Secret 'Existing AGENT_SECRET from Desk .env (input hidden)'
    $token = Read-Secret 'Existing Telegram bot token (input hidden)'
    if ($secret.Length -lt 24 -or $secret -match "['`r`n]" -or $token -notmatch '^\d+:[A-Za-z0-9_-]+$') { throw 'Invalid secret/token format. No files were written.' }
    $lines = @("POSTGRES_PASSWORD=$(Random-Hex)", "API_DB_PASSWORD=$(Random-Hex)", "AGENT_SECRET='$secret'", "TELEGRAM_BOT_TOKEN='$token'", 'ALLOWED_ORIGINS=https://api.tengizka.fun,http://localhost:8787,http://127.0.0.1:8787')
    $path = Join-Path $PSScriptRoot '.env'
    [IO.File]::WriteAllLines($path,$lines,(New-Object Text.UTF8Encoding($false)))
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    icacls $path /inheritance:r /grant:r "${identity}:(F)" 'SYSTEM:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict .env permissions. Restrict them manually before continuing.' }
}
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Do not change Desk or delete the database volume.' }
Write-Host 'Local preview installed. Check http://127.0.0.1:8787/healthz'
Write-Host 'No cloud data was imported and bookings are disabled. Read README.md before connecting Desk.'
