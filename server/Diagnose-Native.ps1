# Read-only connection test with PostgreSQL's native client. No Deno or new secrets.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$previous = @{}
$names = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS')
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
    $directory = Join-Path $PSScriptRoot 'private'
    if (-not (Test-Path (Join-Path $directory 'supabase-ca.crt'))) { Write-Host 'ONESHOT_NATIVE CERTIFICATE MISSING'; exit 1 }
    $line = [IO.File]::ReadAllText((Join-Path $directory 'transfer.env')).Trim()
    if (-not $line.StartsWith('SOURCE_DATABASE_URL=')) { Write-Host 'ONESHOT_NATIVE CONFIG INVALID'; exit 1 }
    $uri = [Uri]$line.Substring('SOURCE_DATABASE_URL='.Length)
    if ($uri.Scheme -notin @('postgres','postgresql') -or $uri.Host -ne 'aws-1-eu-west-1.pooler.supabase.com' -or $uri.Port -ne 5432 -or $uri.Fragment -ne '') { Write-Host 'ONESHOT_NATIVE CONFIG INVALID'; exit 1 }
    $parts = $uri.UserInfo.Split(':',2)
    if ($parts.Count -ne 2) { Write-Host 'ONESHOT_NATIVE CONFIG INVALID'; exit 1 }
    $env:PGHOST = $uri.Host
    $env:PGPORT = '5432'
    $env:PGDATABASE = 'postgres'
    $env:PGUSER = [Uri]::UnescapeDataString($parts[0])
    $env:PGPASSWORD = [Uri]::UnescapeDataString($parts[1])
    if ($env:PGUSER -ne 'postgres.zqhfvtgktbfnxcclqqny' -or [string]::IsNullOrEmpty($env:PGPASSWORD)) { Write-Host 'ONESHOT_NATIVE CONFIG INVALID'; exit 1 }
    $env:PGSSLMODE = 'verify-full'
    $env:PGSSLROOTCERT = '/transfer/supabase-ca.crt'
    $env:PGCONNECT_TIMEOUT = '10'
    $env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=10000'
    Write-Host 'ONESHOT_NATIVE CONFIG OK'
    Write-Host 'Checking with native PostgreSQL client. No password entry needed; SSL verification remains enabled.'
    # Environment values are inherited, NOT placed in process arguments. Never
    # print captured native stderr: older libraries can expose credentials.
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(docker run --rm --pull=never --read-only --cap-drop=ALL --security-opt=no-new-privileges -v "${directory}:/transfer:ro" -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE -e PGSSLROOTCERT -e PGCONNECT_TIMEOUT -e PGOPTIONS --entrypoint psql postgres:17.7 -X -w -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c 'SELECT 1;' 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
    $result = 'FAILED'
    if ($code -eq 0 -and ($text -split "`n" | Where-Object { $_.Trim() -eq '1' })) { $result = 'OK' }
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
    Write-Host ('ONESHOT_NATIVE CONNECT ' + $result)
    Write-Host 'Send only ONESHOT_NATIVE lines. No database data was changed.'
    if ($result -ne 'OK') { exit 1 }
} catch {
    Write-Host 'ONESHOT_NATIVE START FAILED'
    Write-Host 'Raw errors suppressed. Check that this file is in the installed server folder.'
    exit 1
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
    $line = $null; $uri = $null; $parts = $null; $text = $null; $output = $null
}
