$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
py -3 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r desktop\requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed" }
& .\.venv\Scripts\python.exe -m desktop.write_metadata
if ($LASTEXITCODE -ne 0) { throw "Metadata generation failed" }
& .\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --windowed --name "1SHOT-Desk" --paths . --icon desktop/assets/app.ico --version-file desktop/version-info.txt --add-data "desktop/assets;desktop/assets" --add-data "desktop/brand.js;desktop" --add-data "desktop/index.html;desktop" --add-data "desktop/desk.js;desktop" --add-data "desktop/desk.css;desktop" --add-data "desktop/polish.css;desktop" --add-data "desktop/polish.js;desktop" --add-data "assets/fonts;assets/fonts" --collect-all webview --exclude-module webview.platforms.winforms --exclude-module webview.platforms.edgechromium --exclude-module clr --exclude-module pythonnet desktop\launcher.py
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
$report = Join-Path (Get-Location) "dist\smoke-result.json"
$proc = Start-Process -FilePath "dist\1SHOT-Desk\1SHOT-Desk.exe" -ArgumentList @("--smoke-test", "`"$report`"") -PassThru
if (-not $proc.WaitForExit(90000)) { Stop-Process -Id $proc.Id -Force; throw "UI smoke test timed out" }
if (-not (Test-Path $report)) { throw "UI smoke test did not produce a result" }
$result = Get-Content $report -Raw | ConvertFrom-Json
if (-not $result.ok) { throw "UI smoke test failed: $($result.error)" }
Write-Host "Ready: dist\1SHOT-Desk\1SHOT-Desk.exe. Copy the ENTIRE folder."
