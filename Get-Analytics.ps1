# Get-Analytics.ps1
# Runs Export-ClubAnalytics.py using existing %LOCALAPPDATA%\1SHOT Desk\.env credentials
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$script = Join-Path $root 'Export-ClubAnalytics.py'
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = 'python' }
& $python $script
