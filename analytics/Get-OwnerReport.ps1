# Get-OwnerReport.ps1
# Generates executive presentation workbook for Club Owners (Otchet_Dlya_Vladeltsev.xlsx)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$script = Join-Path $root 'Export-OwnerDashboard.py'

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    $python = (Get-Command py -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    Write-Host "[!] Python не найден в PATH. Пожалуйста, установите Python с сайта python.org (обязательно выберите галочку 'Add python.exe to PATH')." -ForegroundColor Red
    exit 1
}

Write-Host "[*] Запуск генерации отчёта для владельцев клуба..." -ForegroundColor Cyan
& $python $script

$xlsx = Join-Path $root 'Otchet_Dlya_Vladeltsev.xlsx'
if (Test-Path $xlsx) {
    Write-Host "`n[OK] Отчёт для владельцев создан: $xlsx" -ForegroundColor Green
    Write-Host "[*] Открываем отчёт..." -ForegroundColor Cyan
    Start-Process $xlsx
}
