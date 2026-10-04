# Read-only consistent export using the already installed native PostgreSQL client.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$previous = @{}
$names = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS','PGCLIENTENCODING')
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$sqlFile = $null; $partFile = $null
try {
    $directory = Join-Path $PSScriptRoot 'private'
    $file = Join-Path $directory 'club-export.json'
    if ((Test-Path $file) -or (Test-Path ($file + '.sha256'))) {
        Write-Host 'ONESHOT_EXPORT FILES ALREADY_EXIST'
        Write-Host 'Keep the existing files. No overwrite was attempted.'
        exit 1
    }
    Write-Host 'Keep old Desk and mini-app CLOSED. This only exports; no import or cutover.'
    if ((Read-Host 'Are Desk and mini-app closed? Type YES') -cne 'YES') { Write-Host 'Cancelled.'; exit 1 }
    if (-not (Test-Path (Join-Path $directory 'supabase-ca.crt'))) { Write-Host 'ONESHOT_EXPORT CERTIFICATE MISSING'; exit 1 }
    $line = [IO.File]::ReadAllText((Join-Path $directory 'transfer.env')).Trim()
    if (-not $line.StartsWith('SOURCE_DATABASE_URL=')) { Write-Host 'ONESHOT_EXPORT CONFIG INVALID'; exit 1 }
    $uri = [Uri]$line.Substring('SOURCE_DATABASE_URL='.Length)
    if ($uri.Scheme -notin @('postgres','postgresql') -or $uri.Host -ne 'aws-1-eu-west-1.pooler.supabase.com' -or $uri.Port -ne 5432 -or $uri.Fragment -ne '') { Write-Host 'ONESHOT_EXPORT CONFIG INVALID'; exit 1 }
    $parts = $uri.UserInfo.Split(':',2)
    if ($parts.Count -ne 2) { Write-Host 'ONESHOT_EXPORT CONFIG INVALID'; exit 1 }
    $env:PGHOST = $uri.Host
    $env:PGPORT = '5432'
    $env:PGDATABASE = 'postgres'
    $env:PGUSER = [Uri]::UnescapeDataString($parts[0])
    $env:PGPASSWORD = [Uri]::UnescapeDataString($parts[1])
    if ($env:PGUSER -ne 'postgres.zqhfvtgktbfnxcclqqny' -or [string]::IsNullOrEmpty($env:PGPASSWORD)) { Write-Host 'ONESHOT_EXPORT CONFIG INVALID'; exit 1 }
    $env:PGSSLMODE = 'verify-full'
    $env:PGSSLROOTCERT = '/transfer/supabase-ca.crt'
    $env:PGCONNECT_TIMEOUT = '10'
    $env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=60000'
    $env:PGCLIENTENCODING = 'UTF8'
    Write-Host 'ONESHOT_EXPORT CONFIG OK'
    $tag = [guid]::NewGuid().ToString('N')
    $sqlName = 'export-' + $tag + '.sql'
    $partName = 'export-' + $tag + '.part'
    $sqlFile = Join-Path $directory $sqlName
    $partFile = Join-Path $directory $partName
    $query = @'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.club_worker WHERE lease_until>now()) THEN
  RAISE EXCEPTION 'ONESHOT_DESK_ACTIVE';
 END IF;
 IF EXISTS(SELECT 1 FROM public.club_commands WHERE status IN ('queued','running'))
 OR EXISTS(SELECT 1 FROM public.club_auth_requests WHERE status IN ('pending','running')) THEN
  RAISE EXCEPTION 'ONESHOT_PENDING_OPERATIONS';
 END IF;
END $$;
SELECT jsonb_build_object('format','1shot-local-v1','exported_at',now(),'tables',jsonb_build_object(
 'profiles',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.profiles r),'[]'::jsonb),
 'hosts_cache',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.hosts_cache r),'[]'::jsonb),
 'reservations',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.reservations r),'[]'::jsonb),
 'club_settings',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.club_settings r),'[]'::jsonb),
 'club_bookings',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.club_bookings r),'[]'::jsonb),
 'club_events',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.club_events r),'[]'::jsonb),
 'club_accounts',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.club_accounts r),'[]'::jsonb),
 'club_commands',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.club_commands r),'[]'::jsonb),
 'club_auth_requests',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('cipher',null)) FROM public.club_auth_requests r),'[]'::jsonb)
));
COMMIT;
'@
    [IO.File]::WriteAllText($sqlFile,$query,(New-Object Text.UTF8Encoding($false)))
    Write-Host 'Exporting through native PostgreSQL with strict SSL. Please wait...'
    # Environment values are inherited, NOT placed in process arguments. Never
    # print captured native stderr: older libraries can expose credentials.
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(docker run --rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges -v "${directory}:/transfer" -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE -e PGSSLROOTCERT -e PGCONNECT_TIMEOUT -e PGOPTIONS -e PGCLIENTENCODING --entrypoint psql postgres:17.7 -X -w -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "/transfer/$sqlName" -o "/transfer/$partName" 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
    $result = 'FAILED'
    if ($code -eq 0) { $result = 'OK' }
    elseif ($text -match 'ONESHOT_DESK_ACTIVE') { $result = 'DESK_ACTIVE' }
    elseif ($text -match 'ONESHOT_PENDING_OPERATIONS') { $result = 'PENDING_OPERATIONS' }
    elseif ($text -match 'Tenant or user not found') { $result = 'POOLER_TENANT_OR_USER_NOT_FOUND' }
    elseif ($text -match 'password authentication failed|28P01') { $result = 'PASSWORD_AUTH_FAILED' }
    elseif ($text -match '28000') { $result = 'AUTHORIZATION_REJECTED' }
    elseif ($text -match 'does not match host name|hostname mismatch') { $result = 'TLS_HOSTNAME_MISMATCH' }
    elseif ($text -match 'certificate has expired|certificate is not yet valid') { $result = 'TLS_CERT_TIME_ERROR' }
    elseif ($text -match 'certificate verify failed|self.signed|unable to get.*issuer|unable to verify') { $result = 'TLS_UNTRUSTED_ISSUER' }
    elseif ($text -match 'root certificate file|could not read.*certificate|could not load.*certificate') { $result = 'CERTIFICATE_FILE_ERROR' }
    elseif ($text -match 'timeout|timed out') { $result = 'TIMEOUT' }
    elseif ($text -match 'could not translate host name|network is unreachable|connection refused|server closed the connection|connection reset') { $result = 'NETWORK_ERROR' }
    elseif ($text -match 'No such image|image.*not found|Cannot connect to the Docker daemon|error during connect|docker.*not recognized') { $result = 'DOCKER_UNAVAILABLE' }
    elseif ($text -match 'SSL|TLS') { $result = 'TLS_ERROR' }
    if ($result -ne 'OK') { Write-Host ('ONESHOT_EXPORT DATABASE ' + $result); exit 1 }
    $bundle = [IO.File]::ReadAllText($partFile) | ConvertFrom-Json
    $tables = @('profiles','hosts_cache','reservations','club_settings','club_bookings','club_events','club_accounts','club_commands','club_auth_requests')
    if ($bundle.format -ne '1shot-local-v1' -or @($bundle.tables.PSObject.Properties).Count -ne $tables.Count) { throw 'Invalid export structure' }
    foreach ($table in $tables) {
        if (-not ($bundle.tables.PSObject.Properties.Name -contains $table) -or $bundle.tables.$table -isnot [Array]) { throw 'Missing export table' }
    }
    foreach ($row in $bundle.tables.club_auth_requests) {
        if ($null -ne $row.cipher -or $row.status -in @('pending','running')) { throw 'Unsafe auth state' }
    }
    foreach ($row in $bundle.tables.club_commands) {
        if ($row.status -in @('queued','running')) { throw 'Unsafe command state' }
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $partFile).Hash.ToLowerInvariant()
    # File.Move does not overwrite. Never replace a previous export on retry.
    [IO.File]::Move($partFile,$file)
    $stream = [IO.File]::Open(($file + '.sha256'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $bytes = [Text.Encoding]::ASCII.GetBytes($hash); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash -ine [IO.File]::ReadAllText($file + '.sha256')) { throw 'Checksum mismatch' }
    Write-Host 'ONESHOT_EXPORT COMPLETE OK'
    Write-Host ('Profiles exported: ' + @($bundle.tables.profiles).Count)
    Write-Host 'Export complete. Checksum verified. Files: private/club-export.json and private/club-export.json.sha256'
    Write-Host 'Do NOT send these personal-data files. Stop here: data has NOT been imported.'
} catch {
    Write-Host 'ONESHOT_EXPORT START FAILED'
    Write-Host 'Raw errors suppressed. Check that this file is in the installed server folder.'
    exit 1
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
    $line = $null; $uri = $null; $parts = $null; $text = $null; $output = $null; $bundle = $null
    foreach ($temporary in @($sqlFile,$partFile)) { if ($temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue } }
}
