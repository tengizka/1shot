# Builds an isolated test folder. Does not deploy SQL/functions or publish Pages.
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$target = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $target) { throw 'Output directory must not exist; existing files are never overwritten.' }
$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'))
$needle = '<script src="club-booking.js?'
if (($html.Split(@($needle), [StringSplitOptions]::None)).Count -ne 2) { throw 'Unexpected frontend structure; refusing to modify.' }
$prefix = '<link rel="stylesheet" href="registration-wait.css"><script src="registration-wait.js"></script>' + "`n"
$html = $html.Replace($needle, $prefix + $needle)
New-Item -ItemType Directory -Path $target | Out-Null
Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Extension -in @('.js','.css','.svg','.png','.ico') } | Copy-Item -Destination $target
Copy-Item -LiteralPath (Join-Path $root 'assets') -Destination $target -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'registration-wait.js'),(Join-Path $PSScriptRoot 'registration-wait.css') -Destination $target
[IO.File]::WriteAllText((Join-Path $target 'index.html'), $html, (New-Object Text.UTF8Encoding($false)))
Write-Host 'Registration frontend staged for isolated testing only. Nothing has been deployed.'
