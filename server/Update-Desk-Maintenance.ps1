param([switch]$FunctionsOnly)
$ErrorActionPreference = 'Stop'

function Invoke-DeskFunctionDeploy([string]$Executable, [string]$Folder) {
    # Use the remote bundler. No Docker, database password, link or SQL commands.
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = 'functions deploy club-bookings --project-ref zqhfvtgktbfnxcclqqny --use-api --no-verify-jwt'
    $info.WorkingDirectory = $Folder
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'CLI_START_FAILED' }
        # Drain both pipes asynchronously; do not print or save CLI output.
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'CLI_TIMEOUT' }
        $null = $stdout.GetAwaiter().GetResult()
        $null = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'CLI_FAILED' }
    } finally { $process.Dispose() }
}

function Invoke-DeskMaintenanceUpdate {
    $folder = Join-Path ([IO.Path]::GetTempPath()) ('1shot-maintenance-' + [guid]::NewGuid().ToString('N'))
    $previousToken = $env:SUPABASE_ACCESS_TOKEN
    $previousTls = [Net.ServicePointManager]::SecurityProtocol
    $secret = $null
    $stage = 'PREPARE'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        New-Item -ItemType Directory -Path $folder | Out-Null
        $stage = 'DOWNLOAD_TOOL'
        Write-Host 'Downloading official Supabase CLI 2.119.0...'
        $archive = Join-Path $folder 'cli.zip'
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri 'https://github.com/supabase/cli/releases/download/v2.119.0/supabase_2.119.0_windows_amd64.zip' -OutFile $archive
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne 'db4a6ec26d182408ca605efc0d0d938720bd2d8d39541e79c7d69043897affb9') { throw 'CHECKSUM_MISMATCH' }
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $folder 'bin')
        $exe = Join-Path $folder 'bin\supabase.exe'
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'CLI_MISSING' }
        $stage = 'DOWNLOAD_SOURCE'
        $root = Join-Path $folder 'project'
        $source = 'https://raw.githubusercontent.com/tengizka/1shot/6df612a640be1ccad0c589255078109153589503/supabase'
        foreach ($name in @('functions/club-bookings/index.ts', 'functions/_shared/club.ts')) {
            $target = Join-Path $root ('supabase/' + $name)
            New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
            Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri ($source + '/' + $name) -OutFile $target
        }
        [IO.File]::WriteAllText((Join-Path $root 'supabase/config.toml'), "[functions.club-bookings]`nverify_jwt = false`n", (New-Object Text.UTF8Encoding($false)))
        $stage = 'TOKEN_INPUT'
        Write-Host 'Project: zqhfvtgktbfnxcclqqny. Updating ONLY club-bookings.'
        Write-Host 'No SQL, data deletion, database export or Desk configuration changes.'
        $secret = Read-Host 'Paste Supabase PERSONAL access token (hidden input, not a database password)' -AsSecureString
        if ($secret.Length -eq 0) { throw 'EMPTY_TOKEN' }
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $stage = 'DEPLOY_FUNCTION'
        Write-Host 'Deploying club-bookings. Please wait...'
        Invoke-DeskFunctionDeploy $exe $root
        $stage = 'VERIFY_FUNCTION'
        $ready = $false
        for ($attempt = 0; $attempt -lt 6; $attempt++) {
            try {
                $response = Invoke-RestMethod -Method Post -TimeoutSec 20 -Uri 'https://zqhfvtgktbfnxcclqqny.supabase.co/functions/v1/club-bookings' -ContentType 'application/json' -Body '{"action":"capabilities"}'
                $desk = $response.desk
                if ($null -ne $desk -and $desk.online -is [bool] -and $null -ne $desk.valid_for_ms -and $desk.valid_for_ms -is [ValueType]) {
                    $ttl = [double]$desk.valid_for_ms
                    if ($ttl -ge 0 -and $ttl -le 30000 -and ($desk.online -eq ($ttl -gt 0))) { $ready = $true; break }
                }
            } catch { # Never echo a response body or credential-bearing exception.
            }
            if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
        }
        if (-not $ready) { throw 'NEW_RESPONSE_NOT_CONFIRMED' }
        Write-Host 'DESK_MAINTENANCE_BACKEND_READY'
        if ($desk.online) { Write-Host 'DESK_ONLINE' } else { Write-Host 'DESK_OFFLINE (backend update succeeded)' }
    } catch {
        throw "UPDATE_FAILED: $stage. Stop here and report this marker only."
    } finally {
        $env:SUPABASE_ACCESS_TOKEN = $previousToken
        [Net.ServicePointManager]::SecurityProtocol = $previousTls
        if ($null -ne $secret) { $secret.Dispose() }
        if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
if (-not $FunctionsOnly) {
    try { Invoke-DeskMaintenanceUpdate }
    catch { Write-Host $_.Exception.Message; exit 1 }
}
