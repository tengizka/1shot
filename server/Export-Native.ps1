# Read-only consistent export using the already installed native PostgreSQL client.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
# Pack one row at a time; keep raw JSON numbers/strings exactly as PostgreSQL wrote them.
function Convert-ExportRows([string]$inputFile,[string]$outputFile) {
    $tables = @('profiles','hosts_cache','reservations','club_settings','club_bookings','club_events','club_accounts','club_commands','club_auth_requests')
    $counts = @{}; foreach ($table in $tables) { $counts[$table] = [long]0 }
    $reader = $null; $writer = $null; $stream = $null
    try {
        $reader = New-Object IO.StreamReader($inputFile,(New-Object Text.UTF8Encoding($false,$true)))
        $header = $reader.ReadLine()
        $meta = $header | ConvertFrom-Json
        if ($meta.format -ne '1shot-local-v1' -or -not $meta.exported_at -or -not $header.TrimEnd().EndsWith('}')) { throw 'Invalid stream header' }
        $stream = [IO.File]::Open($outputFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $writer = New-Object IO.StreamWriter($stream,(New-Object Text.UTF8Encoding($false)))
        $writer.Write($header.TrimEnd().Substring(0,$header.TrimEnd().Length-1) + ',"tables":{')
        $index = -1; $current = $null; $ended = $false
        while ($null -ne ($record = $reader.ReadLine())) {
            if ($record.StartsWith('ONESHOT_TABLE ')) {
                $next = $record.Substring('ONESHOT_TABLE '.Length)
                $index++
                if ($index -ge $tables.Count -or $next -cne $tables[$index]) { throw 'Unexpected table order' }
                if ($null -ne $current) { $writer.Write('],') }
                $current = $next
                $writer.Write('"' + $current + '":[')
            } elseif ($record -ceq 'ONESHOT_END') {
                if ($index -ne $tables.Count-1) { throw 'Incomplete tables' }
                $expected = $reader.ReadLine() | ConvertFrom-Json
                if (@($expected.PSObject.Properties).Count -ne $tables.Count) { throw 'Missing source counts' }
                foreach ($table in $tables) {
                    if (-not ($expected.PSObject.Properties.Name -contains $table) -or [long]$expected.$table -ne $counts[$table]) { throw 'Row count mismatch' }
                }
                if ($null -ne $reader.ReadLine()) { throw 'Trailing stream data' }
                $writer.Write(']}}')
                $ended = $true
                break
            } else {
                if ($null -eq $current -or -not $record.StartsWith('{') -or -not $record.EndsWith('}')) { throw 'Invalid row' }
                $row = $record | ConvertFrom-Json
                if ($current -eq 'club_auth_requests' -and ($null -ne $row.cipher -or $row.status -in @('pending','running'))) { throw 'Unsafe auth state' }
                if ($current -eq 'club_commands' -and $row.status -in @('queued','running')) { throw 'Unsafe command state' }
                if ($counts[$current] -gt 0) { $writer.Write(',') }
                $writer.Write($record)
                $counts[$current]++
                $row = $null
            }
        }
        if (-not $ended) { throw 'Truncated stream' }
        return $counts
    } finally {
        if ($writer) { $writer.Dispose() } elseif ($stream) { $stream.Dispose() }
        if ($reader) { $reader.Dispose() }
    }
}

$previous = @{}
$names = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS','PGCLIENTENCODING')
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$sqlFile = $null; $partFile = $null; $jsonFile = $null
$localStage = 'START'
try {
    Write-Host 'ONESHOT_EXPORT VERSION STREAMING_ROWS'
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
\warn ONESHOT_PHASE CONNECTED
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
\warn ONESHOT_PHASE SNAPSHOT_STARTED
DO $$
BEGIN
 IF to_regclass('public.club_registration_requests') IS NOT NULL THEN
  RAISE EXCEPTION 'ONESHOT_UNSUPPORTED_REGISTRATION_SCHEMA';
 END IF;
 IF EXISTS(SELECT 1 FROM public.club_worker WHERE lease_until>now()) THEN
  RAISE EXCEPTION 'ONESHOT_DESK_ACTIVE';
 END IF;
 IF EXISTS(SELECT 1 FROM public.club_commands WHERE status IN ('queued','running'))
 OR EXISTS(SELECT 1 FROM public.club_auth_requests WHERE status IN ('pending','running')) THEN
  RAISE EXCEPTION 'ONESHOT_PENDING_OPERATIONS';
 END IF;
END $$;
\warn ONESHOT_PHASE GUARDS_PASSED
SELECT jsonb_build_object('format','1shot-local-v1','exported_at',now())::text AS line;
\warn ONESHOT_PHASE TABLE_PROFILES
SELECT 'ONESHOT_TABLE profiles' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.profiles r;
\warn ONESHOT_PHASE TABLE_HOSTS_CACHE
SELECT 'ONESHOT_TABLE hosts_cache' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.hosts_cache r;
\warn ONESHOT_PHASE TABLE_RESERVATIONS
SELECT 'ONESHOT_TABLE reservations' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.reservations r;
\warn ONESHOT_PHASE TABLE_CLUB_SETTINGS
SELECT 'ONESHOT_TABLE club_settings' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.club_settings r;
\warn ONESHOT_PHASE TABLE_CLUB_BOOKINGS
SELECT 'ONESHOT_TABLE club_bookings' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.club_bookings r;
\warn ONESHOT_PHASE TABLE_CLUB_EVENTS
SELECT 'ONESHOT_TABLE club_events' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.club_events r;
\warn ONESHOT_PHASE TABLE_CLUB_ACCOUNTS
SELECT 'ONESHOT_TABLE club_accounts' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.club_accounts r;
\warn ONESHOT_PHASE TABLE_CLUB_COMMANDS
SELECT 'ONESHOT_TABLE club_commands' AS line;
SELECT (to_jsonb(r))::text AS line FROM public.club_commands r;
\warn ONESHOT_PHASE TABLE_CLUB_AUTH_REQUESTS
SELECT 'ONESHOT_TABLE club_auth_requests' AS line;
SELECT (to_jsonb(r)||jsonb_build_object('cipher',null))::text AS line FROM public.club_auth_requests r;
SELECT 'ONESHOT_END' AS line;
SELECT jsonb_build_object('profiles',(SELECT count(*) FROM public.profiles),'hosts_cache',(SELECT count(*) FROM public.hosts_cache),'reservations',(SELECT count(*) FROM public.reservations),'club_settings',(SELECT count(*) FROM public.club_settings),'club_bookings',(SELECT count(*) FROM public.club_bookings),'club_events',(SELECT count(*) FROM public.club_events),'club_accounts',(SELECT count(*) FROM public.club_accounts),'club_commands',(SELECT count(*) FROM public.club_commands),'club_auth_requests',(SELECT count(*) FROM public.club_auth_requests))::text AS line;
\warn ONESHOT_PHASE DATA_READ
COMMIT;
\warn ONESHOT_PHASE SNAPSHOT_FINISHED
'@
    [IO.File]::WriteAllText($sqlFile,$query,(New-Object Text.UTF8Encoding($false)))
    Write-Host 'Exporting through native PostgreSQL with strict SSL. Please wait...'
    # Environment values are inherited, NOT placed in process arguments. Never
    # print captured native stderr: older libraries can expose credentials.
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(docker run --rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges -v "${directory}:/transfer" -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE -e PGSSLROOTCERT -e PGCONNECT_TIMEOUT -e PGOPTIONS -e PGCLIENTENCODING --entrypoint psql postgres:17.7 -X -w -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -v FETCH_COUNT=200 -f "/transfer/$sqlName" -o "/transfer/$partName" 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
    foreach ($entry in $output) {
        $phase = ([string]$entry).Trim()
        if ($phase -cmatch '^ONESHOT_PHASE (CONNECTED|SNAPSHOT_STARTED|GUARDS_PASSED|DATA_READ|SNAPSHOT_FINISHED|TABLE_(PROFILES|HOSTS_CACHE|RESERVATIONS|CLUB_SETTINGS|CLUB_BOOKINGS|CLUB_EVENTS|CLUB_ACCOUNTS|CLUB_COMMANDS|CLUB_AUTH_REQUESTS))$') { Write-Host $phase }
    }
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
    elseif ($text -match 'SSL.*closed unexpectedly|SSL SYSCALL|unexpected EOF|EOF detected') { $result = 'TLS_CONNECTION_INTERRUPTED' }
    elseif ($text -match 'SSL|TLS') { $result = 'TLS_ERROR' }
    if ($result -ne 'OK') {
        Write-Host ('ONESHOT_EXPORT DATABASE ' + $result)
        # Show only native error headings, not SQL context, records or raw logs.
        # Redact credentials BEFORE truncation so a partial secret cannot escape.
        $printed = 0
        foreach ($nativeLine in ($text -split "[\r\n]+")) {
            if ($printed -ge 4) { break }
            $safe = $nativeLine.Trim()
            if ($safe -notmatch '^(psql:|(?:ERROR|FATAL|PANIC):|SSL error:|SSL SYSCALL error:)') { continue }
            foreach ($sensitive in @($line,$env:PGPASSWORD,[Uri]::EscapeDataString($env:PGPASSWORD),$env:PGUSER)) {
                if (-not [string]::IsNullOrEmpty($sensitive)) {
                    $safe = [regex]::Replace($safe,[regex]::Escape($sensitive),'[REDACTED]',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
                }
            }
            $safe = [regex]::Replace($safe,'[a-zA-Z][a-zA-Z0-9+.-]*://[^\s]+','[CONNECTION_REDACTED]')
            $safe = [regex]::Replace($safe,'[\x00-\x1f\x7f]',' ')
            if ($safe.Length -gt 500) { $safe = $safe.Substring(0,500) + '...' }
            Write-Host ('ONESHOT_EXPORT DETAIL ' + $safe)
            $printed++
        }
        exit 1
    }
    $localStage = 'PACKING'
    $jsonFile = Join-Path $directory ('export-' + $tag + '.json.part')
    $counts = Convert-ExportRows $partFile $jsonFile
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $jsonFile).Hash.ToLowerInvariant()
    $localStage = 'PUBLISHING'
    # File.Move does not overwrite. Never replace a previous export on retry.
    [IO.File]::Move($jsonFile,$file)
    $stream = [IO.File]::Open(($file + '.sha256'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $bytes = [Text.Encoding]::ASCII.GetBytes($hash); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash -ine [IO.File]::ReadAllText($file + '.sha256')) { throw 'Checksum mismatch' }
    Write-Host 'ONESHOT_EXPORT COMPLETE OK'
    Write-Host ('Profiles exported: ' + $counts['profiles'])
    Write-Host 'Export complete. Checksum verified. Files: private/club-export.json and private/club-export.json.sha256'
    Write-Host 'Do NOT send these personal-data files. Stop here: data has NOT been imported.'
} catch {
    Write-Host ('ONESHOT_EXPORT ' + $localStage + ' FAILED')
    Write-Host 'Raw errors suppressed. Check that this file is in the installed server folder.'
    exit 1
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
    $line = $null; $uri = $null; $parts = $null; $text = $null; $output = $null; $bundle = $null
    foreach ($temporary in @($sqlFile,$partFile,$jsonFile)) { if ($temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue } }
}
