$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$dir = Join-Path $PSScriptRoot 'backups'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$name = 'oneshot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump'
$temp = '/tmp/' + $name
try {
    docker compose exec -T db pg_dump -U oneshot_owner -d oneshot -Fc -f $temp
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
    docker compose cp "db:$temp" (Join-Path $dir $name)
    if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed.' }
} finally { docker compose exec -T db rm -f $temp }
Write-Host "Backup: backups\$name. Contains personal data. Copy to protected storage on another device."
