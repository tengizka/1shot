# Get-Analytics.ps1
# Runs Export-ClubAnalytics.py using existing %LOCALAPPDATA%\1SHOT Desk\.env credentials
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$script = Join-Path $root 'Export-ClubAnalytics.py'

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    $python = (Get-Command py -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    Write-Host "[!] Python не найден в PATH. Пожалуйста, установите Python с сайта python.org (обязательно выберите галочку 'Add python.exe to PATH')." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Запуск выгрузки аналитики клуба..." -ForegroundColor Cyan
& $python $script

$xlsx = Join-Path $root '1SHOT_Statistika_Club.xlsx'
if (Test-Path $xlsx) {
    Write-Host "`n[OK] Таблица успешно создана: $xlsx" -ForegroundColor Green
    Write-Host "[*] Открываем готовую таблицу..." -ForegroundColor Cyan
    Start-Process $xlsx
}
