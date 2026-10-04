# Allow ONLY the existing GitHub Pages origin. No secrets, DB changes or Desk switch.
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
try {
    if (-not (Test-Path '.env') -or -not (Test-Path 'compose.yaml')) { Write-Host 'Put this script in the installed server folder.'; exit 1 }
    $path=Join-Path $PSScriptRoot '.env'
    $lines=[IO.File]::ReadAllLines($path)
    $found=@($lines | Where-Object { $_ -match '^ALLOWED_ORIGINS=' })
    if ($found.Count -gt 1) { Write-Host 'Duplicate ALLOWED_ORIGINS entries. No changes made.'; exit 1 }
    $default='https://api.tengizka.fun,http://localhost:8787,http://127.0.0.1:8787'
    $origins=if($found.Count){$found[0].Substring('ALLOWED_ORIGINS='.Length).Trim().Trim('"').Trim("'")}else{$default}
    $values=@($origins.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($values -contains '*') { Write-Host 'Wildcard origin found. Stop and review configuration first.'; exit 1 }
    if ($values -notcontains 'https://tengizka.github.io') { $values+='https://tengizka.github.io' }
    $replacement='ALLOWED_ORIGINS='+($values -join ',')
    if($found.Count){$lines=@($lines | ForEach-Object { if($_ -match '^ALLOWED_ORIGINS='){$replacement}else{$_} })}else{$lines+=$replacement}
    [IO.File]::WriteAllLines($path,$lines,(New-Object Text.UTF8Encoding($false)))
    Write-Host 'Allowed GitHub Pages origin. Restarting only the local API; database and Desk are not changed.'
    $ErrorActionPreference='Continue'
    try{$output=@(docker compose up -d --no-deps --force-recreate api 2>&1);$code=$LASTEXITCODE}finally{$ErrorActionPreference='Stop'}
    $output=$null
    if($code -ne 0){Write-Host 'API restart failed. No database migration was run. Report this message without .env.';exit 1}
    Write-Host 'GITHUB_TEST_READY. Check http://127.0.0.1:8787/healthz. Tunnel setup is separate.'
}catch{Write-Host 'Setup stopped. Raw errors suppressed to protect .env values.';exit 1}
