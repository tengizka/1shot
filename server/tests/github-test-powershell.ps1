$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\Enable-GitHub-Test.ps1'
$folder=Join-Path ([IO.Path]::GetTempPath()) ('oneshot-github-test-'+[guid]::NewGuid())
$before=Get-Location
New-Item -ItemType Directory $folder | Out-Null
try {
 Copy-Item $source (Join-Path $folder 'Enable-GitHub-Test.ps1')
 Set-Content (Join-Path $folder 'compose.yaml') 'test-only'
 Set-Content (Join-Path $folder '.env') @('AGENT_SECRET=synthetic-not-real','ALLOWED_ORIGINS=https://api.tengizka.fun,http://127.0.0.1:8787')
 function global:docker {
  if(($args -join ' ') -ne 'compose up -d --no-deps --force-recreate api'){throw 'Unexpected Docker operation'}
  Write-Output 'synthetic-not-real'
  $global:LASTEXITCODE=0
 }
 for($i=0;$i -lt 2;$i++){
  $result=(& (Join-Path $folder 'Enable-GitHub-Test.ps1') *>&1 | Out-String)
  if($result.Contains('synthetic-not-real') -or -not $result.Contains('GITHUB_TEST_READY')){throw 'Unexpected output'}
 }
 $text=[IO.File]::ReadAllText((Join-Path $folder '.env'))
 if(-not $text.Contains('AGENT_SECRET=synthetic-not-real') -or ([regex]::Matches($text,'https://tengizka.github.io')).Count -ne 1 -or -not $text.Contains('http://127.0.0.1:8787')){throw 'Configuration preservation failed'}
 Set-Content (Join-Path $folder '.env') 'ALLOWED_ORIGINS=*'
 $result=(& (Join-Path $folder 'Enable-GitHub-Test.ps1') *>&1 | Out-String)
 if(-not $result.Contains('Wildcard origin found')){throw 'Wildcard accepted'}
 Write-Host 'GitHub test configuration: secrets preserved, idempotent, API-only restart PASS'
}finally{
 Set-Location $before
 Remove-Item $folder -Recurse -Force
 Remove-Item Function:\docker -ErrorAction SilentlyContinue
}
exit 0
